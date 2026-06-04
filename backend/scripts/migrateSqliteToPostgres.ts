import * as dotenv from 'dotenv';
dotenv.config();

import sqlite3 from 'sqlite3';
import path from 'path';
import prisma from '../src/prismaClient';

type SqliteRow = Record<string, any>;

function openSqlite(filePath: string) {
  return new Promise<sqlite3.Database>((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function allRows(db: sqlite3.Database, sql: string, params: any[] = []) {
  return new Promise<SqliteRow[]>((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as SqliteRow[]);
    });
  });
}

async function migrate() {
  const sqlitePath = process.argv[2] || path.resolve(__dirname, '../storage/flock_archive.db');
  console.log('SQLite path:', sqlitePath);
  const db = await openSqlite(sqlitePath);

  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      throw new Error(`Target Postgres database is not empty (users count=${userCount}). Use a fresh DB or clear it before running this script.`);
    }

    console.log('Reading SQLite tables...');
    const users = await allRows(db, 'SELECT id, email, name FROM "User"');
    const channels = await allRows(db, 'SELECT id, name, description FROM "Channel"');
    const messages = await allRows(db, `SELECT id, timestamp, dateText, senderName, text, isGroup, sourceFile, userId, channelId FROM "Message"`);
    const attachments = await allRows(db, `SELECT id, url, fileName, sizeBytes, contentType, s3Key, isDownloaded, messageId FROM "Attachment"`);

    console.log(`Found: ${users.length} users, ${channels.length} channels, ${messages.length} messages, ${attachments.length} attachments`);

    console.log('Inserting users...');
    for (const user of users) {
      await prisma.user.create({
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    }

    console.log('Inserting channels...');
    for (const channel of channels) {
      await prisma.channel.create({
        data: {
          id: channel.id,
          name: channel.name,
          description: channel.description || null,
        },
      });
    }

    console.log('Inserting messages...');
    for (const message of messages) {
      await prisma.message.create({
        data: {
          id: message.id,
          timestamp: BigInt(message.timestamp),
          dateText: message.dateText,
          senderName: message.senderName,
          text: message.text,
          isGroup: Boolean(message.isGroup),
          sourceFile: message.sourceFile,
          userId: message.userId || null,
          channelId: message.channelId || null,
        },
      });
    }

    console.log('Inserting attachments...');
    for (const attachment of attachments) {
      await prisma.attachment.create({
        data: {
          id: attachment.id,
          url: attachment.url,
          fileName: attachment.fileName,
          sizeBytes: attachment.sizeBytes !== null ? BigInt(attachment.sizeBytes) : null,
          contentType: attachment.contentType || null,
          s3Key: attachment.s3Key || null,
          isDownloaded: Boolean(attachment.isDownloaded),
          messageId: attachment.messageId,
        },
      });
    }

    console.log('Migration complete.');
  } finally {
    db.close();
    await prisma.$disconnect();
  }
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
