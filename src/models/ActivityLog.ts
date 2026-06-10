import mongoose, { Schema, Document, Model } from 'mongoose';

export type ActivityType =
  | 'login'
  | 'logout'
  | 'disconnect'
  | 'space_enter'
  | 'space_leave'
  | 'seat_occupy'
  | 'seat_release'
  | 'seat_assign'
  | 'seat_unassign'
  | 'whiteboard_create'
  | 'whiteboard_update'
  | 'whiteboard_delete'
  | 'voice_join'
  | 'voice_leave'
  | 'meeting_create'
  | 'meeting_start'
  | 'meeting_end'
  | 'meeting_join'
  | 'meeting_leave'
  | 'file_upload'
  | 'invitation_create'
  | 'invitation_accept'
  | 'permission_grant'
  | 'permission_revoke'
  | 'user_kick'
  | 'user_ban'
  | 'custom';

export type EntityType = 'user' | 'space' | 'seat' | 'whiteboard' | 'voice_room' | 'meeting' | 'file' | 'invitation' | 'permission' | 'system';

export interface IActivityLog extends Document {
  userId: mongoose.Types.ObjectId;
  spaceId?: mongoose.Types.ObjectId;
  roomId?: mongoose.Types.ObjectId;
  type: ActivityType;
  entityType: EntityType;
  entityId?: mongoose.Types.ObjectId;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

const ActivityLogSchema: Schema<IActivityLog> = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
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
    type: {
      type: String,
      enum: [
        'login',
        'logout',
        'disconnect',
        'space_enter',
        'space_leave',
        'seat_occupy',
        'seat_release',
        'seat_assign',
        'seat_unassign',
        'whiteboard_create',
        'whiteboard_update',
        'whiteboard_delete',
        'voice_join',
        'voice_leave',
        'meeting_create',
        'meeting_start',
        'meeting_end',
        'meeting_join',
        'meeting_leave',
        'file_upload',
        'invitation_create',
        'invitation_accept',
        'permission_grant',
        'permission_revoke',
        'user_kick',
        'user_ban',
        'custom',
      ],
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['user', 'space', 'seat', 'whiteboard', 'voice_room', 'meeting', 'file', 'invitation', 'permission', 'system'],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    description: {
      type: String,
      trim: true,
    },
    ipAddress: String,
    userAgent: String,
    metadata: Schema.Types.Mixed,
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'activity_logs',
  }
);

ActivityLogSchema.index({ userId: 1, type: 1, timestamp: -1 });
ActivityLogSchema.index({ roomId: 1, type: 1, timestamp: -1 });
ActivityLogSchema.index({ timestamp: -1 });

const ActivityLog: Model<IActivityLog> = mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);
export default ActivityLog;
