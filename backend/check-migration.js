require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  try {
    const users = await prisma.user.count();
    const channels = await prisma.channel.count();
    const messages = await prisma.message.count();
    const attachments = await prisma.attachment.count();
    
    console.log(`users: ${users}`);
    console.log(`channels: ${channels}`);
    console.log(`messages: ${messages}`);
    console.log(`attachments: ${attachments}`);
    
    if (users === 232 && channels === 679 && messages === 112902 && attachments === 1644) {
      console.log('\n✅ MIGRATION COMPLETE! All data migrated from SQLite to PostgreSQL.');
    } else {
      console.log('\n⚠️  Migration may be incomplete. Expected 232 users, 679 channels, 112902 messages, 1644 attachments.');
    }
  } finally {
    await prisma.$disconnect();
  }
})();
