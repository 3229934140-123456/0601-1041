import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  createVoiceRoom,
  getVoiceRooms,
  getVoiceRoomById,
  joinVoiceRoom,
  leaveVoiceRoom,
  updateParticipantState,
  updateVoiceRoom,
  endVoiceRoom,
  removeParticipant,
} from '../controllers/voiceRoomController';

const router = Router();

router.use(protect);

router.get('/', getVoiceRooms);
router.get('/:id', getVoiceRoomById);
router.post('/', createVoiceRoom);
router.post('/join', joinVoiceRoom);
router.post('/leave', leaveVoiceRoom);
router.post('/participant-state', updateParticipantState);
router.patch('/:id', updateVoiceRoom);
router.post('/:id/end', endVoiceRoom);
router.post('/remove-participant', restrictTo('admin', 'moderator'), removeParticipant);

export default router;
