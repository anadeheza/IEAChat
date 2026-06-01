import { Request, RequestHandler } from 'express';
import prisma from '../prismaClient';
import * as path from 'path';
import * as fs from 'fs';
import { downloadAttachmentsBatch as downloadAttachmentsBatchService, getTotalAttachmentBytes, getRealStorageBytes, cancelDownloads as cancelDownloadsService } from '../services/attachmentDownloader';

// Helper para convertir BigInt a string (recursivo)
const sanitize = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(sanitize);
    if (typeof obj === 'object') {
        const newObj: any = {};
        for (const [key, value] of Object.entries(obj)) {
            newObj[key] = sanitize(value);
        }
        return newObj;
    }
    return obj;
};

// Helper — 
function resolveAttachmentUrl(s3Key: string | null, req: Request): string | null {
    if (!s3Key || s3Key.trim() === '') return null;

    // Limpiar espacios
    const cleanKey = s3Key.trim();

    // Si ya es absoluta, devolver tal cual (mejor validar que sea URL válida)
    if (cleanKey.startsWith('http://') || cleanKey.startsWith('https://')) {
        try {
            new URL(cleanKey); // lanza error si no es válida
            return cleanKey;
        } catch {
            console.warn(`URL inválida en s3Key: ${cleanKey}`);
            // continuar como si fuera relativa
        }
    }

    // Asegurar que empiece con '/' (para rutas relativas al host)
    const relativePath = cleanKey.startsWith('/') ? cleanKey : `/${cleanKey}`;

    // Determinar protocolo (respetando proxy)
    let proto = req.protocol;
    if (req.headers['x-forwarded-proto']) {
        const forwarded = req.headers['x-forwarded-proto'];
        proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    }

    // Determinar host (sin doble puerto)
    let host = req.get('host') || '';
    if (req.headers['x-forwarded-host']) {
        const forwardedHost = req.headers['x-forwarded-host'];
        host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
    }

    // Si no hay host, fallback (no debería pasar)
    if (!host) {
        console.error('No se pudo determinar el host para resolver URL');
        return null;
    }

    // Construir URL final
    return `${proto}://${host}${relativePath}`;
}

const getId = (param: string | string[] | undefined): string | undefined => {
    if (typeof param === 'string') return param;
    return undefined;
};

export const listChannels: RequestHandler = async (req, res) => {
    try {
        const channels = await prisma.channel.findMany({
            include: { _count: { select: { messages: true } } },
        });
        res.json(sanitize(channels));
    } catch (error) {
        res.status(500).json({ message: 'Error', error });
    }
};

