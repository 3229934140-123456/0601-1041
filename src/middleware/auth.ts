import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload, Secret } from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import { config } from '../config';
import AppError from '../utils/AppError';
import User, { IUser } from '../models/User';

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export interface AuthJwtPayload extends JwtPayload {
  id: string;
}

export const protect = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  let token: string | undefined;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(new AppError('未授权访问，请先登录', 401));
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthJwtPayload;
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return next(new AppError('该用户不存在', 401));
    }

    if (user.status === 'banned') {
      return next(new AppError('账号已被封禁', 403));
    }

    req.user = user;
    next();
  } catch (error) {
    return next(new AppError('Token无效或已过期', 401));
  }
});

export const restrictTo = (...roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('您没有权限执行此操作', 403));
    }
    next();
  };
};

export const generateToken = (id: mongoose.Types.ObjectId | string): string => {
  const stringId = typeof id === 'string' ? id : id.toString();
  return jwt.sign(
    { id: stringId },
    config.jwtSecret as string,
    { expiresIn: config.jwtExpiresIn as any }
  );
};
