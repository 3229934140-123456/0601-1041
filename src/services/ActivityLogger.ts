import ActivityLog, { ActivityType, EntityType, IActivityLog } from '../models/ActivityLog';
import mongoose from 'mongoose';

export interface LogActivityParams {
  userId: mongoose.Types.ObjectId | string;
  type: ActivityType;
  entityType: EntityType;
  entityId?: mongoose.Types.ObjectId | string;
  spaceId?: mongoose.Types.ObjectId | string;
  roomId?: mongoose.Types.ObjectId | string;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

class ActivityLogger {
  static async log(params: LogActivityParams): Promise<IActivityLog> {
    const {
      userId,
      type,
      entityType,
      entityId,
      spaceId,
      roomId,
      description,
      ipAddress,
      userAgent,
      metadata,
    } = params;

    const log = new ActivityLog({
      userId: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId,
      type,
      entityType,
      entityId: entityId ? (typeof entityId === 'string' ? new mongoose.Types.ObjectId(entityId) : entityId) : undefined,
      spaceId: spaceId ? (typeof spaceId === 'string' ? new mongoose.Types.ObjectId(spaceId) : spaceId) : undefined,
      roomId: roomId ? (typeof roomId === 'string' ? new mongoose.Types.ObjectId(roomId) : roomId) : undefined,
      description,
      ipAddress,
      userAgent,
      metadata,
    });

    return log.save();
  }

  static async bulk(logs: LogActivityParams[]): Promise<IActivityLog[]> {
    const documents = logs.map((params) => {
      const {
        userId,
        type,
        entityType,
        entityId,
        spaceId,
        roomId,
        description,
        ipAddress,
        userAgent,
        metadata,
      } = params;

      return new ActivityLog({
        userId: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId,
        type,
        entityType,
        entityId: entityId ? (typeof entityId === 'string' ? new mongoose.Types.ObjectId(entityId) : entityId) : undefined,
        spaceId: spaceId ? (typeof spaceId === 'string' ? new mongoose.Types.ObjectId(spaceId) : spaceId) : undefined,
        roomId: roomId ? (typeof roomId === 'string' ? new mongoose.Types.ObjectId(roomId) : roomId) : undefined,
        description,
        ipAddress,
        userAgent,
        metadata,
      });
    });

    return ActivityLog.insertMany(documents);
  }
}

export default ActivityLogger;
