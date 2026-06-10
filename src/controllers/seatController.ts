import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Seat, { ISeat } from '../models/Seat';
import Space from '../models/Space';
import User from '../models/User';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';

export const createSeat = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    code,
    name,
    description,
    type,
    roomId,
    position,
    equipment,
  } = req.body;

  if (!code || !name || !roomId || !position) {
    return next(new AppError('请提供座位编号、名称、房间ID和位置', 400));
  }

  const room = await Space.findById(roomId);
  if (!room) {
    return next(new AppError('房间不存在', 404));
  }
  if (room.type !== 'room') {
    return next(new AppError('只能在房间类型的空间内创建座位', 400));
  }

  const seat = await Seat.create({
    code,
    name,
    description,
    type: type || 'hot',
    roomId: new mongoose.Types.ObjectId(roomId),
    position,
    equipment: equipment || [],
  });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'seat',
    entityId: seat._id as any,
    roomId: room._id as any,
    description: `创建座位: ${name} (${code})`,
  });

  sendSuccess(res, { seat }, 201);
});

export const getSeats = asyncHandler(async (req: Request, res: Response) => {
  const { roomId, type, status, assignedUserId, includeInactive } = req.query;

  const query: any = {};
  if (roomId) query.roomId = new mongoose.Types.ObjectId(roomId as string);
  if (type) query.type = type;
  if (status) query.status = status;
  if (assignedUserId) query.assignedUserId = new mongoose.Types.ObjectId(assignedUserId as string);
  if (!includeInactive) query.isActive = true;

  const seats = await Seat.find(query)
    .populate('assignedUserId', 'displayName avatar email')
    .populate('occupiedBy', 'displayName avatar email')
    .populate('roomId', 'name type')
    .sort({ code: 1 });

  sendSuccess(res, { seats });
});

export const getSeatById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const seat = await Seat.findById(req.params.id)
    .populate('assignedUserId', 'displayName avatar email')
    .populate('occupiedBy', 'displayName avatar email')
    .populate('roomId', 'name type');

  if (!seat) {
    return next(new AppError('座位不存在', 404));
  }

  sendSuccess(res, { seat });
});

export const updateSeat = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const seat = await Seat.findById(req.params.id);
  if (!seat) {
    return next(new AppError('座位不存在', 404));
  }

  const allowedUpdates = [
    'name',
    'description',
    'type',
    'position',
    'equipment',
    'status',
    'isActive',
  ];

  for (const field of allowedUpdates) {
    if (req.body[field] !== undefined) {
      (seat as any)[field] = req.body[field];
    }
  }

  await seat.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'seat',
    entityId: seat._id as any,
    description: `更新座位: ${seat.name}`,
  });

  sendSuccess(res, { seat });
});

export const deleteSeat = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const seat = await Seat.findById(req.params.id);
  if (!seat) {
    return next(new AppError('座位不存在', 404));
  }

  await Seat.findByIdAndDelete(req.params.id);

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'seat',
    entityId: seat._id as any,
    description: `删除座位: ${seat.name}`,
  });

  sendMessage(res, '座位已删除');
});

export const assignSeat = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { seatId, userId } = req.body;

  const seat = await Seat.findById(seatId);
  if (!seat) {
    return next(new AppError('座位不存在', 404));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const existingAssignment = await Seat.findOne({
    assignedUserId: new mongoose.Types.ObjectId(userId),
    _id: { $ne: new mongoose.Types.ObjectId(seatId) },
  });
  if (existingAssignment) {
    existingAssignment.assignedUserId = undefined;
    if (existingAssignment.status === 'occupied') {
      existingAssignment.status = 'available';
    }
    await existingAssignment.save();
  }

  seat.assignedUserId = new mongoose.Types.ObjectId(userId);
  seat.type = 'fixed';
  await seat.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'seat_assign',
    entityType: 'seat',
    entityId: seat._id as any,
    roomId: seat.roomId as any,
    description: `为 ${user.displayName} 分配座位: ${seat.name}`,
    metadata: { assignedUserId: userId },
  });

  try {
    const { default: NotificationService } = await import('../services/NotificationService');
    await NotificationService.create({
      userId,
      type: 'seat_assigned',
      priority: 'normal',
      title: `您被分配了新座位: ${seat.name}`,
      content: `座位位于 ${seat.roomId ? '指定房间' : '公共区域'}，类型: ${seat.type === 'fixed' ? '固定工位' : '热座'}`,
      entityType: 'seat',
      entityId: seat._id,
      spaceId: seat.roomId,
      roomId: seat.roomId,
      actorUserId: req.user!._id,
      actionUrl: `/seats/${seat._id}`,
      metadata: {
        seatName: seat.name,
        seatType: seat.type,
      },
    });
  } catch (_e) {
    // 通知失败忽略
  }

  sendSuccess(res, { seat });
});

