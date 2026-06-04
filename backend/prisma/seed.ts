import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const prisma = new PrismaClient();

// ─── Rutas ────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data');
const USERS_JSON = path.join(DATA_DIR, 'users.json');
const CHANNELS_JSON = path.join(DATA_DIR, 'channels.json');
const GROUPS_DIR = path.join(DATA_DIR, 'groups');

// ─── Helpers ─────────────────────────────────────────

function extractGuid(filename: string): string | null {
  const match = filename.match(/-([a-f0-9]{32})\.html$/i);
  return match ? match[1] : null;
}

function cleanText(raw: string): string {
  return raw
    .replace(/<user[^>]*>([^<]*)<\/user>/gi, '$1')
    .replace(/<\/?flockml>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGroupHtml(filepath: string, channelId: string): Array<{
  timestamp: bigint;
  dateText: string;
  senderName: string;
  text: string;
  isGroup: boolean;
  sourceFile: string;
  channelId: string;
}> {
  try {
    const html = fs.readFileSync(filepath, 'utf-8');
    const dom = new JSDOM(html);
    const rows = dom.window.document.querySelectorAll('tbody tr');
    const filename = path.basename(filepath);
    const messages = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) continue;

      const timeCell = cells[0];
      const senderCell = cells[1];
      const msgCell = cells[2];

      const dataOrder = timeCell.getAttribute('data-order');
      const dateText = timeCell.textContent?.trim() ?? '';
      const senderName = senderCell.textContent?.trim() ?? '';
      const rawText = msgCell.innerHTML ?? '';
      const text = cleanText(rawText);

      if (!dataOrder || !senderName) continue;

      messages.push({
        timestamp: BigInt(dataOrder),
        dateText,
        senderName,
        text,
        isGroup: true,
        sourceFile: filename,
        channelId,
      });
    }

    return messages;
  } catch (err) {
    console.warn(`⚠️  Error parsing ${filepath}:`, err);
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  console.log('📦 Iniciando seed de datos...\n');

  try {
    // ─── 1. Seed de usuarios ─────────────────────────
    console.log('👤 Procesando usuarios...');
    const usersRaw: Array<any> = JSON.parse(fs.readFileSync(USERS_JSON, 'utf-8'));
    let usersCreated = 0;
    let usersSkipped = 0;

    for (const u of usersRaw) {
      const existing = await prisma.user.findUnique({ where: { email: u.email } });
      if (existing) {
        usersSkipped++;
      } else {
        await prisma.user.create({
          data: {
            id: u.guid,
            email: u.email,
            name: `${u.name.firstName} ${u.name.lastName}`.trim(),
          },
        });
        usersCreated++;
      }
    }
    console.log(`   ✅ Usuarios: ${usersCreated} creados, ${usersSkipped} ya existían\n`);

    // ─── 2. Seed de canales ─────────────────────────
    console.log('📢 Procesando canales...');
    const channelsRaw: Array<any> = JSON.parse(fs.readFileSync(CHANNELS_JSON, 'utf-8'));
    let channelsCreated = 0;
    let channelsSkipped = 0;

    for (const c of channelsRaw) {
      const existing = await prisma.channel.findUnique({ where: { id: c.id } });
      if (existing) {
        channelsSkipped++;
      } else {
        await prisma.channel.create({
          data: {
            id: c.id,
            name: c.name,
            description: c.description || null,
          },
        });
        channelsCreated++;
      }
    }
    console.log(`   ✅ Canales: ${channelsCreated} creados, ${channelsSkipped} ya existían\n`);

    // ─── 3. Seed de mensajes desde archivos HTML ────
    console.log('💬 Procesando mensajes de grupos...');
    const channelMap = new Map(channelsRaw.map((c: any) => [c.id, c]));

    if (!fs.existsSync(GROUPS_DIR)) {
      console.warn(`   ⚠️  Directorio ${GROUPS_DIR} no encontrado. Saltando mensajes.\n`);
    } else {
      const files = fs.readdirSync(GROUPS_DIR).filter((f) => f.endsWith('.html'));
      let messagesCreated = 0;
      let messagesSkipped = 0;

      for (const filename of files) {
        const guid = extractGuid(filename);
        const channel = channelMap.get(guid);
        
        if (!guid || !channel) {
          console.warn(`   ⚠️  Archivo sin GUID válido: ${filename}`);
          continue;
        }

        const filepath = path.join(GROUPS_DIR, filename);
        const messages = parseGroupHtml(filepath, (channel as any).id);

        for (const msg of messages) {
          try {
            await prisma.message.create({
              data: {
                timestamp: msg.timestamp,
                dateText: msg.dateText,
                senderName: msg.senderName,
                text: msg.text,
                isGroup: msg.isGroup,
                sourceFile: msg.sourceFile,
                channelId: msg.channelId,
              },
            });
            messagesCreated++;
          } catch (err) {
            messagesSkipped++;
          }
        }
      }

      console.log(
        `   ✅ Mensajes: ${messagesCreated} creados, ${messagesSkipped} ya existían\n`
      );
    }

    console.log('✨ Seeding completado exitosamente.');
  } catch (err) {
    console.error('❌ Error durante seeding:', err);
    process.exit(1);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