export const channelMessages: RequestHandler = async (req, res) => {
    try {
        const id = getId(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID inválido' });

        const take = Number(req.query.take) || 50;
        const beforeId = req.query.beforeId ? Number(req.query.beforeId as string) : undefined;

        const totalCount = await prisma.message.count({ where: { channelId: id } });
        const where: any = { channelId: id };
        if (beforeId) where.id = { lt: beforeId };

        let messages = await prisma.message.findMany({
            where,
            include: { attachments: true },
            orderBy: { id: 'desc' },
            take,
        });
        messages = messages.reverse();

        res.setHeader('X-Total-Count', totalCount.toString());
        res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
        res.json(sanitize(messages));
    } catch (error) {
        console.error('Error en channelMessages:', error);
        res.status(500).json({ message: 'Error', error: String(error) });
    }
};

export const userMessages: RequestHandler = async (req, res) => {
    try {
        const id = getId(req.params.id);
        console.log('✅ userMessages fue llamada con ID:', id);
        if (!id) return res.status(400).json({ message: 'ID inválido' });

        const take = Number(req.query.take) || 50;
        const beforeId = req.query.beforeId ? Number(req.query.beforeId as string) : undefined;

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const totalCountById = await prisma.message.count({ where: { userId: id } });
        const totalCountBySender = await prisma.message.count({ where: { senderName: user.name } });

        let totalCount = totalCountById > 0 ? totalCountById : totalCountBySender;
        const whereById: any = { userId: id };
        const whereBySender: any = { senderName: user.name };
        if (beforeId) {
            whereById.id = { lt: beforeId };
            whereBySender.id = { lt: beforeId };
        }

        // 1. Buscar por userId
        let messages = await prisma.message.findMany({
            where: whereById,
            include: { attachments: true },
            orderBy: { id: 'desc' },
            take,
        });

        // 2. Si no hay, buscar por senderName
        if (messages.length === 0) {
            messages = await prisma.message.findMany({
                where: whereBySender,
                include: { attachments: true },
                orderBy: { id: 'desc' },
                take,
            });
            totalCount = totalCountBySender;
            if (messages.length > 0) {
                console.log(`✅ Encontrados ${messages.length} mensajes por senderName: ${user.name}`);
            }
        }
        messages = messages.reverse();

        res.setHeader('X-Total-Count', totalCount.toString());
        res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
        res.json(sanitize(messages));
    } catch (error) {
        console.error('Error en userMessages:', error);
        res.status(500).json({ message: 'Error', error: String(error) });
    }
};
export const listUsers: RequestHandler = async (req, res) => {
    try {
        // Capturamos el correo del usuario que está navegando la app
        const currentUserEmail = req.headers['x-user-email'] as string;

        // Traemos todos los usuarios del sistema ordenados por nombre
        const users = await prisma.user.findMany({
            orderBy: { name: 'asc' },
        });

        // Si el usuario no inició sesión o no viene el header, devolvemos la lista con conteo en 0
        if (!currentUserEmail) {
            const fallbackUsers = users.map(u => ({ ...u, _count: { messages: 0 } }));
            return res.json(sanitize(fallbackUsers));
        }

        // Buscamos el nombre del usuario logueado en la base de datos
        const currentUser = await prisma.user.findUnique({ where: { email: currentUserEmail } });
        const currentName = currentUser ? currentUser.name : '';

        // Recorremos la lista de usuarios de forma asíncrona para inyectarles el conteo de mensajes
        const usersWithCount = await Promise.all(users.map(async (user) => {
            
            // 1. Contamos mensajes donde este usuario me escribió a mí (su nombre figura como sender y mi mail está en el sourceFile)
            const receivedCount = await prisma.message.count({
                where: {
                    senderName: user.name,
                    sourceFile: { contains: currentUserEmail }
                }
            });

            // 2. Contamos mensajes que yo le mandé a él (mi nombre figura como sender y su mail está en el archivo origen)
            const sentCount = await prisma.message.count({
                where: {
                    senderName: currentName,
                    sourceFile: { contains: user.email }
                }
            });

            // Retornamos el objeto usuario extendido con la estructura que tu script.js ya sabe leer (_count.messages)
            return {
                ...user,
                _count: {
                    messages: receivedCount + sentCount
                }
            };
        }));

        res.json(sanitize(usersWithCount));
    } catch (error) {
        console.error('Error en listUsers con contadores:', error);
        res.status(500).json({ message: 'Error en el servidor al listar usuarios', error: String(error) });
    }
};

export const searchMessages: RequestHandler = async (req, res) => {
    try {
        const q = (req.query.q as string) || '';
        if (!q.trim()) return res.status(400).json({ message: 'Falta el parámetro q' });

        const messages = await prisma.message.findMany({
            where: { text: { contains: q } },
            include: { attachments: true },
            orderBy: { id: 'desc' },
            take: 100,
        });
        res.json(sanitize(messages));
    } catch (error) {
        res.status(500).json({ message: 'Error', error });
    }
};

export const listAttachments: RequestHandler = async (req, res) => {
    try {
        const downloaded = req.query.downloaded;
        const all = req.query.all === 'true';
        const userEmail = req.headers['x-user-email'] as string | undefined;

        let where: any = {};

        if (!all && userEmail) {
            const currentUser = await prisma.user.findUnique({ where: { email: userEmail } });
            if (currentUser) {
                where.message = {
                    OR: [
                        { userId: currentUser.id },
                        { senderName: currentUser.name },
                    ],
                };
            }
        }

        if (downloaded === 'false') {
            where.isDownloaded = false;
        } else if (downloaded === 'true') {
            where.isDownloaded = true;
        }

        const take = all ? undefined : Number(req.query.take) || 200;
        const attachments = await prisma.attachment.findMany({
            where,
            include: { message: { select: { sourceFile: true, senderName: true } } },
            orderBy: { id: 'asc' },
            take,
        });
        const resolved = attachments.map(att => ({
            ...att,
            s3Key: resolveAttachmentUrl(att.s3Key, req),
        }));
        res.json(sanitize(resolved));
        // res.json(sanitize(attachments));
    } catch (error) {
        res.status(500).json({ message: 'Error', error });
    }
};

export const listAttachmentsById: RequestHandler = async (req, res) => {
    try {
        const id = Number(req.params.id);
        console.log('✅ listAttachmentsById fue llamada con ID:', id);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ message: 'ID inválido' });
        }

        const attachment = await prisma.attachment.findUnique({
            where: { id },
            include: { message: { select: { sourceFile: true, senderName: true } } },
        });

        if (!attachment) {
            return res.status(404).json({ message: 'Adjunto no encontrado' });
        }

        res.json(sanitize({
            ...attachment,
            s3Key: resolveAttachmentUrl(attachment.s3Key, req),
        }));
        // res.json(sanitize(attachment));
    } catch (error) {
        res.status(500).json({ message: 'Error', error });
    }
};

