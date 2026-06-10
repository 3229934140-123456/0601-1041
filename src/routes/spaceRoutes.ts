import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  createSpace,
  getSpaces,
  getSpaceById,
  getSpaceTree,
  updateSpace,
  deleteSpace,
  enterSpace,
  leaveSpace,
} from '../controllers/spaceController';

const router = Router();

router.use(protect);

router.get('/tree', getSpaceTree);
router.get('/', getSpaces);
router.get('/:id', getSpaceById);
router.post('/', restrictTo('admin', 'moderator'), createSpace);
router.patch('/:id', restrictTo('admin', 'moderator'), updateSpace);
router.delete('/:id', restrictTo('admin'), deleteSpace);

router.post('/enter', enterSpace);
router.post('/leave', leaveSpace);

export default router;
