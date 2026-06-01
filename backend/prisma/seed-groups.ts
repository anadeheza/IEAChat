
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { JSDOM } from 'jsdom';

const prisma = new PrismaClient();

// ─── Rutas ────────────────────────────────────────────────────────────────────
const GROUPS_DIR    = path.join(__dirname, '../data/groups');
const CHANNELS_JSON = path.join(__dirname, '../data/channels.json');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extrae el GUID del nombre del archivo: "NombreGrupo-<guid>.html" → "<guid>" */
function extractGuid(filename: string): string | null {
    const match = filename.match(/-([a-f0-9]{32})\.html$/i);
    return match ? match[1] : null;
}

/** Limpia etiquetas <flockml> y <user> dejando solo el texto plano */
function cleanText(raw: string): string {
    return raw
        .replace(/<user[^>]*>([^<]*)<\/user>/gi, '$1')  // <user ...>@nombre</user> → @nombre
        .replace(/<\/?flockml>/gi, '')                   // <flockml> / </flockml>
        .replace(/<[^>]+>/g, '')                         // cualquier otra etiqueta HTML
        .replace(/\s+/g, ' ')
        .trim();
}

/** Parsea los mensajes de un archivo HTML de grupo */
function parseGroupHtml(filepath: string, channelId: string): Array<{
    timestamp: bigint;
    dateText: string;
    senderName: string;
    text: string;
    isGroup: boolean;
    sourceFile: string;
    channelId: string;
}> {
    const html = fs.readFileSync(filepath, 'utf-8');
    const dom  = new JSDOM(html);
    const rows = dom.window.document.querySelectorAll('tbody tr');
    const filename = path.basename(filepath);
    const messages = [];

    for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;

        const timeCell   = cells[0];
        const senderCell = cells[1];
        const msgCell    = cells[2];

        const dataOrder  = timeCell.getAttribute('data-order');
        const dateText   = timeCell.textContent?.trim() ?? '';
        const senderName = senderCell.textContent?.trim() ?? '';
        const rawText    = msgCell.innerHTML ?? '';
        const text       = cleanText(rawText);

        if (!dataOrder || !senderName) continue;

        messages.push({
            timestamp:  BigInt(dataOrder),
            dateText,
            senderName,
            text,
            isGroup:    true,
            sourceFile: filename,
            channelId,
        });
    }

    return messages;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('📦 Leyendo channels.json...');
    const channelsRaw: Array<{ id: string; name: string; description?: string }> =
        JSON.parse(fs.readFileSync(CHANNELS_JSON, 'utf-8'));

    // Construir mapa guid → channel info
    const channelMap = new Map(channelsRaw.map(c => [c.id, c]));

    // Listar archivos HTML en groups/
    const files = fs.readdirSync(GROUPS_DIR).filter(f => f.endsWith('.html'));
    console.log(`📂 ${files.length} archivos encontrados en data/groups/`);

    let totalChannels  = 0;
    let totalMessages  = 0;
    let skippedFiles   = 0;

    for (const filename of files) {
        const guid = extractGuid(filename);

        if (!guid) {
            // Archivos especiales tipo "TODOS-318801_lobby.html" sin guid estándar
            // Intentar buscar por nombre
            console.warn(`⚠️  Sin GUID en nombre: ${filename} — omitido`);
            skippedFiles++;
            continue;
        }

        const channelInfo = channelMap.get(guid);
        if (!channelInfo) {
            console.warn(`⚠️  GUID ${guid} no encontrado en channels.json — omitido`);
            skippedFiles++;
            continue;
        }

        // Upsert del canal
        await prisma.channel.upsert({
            where:  { id: channelInfo.id },
            update: { name: channelInfo.name, description: channelInfo.description ?? null },
            create: { id: channelInfo.id,     name: channelInfo.name, description: channelInfo.description ?? null },
        });
        totalChannels++;

        // Parsear mensajes del HTML
        const filepath = path.join(GROUPS_DIR, filename);
        const messages = parseGroupHtml(filepath, channelInfo.id);

        if (messages.length === 0) {
            console.log(`   ↳ ${channelInfo.name}: sin mensajes`);
            continue;
        }

        // Insertar en lotes de 100 para no sobrecargar SQLite
        const BATCH = 100;
        let inserted = 0;
        for (let i = 0; i < messages.length; i += BATCH) {
            const batch = messages.slice(i, i + BATCH);
            await prisma.message.createMany({
                data:           batch,
            });
            inserted += batch.length;
        }

        totalMessages += inserted;
        console.log(`   ✅ ${channelInfo.name}: ${inserted} mensajes`);
    }

    console.log('\n─────────────────────────────────────────');
    console.log(`✔  Canales insertados/actualizados : ${totalChannels}`);
    console.log(`✔  Mensajes insertados             : ${totalMessages}`);
    console.log(`⚠️  Archivos omitidos               : ${skippedFiles}`);
    console.log('─────────────────────────────────────────\n');
}

main()
    .catch(e => { console.error('❌ Error:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());