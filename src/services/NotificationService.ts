import mongoose from 'mongoose';
import Notification, { INotification, NotificationType, NotificationPriority } from '../models/Notification';
import { onlineUsers, getIO } from '../socket';

export interface CreateNotificationParams {
  userId: mongoose.Types.ObjectId | string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  content?: string;
  entityType?: INotification['entityType'];
  entityId?: mongoose.Types.ObjectId | string;
  spaceId?: mongoose.Types.ObjectId | string;
  roomId?: mongoose.Types.ObjectId | string;
  actorUserId?: mongoose.Types.ObjectId | string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  dedupKey?: string;
  dedupWindowMinutes?: number;
}

class NotificationService {
  private static async checkDuplicate(
    params: CreateNotificationParams
  ): Promise<boolean> {
    if (!params.dedupKey && !params.entityId) return false;

    const dedupWindowMinutes = params.dedupWindowMinutes || 5;
    const cutoffTime = new Date(Date.now() - dedupWindowMinutes * 60 * 1000);

    const query: any = {
      userId: typeof params.userId === 'string'
        ? new mongoose.Types.ObjectId(params.userId)
        : params.userId,
      type: params.type,
      createdAt: { $gte: cutoffTime },
      isRead: false,
    };

    if (params.dedupKey) {
      query['metadata.dedupKey'] = params.dedupKey;
    } else if (params.entityId) {
      query.entityId = typeof params.entityId === 'string'
        ? new mongoose.Types.ObjectId(params.entityId)
        : params.entityId;
    }

    const existing = await Notification.findOne(query);
    return !!existing;
  }

  static async create(params: CreateNotificationParams): Promise<INotification | null> {
    const isDuplicate = await this.checkDuplicate(params);
    if (isDuplicate) {
      return null;
    }

    const notification = new Notification({
      userId: typeof params.userId === 'string'
        ? new mongoose.Types.ObjectId(params.userId)
        : params.userId,
      type: params.type,
      priority: params.priority || 'normal',
      title: params.title,
      content: params.content,
      entityType: params.entityType,
      entityId: params.entityId
        ? typeof params.entityId === 'string'
          ? new mongoose.Types.ObjectId(params.entityId)
          : params.entityId
        : undefined,
      spaceId: params.spaceId
        ? typeof params.spaceId === 'string'
          ? new mongoose.Types.ObjectId(params.spaceId)
          : params.spaceId
        : undefined,
      roomId: params.roomId
        ? typeof params.roomId === 'string'
          ? new mongoose.Types.ObjectId(params.roomId)
          : params.roomId
        : undefined,
      actorUserId: params.actorUserId
        ? typeof params.actorUserId === 'string'
          ? new mongoose.Types.ObjectId(params.actorUserId)
          : params.actorUserId
        : undefined,
      actionUrl: params.actionUrl,
      metadata: params.dedupKey
        ? { ...params.metadata, dedupKey: params.dedupKey }
        : params.metadata,
    });

    await notification.save();
    await this.pushToUser(notification);

    return notification;
  }

  static async batchCreate(params: Omit<CreateNotificationParams, 'userId'> & {
    userIds: (mongoose.Types.ObjectId | string)[];
  }): Promise<INotification[]> {
    const notifications: INotification[] = [];
    const now = new Date();

    for (const userId of params.userIds) {
      const isDuplicate = await this.checkDuplicate({ ...params, userId });
      if (isDuplicate) continue;

      const notification = new Notification({
        ...params,
        userId: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId,
        createdAt: now,
        metadata: params.dedupKey
          ? { ...params.metadata, dedupKey: params.dedupKey }
          : params.metadata,
      });
      notifications.push(notification);
    }

    if (notifications.length === 0) return [];

    const saved = await Notification.insertMany(notifications);

    for (const n of saved) {
      await this.pushToUser(n);
    }

    return saved;
  }

  private static async pushToUser(notification: INotification): Promise<void> {
    try {
      const userId = notification.userId.toString();
      const online = onlineUsers.get(userId);
      if (online) {
        const io = getIO();
        io.to(online.socketId).emit('notification:new', {
          id: notification._id,
          type: notification.type,
          priority: notification.priority,
          title: notification.title,
          content: notification.content,
          entityType: notification.entityType,
          entityId: notification.entityId,
          actionUrl: notification.actionUrl,
          metadata: notification.metadata,
          createdAt: notification.createdAt,
        });

        const unreadCount = await this.getUnreadCount(notification.userId);
        io.to(online.socketId).emit('notification:unread-count', {
          unreadCount,
        });
      }
    } catch (_e) {
      // 推送失败忽略（可能Socket.IO还没初始化）
    }
  }

