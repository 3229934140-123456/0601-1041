import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import User, { IUser, OnlineStatus } from '../models/User';
import Seat from '../models/Seat';
import AppError from '../utils/AppError';
import { sendSuccess } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';
import { onlineUsers } from '../socket';

interface UserPresence {
  userId: string;
  displayName: string;
  avatar?: string;
  onlineStatus: OnlineStatus;
  role: string;
  currentSpaceId?: string;
  currentRoomId?: string;
  currentSeatId?: string;
  currentSeat?: any;
  lastActiveAt: Date;
}

const mapUserToPresence = (user: IUser, withSeat: boolean = false): UserPresence => {
  const onlineUser = onlineUsers.get(user._id.toString());
  const socketStatus = onlineUser?.status || user.onlineStatus;

  return {
    userId: user._id.toString(),
    displayName: user.displayName,
    avatar: user.avatar,
    onlineStatus: user.onlineStatus === 'offline' ? 'offline' : socketStatus,
    role: user.role,
    currentSpaceId: user.currentSpaceId?.toString(),
    currentRoomId: user.currentRoomId?.toString(),
    currentSeatId: user.currentSeatId?.toString(),
    lastActiveAt: user.lastActiveAt,
  };
};

export const setPresenceStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { status } = req.body;

  const validStatuses: OnlineStatus[] = ['online', 'busy', 'away', 'offline'];
  if (!status || !validStatuses.includes(status as OnlineStatus)) {
    return next(new AppError('无效的状态值', 400));
  }

  const user = await User.findByIdAndUpdate(
    req.user!._id,
    {
      onlineStatus: status as OnlineStatus,
      lastActiveAt: new Date(),
    },
    { new: true }
  );

  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const onlineUser = onlineUsers.get(user._id.toString());
  if (onlineUser && status !== 'offline') {
    onlineUser.status = status as 'online' | 'busy' | 'away';
  }

  sendSuccess(res, { user: mapUserToPresence(user) });
});

export const getOnlineUsers = asyncHandler(async (req: Request, res: Response) => {
  const { roomId, spaceId, role } = req.query;

  const query: any = { onlineStatus: { $ne: 'offline' } };
  if (roomId) query.currentRoomId = new mongoose.Types.ObjectId(roomId as string);
  if (spaceId) query.currentSpaceId = new mongoose.Types.ObjectId(spaceId as string);
  if (role) query.role = role;

  const users = await User.find(query)
    .sort({ lastActiveAt: -1 })
    .limit(200);

  const presences = users.map((u) => mapUserToPresence(u));

  const seatIds = presences.filter((p) => p.currentSeatId).map((p) => p.currentSeatId!);
  if (seatIds.length > 0) {
    const seats = await Seat.find({ _id: { $in: seatIds } }).populate('roomId', 'name');
    const seatMap = new Map(seats.map((s) => [s._id.toString(), s]));
    presences.forEach((p) => {
      if (p.currentSeatId) {
        (p as any).currentSeat = seatMap.get(p.currentSeatId);
      }
    });
  }

  sendSuccess(res, {
    users: presences,
    onlineCount: presences.length,
    totalSocketConnections: onlineUsers.size,
  });
});

export const getRoomOccupants = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params;

  const room = await (await import('../models/Space')).default.findById(roomId);
  if (!room) {
    return next(new AppError('房间不存在', 404));
  }

  const users = await User.find({
    currentRoomId: new mongoose.Types.ObjectId(roomId),
  }).sort({ lastActiveAt: -1 });

  const presences = users.map((u) => mapUserToPresence(u));

  const seats = await Seat.find({
    roomId: new mongoose.Types.ObjectId(roomId),
    status: 'occupied',
  }).populate('occupiedBy', 'displayName avatar');

  sendSuccess(res, {
    users: presences,
    occupiedSeats: seats,
    count: presences.length,
    capacity: room.capacity || 0,
  });
});

export const getUserPresence = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const presence = mapUserToPresence(user, true);

  if (presence.currentSeatId) {
    const seat = await Seat.findById(presence.currentSeatId)
      .populate('roomId', 'name');
    (presence as any).currentSeat = seat;
  }

  sendSuccess(res, { user: presence });
});

export const getPresenceBatch = asyncHandler(async (req: Request, res: Response) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return sendSuccess(res, { users: [] });
  }

  const ids = userIds
    .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
    .map((id: string) => new mongoose.Types.ObjectId(id));

  const users = await User.find({ _id: { $in: ids } });

  sendSuccess(res, {
    users: users.map((u) => mapUserToPresence(u)),
  });
});

export const updateLastActive = asyncHandler(async (req: Request, res: Response) => {
  await User.findByIdAndUpdate(req.user!._id, {
    lastActiveAt: new Date(),
  });

  sendSuccess(res, { lastActiveAt: new Date() });
});

export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 50,
    role,
    status,
    search,
  } = req.query;

  const query: any = {};
  if (role) query.role = role;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { displayName: { $regex: search as string, $options: 'i' } },
      { email: { $regex: search as string, $options: 'i' } },
    ];
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const total = await User.countDocuments(query);

  const users = await User.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit as string));

  sendSuccess(
    res,
    {
      users: users.map((u) => mapUserToPresence(u)),
    },
    200,
    {
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string)),
    }
  );
});

export const kickUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId, reason } = req.body;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  user.currentSpaceId = undefined;
  user.currentRoomId = undefined;
  user.currentSeatId = undefined;
  user.onlineStatus = 'offline';
  await user.save({ validateBeforeSave: false });

  await Seat.updateMany(
    { occupiedBy: new mongoose.Types.ObjectId(userId) },
    {
      $set: {
        occupiedBy: undefined,
        status: 'available',
      },
    }
  );

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'user_kick',
    entityType: 'user',
    entityId: user._id as any,
    description: `踢出用户: ${user.displayName}${reason ? ` - 原因: ${reason}` : ''}`,
    metadata: { reason, targetUserId: userId },
  });

  sendSuccess(res, { message: `已踢出用户: ${user.displayName}` });
});

export const banUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId, reason } = req.body;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  if (user.role === 'admin') {
    return next(new AppError('不能封禁管理员', 403));
  }

  user.status = 'banned';
  user.currentSpaceId = undefined;
  user.currentRoomId = undefined;
  user.currentSeatId = undefined;
  user.onlineStatus = 'offline';
  await user.save({ validateBeforeSave: false });

  await Seat.updateMany(
    { occupiedBy: new mongoose.Types.ObjectId(userId) },
    {
      $set: {
        occupiedBy: undefined,
        status: 'available',
      },
    }
  );

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'user_ban',
    entityType: 'user',
    entityId: user._id as any,
    description: `封禁用户: ${user.displayName}${reason ? ` - 原因: ${reason}` : ''}`,
    metadata: { reason, targetUserId: userId },
  });

  sendSuccess(res, { message: `已封禁用户: ${user.displayName}` });
});
