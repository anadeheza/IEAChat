import * as dotenv from 'dotenv';
import { downloadAttachmentsBatch } from '../services/attachmentDownloader';

dotenv.config();

async function main() {
    console.log('=== flock-backup downloader ===\n');

    const result = await downloadAttachmentsBatch(5);

    console.log(`📦 Descargados: ${result.downloaded}/${result.total}`);
    if (result.failed > 0) {
        console.log(`⚠ Fallidos: ${result.failed}`);
        for (const item of result.details.filter(d => !d.success)) {
            console.log(`  - [${item.id}] ${item.fileName}: ${item.message}`);
        }
    }

    console.log('\n🎉 Proceso completo.');
}

main().catch(console.error);
