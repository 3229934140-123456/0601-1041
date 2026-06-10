import { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError';

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  } else {
    let error = { ...err };
    error.message = err.message;

    if (err.name === 'CastError') {
      const message = `无效的资源ID: ${err.value}`;
      error = new AppError(message, 400);
    }

    if (err.code === 11000) {
      const message = `重复的字段值: ${Object.keys(err.keyValue || {}).join(', ')}`;
      error = new AppError(message, 400);
    }

    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors || {})
        .map((val: any) => val.message)
        .join(', ');
      error = new AppError(message, 400);
    }

    if (err.name === 'JsonWebTokenError') {
      error = new AppError('无效的Token，请重新登录', 401);
    }

    if (err.name === 'TokenExpiredError') {
      error = new AppError('Token已过期，请重新登录', 401);
    }

    res.status(error.statusCode).json({
      status: error.status,
      message: error.message || '服务器内部错误',
    });
  }
};

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new AppError(`未找到路由: ${req.originalUrl}`, 404));
};
