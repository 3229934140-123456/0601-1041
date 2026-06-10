import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import User, { IUser } from '../models/User';
import AppError from '../utils/AppError';
import { sendSuccess } from '../utils/response';
import { generateToken } from '../middleware/auth';
import { config } from '../config';
import ActivityLogger from '../services/ActivityLogger';

const filterUserResponse = (user: IUser) => {
  const obj: any = user.toObject();
  delete obj.password;
  return obj;
};

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password, displayName, avatar, inviteCode } = req.body;

  if (!email || !password || !displayName) {
    return next(new AppError('请提供邮箱、密码和显示名称', 400));
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('该邮箱已被注册', 400));
  }

  let allowedSpaces: string[] = [];
  let role: IUser['role'] = 'member';

  if (inviteCode) {
    const Invitation = (await import('../models/Invitation')).default;
    const invitation = await Invitation.findOne({
      code: inviteCode.toUpperCase(),
      status: 'pending',
    });
    if (!invitation || invitation.expiresAt < new Date()) {
      return next(new AppError('邀请码无效或已过期', 400));
    }
    if (invitation.maxUses <= invitation.usedCount) {
      return next(new AppError('邀请码使用次数已达上限', 400));
    }
    allowedSpaces = invitation.allowedSpaces as unknown as string[];
    role = invitation.type === 'member' ? 'member' : 'guest';
    invitation.usedCount += 1;
    if (invitation.usedCount >= invitation.maxUses) {
      invitation.status = 'accepted';
    }
    await invitation.save();
  }

  const user = await User.create({
    email,
    password,
    displayName,
    avatar: avatar || '',
    role,
    allowedSpaces,
  });

  const token = generateToken(user._id);
  await ActivityLogger.log({
    userId: user._id as any,
    type: 'login',
    entityType: 'user',
    entityId: user._id as any,
    description: `${user.displayName} 注册并登录`,
    ipAddress: req.ip,
  });

  sendSuccess(
    res,
    { user: filterUserResponse(user) },
    201,
    { token }
  );
});

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError('请提供邮箱和密码', 400));
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('邮箱或密码错误', 401));
  }

  if (user.status === 'banned') {
    return next(new AppError('账号已被封禁', 403));
  }

  user.onlineStatus = 'online';
  user.lastActiveAt = new Date();
  await user.save({ validateBeforeSave: false });

  const token = generateToken(user._id);

  await ActivityLogger.log({
    userId: user._id as any,
    type: 'login',
    entityType: 'user',
    entityId: user._id as any,
    description: `${user.displayName} 登录`,
    ipAddress: req.ip,
  });

  sendSuccess(
    res,
    { user: filterUserResponse(user) },
    200,
    { token }
  );
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  if (req.user) {
    await User.findByIdAndUpdate(
      req.user._id,
      {
        onlineStatus: 'offline',
        currentSpaceId: undefined,
        currentRoomId: undefined,
        currentSeatId: undefined,
        lastActiveAt: new Date(),
      }
    );

    await ActivityLogger.log({
      userId: req.user._id as any,
      type: 'logout',
      entityType: 'user',
      entityId: req.user._id as any,
      description: `${req.user.displayName} 登出`,
      ipAddress: req.ip,
    });
  }

  sendSuccess(res, null as any, 200);
  res.end();
});

export const getCurrentUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('请先登录', 401));
  }
  const user = await User.findById(req.user._id);
  sendSuccess(res, { user: filterUserResponse(user as IUser) });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('请先登录', 401));
  }

  const allowedUpdates = ['displayName', 'avatar'];
  const updateData: any = {};

  for (const field of allowedUpdates) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  const user = await User.findByIdAndUpdate(req.user._id, updateData, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  sendSuccess(res, { user: filterUserResponse(user) });
});

export const initAdminUser = async (): Promise<void> => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      await User.create({
        email: config.adminEmail,
        password: config.adminPassword,
        displayName: '系统管理员',
        role: 'admin',
      });
      console.log('👤 默认管理员已创建');
    }
  } catch (error) {
    console.error('初始化管理员失败:', error);
  }
};
