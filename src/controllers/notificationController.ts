import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import NotificationService from '../services/NotificationService';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { isRead, type, page = 1, limit = 50 } = req.query;

  const result = await NotificationService.getNotifications(req.user!._id, {
    isRead: isRead !== undefined ? isRead === 'true' : undefined,
    type: type as any,
    page: parseInt(page as string),
    limit: parseInt(limit as string),
  });

  sendSuccess(
    res,
    { notifications: result.notifications, unreadCount: result.unreadCount },
    200,
    { total: result.total, page: parseInt(page as string), pages: result.pages }
  );
});

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await NotificationService.getUnreadCount(req.user!._id);
  sendSuccess(res, { unreadCount: count });
});

export const markAsRead = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const success = await NotificationService.markAsRead(req.user!._id, id);
  if (!success) {
    return next(new AppError('通知不存在或无权限', 404));
  }
  sendMessage(res, '已标记为已读');
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  const count = await NotificationService.markAllAsRead(req.user!._id);
  sendSuccess(res, { markedCount: count });
});

export const deleteNotification = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const success = await NotificationService.deleteNotification(req.user!._id, id);
  if (!success) {
    return next(new AppError('通知不存在或无权限', 404));
  }
  sendMessage(res, '通知已删除');
});

export const clearAllNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { onlyRead } = req.query;
  const count = await NotificationService.clearAll(
    req.user!._id,
    onlyRead === 'false' ? false : true
  );
  sendSuccess(res, { clearedCount: count });
});

export const getMissingNotifications = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { since } = req.query;
  if (!since) {
    return next(new AppError('请提供 since 参数（ISO 日期字符串）', 400));
  }

  const sinceDate = new Date(since as string);
  if (isNaN(sinceDate.getTime())) {
    return next(new AppError('since 参数格式无效', 400));
  }

  const notifications = await NotificationService.getMissingSince(
    req.user!._id,
    sinceDate
  );

  sendSuccess(res, {
    notifications,
    count: notifications.length,
    since: sinceDate,
  });
});

export const createSystemNotification = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userIds, title, content, type, priority, actionUrl } = req.body;

  if (!title || !userIds || (!Array.isArray(userIds) && userIds !== 'all')) {
    return next(new AppError('请提供标题和目标用户', 400));
  }

  if (userIds === 'all') {
    const User = (await import('../models/User')).default;
    const users = await User.find({ status: 'active' }).select('_id');
    const ids = users.map((u) => u._id);
    await NotificationService.batchCreate({
      userIds: ids,
      type: type || 'system',
      priority: priority || 'normal',
      title,
      content,
      entityType: 'system',
      actionUrl,
    });
    sendSuccess(res, { sentCount: ids.length });
  } else {
    await NotificationService.batchCreate({
      userIds,
      type: type || 'system',
      priority: priority || 'normal',
      title,
      content,
      entityType: 'system',
      actionUrl,
    });
    sendSuccess(res, { sentCount: userIds.length });
  }
});
