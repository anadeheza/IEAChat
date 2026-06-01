import * as dotenv from 'dotenv';
import axios from 'axios';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import prisma from '../prismaClient';
import * as fs from 'fs-extra';
import path from 'path';
import { pipeline } from 'stream/promises';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const s3 = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT,
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || '',
        secretAccessKey: process.env.MINIO_SECRET_KEY || '',
    },
    forcePathStyle: true,
});

const DOWNLOAD_BUCKET = process.env.MINIO_BUCKET || 'flock-attachments';
const SERVER_PORT = process.env.port || process.env.PORT || 3000;
const USE_LOCAL_FALLBACK = process.env.FORCE_LOCAL_STORAGE === '1' || false;

let currentAbortController: AbortController | null = null;

function getUniqueFileName(filePath: string): string {
    if (!fs.existsSync(filePath)) {
        return filePath;
    }

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);

    //WARN
    let counter = 1;
    while (true) {
        const newFileName = `${baseName} (${counter})${ext}`;
        const newPath = path.join(dir, newFileName);
        if (!fs.existsSync(newPath)) {
            return newPath;
        }
        counter++;
    }
}

export function cancelDownloads() {
    if (currentAbortController) {
        try { currentAbortController.abort(); } catch (e) { /* ignore */ }
    }
}

export async function downloadAttachment(attachment: any, signal?: AbortSignal): Promise<{ success: boolean; message: string }> {
    const fileName = attachment.fileName || `attachment-${attachment.id}`;
    const key = `attachments/${fileName}`;

    if (!attachment.url) {
        return { success: false, message: 'URL del adjunto inválida' };
    }

    const RETRIES = 3;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
            const response = await axios.get(attachment.url, {
                responseType: 'stream',
                timeout: 30_000,
                signal,
            });

            // BYTES
            const contentType = typeof response.headers['content-type'] === 'string'
                ? response.headers['content-type']
                : 'application/octet-stream';

            // Try to obtain content length from response headers or DB field 
            const headerLength = response.headers && (response.headers['content-length'] || response.headers['Content-Length']);
            const parsedHeaderLength = headerLength ? Number(headerLength) : NaN;
            const dbSize = attachment.sizeBytes ? Number(attachment.sizeBytes) : NaN;
            const contentLength = Number.isFinite(parsedHeaderLength) ? parsedHeaderLength : (Number.isFinite(dbSize) ? dbSize : undefined);

            const putParams: any = {
                Bucket: DOWNLOAD_BUCKET,
                Key: key,
                Body: response.data as Readable,
                ContentType: contentType,
            };

            if (typeof contentLength === 'number' && Number.isFinite(contentLength)) {
                putParams.ContentLength = contentLength;
            }

            console.debug(`Downloading attachment ${attachment.id} -> ${key} (contentLength=${putParams.ContentLength ?? 'unknown'})`);

            // If forced local or missing credentials, save to local storage/attachments
            const accessKey = process.env.MINIO_ACCESS_KEY || process.env.MINIO_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
            const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

            const shouldUseLocal = USE_LOCAL_FALLBACK || !(accessKey && secretKey);

            if (signal && signal.aborted) {
                return { success: false, message: 'Aborted' };
            }

            if (shouldUseLocal) {
                const storageDir = path.resolve(__dirname, '../../storage/attachments');
                await fs.ensureDir(storageDir);
                let outPath = path.join(storageDir, fileName);
                outPath = getUniqueFileName(outPath);
                const finalFileName = path.basename(outPath);
                
                const writeStream = fs.createWriteStream(outPath);
                await pipeline(response.data as Readable, writeStream);

                // const localUrl = `http://localhost:${SERVER_PORT}/storage/attachments/${encodeURIComponent(finalFileName)}`;
                // await prisma.attachment.update({ where: { id: attachment.id }, data: { isDownloaded: true, s3Key: localUrl } });

                //en lugar de guardar la url local guardamos la ruta relativa 
                const relativeKey = `/storage/attachments/${encodeURIComponent(finalFileName)}`;
                await prisma.attachment.update({ where: { id: attachment.id }, data: { isDownloaded: true, s3Key: relativeKey } });

                return { success: true, message: 'Guardado localmente' };
            }

            await s3.send(new PutObjectCommand(putParams));

            await prisma.attachment.update({
                where: { id: attachment.id },
                data: { isDownloaded: true, s3Key: key },
            });

            return { success: true, message: 'Descargado' };
        } catch (error: any) {
            console.error(`Error descargando adjunto ${attachment.id} (intento ${attempt}/${RETRIES}):`, error?.message || error);
            if (attempt === RETRIES) {
                return { success: false, message: String(error?.message || error) };
            }
            // backoff
            await new Promise(r => setTimeout(r, 1500 * attempt));
        }
    }
    return { success: false, message: 'Error desconocido' };
}

export async function downloadAttachmentsBatch(limit = 5, ids?: number[]) {
    const where = ids && ids.length > 0
        ? { id: { in: ids } }
        : { isDownloaded: false };

    const pending = await prisma.attachment.findMany({
        where,
        orderBy: { id: 'asc' },
        take: ids && ids.length > 0 ? undefined : limit,
    });

    const details = [] as Array<{ id: number; fileName: string; url: string; success: boolean; message: string }>;

    // Create a controller for this batch so it can be aborted externally
    const controller = new AbortController();
    currentAbortController = controller;

    try {
        for (const attachment of pending) {
            if (controller.signal.aborted) {
                details.push({ id: -1, fileName: 'ABORT', url: '', success: false, message: 'Aborted' });
                break;
            }
            const result = await downloadAttachment(attachment, controller.signal);
            details.push({
                id: attachment.id,
                fileName: attachment.fileName,
                url: attachment.url,
                success: result.success,
                message: result.message,
            });
        }
    } finally {
        // Clear controller when finished
        if (currentAbortController === controller) currentAbortController = null;
    }

    const downloaded = details.filter(item => item.success).length;
    const failed = details.length - downloaded;

    return { total: details.length, downloaded, failed, details };
}

export async function getTotalAttachmentBytes(): Promise<bigint> {
    const aggregate = await prisma.attachment.aggregate({ _sum: { sizeBytes: true } });
    return aggregate._sum.sizeBytes ?? BigInt(0);
}

export async function getRealStorageBytes(): Promise<bigint> {
    const downloaded = await prisma.attachment.findMany({
        where: { isDownloaded: true, s3Key: { not: null } },
        select: { id: true, s3Key: true },
    });

    let total = BigInt(0);

    for (const att of downloaded) {
        const key = att.s3Key!;
        try {
            if (key.startsWith('/storage/') || key.startsWith('http://localhost') || key.startsWith('http://127.')) {
                // Archivo local — medir en disco
                const fileName = decodeURIComponent(key.split('/').pop() || '');
                const filePath = path.resolve(__dirname, '../../storage/attachments', fileName);
                const info = await fs.stat(filePath);
                total += BigInt(info.size);
            } else {
                // Archivo en MinIO/S3
                const head = await s3.send(new HeadObjectCommand({
                    Bucket: DOWNLOAD_BUCKET,
                    Key: key,
                }));
                total += BigInt(head.ContentLength ?? 0);
            }
        } catch {
            // Archivo no encontrado o error de red — lo saltamos
        }
    }

    return total;
}