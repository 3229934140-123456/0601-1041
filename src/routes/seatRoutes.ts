import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  createSeat,
  getSeats,
  getSeatById,
  updateSeat,
  deleteSeat,
  assignSeat,
  unassignSeat,
  occupySeat,
  releaseSeat,
  getMySeat,
} from '../controllers/seatController';

const router = Router();

router.use(protect);

router.get('/my', getMySeat);
router.get('/', getSeats);
router.get('/:id', getSeatById);

router.post('/', restrictTo('admin', 'moderator'), createSeat);
router.patch('/:id', restrictTo('admin', 'moderator'), updateSeat);
router.delete('/:id', restrictTo('admin'), deleteSeat);

router.post('/assign', restrictTo('admin', 'moderator'), assignSeat);
router.post('/:id/unassign', restrictTo('admin', 'moderator'), unassignSeat);

router.post('/occupy', occupySeat);
router.post('/release', releaseSeat);

export default router;
