import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import VoiceRoom, { IVoiceParticipant } from '../models/VoiceRoom';
import Space from '../models/Space';
import User from '../models/User';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';

export const createVoiceRoom = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    name,
    description,
    type,
    roomId,
    position,
    maxParticipants,
    isPrivate,
    allowedUsers,
  } = req.body;

  if (!name) {
    return next(new AppError('请提供语音房间名称', 400));
  }

  if (roomId) {
    const room = await Space.findById(roomId);
    if (!room) {
      return next(new AppError('关联的空间不存在', 404));
    }
  }

  const accessCode = isPrivate
    ? Math.random().toString(36).substring(2, 8).toUpperCase()
    : undefined;

  const voiceRoom = await VoiceRoom.create({
    name,
    description,
    type: type || 'temporary',
    roomId: roomId ? new mongoose.Types.ObjectId(roomId) : undefined,
    position,
    createdBy: req.user!._id,
    maxParticipants: maxParticipants || 10,
    isPrivate: isPrivate || false,
    allowedUsers: allowedUsers?.map((id: string) => new mongoose.Types.ObjectId(id)) || [],
    accessCode,
    participants: [],
  });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'voice_room',
    entityId: voiceRoom._id as any,
    roomId: voiceRoom.roomId as any,
    description: `创建语音房间: ${name}`,
    metadata: { isPrivate, maxParticipants },
  });

  sendSuccess(res, { voiceRoom }, 201);
});

export const getVoiceRooms = asyncHandler(async (req: Request, res: Response) => {
  const { status, type, roomId } = req.query;

  const query: any = {};
  if (status) query.status = status;
  else query.status = 'active';
  if (type) query.type = type;
  if (roomId) query.roomId = new mongoose.Types.ObjectId(roomId as string);

  const rooms = await VoiceRoom.find(query)
    .populate('createdBy', 'displayName avatar')
    .populate('participants.userId', 'displayName avatar')
    .sort({ createdAt: -1 });

  const visibleRooms = rooms.filter((room) => {
    if (!room.isPrivate) return true;
    if (req.user!.role === 'admin') return true;
    if (room.createdBy.toString() === req.user!._id.toString()) return true;
    if (room.allowedUsers && room.allowedUsers.some((u) => u.toString() === req.user!._id.toString())) return true;
    return false;
  });

  sendSuccess(res, { voiceRooms: visibleRooms });
});

export const getVoiceRoomById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const voiceRoom = await VoiceRoom.findById(req.params.id)
    .populate('createdBy', 'displayName avatar')
    .populate('participants.userId', 'displayName avatar');

  if (!voiceRoom) {
    return next(new AppError('语音房间不存在', 404));
  }

  if (voiceRoom.isPrivate) {
    if (req.user!.role !== 'admin' &&
        voiceRoom.createdBy.toString() !== req.user!._id.toString() &&
        !(voiceRoom.allowedUsers && voiceRoom.allowedUsers.some((u) => u.toString() === req.user!._id.toString())) &&
        !voiceRoom.participants.some((p) => p.userId.toString() === req.user!._id.toString())) {
      return next(new AppError('您没有权限访问此私有语音房间', 403));
    }
  }

  sendSuccess(res, { voiceRoom });
});

export const joinVoiceRoom = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { voiceRoomId, accessCode } = req.body;

  const voiceRoom = await VoiceRoom.findById(voiceRoomId);
  if (!voiceRoom) {
    return next(new AppError('语音房间不存在', 404));
  }

  if (voiceRoom.status !== 'active') {
    return next(new AppError('此语音房间已结束', 400));
  }

  if (voiceRoom.isPrivate) {
    const isAllowed =
      req.user!.role === 'admin' ||
      voiceRoom.createdBy.toString() === req.user!._id.toString() ||
      (voiceRoom.allowedUsers && voiceRoom.allowedUsers.some((u) => u.toString() === req.user!._id.toString())) ||
      (accessCode && voiceRoom.accessCode === accessCode.toUpperCase());
    if (!isAllowed) {
      return next(new AppError('需要访问码才能加入此私有房间', 403));
    }
  }

  if (voiceRoom.participants.length >= voiceRoom.maxParticipants) {
    return next(new AppError('语音房间已满员', 400));
  }

  const existingParticipant = voiceRoom.participants.find(
    (p) => p.userId.toString() === req.user!._id.toString()
  );
  if (existingParticipant) {
    return sendSuccess(res, { voiceRoom, participant: existingParticipant });
  }

  await VoiceRoom.updateMany(
    {
      'participants.userId': new mongoose.Types.ObjectId(req.user!._id.toString()),
      _id: { $ne: new mongoose.Types.ObjectId(voiceRoomId) },
    },
    {
      $pull: { participants: { userId: new mongoose.Types.ObjectId(req.user!._id.toString()) } },
    }
  );

  const participant: IVoiceParticipant = {
    userId: req.user!._id as any,
    joinedAt: new Date(),
    isMuted: false,
    isDeafened: false,
    isSpeaker: true,
  };

  voiceRoom.participants.push(participant);
  await voiceRoom.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'voice_join',
    entityType: 'voice_room',
    entityId: voiceRoom._id as any,
    roomId: voiceRoom.roomId as any,
    description: `${req.user!.displayName} 加入语音房间: ${voiceRoom.name}`,
  });

  const populated = await VoiceRoom.findById(voiceRoom._id)
    .populate('participants.userId', 'displayName avatar');

  sendSuccess(res, { voiceRoom: populated });
});

