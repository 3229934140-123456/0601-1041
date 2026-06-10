import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Whiteboard, { IBoardElement } from '../models/Whiteboard';
import Space from '../models/Space';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';

export const getWhiteboardByRoom = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params;

  const room = await Space.findById(roomId);
  if (!room) {
    return next(new AppError('房间不存在', 404));
  }

  let whiteboard = await Whiteboard.findOne({ roomId: new mongoose.Types.ObjectId(roomId) })
    .populate('elements.createdBy', 'displayName avatar')
    .populate('elements.updatedBy', 'displayName avatar');

  if (!whiteboard) {
    whiteboard = await Whiteboard.create({
      roomId: new mongoose.Types.ObjectId(roomId),
      name: `${room.name} - 白板`,
      lastModifiedBy: req.user!._id,
    });
  }

  sendSuccess(res, { whiteboard });
});

export const createWhiteboard = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { roomId, name, backgroundColor, width, height } = req.body;

  if (!roomId) {
    return next(new AppError('请提供房间ID', 400));
  }

  const room = await Space.findById(roomId);
  if (!room) {
    return next(new AppError('房间不存在', 404));
  }

  const existing = await Whiteboard.findOne({ roomId: new mongoose.Types.ObjectId(roomId) });
  if (existing) {
    return next(new AppError('该房间已有白板', 400));
  }

  const whiteboard = await Whiteboard.create({
    roomId: new mongoose.Types.ObjectId(roomId),
    name: name || `${room.name} - 白板`,
    backgroundColor,
    width,
    height,
    lastModifiedBy: req.user!._id,
  });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'whiteboard_create',
    entityType: 'whiteboard',
    entityId: whiteboard._id as any,
    roomId: room._id as any,
    description: `创建白板: ${whiteboard.name}`,
  });

  sendSuccess(res, { whiteboard }, 201);
});

export const updateWhiteboardSettings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const whiteboard = await Whiteboard.findById(req.params.id);
  if (!whiteboard) {
    return next(new AppError('白板不存在', 404));
  }

  const allowedUpdates = ['name', 'backgroundColor', 'width', 'height', 'isLocked', 'lockedBy'];
  for (const field of allowedUpdates) {
    if (req.body[field] !== undefined) {
      (whiteboard as any)[field] = req.body[field];
    }
  }
  whiteboard.lastModifiedBy = req.user!._id;
  await whiteboard.save();

  sendSuccess(res, { whiteboard });
});

export const addElement = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { whiteboardId } = req.params;
  const element = req.body as IBoardElement;

  if (!element.id || !element.type || !element.position || !element.size) {
    return next(new AppError('元素数据不完整', 400));
  }

  const whiteboard = await Whiteboard.findById(whiteboardId);
  if (!whiteboard) {
    return next(new AppError('白板不存在', 404));
  }

  if (whiteboard.isLocked && req.user!.role !== 'admin') {
    const lockedByMe = whiteboard.lockedBy?.toString() === req.user!._id.toString();
    if (!lockedByMe) {
      return next(new AppError('白板已被锁定', 403));
    }
  }

  const exists = whiteboard.elements.some((e) => e.id === element.id);
  if (exists) {
    return next(new AppError('元素ID已存在', 400));
  }

  const newElement: IBoardElement = {
    ...element,
    createdBy: req.user!._id as any,
    updatedBy: req.user!._id as any,
    zIndex: element.zIndex || whiteboard.elements.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  whiteboard.elements.push(newElement);
  whiteboard.lastModifiedBy = req.user!._id;
  await whiteboard.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'whiteboard_create',
    entityType: 'whiteboard',
    entityId: whiteboard._id as any,
    roomId: whiteboard.roomId as any,
    description: `添加白板元素: ${element.type}`,
    metadata: { elementId: element.id, elementType: element.type },
  });

  sendSuccess(res, { element: newElement });
});

export const updateElement = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { whiteboardId, elementId } = req.params;
  const updateData = req.body;

  const whiteboard = await Whiteboard.findById(whiteboardId);
  if (!whiteboard) {
    return next(new AppError('白板不存在', 404));
  }

  if (whiteboard.isLocked && req.user!.role !== 'admin') {
    const lockedByMe = whiteboard.lockedBy?.toString() === req.user!._id.toString();
    if (!lockedByMe) {
      return next(new AppError('白板已被锁定', 403));
    }
  }

  const elementIndex = whiteboard.elements.findIndex((e) => e.id === elementId);
  if (elementIndex === -1) {
    return next(new AppError('元素不存在', 404));
  }

  const element = whiteboard.elements[elementIndex];
  const allowedFields = ['content', 'color', 'position', 'size', 'rotation', 'zIndex'];

  for (const field of allowedFields) {
    if (updateData[field] !== undefined) {
      (element as any)[field] = updateData[field];
    }
  }
  element.updatedBy = req.user!._id as any;
  element.updatedAt = new Date();

  whiteboard.lastModifiedBy = req.user!._id;
  await whiteboard.save();

  try {
    const { getIO } = await import('../socket');
    const { default: NotificationService } = await import('../services/NotificationService');

    const io = getIO();
    const roomKey = `whiteboard:${whiteboardId}`;
    io.to(roomKey).emit('whiteboard:updated', {
      whiteboardId,
      elementId,
      element,
      updatedBy: req.user!._id,
    });

    const notifiedUserIds = new Set<string>();
    const sockets = await io.in(roomKey).fetchSockets();
    for (const s of sockets) {
      const uid = (s as any).user?._id?.toString();
      if (uid && uid !== req.user!._id.toString()) {
        notifiedUserIds.add(uid);
      }
    }

    if (notifiedUserIds.size > 0) {
      await NotificationService.batchCreate({
        userIds: Array.from(notifiedUserIds),
        type: 'whiteboard_update',
        priority: 'normal',
        title: `白板更新: ${whiteboard.name}`,
        content: `${req.user!.displayName} 更新了白板中的「${element.type}」元素`,
        entityType: 'whiteboard',
        entityId: whiteboard._id,
        roomId: whiteboard.roomId,
        actorUserId: req.user!._id,
        actionUrl: `/whiteboard/${whiteboard._id}`,
        dedupKey: `wb_update_${whiteboard._id}_${Math.floor(Date.now() / 30000)}`,
        dedupWindowMinutes: 1,
        metadata: {
          elementId,
          elementType: element.type,
          whiteboardName: whiteboard.name,
        },
      });
    }
  } catch (_e) {
    // 通知失败忽略
  }

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'whiteboard_update',
    entityType: 'whiteboard',
    entityId: whiteboard._id as any,
    roomId: whiteboard.roomId as any,
    description: `更新白板元素: ${element.type}`,
    metadata: { elementId, elementType: element.type },
  });

  sendSuccess(res, { element });
});