export const unassignSeat = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const seat = await Seat.findById(req.params.id);
  if (!seat) {
    return next(new AppError('座位不存在', 404));
  }

  const assignedUser = seat.assignedUserId
    ? await User.findById(seat.assignedUserId)
    : null;

  seat.assignedUserId = undefined;
  if (seat.status === 'occupied' && !seat.occupiedBy) {
    seat.status = 'available';
  }
  await seat.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'seat_unassign',
    entityType: 'seat',
    entityId: seat._id as any,
    description: `取消座位分配: ${seat.name}${assignedUser ? ` (原分配给 ${assignedUser.displayName})` : ''}`,
  });

  sendSuccess(res, { seat });
});

export const occupySeat = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { seatId } = req.body;
  const userId = req.user!._id;

  const seat = await Seat.findById(seatId);
  if (!seat) {
    return next(new AppError('座位不存在', 404));
  }

  if (seat.status === 'maintenance') {
    return next(new AppError('该座位正在维护中，无法使用', 400));
  }

  if (seat.assignedUserId && seat.assignedUserId.toString() !== userId.toString()) {
    return next(new AppError('该座位已分配给其他用户', 403));
  }

  if (seat.status === 'occupied' && seat.occupiedBy && seat.occupiedBy.toString() !== userId.toString()) {
    return next(new AppError('该座位已被占用', 409));
  }

  await Seat.updateMany(
    {
      occupiedBy: new mongoose.Types.ObjectId(userId.toString()),
      _id: { $ne: new mongoose.Types.ObjectId(seatId) },
    },
    {
      $set: {
        occupiedBy: undefined,
        status: 'available',
      },
    }
  );

  seat.occupiedBy = new mongoose.Types.ObjectId(userId.toString());
  seat.status = 'occupied';
  await seat.save();

  await User.findByIdAndUpdate(userId, {
    currentSeatId: seat._id,
  });

  await ActivityLogger.log({
    userId: userId as any,
    type: 'seat_occupy',
    entityType: 'seat',
    entityId: seat._id as any,
    roomId: seat.roomId as any,
    description: `${req.user!.displayName} 占用座位: ${seat.name}`,
  });

  sendSuccess(res, { seat });
});

export const releaseSeat = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { seatId } = req.body;
  const operatorUserId = req.user!._id;

  const seat = await Seat.findById(seatId);
  if (!seat) {
    return next(new AppError('座位不存在', 404));
  }

  if (!seat.occupiedBy) {
    return next(new AppError('该座位当前无人占用', 400));
  }

  const targetUserId = seat.occupiedBy;
  const isSelf = targetUserId.toString() === operatorUserId.toString();

  if (!isSelf && req.user!.role !== 'admin' && req.user!.role !== 'moderator') {
    return next(new AppError('您没有权限释放此座位', 403));
  }

  seat.occupiedBy = undefined;
  seat.status = seat.assignedUserId ? 'reserved' : 'available';
  await seat.save();

  await User.findByIdAndUpdate(targetUserId, {
    $unset: {
      currentSeatId: '',
      currentRoomId: '',
      currentSpaceId: '',
    },
  });

  const UserSocket = (await import('../socket')).onlineUsers;
  const targetOnline = UserSocket.get(targetUserId.toString());
  if (targetOnline) {
    targetOnline.currentSeatId = undefined;
    targetOnline.currentRoomId = undefined;
  }

  await ActivityLogger.log({
    userId: operatorUserId as any,
    type: 'seat_release',
    entityType: 'seat',
    entityId: seat._id as any,
    roomId: seat.roomId as any,
    description: isSelf
      ? `${req.user!.displayName} 释放座位: ${seat.name}`
      : `${req.user!.displayName} (管理员) 释放了 ${targetUserId} 的座位: ${seat.name}`,
    metadata: {
      targetUserId: targetUserId.toString(),
      isAdminAction: !isSelf,
    },
  });

  try {
    const { default: NotificationService } = await import('../services/NotificationService');
    await NotificationService.create({
      userId: targetUserId,
      type: 'seat_released',
      priority: 'normal',
      title: isSelf ? '座位已释放' : '座位被收回',
      content: isSelf
        ? `您已释放座位: ${seat.name}`
        : `${req.user!.displayName} (管理员) 收回了您的座位: ${seat.name}`,
      entityType: 'seat',
      entityId: seat._id,
      roomId: seat.roomId,
      actorUserId: operatorUserId,
      actionUrl: `/seats`,
      dedupKey: `seat_released_${seat._id}_${Date.now()}`,
      dedupWindowMinutes: 5,
      metadata: {
        seatName: seat.name,
        isAdminAction: !isSelf,
        isSelf,
      },
    });
  } catch (_e) {
    // 通知失败忽略
  }

  sendSuccess(res, { seat });
});

export const getMySeat = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id;

  const assignedSeat = await Seat.findOne({ assignedUserId: userId })
    .populate('roomId', 'name type');

  const occupiedSeat = await Seat.findOne({ occupiedBy: userId })
    .populate('roomId', 'name type');

  sendSuccess(res, { assignedSeat, occupiedSeat });
});
