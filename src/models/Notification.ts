import mongoose, { Schema, Document, Model } from 'mongoose';
import { NotificationCategory } from './User';

export type NotificationType =
  | 'system'
  | 'meeting_reminder'
  | 'meeting_start'
  | 'meeting_end'
  | 'meeting_invite'
  | 'invitation'
  | 'kick'
  | 'ban'
  | 'seat_change'
  | 'seat_assigned'
  | 'seat_released'
  | 'whiteboard_update'
  | 'voice_invite'
  | 'voice_join'
  | 'permission_change'
  | 'space_access_granted'
  | 'space_access_revoked'
  | 'role_change'
  | 'file_uploaded'
  | 'custom';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationDeliveryStatus = 'pending' | 'pushed' | 'stored_only' | 'skipped' | 'failed';

export const NOTIFICATION_TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> = {
  system: 'system',
  meeting_reminder: 'meeting',
  meeting_start: 'meeting',
  meeting_end: 'meeting',
  meeting_invite: 'meeting',
  invitation: 'visitor',
  kick: 'system',
  ban: 'system',
  seat_change: 'seat',
  seat_assigned: 'seat',
  seat_released: 'seat',
  whiteboard_update: 'whiteboard',
  voice_invite: 'voice',
  voice_join: 'voice',
  permission_change: 'permission',
  space_access_granted: 'permission',
  space_access_revoked: 'permission',
  role_change: 'permission',
  file_uploaded: 'system',
  custom: 'system',
};

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  content?: string;
  entityType?: 'user' | 'space' | 'seat' | 'meeting' | 'whiteboard' | 'voice_room' | 'file' | 'invitation' | 'permission' | 'system';
  entityId?: mongoose.Types.ObjectId;
  spaceId?: mongoose.Types.ObjectId;
  roomId?: mongoose.Types.ObjectId;
  actorUserId?: mongoose.Types.ObjectId;
  isRead: boolean;
  readAt?: Date;
  deliveryStatus: NotificationDeliveryStatus;
  pushedAt?: Date;
  actionUrl?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const NotificationSchema: Schema<INotification> = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'system',
        'meeting_reminder',
        'meeting_start',
        'meeting_end',
        'meeting_invite',
        'invitation',
        'kick',
        'ban',
        'seat_change',
        'seat_assigned',
        'seat_released',
        'whiteboard_update',
        'voice_invite',
        'voice_join',
        'permission_change',
        'space_access_granted',
        'space_access_revoked',
        'role_change',
        'file_uploaded',
        'custom',
      ],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['meeting', 'whiteboard', 'voice', 'seat', 'visitor', 'permission', 'system'],
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, '标题不能超过200个字符'],
    },
    content: {
      type: String,
      trim: true,
      maxlength: [2000, '内容不能超过2000个字符'],
    },
    entityType: {
      type: String,
      enum: ['user', 'space', 'seat', 'meeting', 'whiteboard', 'voice_room', 'file', 'invitation', 'permission', 'system'],
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    spaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
      index: true,
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
      index: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: Date,
    deliveryStatus: {
      type: String,
      enum: ['pending', 'pushed', 'stored_only', 'skipped', 'failed'],
      default: 'pending',
      index: true,
    },
    pushedAt: Date,
    actionUrl: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, type: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, category: 1, createdAt: -1 });
NotificationSchema.index({ category: 1, deliveryStatus: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: -1 });

const Notification: Model<INotification> = mongoose.model<INotification>(
  'Notification',
  NotificationSchema
);
export default Notification;
