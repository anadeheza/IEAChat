import { PrismaClient } from '@prisma/client';
import * as fs from 'fs-extra';
import path from 'path';

const storagePath = path.resolve(__dirname, '../storage');
fs.ensureDirSync(storagePath);

const prisma = new PrismaClient();
export default prisma;
