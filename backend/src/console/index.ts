import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';
import * as fs from 'fs-extra';
import path from 'path';
import axios from 'axios';

const prisma = new PrismaClient();

const BASE_DATA_PATH = path.join(__dirname, '../../data');

// ─── Helper: parsear y guardar adjuntos 
async function processAttachments(
    $: cheerio.CheerioAPI,
    cell: ReturnType<typeof $>[0],  
    messageId: number
) {
    const links = $(cell).find('a');
    for (const link of links.toArray()) {
        const url = $(link).attr('href');
        if (!url?.includes('flock.com/hades/files')) continue;

        const fileName = new URL(url).searchParams.get('filename') || 'file';

        try {
            const res = await axios.head(url, { timeout: 10_000 });

            const contentLength = res.headers['content-length'];
            const sizeBytes = BigInt(typeof contentLength === 'string' ? contentLength : '0');
            const contentType = typeof res.headers['content-type'] === 'string'
                ? res.headers['content-type']
                : null;

            await prisma.attachment.create({
                data: {
                    url,
                    fileName,
                    sizeBytes,
                    contentType,
                    isDownloaded: false,
                    messageId,
                },
            });
        } catch {
            await prisma.attachment.create({
                data: {
                    url,
                    fileName,
                    sizeBytes: BigInt(0),
                    isDownloaded: false,
                    messageId,
                },
            });
            console.warn(`  ⚠ No se pudo hacer HEAD del adjunto: ${fileName}`);
        }
    }
}

// ─── Helper: procesar todos los mensajes de un HTML ──────────────────────────
async function processHtmlFile(
    filePath: string,
    fileName: string,
    isGroup: boolean,
    userId: string | null,
    channelId: string | null
) {
    const alreadyImported = await prisma.message.findFirst({ where: { sourceFile: fileName } });
    if (alreadyImported) {
        console.log(`  ↩ Ya importado, saltando: ${fileName}`);
        return;
    }

    const html = await fs.readFile(filePath, 'utf-8');
    const $ = cheerio.load(html);
    const rows = $('table#example tbody tr').toArray();

    // Antes del loop de rows, verificar que el userId existe
    if (userId) {
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            await prisma.user.create({
                data: {
                    id: userId,
                    email: `unknown_${userId}@unknown.com`,
                    name: 'Usuario desconocido',
                },
            });
            console.warn(`  ⚠ Usuario ${userId} no encontrado en users.json, creado como desconocido`);
        }
    }

    for (const row of rows) {
        const cols = $(row).find('td');
        const timestamp = BigInt($(cols[0]).attr('data-order') || '0');
        const senderName = $(cols[1]).text().trim();

        const msg = await prisma.message.create({
            data: {
                timestamp,
                dateText: $(cols[0]).text().trim(),
                senderName,
                text: $(cols[2]).text().trim(),
                isGroup,
                sourceFile: fileName,
                userId,
                channelId: channelId ?? undefined,  // ✅ FIX: null → undefined para Prisma
            },
        });

        await processAttachments($, cols.get(2)!, msg.id);  // ✅ FIX: .get() devuelve Element
    }

    console.log(`  ✔ ${rows.length} mensajes importados`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('=== flock-backup importer ===\n');

    console.log('📥 Importando usuarios...');
    const usersJson = await fs.readJson(path.join(BASE_DATA_PATH, 'users.json'));

    for (const u of usersJson) {
        try {
            await prisma.user.upsert({
                where: { id: u.guid },
                update: { 
                    name: `${u.name.firstName} ${u.name.lastName}`,
                    email: u.email 
                },
                create: {
                    id: u.guid,
                    email: u.email,
                    name: `${u.name.firstName} ${u.name.lastName}`,
                },
            });
        } catch (e: any) {
            if (e.code === 'P2002') {
                console.warn(`  ⚠ Usuario duplicado, saltando: ${u.email}`);
            } else {
                throw e;
            }
        }
    }

    console.log(`  ✔ ${usersJson.length} usuarios sincronizados\n`);

    console.log('📥 Importando canales...');
    const channelsJson = await fs.readJson(path.join(BASE_DATA_PATH, 'channels.json'));
    for (const c of channelsJson) {
        await prisma.channel.upsert({
            where: { id: c.id },
            update: { name: c.name, description: c.description ?? null },
            create: { id: c.id, name: c.name, description: c.description ?? null },
        });
    }
    console.log(`  ✔ ${channelsJson.length} canales sincronizados\n`);

    console.log('💬 Procesando chats 1 a 1 (DMs)...');
    const userFolder = path.join(BASE_DATA_PATH, 'users');
    const dmFiles = (await fs.readdir(userFolder)).filter(f => f.endsWith('.html'));

    for (const [i, file] of dmFiles.entries()) {
        console.log(`[${i + 1}/${dmFiles.length}] DM: ${file}`);
        const userId = file.split(',')[0] ?? null;
        await processHtmlFile(path.join(userFolder, file), file, false, userId, null);
    }
    console.log(`\n  ✔ DMs procesados: ${dmFiles.length}\n`);

    console.log('👥 Procesando grupos...');
    const groupFolder = path.join(BASE_DATA_PATH, 'groups');
    const groupFiles = (await fs.readdir(groupFolder)).filter(f => f.endsWith('.html'));

    for (const [i, file] of groupFiles.entries()) {
        console.log(`[${i + 1}/${groupFiles.length}] Grupo: ${file}`);
        const parts = file.replace('.html', '').split('-');
        const channelId = parts[parts.length - 1] ?? null;
        await processHtmlFile(path.join(groupFolder, file), file, true, null, channelId);
    }
    console.log(`\n  ✔ Grupos procesados: ${groupFiles.length}\n`);

    console.log('🎉 Importación completa.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());