export const downloadAttachmentsBatch: RequestHandler = async (req, res) => {
    try {
        const limit = Number(req.body.limit) || 5;
        const ids = Array.isArray(req.body.ids) ? req.body.ids.map((id: any) => Number(id)).filter(Number.isInteger) : undefined;
        const result = await downloadAttachmentsBatchService(limit, ids);
        res.json(sanitize(result));
    } catch (error) {
        res.status(500).json({ message: 'Error al descargar adjuntos', error: String(error) });
    }
};

export const downloadAllAttachments: RequestHandler = async (req, res) => {
    try {
        const batchSize = Number(req.body?.batchSize || req.query?.batchSize) || undefined;
        const force = req.body?.force === true || req.query?.force === 'true' || false;

        // Build the list of IDs to process depending on 'force'
        const rows = await prisma.attachment.findMany({ select: { id: true, isDownloaded: true } });
        let ids = rows.map(r => r.id);
        if (!force) {
            // Filter out already-downloaded ids
            const pendingRows = await prisma.attachment.findMany({ where: { isDownloaded: false }, select: { id: true } });
            ids = pendingRows.map(r => r.id);
        }

        const total = ids.length;
        if (total === 0) return res.json(sanitize({ total: 0, processed: 0, downloaded: 0, failed: 0, remaining: 0, details: [] }));

        // If no batchSize specified, process all at once (use with caution)
        const toProcess = batchSize ? ids.slice(0, batchSize) : ids;

        const result = await downloadAttachmentsBatchService(undefined, toProcess);

        const processed = toProcess.length;
        const remaining = Math.max(0, total - processed);

        res.json(sanitize({ total, processed, downloaded: result.downloaded, failed: result.failed, remaining, details: result.details }));
    } catch (error) {
        res.status(500).json({ message: 'Error al descargar todos los adjuntos', error: String(error) });
    }
};

export const cancelDownloads: RequestHandler = async (req, res) => {
    try {
        cancelDownloadsService();
        res.json(sanitize({ status: 'cancelled', message: 'Cancel request received' }));
    } catch (error) {
        res.status(500).json({ message: 'Error cancelling downloads', error: String(error) });
    }
};

export const getRealSize: RequestHandler = async (req, res) => {
    try {
        const totalBytes = await getRealStorageBytes();
        res.json(sanitize({ totalBytes }));
    } catch (error) {
        res.status(500).json({ message: 'Error calculando tamaño real', error: String(error) });
    }
};

export const stats: RequestHandler = async (req, res) => {
    try {
        const [totalMessages, totalAttachments, totalChannels, totalUsers, pendingDownloads, totalAttachmentBytes] =
            await Promise.all([
                prisma.message.count(),
                prisma.attachment.count(),
                prisma.channel.count(),
                prisma.user.count(),
                prisma.attachment.count({ where: { isDownloaded: false } }),
                getTotalAttachmentBytes(),
            ]);

        res.json(sanitize({
            totalMessages,
            totalAttachments,
            totalChannels,
            totalUsers,
            pendingDownloads,
            totalAttachmentBytes,
        }));
    } catch (error) {
        res.status(500).json({ message: 'Error', error });
    }
};

export const signIn: RequestHandler = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'El correo electrónico es requerido.' });
        const user = await prisma.user.findUnique({ where: { email: email.trim() } });
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado en el archivo.' });
        res.json(sanitize({ id: user.id, name: user.name, email: user.email }));
    } catch (error) {
        res.status(500).json({ message: 'Error del servidor al autenticar', error });
    }
};

