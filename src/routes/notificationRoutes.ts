import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
  getMissingNotifications,
  createSystemNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
  getDeliveryStats,
} from '../controllers/notificationController';

const router = Router();

router.use(protect);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.get('/missing', getMissingNotifications);
router.get('/preferences', getNotificationPreferences);
router.put('/preferences', updateNotificationPreferences);
router.post('/mark-all-read', markAllAsRead);
router.post('/:id/read', markAsRead);
router.delete('/clear/all', clearAllNotifications);
router.delete('/:id', deleteNotification);

router.post('/system', restrictTo('admin'), createSystemNotification);
router.get('/delivery-stats', restrictTo('admin', 'moderator'), getDeliveryStats);

export default router;
