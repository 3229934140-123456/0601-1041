import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Space, { ISpace } from '../models/Space';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';

const canAccessSpace = (user: any, space: ISpace): boolean => {
  if (!space.isPublic) {
    if (space.allowedRoles && space.allowedRoles.length > 0) {
      if (!space.allowedRoles.includes(user.role)) return false;
    }
    if (space.allowedUsers && space.allowedUsers.length > 0) {
      if (!space.allowedUsers.some((u: any) => u.toString() === user._id.toString())) return false;
    }
    if (user.role === 'admin') return true;
  }
  if (user.allowedSpaces && user.allowedSpaces.length > 0) {
    if (!user.allowedSpaces.some((s: any) => s.toString() === space._id.toString())) {
      if (user.role !== 'admin') return false;
    }
  }
  return true;
};

export const createSpace = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    name,
    description,
    type,
    category,
    parentId,
    sortOrder,
    position,
    backgroundUrl,
    capacity,
    isPublic,
    allowedRoles,
    allowedUsers,
  } = req.body;

  if (!name || !type) {
    return next(new AppError('请提供空间名称和类型', 400));
  }

  let spacePath: mongoose.Types.ObjectId[] = [];
  let level = 0;

  if (parentId) {
    const parent = await Space.findById(parentId);
    if (!parent) {
      return next(new AppError('父空间不存在', 404));
    }
    spacePath = [...(parent.spacePath || []), new mongoose.Types.ObjectId(parentId)];
    level = parent.level + 1;
  }

  const space = await Space.create({
    name,
    description,
    type,
    category,
    parentId: parentId ? new mongoose.Types.ObjectId(parentId) : undefined,
    spacePath,
    level,
    sortOrder: sortOrder || 0,
    position,
    backgroundUrl,
    capacity: capacity || 0,
    isPublic: isPublic !== undefined ? isPublic : true,
    allowedRoles,
    allowedUsers,
    createdBy: req.user!._id,
  });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'space',
    entityId: space._id as any,
    spaceId: parentId || space._id as any,
    description: `创建${type === 'floor' ? '楼层' : type === 'room' ? '房间' : '区域'}: ${name}`,
  });

  sendSuccess(res, { space }, 201);
});

export const getSpaces = asyncHandler(async (req: Request, res: Response) => {
  const { type, parentId, isActive, includeInactive } = req.query;

  const query: any = {};
  if (type) query.type = type;
  if (parentId) query.parentId = new mongoose.Types.ObjectId(parentId as string);
  if (isActive !== undefined) query.isActive = isActive === 'true';
  else if (!includeInactive) query.isActive = true;

  const spaces = await Space.find(query).sort({ level: 1, sortOrder: 1, createdAt: 1 });

  const filteredSpaces = spaces.filter((space) => canAccessSpace(req.user, space));

  sendSuccess(res, { spaces: filteredSpaces });
});

export const getSpaceById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const space = await Space.findById(req.params.id);
  if (!space) {
    return next(new AppError('空间不存在', 404));
  }

  if (!canAccessSpace(req.user, space)) {
    return next(new AppError('您没有权限访问此空间', 403));
  }

  sendSuccess(res, { space });
});

export const getSpaceTree = asyncHandler(async (req: Request, res: Response) => {
  const floors = await Space.find({ type: 'floor', isActive: true }).sort({ sortOrder: 1 });
  const allRooms = await Space.find({ type: 'room', isActive: true }).sort({ sortOrder: 1 });
  const allAreas = await Space.find({ type: 'area', isActive: true }).sort({ sortOrder: 1 });

  const buildTree = (floors: ISpace[]) => {
    return floors
      .filter((f) => canAccessSpace(req.user, f))
      .map((floor) => ({
        ...floor.toObject(),
        children: allRooms
          .filter((r) => r.parentId?.toString() === floor._id.toString())
          .filter((r) => canAccessSpace(req.user, r))
          .map((room) => ({
            ...room.toObject(),
            children: allAreas.filter(
              (a) => a.parentId?.toString() === room._id.toString() && canAccessSpace(req.user, a)
            ),
          })),
      }));
  };

  sendSuccess(res, { tree: buildTree(floors) });
});

export const updateSpace = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const space = await Space.findById(req.params.id);
  if (!space) {
    return next(new AppError('空间不存在', 404));
  }

  const allowedUpdates = [
    'name',
    'description',
    'category',
    'sortOrder',
    'position',
    'backgroundUrl',
    'capacity',
    'isPublic',
    'allowedRoles',
    'allowedUsers',
    'isActive',
  ];

  for (const field of allowedUpdates) {
    if (req.body[field] !== undefined) {
      (space as any)[field] = req.body[field];
    }
  }

  await space.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'space',
    entityId: space._id as any,
    description: `更新空间: ${space.name}`,
  });

  sendSuccess(res, { space });
});

export const deleteSpace = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const space = await Space.findById(req.params.id);
  if (!space) {
    return next(new AppError('空间不存在', 404));
  }

  const hasChildren = await Space.exists({ parentId: space._id });
  if (hasChildren) {
    return next(new AppError('该空间下还有子空间，无法删除', 400));
  }

  const Seat = (await import('../models/Seat')).default;
  await Seat.deleteMany({ roomId: space._id });

  await Space.findByIdAndDelete(space._id);

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'space',
    entityId: space._id as any,
    description: `删除空间: ${space.name}`,
  });

  sendMessage(res, '空间已删除');
});

export const enterSpace = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { spaceId, roomId } = req.body;

  const targetSpace = await Space.findById(roomId || spaceId);
  if (!targetSpace) {
    return next(new AppError('空间不存在', 404));
  }

  if (!canAccessSpace(req.user, targetSpace)) {
    return next(new AppError('您没有权限进入此空间', 403));
  }

  const User = (await import('../models/User')).default;
  await User.findByIdAndUpdate(req.user!._id, {
    currentSpaceId: spaceId,
    currentRoomId: roomId || spaceId,
    lastActiveAt: new Date(),
  });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'space_enter',
    entityType: 'space',
    entityId: targetSpace._id as any,
    spaceId: spaceId,
    roomId: roomId || spaceId,
    description: `${req.user!.displayName} 进入空间: ${targetSpace.name}`,
  });

  sendSuccess(res, { space: targetSpace });
});

export const leaveSpace = asyncHandler(async (req: Request, res: Response) => {
  const User = (await import('../models/User')).default;
  const leftRoomId = req.user!.currentRoomId;

  await User.findByIdAndUpdate(req.user!._id, {
    currentSpaceId: undefined,
    currentRoomId: undefined,
    currentSeatId: undefined,
    lastActiveAt: new Date(),
  });

  if (leftRoomId) {
    const space = await Space.findById(leftRoomId);
    await ActivityLogger.log({
      userId: req.user!._id as any,
      type: 'space_leave',
      entityType: 'space',
      entityId: leftRoomId as any,
      description: `${req.user!.displayName} 离开空间: ${space?.name || ''}`,
    });
  }

  sendMessage(res, '已离开空间');
});
