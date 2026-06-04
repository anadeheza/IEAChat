import { Router } from 'express';
import {
    listChannels,
    channelMessages,
    listUsers,
    userMessages,
    searchMessages,
    listAttachments,
    listAttachmentsById,
    downloadAttachmentsBatch,
    downloadAllAttachments,
    cancelDownloads,
    stats,
    signIn,
    dmConversation,
    queryFileWithoutDownload,
    getRealSize,
} from '../controllers/Flock.Controller';
    
const router = Router();

router.post('/auth/signin',                 signIn);
router.get('/channels',                     listChannels);
router.get('/channels/:id/messages',        channelMessages);
router.get('/users',                        listUsers);
router.get('/users/:id/messages',           userMessages);
router.get('/messages/search',              searchMessages);
router.get('/attachments',                  listAttachments);
router.get('/attachments/real-size',        getRealSize);
router.get('/attachments/:id',              listAttachmentsById);
router.post('/attachments/download',        downloadAttachmentsBatch);
router.post('/attachments/download-all',    downloadAllAttachments);
router.post('/attachments/cancel',          cancelDownloads);
router.get('/stats',                        stats);
router.get('/dm/:id/conversation',          dmConversation);
router.post('/attachments/query',           queryFileWithoutDownload);


export default router;