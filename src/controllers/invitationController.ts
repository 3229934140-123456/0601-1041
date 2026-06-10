import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Invitation from '../models/Invitation';
import User from '../models/User';
import Space from '../models/Space';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';

export const createInvitation = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    inviteeEmail,
    inviteeName,
    type,
    allowedSpaces,
    expiresAt,
    maxUses,
    message,
  } = req.body;

  const validTypes = ['guest', 'member'];
  if (type && !validTypes.includes(type)) {
    return next(new AppError('邀请类型无效', 400));
  }

  if (type === 'member' && req.user!.role !== 'admin' && req.user!.role !== 'moderator') {
    return next(new AppError('只有管理员可以发送成员邀请', 403));
  }

  if (allowedSpaces && Array.isArray(allowedSpaces)) {
    for (const spaceId of allowedSpaces) {
      const space = await Space.findById(spaceId);
      if (!space) {
        return next(new AppError(`空间ID无效: ${spaceId}`, 400));
      }
    }
  }

  let expiration = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (expiration <= new Date()) {
    return next(new AppError('过期时间必须晚于当前时间', 400));
  }

  const invitation = await Invitation.create({
    inviterId: req.user!._id,
    inviteeEmail: inviteeEmail?.toLowerCase(),
    inviteeName,
    type: type || 'guest',
    allowedSpaces: allowedSpaces?.map((id: string) => new mongoose.Types.ObjectId(id)) || [],
    expiresAt: expiration,
    maxUses: maxUses || 1,
    message,
  });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'invitation_create',
    entityType: 'invitation',
    entityId: invitation._id as any,
    description: `创建邀请: ${type === 'member' ? '成员邀请' : '访客邀请'}${inviteeName ? ` -> ${inviteeName}` : ''}`,
    metadata: {
      inviteeEmail,
      allowedSpaces: allowedSpaces?.length || 0,
    },
  });

  sendSuccess(res, { invitation }, 201);
});

export const getInvitations = asyncHandler(async (req: Request, res: Response) => {
  const {
    status,
    type,
    page = 1,
    limit = 50,
  } = req.query;

  const query: any = {};
  if (req.user!.role !== 'admin') {
    query.inviterId = req.user!._id;
  }
  if (status) query.status = status;
  if (type) query.type = type;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const total = await Invitation.countDocuments(query);

  const invitations = await Invitation.find(query)
    .populate('inviterId', 'displayName avatar email')
    .populate('acceptedBy', 'displayName avatar email')
    .populate('allowedSpaces', 'name type')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit as string));

  await Invitation.updateMany(
    { status: 'pending', expiresAt: { $lt: new Date() } },
    { status: 'expired' }
  );

  sendSuccess(
    res,
    { invitations },
    200,
    {
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string)),
    }
  );
});

export const getInvitationByCode = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { code } = req.params;

  const invitation = await Invitation.findOne({
    code: code.toUpperCase(),
  })
    .populate('inviterId', 'displayName avatar email')
    .populate('allowedSpaces', 'name type');

  if (!invitation) {
    return next(new AppError('邀请码不存在', 404));
  }

  let isValid = true;
  let invalidReason = '';

  if (invitation.status !== 'pending') {
    isValid = false;
    invalidReason = `邀请已${invitation.status === 'expired' ? '过期' : invitation.status === 'revoked' ? '撤销' : '被使用'}`;
  } else if (invitation.expiresAt < new Date()) {
    isValid = false;
    invalidReason = '邀请已过期';
    invitation.status = 'expired';
    await invitation.save();
  } else if (invitation.usedCount >= invitation.maxUses) {
    isValid = false;
    invalidReason = '邀请码使用次数已达上限';
  }

  sendSuccess(res, {
    invitation,
    isValid,
    invalidReason,
  });
});

export const acceptInvitation = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { code } = req.body;

  const invitation = await Invitation.findOne({ code: code.toUpperCase() });
  if (!invitation) {
    return next(new AppError('邀请码不存在', 404));
  }

  if (invitation.status !== 'pending') {
    return next(new AppError(`邀请已${invitation.status === 'expired' ? '过期' : invitation.status === 'revoked' ? '撤销' : '被使用'}`, 400));
  }

  if (invitation.expiresAt < new Date()) {
    invitation.status = 'expired';
    await invitation.save();
    return next(new AppError('邀请已过期', 400));
  }

  if (invitation.usedCount >= invitation.maxUses) {
    return next(new AppError('邀请码使用次数已达上限', 400));
  }

  if (req.user) {
    const currentSpaces = req.user.allowedSpaces || [];
    const newSpaces = [
      ...new Set([
        ...currentSpaces.map((id) => id.toString()),
        ...invitation.allowedSpaces.map((id) => id.toString()),
      ]),
    ].map((id) => new mongoose.Types.ObjectId(id));

    await User.findByIdAndUpdate(req.user._id, {
      allowedSpaces: newSpaces,
      role: invitation.type === 'member' ? 'member' : req.user.role,
    });

    invitation.usedCount += 1;
    invitation.acceptedBy = req.user._id as any;
    invitation.acceptedAt = new Date();
    if (invitation.usedCount >= invitation.maxUses) {
      invitation.status = 'accepted';
    }
    await invitation.save();

    await ActivityLogger.log({
      userId: req.user._id as any,
      type: 'invitation_accept',
      entityType: 'invitation',
      entityId: invitation._id as any,
      description: `${req.user.displayName} 接受邀请`,
      metadata: { invitationType: invitation.type },
    });

    const updatedUser = await User.findById(req.user._id);
    sendSuccess(res, {
      invitation,
      user: updatedUser,
      grantedSpaces: invitation.allowedSpaces,
    });
  } else {
    sendSuccess(res, {
      invitation,
      requiresRegistration: true,
    });
  }
});

export const revokeInvitation = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const invitation = await Invitation.findById(req.params.id);
  if (!invitation) {
    return next(new AppError('邀请不存在', 404));
  }

  if (invitation.inviterId.toString() !== req.user!._id.toString() &&
      req.user!.role !== 'admin') {
    return next(new AppError('只有邀请创建者或管理员可以撤销邀请', 403));
  }

  invitation.status = 'revoked';
  await invitation.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'invitation_create',
    entityType: 'invitation',
    entityId: invitation._id as any,
    description: `撤销邀请码: ${invitation.code}`,
  });

  sendMessage(res, '邀请已撤销');
});

export const deleteInvitation = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const invitation = await Invitation.findById(req.params.id);
  if (!invitation) {
    return next(new AppError('邀请不存在', 404));
  }

  if (invitation.inviterId.toString() !== req.user!._id.toString() &&
      req.user!.role !== 'admin') {
    return next(new AppError('只有邀请创建者或管理员可以删除邀请', 403));
  }

  await Invitation.findByIdAndDelete(req.params.id);

  sendMessage(res, '邀请已删除');
});

export const getMyInvitations = asyncHandler(async (req: Request, res: Response) => {
  const invitations = await Invitation.find({
    $or: [
      { inviteeEmail: req.user!.email },
      { acceptedBy: req.user!._id },
    ],
  })
    .populate('inviterId', 'displayName avatar email')
    .populate('allowedSpaces', 'name type')
    .sort({ createdAt: -1 });

  sendSuccess(res, { invitations });
});