export const leaveVoiceRoom = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { voiceRoomId } = req.body;

  const voiceRoom = await VoiceRoom.findById(voiceRoomId);
  if (!voiceRoom) {
    return next(new AppError('语音房间不存在', 404));
  }

  const participantIndex = voiceRoom.participants.findIndex(
    (p) => p.userId.toString() === req.user!._id.toString()
  );
  if (participantIndex === -1) {
    return next(new AppError('您不在此语音房间中', 400));
  }

  voiceRoom.participants.splice(participantIndex, 1);

  if (voiceRoom.participants.length === 0 && voiceRoom.type === 'temporary') {
    voiceRoom.status = 'ended';
    voiceRoom.endedAt = new Date();
  }
  await voiceRoom.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'voice_leave',
    entityType: 'voice_room',
    entityId: voiceRoom._id as any,
    roomId: voiceRoom.roomId as any,
    description: `${req.user!.displayName} 离开语音房间: ${voiceRoom.name}`,
  });

  sendMessage(res, '已离开语音房间');
});

export const updateParticipantState = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { voiceRoomId, isMuted, isDeafened, isSpeaker } = req.body;

  const voiceRoom = await VoiceRoom.findById(voiceRoomId);
  if (!voiceRoom) {
    return next(new AppError('语音房间不存在', 404));
  }

  const participant = voiceRoom.participants.find(
    (p) => p.userId.toString() === req.user!._id.toString()
  );
  if (!participant) {
    return next(new AppError('您不在此语音房间中', 400));
  }

  if (isMuted !== undefined) participant.isMuted = isMuted;
  if (isDeafened !== undefined) participant.isDeafened = isDeafened;
  if (isSpeaker !== undefined) participant.isSpeaker = isSpeaker;

  await voiceRoom.save();

  sendSuccess(res, { participant });
});

export const updateVoiceRoom = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const voiceRoom = await VoiceRoom.findById(req.params.id);
  if (!voiceRoom) {
    return next(new AppError('语音房间不存在', 404));
  }

  if (voiceRoom.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以修改此语音房间', 403));
  }

  const allowedUpdates = ['name', 'description', 'maxParticipants', 'position'];
  for (const field of allowedUpdates) {
    if (req.body[field] !== undefined) {
      (voiceRoom as any)[field] = req.body[field];
    }
  }
  await voiceRoom.save();

  sendSuccess(res, { voiceRoom });
});

export const endVoiceRoom = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const voiceRoom = await VoiceRoom.findById(req.params.id);
  if (!voiceRoom) {
    return next(new AppError('语音房间不存在', 404));
  }

  if (voiceRoom.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以结束此语音房间', 403));
  }

  voiceRoom.status = 'ended';
  voiceRoom.endedAt = new Date();
  voiceRoom.participants = [];
  await voiceRoom.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'voice_room',
    entityId: voiceRoom._id as any,
    description: `结束语音房间: ${voiceRoom.name}`,
  });

  sendMessage(res, '语音房间已结束');
});

export const removeParticipant = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { voiceRoomId, userId } = req.body;

  const voiceRoom = await VoiceRoom.findById(voiceRoomId);
  if (!voiceRoom) {
    return next(new AppError('语音房间不存在', 404));
  }

  if (voiceRoom.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以移除成员', 403));
  }

  const targetUser = await User.findById(userId);
  const participantIndex = voiceRoom.participants.findIndex(
    (p) => p.userId.toString() === userId
  );
  if (participantIndex === -1) {
    return next(new AppError('该用户不在此语音房间中', 400));
  }

  voiceRoom.participants.splice(participantIndex, 1);
  await voiceRoom.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'user_kick',
    entityType: 'voice_room',
    entityId: voiceRoom._id as any,
    description: `从语音房间移除用户: ${targetUser?.displayName || userId}`,
    metadata: { targetUserId: userId },
  });

  sendMessage(res, '已移除该用户');
});
