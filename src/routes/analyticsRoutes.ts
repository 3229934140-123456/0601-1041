import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  getActivityLogs,
  getUserActivityHistory,
  getSpaceHeatmap,
  getDashboardStats,
  generateCollaborationSummary,
  getActivityTypes,
} from '../controllers/analyticsController';

const router = Router();

router.use(protect);

router.get('/activity-types', getActivityTypes);
router.get('/logs', getActivityLogs);
router.get('/user/:userId/history', getUserActivityHistory);
router.get('/heatmap', getSpaceHeatmap);
router.get('/dashboard', getDashboardStats);
router.post('/collaboration-summary', restrictTo('admin', 'moderator'), generateCollaborationSummary);

export default router;