export const dmConversation: RequestHandler = async (req, res) => {
    try {
        const otherUserId = getId(req.params.id);
        const currentUserEmail = req.query.currentUserEmail as string;

        if (!otherUserId || !currentUserEmail) {
            return res.status(400).json({ message: 'Faltan parámetros' });
        }

        const take = Number(req.query.take) || 50;
        const beforeId = req.query.beforeId ? Number(req.query.beforeId as string) : undefined;

        // Buscar el otro usuario para obtener su email y nombre
        const otherUser = await prisma.user.findUnique({ where: { id: otherUserId } });
        if (!otherUser) return res.status(404).json({ message: 'Usuario no encontrado' });

        // Buscar el usuario logueado para obtener su nombre
        const currentUser = await prisma.user.findUnique({ where: { email: currentUserEmail } });
        if (!currentUser) return res.status(404).json({ message: 'Usuario logueado no encontrado' });

        const receivedWhere: any = {
            senderName: otherUser.name,
            sourceFile: { contains: currentUserEmail },
        };
        const sentWhere: any = {
            senderName: currentUser.name,
            sourceFile: { contains: otherUser.email },
        };
        if (beforeId) {
            receivedWhere.id = { lt: beforeId };
            sentWhere.id = { lt: beforeId };
        }

        const receivedByMe = prisma.message.findMany({
            where: receivedWhere,
            include: { attachments: true },
            orderBy: { id: 'desc' },
            take,
        });

        const sentByMe = prisma.message.findMany({
            where: sentWhere,
            include: { attachments: true },
            orderBy: { id: 'desc' },
            take,
        });

        const [received, sent] = await Promise.all([receivedByMe, sentByMe]);
        const all = [...received, ...sent].sort((a, b) => Number(a.id) - Number(b.id));
        const paginated = all.slice(-take);

        const totalReceived = await prisma.message.count({
            where: {
                senderName: otherUser.name,
                sourceFile: { contains: currentUserEmail },
            }
        });
        const totalSent = await prisma.message.count({
            where: {
                senderName: currentUser.name,
                sourceFile: { contains: otherUser.email },
            }
        });
        const totalCount = totalReceived + totalSent;

        res.setHeader('X-Total-Count', totalCount.toString());
        res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
        res.json(sanitize(paginated));
    } catch (error) {
        console.error('Error en dmConversation:', error);
        res.status(500).json({ message: 'Error', error: String(error) });
    }
};