  static async getUnreadCount(userId: mongoose.Types.ObjectId | string): Promise<number> {
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    return Notification.countDocuments({ userId: id, isRead: false });
  }

  static async getNotifications(
    userId: mongoose.Types.ObjectId | string,
    options: {
      isRead?: boolean;
      type?: NotificationType;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ notifications: INotification[]; total: number; unreadCount: number; pages: number }> {
    const { isRead, type, page = 1, limit = 50 } = options;
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    const query: any = { userId: id };
    if (isRead !== undefined) query.isRead = isRead;
    if (type) query.type = type;

    const [total, unreadCount, notifications] = await Promise.all([
      Notification.countDocuments(query),
      Notification.countDocuments({ userId: id, isRead: false }),
      Notification.find(query)
        .populate('actorUserId', 'displayName avatar')
        .populate('spaceId', 'name type')
        .populate('roomId', 'name type')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      pages: Math.ceil(total / limit),
    };
  }

  static async markAsRead(
    userId: mongoose.Types.ObjectId | string,
    notificationId: string
  ): Promise<boolean> {
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const result = await Notification.updateOne(
      { _id: notificationId, userId: id },
      { $set: { isRead: true, readAt: new Date() } }
    );
    return result.modifiedCount > 0;
  }

  static async markAllAsRead(userId: mongoose.Types.ObjectId | string): Promise<number> {
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const result = await Notification.updateMany(
      { userId: id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    try {
      const online = onlineUsers.get(id.toString());
      if (online) {
        const io = getIO();
        io.to(online.socketId).emit('notification:all-read');
      }
    } catch (_e) {
      // 忽略推送失败
    }

    return result.modifiedCount;
  }

  static async getMissingSince(
    userId: mongoose.Types.ObjectId | string,
    since: Date
  ): Promise<INotification[]> {
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    return Notification.find({
      userId: id,
      createdAt: { $gte: since },
    })
      .populate('actorUserId', 'displayName avatar')
      .sort({ createdAt: -1 })
      .limit(200);
  }

  static async deleteOldNotifications(days: number = 90): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoff },
    });
    return result.deletedCount;
  }

  static async deleteNotification(
    userId: mongoose.Types.ObjectId | string,
    notificationId: string
  ): Promise<boolean> {
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const result = await Notification.deleteOne({
      _id: notificationId,
      userId: id,
    });
    return result.deletedCount > 0;
  }

  static async clearAll(userId: mongoose.Types.ObjectId | string, onlyRead: boolean = true): Promise<number> {
    const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const query: any = { userId: id };
    if (onlyRead) query.isRead = true;

    const result = await Notification.deleteMany(query);
    return result.deletedCount;
  }

  static async sendMeetingReminder(
    userIds: (mongoose.Types.ObjectId | string)[],
    meeting: {
      id: mongoose.Types.ObjectId | string;
      title: string;
      roomId?: mongoose.Types.ObjectId | string;
      scheduledStart: Date;
    },
    minutesBefore: number = 5
  ): Promise<void> {
    const timeStr = meeting.scheduledStart.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });

    await this.batchCreate({
      userIds,
      type: 'meeting_reminder',
      priority: 'high',
      title: `会议提醒: ${meeting.title}`,
      content: `会议将在 ${minutesBefore} 分钟后开始 (${timeStr})，请准时参加`,
      entityType: 'meeting',
      entityId: meeting.id,
      roomId: meeting.roomId,
      actionUrl: `/meeting/${meeting.id}`,
      metadata: {
        meetingTitle: meeting.title,
        scheduledStart: meeting.scheduledStart,
        minutesBefore,
      },
    });
  }

  static async sendInvitationNotice(
    userId: mongoose.Types.ObjectId | string,
    inviterName: string,
    invitation: {
      id: mongoose.Types.ObjectId | string;
      code: string;
      type: 'guest' | 'member';
      message?: string;
    }
  ): Promise<void> {
    await this.create({
      userId,
      type: 'invitation',
      priority: 'high',
      title: `您收到了来自 ${inviterName} 的${invitation.type === 'member' ? '成员' : '访客'}邀请`,
      content: invitation.message || `邀请码: ${invitation.code}，点击查看详情`,
      entityType: 'invitation',
      entityId: invitation.id,
      actorUserId: userId,
      metadata: {
        code: invitation.code,
        type: invitation.type,
      },
    });
  }
}

export default NotificationService;
