import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  setPresenceStatus,
  getOnlineUsers,
  getRoomOccupants,
  getUserPresence,
  getPresenceBatch,
  updateLastActive,
  getAllUsers,
  kickUser,
  banUser,
} from '../controllers/presenceController';

const router = Router();

router.use(protect);

router.get('/online', getOnlineUsers);
router.get('/users', getAllUsers);
router.get('/room/:roomId', getRoomOccupants);
router.get('/user/:userId', getUserPresence);
router.post('/batch', getPresenceBatch);
router.post('/status', setPresenceStatus);
router.post('/heartbeat', updateLastActive);

router.post('/kick', restrictTo('admin', 'moderator'), kickUser);
router.post('/ban', restrictTo('admin'), banUser);

export default router;
