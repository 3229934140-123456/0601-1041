import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Space, { ISpace } from '../models/Space';
import User from '../models/User';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';

export const setSpacePermissions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { spaceId, isPublic, allowedRoles, allowedUsers } = req.body;

  const space = await Space.findById(spaceId);
  if (!space) {
    return next(new AppError('空间不存在', 404));
  }

  if (req.user!.role !== 'admin' && space.createdBy.toString() !== req.user!._id.toString()) {
    return next(new AppError('只有管理员或空间创建者可以设置权限', 403));
  }

  if (isPublic !== undefined) space.isPublic = isPublic;
  if (allowedRoles !== undefined) space.allowedRoles = allowedRoles;
  if (allowedUsers !== undefined) {
    space.allowedUsers = allowedUsers.map((id: string) => new mongoose.Types.ObjectId(id));
  }

  await space.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'permission_grant',
    entityType: 'space',
    entityId: space._id as any,
    description: `更新空间权限: ${space.name}`,
    metadata: { isPublic, allowedRoles: allowedRoles?.length, allowedUsers: allowedUsers?.length },
  });

  sendSuccess(res, { space });
});

export const grantUserSpaces = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId, spaceIds, mode = 'merge' } = req.body;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const validSpaces = await Space.find({
    _id: { $in: spaceIds.map((id: string) => new mongoose.Types.ObjectId(id)) },
  }).select('_id');

  const validIds = validSpaces.map((s) => s._id.toString());

  let newAllowedSpaces: string[] = [];
  if (mode === 'replace') {
    newAllowedSpaces = validIds;
  } else {
    const currentIds = (user.allowedSpaces || []).map((id) => id.toString());
    newAllowedSpaces = [...new Set([...currentIds, ...validIds])];
  }

  user.allowedSpaces = newAllowedSpaces.map((id) => new mongoose.Types.ObjectId(id));
  await user.save({ validateBeforeSave: false });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'permission_grant',
    entityType: 'permission',
    entityId: user._id as any,
    description: `为用户 ${user.displayName} ${mode === 'replace' ? '设置' : '添加'}空间访问权限 (${validIds.length}个空间)`,
    metadata: { targetUserId: userId, spaceCount: validIds.length, mode },
  });

  sendSuccess(res, { user: { allowedSpaces: user.allowedSpaces, _id: user._id } });
});

export const revokeUserSpaces = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId, spaceIds } = req.body;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const revokeSet = new Set(spaceIds.map((id: string) => id.toString()));
  user.allowedSpaces = (user.allowedSpaces || []).filter(
    (id) => !revokeSet.has(id.toString())
  );
  await user.save({ validateBeforeSave: false });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'permission_revoke',
    entityType: 'permission',
    entityId: user._id as any,
    description: `撤销用户 ${user.displayName} 的空间访问权限 (${spaceIds.length}个空间)`,
    metadata: { targetUserId: userId, spaceCount: spaceIds.length },
  });

  sendSuccess(res, { user: { allowedSpaces: user.allowedSpaces, _id: user._id } });
});

export const getUserPermissions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const allowedSpaces = await Space.find({
    _id: { $in: user.allowedSpaces || [] },
  }).select('name type isPublic level parentId');

  const adminOverride = user.role === 'admin';

  sendSuccess(res, {
    userId: user._id,
    role: user.role,
    allowedSpaces,
    isAdmin: adminOverride,
    permissionLevel: adminOverride
      ? 'full'
      : user.allowedSpaces && user.allowedSpaces.length > 0
      ? 'restricted'
      : 'public_only',
  });
});

export const checkSpaceAccess = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId, spaceId } = req.body;

  const space = await Space.findById(spaceId);
  if (!space) {
    return next(new AppError('空间不存在', 404));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  let canAccess = space.isPublic;
  let accessReason = space.isPublic ? '空间公开' : '';

  if (user.role === 'admin') {
    canAccess = true;
    accessReason = '管理员权限';
  } else if (!space.isPublic) {
    if (space.allowedRoles && space.allowedRoles.includes(user.role)) {
      canAccess = true;
      accessReason = `角色允许: ${user.role}`;
    }
    if (space.allowedUsers && space.allowedUsers.some((u) => u.toString() === userId)) {
      canAccess = true;
      accessReason = '被列入空间白名单';
    }
    if (user.allowedSpaces && user.allowedSpaces.some((s) => s.toString() === spaceId)) {
      canAccess = true;
      accessReason = '用户被授予空间权限';
    }
  }

  sendSuccess(res, {
    canAccess,
    accessReason,
    space: { id: space._id, name: space.name, isPublic: space.isPublic },
  });
});

export const updateUserRole = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId, role } = req.body;

  const validRoles = ['admin', 'moderator', 'member', 'guest'];
  if (!validRoles.includes(role)) {
    return next(new AppError('无效的角色', 400));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const prevRole = user.role;
  user.role = role;
  await user.save({ validateBeforeSave: false });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'permission_grant',
    entityType: 'user',
    entityId: user._id as any,
    description: `将用户 ${user.displayName} 的角色从 ${prevRole} 改为 ${role}`,
    metadata: { targetUserId: userId, oldRole: prevRole, newRole: role },
  });

  sendSuccess(res, { user: { _id: user._id, role: user.role, displayName: user.displayName } });
});