export const queryFileWithoutDownload: RequestHandler = async (req, res) => {
    console.log('✅ queryFileWithoutDownload fue llamada');

    try {
        let { file, id } = req.body; // aceptamos { file } o { id }

        // Buscar por id si se proporcionó
        let attachmentRecord: any = undefined;
        if (id !== undefined && id !== null) {
            const aid = Number(id);
            if (!Number.isInteger(aid)) return res.status(400).json({ message: 'ID inválido' });
            attachmentRecord = await prisma.attachment.findUnique({ where: { id: aid }, include: { message: true } });
            if (!attachmentRecord) return res.status(404).json({ message: 'Adjunto no encontrado (por id)' });

            // Preferir la URL original si está presente, sino usar s3Key para construir la URL al storage/local
            if (attachmentRecord.url) {
                file = attachmentRecord.url;
            } else if (attachmentRecord.s3Key) {
                const s3 = attachmentRecord.s3Key;
                if (s3.startsWith('/storage/') || s3.startsWith('storage/')) {
                    const proto = req.protocol;
                    const host = req.get('host') || 'localhost:3000';
                    const rel = s3.startsWith('/') ? s3 : `/${s3}`;
                    file = `${proto}://${host}${rel}`;
                } else {
                    file = attachmentRecord.s3Key;
                }
            }
        }

        if (!file) {
            return res.status(400).json({ message: 'Falta la URL del archivo' });
        }

        const urlObj = new URL(file);

        // Intentar resolver el attachment en la base de datos por su URL original si no vinimos por id
        if (!attachmentRecord) {
            attachmentRecord = await prisma.attachment.findFirst({ where: { url: file }, include: { message: true } });
            if (!attachmentRecord) {
                // probar con URL decodificada y sin query params
                try {
                    const decoded = decodeURIComponent(file);
                    if (decoded !== file) attachmentRecord = await prisma.attachment.findFirst({ where: { url: decoded }, include: { message: true } });
                } catch (e) {
                    // ignore decode errors
                }
            }
            if (!attachmentRecord) {
                const noQuery = file.split('?')[0];
                if (noQuery !== file) {
                    attachmentRecord = await prisma.attachment.findFirst({ where: { url: noQuery }, include: { message: true } });
                }
            }
        }

        if (attachmentRecord) {
            console.log('🔎 Attachment encontrado en DB id=', attachmentRecord.id, 's3Key=', attachmentRecord.s3Key);
        } else {
            console.log('🔎 Attachment no encontrado en DB para URL:', file);
        }

        const filenameParam = urlObj.searchParams.get('filename') || '';
        const ext = path.extname(filenameParam).toLowerCase();

        // Clasificación de Grupos Extendidos
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
        const txtExtensions = ['.txt', '.json', '.csv', '.log', '.xml', '.html', '.md'];
        
        // Documentos de diseño, ingeniería y ofimática solicitados
        const docExtensions = [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', 
            '.cdr', '.ai', '.dxf', '.ppt', '.pptx'
        ];

        // 1. PROCESO DE IMÁGENES (Bypass a Base64)
        if (imageExtensions.includes(ext) || file.includes('image')) {
            // Si existe registro en DB y tiene s3Key, preferirlo para resolver la ruta exacta
            if (attachmentRecord && attachmentRecord.s3Key) {
                const s3 = attachmentRecord.s3Key;
                // Si el s3Key es relativo al storage, construir ruta absoluta al archivo en disco
                if (s3.startsWith('/storage/') || s3.startsWith('storage/')) {
                    const storageRoot = path.resolve(__dirname, '../../storage');
                    const rel = s3.replace(/^\/?storage\//, '');
                    const abs = path.join(storageRoot, rel);
                    if (fs.existsSync(abs)) {
                        const buffer = await fs.promises.readFile(abs);
                        const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string,string>;
                        const contentType = map[ext] || attachmentRecord.contentType || 'application/octet-stream';
                        return res.json(sanitize({ status: 'success', type: 'image', content: `data:${contentType};base64,${buffer.toString('base64')}`, message: 'Imagen codificada (desde s3Key DB).' }));
                    }
                }
                // Si s3Key es URL absoluta, intentar fetch remoto de la s3Key
                if (s3.startsWith('http://') || s3.startsWith('https://')) {
                    const responseRemote = await fetch(s3);
                    if (responseRemote.ok) {
                        const arrayBuffer = await responseRemote.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        const contentType = responseRemote.headers.get('content-type') || attachmentRecord.contentType || 'image/png';
                        return res.json(sanitize({ status: 'success', type: 'image', content: `data:${contentType};base64,${buffer.toString('base64')}`, message: 'Imagen codificada (desde s3Key remoto).' }));
                    }
                }
                // si falla la resolución por s3Key, continuamos con el flujo normal
            }
            // Si la URL apunta al storage local servido por este backend, leemos desde disco
            if (urlObj.pathname && urlObj.pathname.startsWith('/storage/')) {
                const storageRoot = path.resolve(__dirname, '../../storage');
                // Intentamos varias variantes: ruta tal cual, decodificada y quitando sufijos tipo " (1)"
                let relPath = urlObj.pathname.replace(/^\/storage\//, '');
                const tried = [] as string[];

                const tryStat = (candidateRel: string) => {
                    const abs = path.join(storageRoot, candidateRel);
                    tried.push(abs);
                    return fs.existsSync(abs) ? abs : null;
                };

                // 1. probar ruta decodificada completa
                let candidate = tryStat(decodeURIComponent(relPath));
                // 2. probar ruta tal cual
                if (!candidate) candidate = tryStat(relPath);

                // 3. si aún no existe, intentar quitar sufijos " (n)" del nombre del archivo (antes de la extensión)
                if (!candidate) {
                    const dir = path.dirname(relPath);
                    const base = path.basename(relPath);
                    const extname = path.extname(base);
                    const nameWithoutExt = base.slice(0, base.length - extname.length);

                    // eliminar solo sufijos numéricos entre paréntesis al final, p. ej. "file (1).png"
                    const stripped = nameWithoutExt.replace(/\s*\(\d+\)$/g, '');
                    if (stripped !== nameWithoutExt) {
                        const newBase = stripped + extname;
                        const newRel = path.join(dir, newBase);
                        candidate = tryStat(decodeURIComponent(newRel)) || tryStat(newRel);
                    }
                }

                if (!candidate) {
                    console.warn('No se encontró archivo en storage. Rutas probadas:', tried);
                    return res.status(404).json({ message: 'Imagen no encontrada en storage.' });
                }

                const buffer = await fs.promises.readFile(candidate);
                const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string,string>;
                const contentType = map[ext] || 'application/octet-stream';

                return res.json(sanitize({
                    status: "success",
                    type: "image",
                    content: `data:${contentType};base64,${buffer.toString('base64')}`,
                    message: "Imagen codificada (local)."
                }));
            }

            // Fallback: intentar fetch remoto
            const response = await fetch(file);
            if (!response.ok) return res.status(404).json({ message: 'Imagen no accesible en Flock.' });

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const contentType = response.headers.get('content-type') || 'image/png';

            return res.json(sanitize({
                status: "success",
                type: "image",
                content: `data:${contentType};base64,${buffer.toString('base64')}`,
                message: "Imagen codificada."
            }));
        }

        // 2. PROCESO DE TEXTO PLANO
        if (txtExtensions.includes(ext)) {
            const response = await fetch(file);
            if (!response.ok) return res.status(404).json({ message: 'Texto no accesible.' });
            
            const fullText = await response.text();
            const truncatedText = fullText.substring(0, 7000) + (fullText.length > 7000 ? "\n\n...[Truncado]..." : "");

            return res.json(sanitize({
                status: "success",
                type: "text",
                content: truncatedText,
                message: "Texto leído."
            }));
        }

        // 3. DOCUMENTOS PESADOS Y CASO ESPECIAL PDF (Ignora si la metadata dice 0 B)
        // Pasamos la URL original de internet para que el motor web del visor la renderice online
        if (docExtensions.includes(ext) || ext === '.pdf') {
            return res.json(sanitize({
                status: "success",
                type: ext === '.pdf' ? "pdf" : "document",
                file: file, // URL con sus tokens de acceso originales intactos
                message: "Enrutando documento al visor interactivo."
            }));
        }

        // 4. Caso no soportado de manera nativa (.zip, .rar, etc.)
        return res.json(sanitize({
            status: "metadata",
            type: "unknown",
            file: file,
            message: `El archivo con extensión ${ext} no cuenta con visor rápido disponible. Puede descargarlo directamente.`
        }));

    } catch (error) {
        console.error('Error en queryFileWithoutDownload extendido:', error);
        res.status(500).json({ message: 'Error al procesar la preview extendida', error: String(error) });
    }
};

/*
export const queryFileWithoutDownload: RequestHandler = async (req, res) => {
    try {
        const { file } = req.body; 

        if (!file) {
            return res.status(400).json({ message: 'Falta el identificador del archivo' });
        }

        // Limpieza básica de caracteres extras
        const cleanPath = file.replace('#s3:', '').split('?')[0];

        // 🔍 DIAGNÓSTICO: Vamos a calcular 3 rutas posibles comunes
        const opcionA = path.resolve(__dirname, '../../storage', cleanPath);
        const opcionB = path.resolve(__dirname, '../../', cleanPath); 
        const opcionC = path.resolve(__dirname, '../', cleanPath);

        // Imprimimos todo en la terminal/consola del backend
        console.log("====== DIAGNÓSTICO DE RUTA ======");
        console.log("1. Lo que viene del frontend (req.body.file):", file);
        console.log("2. String limpio de subcarpetas (cleanPath):", cleanPath);
        console.log("3. Ruta absoluta Opción A (en ../../storage):", opcionA, " -> ¿Existe?:", fs.existsSync(opcionA));
        console.log("4. Ruta absoluta Opción B (en la raíz del proyecto):", opcionB, " -> ¿Existe?:", fs.existsSync(opcionB));
        console.log("5. Ruta absoluta Opción C (en ../):", opcionC, " -> ¿Existe?:", fs.existsSync(opcionC));
        console.log("=================================");

        // Devolvemos las opciones al frontend temporalmente para leerlas allá también
        return res.json({
            status: "diagnostico",
            message: "Revisa la terminal de tu backend para ver los logs.",
            analisis: { file, cleanPath, opcionA_existe: fs.existsSync(opcionA), opcionB_existe: fs.existsSync(opcionB) }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: String(error) });
    }
};
*/