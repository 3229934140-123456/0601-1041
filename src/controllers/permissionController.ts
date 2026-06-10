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

  try {
    const { default: NotificationService } = await import('../services/NotificationService');
    const Space = (await import('../models/Space')).default;
    const spaces = await Space.find({ _id: { $in: validIds } }).select('name type');
    const spaceNames = spaces.map((s) => s.name).join('、');
    await NotificationService.create({
      userId,
      type: 'space_access_granted',
      priority: 'high',
      title: `您获得了 ${validIds.length} 个空间的访问权限`,
      content: `${mode === 'replace' ? '管理员重新设置' : '管理员添加'}了您可访问的空间: ${spaceNames || validIds.length + '个空间'}`,
      entityType: 'permission',
      entityId: user._id,
      actorUserId: req.user!._id,
      actionUrl: '/spaces',
      metadata: {
        spaceCount: validIds.length,
        mode,
      },
    });
  } catch (_e) {
    // 通知失败忽略
  }

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

  try {
    const { default: NotificationService } = await import('../services/NotificationService');
    await NotificationService.create({
      userId,
      type: 'space_access_revoked',
      priority: 'high',
      title: `您失去了 ${spaceIds.length} 个空间的访问权限`,
      content: '管理员撤销了您对部分空间的访问权限',
      entityType: 'permission',
      entityId: user._id,
      actorUserId: req.user!._id,
      actionUrl: '/spaces',
      metadata: {
        spaceCount: spaceIds.length,
      },
    });
  } catch (_e) {
    // 通知失败忽略
  }

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
  const { userId, spaceId, invitationId, adminViewMode, checkInheritance = true } = req.body;

  const space = await Space.findById(spaceId);
  if (!space) {
    return next(new AppError('空间不存在', 404));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const SpaceAccessService = (await import('../services/SpaceAccessService')).default;
  const result = await SpaceAccessService.checkAccess(
    user as any,
    space,
    {
      checkInheritance,
      invitationId,
      adminViewMode,
    }
  );

  const denialExplanation = result.access ? null : SpaceAccessService.explainDenial(result);

  sendSuccess(res, {
    canAccess: result.access,
    accessLevel: result.level,
    accessReason: result.reason,
    matchedBy: result.matchedSpaceId
      ? {
          spaceId: result.matchedSpaceId,
          spaceName: result.matchedSpaceName,
          rule: result.matchedRule,
        }
      : null,
    chain: result.chain,
    isInherited: result.level === 'parent_inherited',
    invitationId: result.invitationId,
    denialExplanation,
    space: {
      id: space._id,
      name: space.name,
      type: space.type,
      isPublic: space.isPublic,
      level: space.level,
    },
    user: {
      id: user._id,
      displayName: user.displayName,
      role: user.role,
    },
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
