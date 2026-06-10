import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  getWhiteboardByRoom,
  createWhiteboard,
  updateWhiteboardSettings,
  addElement,
  updateElement,
  deleteElement,
  batchUpdateElements,
  lockWhiteboard,
  clearWhiteboard,
} from '../controllers/whiteboardController';

const router = Router();

router.use(protect);

router.get('/room/:roomId', getWhiteboardByRoom);
router.post('/', createWhiteboard);
router.patch('/:id', updateWhiteboardSettings);
router.post('/:id/clear', restrictTo('admin', 'moderator'), clearWhiteboard);

router.post('/:whiteboardId/elements', addElement);
router.patch('/:whiteboardId/elements/:elementId', updateElement);
router.delete('/:whiteboardId/elements/:elementId', deleteElement);
router.post('/:whiteboardId/elements/batch', batchUpdateElements);
router.post('/:whiteboardId/lock', lockWhiteboard);

export default router;