export const deleteElement = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { whiteboardId, elementId } = req.params;

  const whiteboard = await Whiteboard.findById(whiteboardId);
  if (!whiteboard) {
    return next(new AppError('白板不存在', 404));
  }

  if (whiteboard.isLocked && req.user!.role !== 'admin') {
    const lockedByMe = whiteboard.lockedBy?.toString() === req.user!._id.toString();
    if (!lockedByMe) {
      return next(new AppError('白板已被锁定', 403));
    }
  }

  const elementIndex = whiteboard.elements.findIndex((e) => e.id === elementId);
  if (elementIndex === -1) {
    return next(new AppError('元素不存在', 404));
  }

  const [deletedElement] = whiteboard.elements.splice(elementIndex, 1);
  whiteboard.lastModifiedBy = req.user!._id;
  await whiteboard.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'whiteboard_delete',
    entityType: 'whiteboard',
    entityId: whiteboard._id as any,
    roomId: whiteboard.roomId as any,
    description: `删除白板元素: ${deletedElement.type}`,
    metadata: { elementId, elementType: deletedElement.type },
  });

  sendMessage(res, '元素已删除');
});

export const batchUpdateElements = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { whiteboardId } = req.params;
  const { elements } = req.body;

  if (!Array.isArray(elements)) {
    return next(new AppError('请提供元素数组', 400));
  }

  const whiteboard = await Whiteboard.findById(whiteboardId);
  if (!whiteboard) {
    return next(new AppError('白板不存在', 404));
  }

  if (whiteboard.isLocked && req.user!.role !== 'admin') {
    const lockedByMe = whiteboard.lockedBy?.toString() === req.user!._id.toString();
    if (!lockedByMe) {
      return next(new AppError('白板已被锁定', 403));
    }
  }

  let updatedCount = 0;
  let addedCount = 0;

  for (const elemData of elements) {
    if (elemData._deleted) {
      const idx = whiteboard.elements.findIndex((e) => e.id === elemData.id);
      if (idx !== -1) {
        whiteboard.elements.splice(idx, 1);
      }
      continue;
    }

    const existingIndex = whiteboard.elements.findIndex((e) => e.id === elemData.id);
    if (existingIndex !== -1) {
      const existing = whiteboard.elements[existingIndex];
      Object.assign(existing, elemData, {
        updatedBy: req.user!._id,
        updatedAt: new Date(),
      });
      updatedCount++;
    } else {
      whiteboard.elements.push({
        ...elemData,
        createdBy: req.user!._id,
        updatedBy: req.user!._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      addedCount++;
    }
  }

  whiteboard.lastModifiedBy = req.user!._id;
  await whiteboard.save();

  sendSuccess(res, {
    updatedCount,
    addedCount,
    totalElements: whiteboard.elements.length,
  });
});

export const lockWhiteboard = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { whiteboardId } = req.params;
  const { lock } = req.body;

  const whiteboard = await Whiteboard.findById(whiteboardId);
  if (!whiteboard) {
    return next(new AppError('白板不存在', 404));
  }

  whiteboard.isLocked = lock;
  whiteboard.lockedBy = lock ? req.user!._id : undefined;
  whiteboard.lastModifiedBy = req.user!._id;
  await whiteboard.save();

  sendSuccess(res, {
    isLocked: whiteboard.isLocked,
    lockedBy: whiteboard.lockedBy,
  });
});

export const clearWhiteboard = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const whiteboard = await Whiteboard.findById(req.params.id);
  if (!whiteboard) {
    return next(new AppError('白板不存在', 404));
  }

  whiteboard.elements = [];
  whiteboard.lastModifiedBy = req.user!._id;
  await whiteboard.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'whiteboard_delete',
    entityType: 'whiteboard',
    entityId: whiteboard._id as any,
    roomId: whiteboard.roomId as any,
    description: '清空白板',
  });

  sendMessage(res, '白板已清空');
});
