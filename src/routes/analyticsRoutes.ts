import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  getActivityLogs,
  getUserActivityHistory,
  getSpaceHeatmap,
  getDashboardStats,
  generateCollaborationSummary,
  getActivityTypes,
  getActivityTimeline,
  exportActivityLogs,
  exportAuditReport,
} from '../controllers/analyticsController';

const router = Router();

router.use(protect);

router.get('/activity-types', getActivityTypes);
router.get('/logs', getActivityLogs);
router.get('/activity-timeline', getActivityTimeline);
router.get('/export', exportActivityLogs);
router.get('/user/:userId/history', getUserActivityHistory);
router.get('/heatmap', getSpaceHeatmap);
router.get('/dashboard', getDashboardStats);

router.post(
  '/collaboration-summary/export',
  restrictTo('admin', 'moderator'),
  (req, _res, next) => { (req as any).exportMode = true; next(); },
  generateCollaborationSummary,
  exportAuditReport
);

router.post('/collaboration-summary', restrictTo('admin', 'moderator'), generateCollaborationSummary);

export default router;
