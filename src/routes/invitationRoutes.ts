import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  createInvitation,
  getInvitations,
  getInvitationByCode,
  acceptInvitation,
  revokeInvitation,
  deleteInvitation,
  getMyInvitations,
} from '../controllers/invitationController';

const router = Router();

router.get('/code/:code', getInvitationByCode);
router.post('/accept', acceptInvitation);

router.use(protect);

router.get('/mine', getMyInvitations);
router.get('/', getInvitations);
router.post('/', createInvitation);
router.post('/:id/revoke', revokeInvitation);
router.delete('/:id', restrictTo('admin'), deleteInvitation);

export default router;
