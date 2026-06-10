import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import { AuthJwtPayload } from '../middleware/auth';
import User, { IUser } from '../models/User';
import ActivityLogger from '../services/ActivityLogger';

export interface ISocketUser extends Socket {
  user?: IUser;
  currentRoomId?: string;
  currentSpaceId?: string;
}

export interface OnlineUser {
  userId: string;
  socketId: string;
  displayName: string;
  avatar?: string;
  status: 'online' | 'busy' | 'away';
  currentRoomId?: string;
  currentSeatId?: string;
}

export const onlineUsers = new Map<string, OnlineUser>();

export const initializeSocket = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      credentials: true,
    },
  });

  io.use(async (socket: ISocketUser, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      if (!token) {
        return next(new Error('未授权的连接'));
      }

      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const decoded = jwt.verify(cleanToken, config.jwtSecret) as AuthJwtPayload;
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return next(new Error('用户不存在'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('认证失败'));
    }
  });

  io.on('connection', (socket: ISocketUser) => {
    if (!socket.user) return;
    console.log(`🔌 用户连接: ${socket.user.displayName} (${socket.id})`);

    const existingUser = onlineUsers.get(socket.user._id.toString());
    if (existingUser) {
      io.to(existingUser.socketId).emit('force-disconnect', { reason: '账号在其他设备登录' });
    }

    const onlineUser: OnlineUser = {
      userId: socket.user._id.toString(),
      socketId: socket.id,
      displayName: socket.user.displayName,
      avatar: socket.user.avatar,
      status: 'online',
    };
    onlineUsers.set(socket.user._id.toString(), onlineUser);
    io.emit('user:online', onlineUser);

    socket.on('user:update-status', ({ status }) => {
      const user = onlineUsers.get(socket.user!._id.toString());
      if (user) {
        user.status = status;
        io.emit('user:status-changed', {
          userId: user.userId,
          status,
        });
      }
    });

    socket.on('space:enter', ({ spaceId, roomId }) => {
      socket.currentSpaceId = spaceId;
      socket.currentRoomId = roomId;
      const user = onlineUsers.get(socket.user!._id.toString());
      if (user) {
        user.currentRoomId = roomId;
      }
      if (roomId) {
        socket.join(`room:${roomId}`);
        io.to(`room:${roomId}`).emit('room:user-joined', {
          userId: socket.user!._id,
          displayName: socket.user!.displayName,
        });
      }
    });

    socket.on('space:leave', ({ spaceId, roomId }) => {
      const user = onlineUsers.get(socket.user!._id.toString());
      if (user) {
        user.currentRoomId = undefined;
      }
      if (roomId) {
        socket.leave(`room:${roomId}`);
        io.to(`room:${roomId}`).emit('room:user-left', {
          userId: socket.user!._id,
          displayName: socket.user!.displayName,
        });
      }
    });

    socket.on('seat:occupy', ({ seatId }) => {
      const user = onlineUsers.get(socket.user!._id.toString());
      if (user) {
        user.currentSeatId = seatId;
      }
      if (socket.currentRoomId) {
        io.to(`room:${socket.currentRoomId}`).emit('seat:occupied', {
          userId: socket.user!._id,
          seatId,
        });
      }
    });

    socket.on('seat:release', ({ seatId }) => {
      const user = onlineUsers.get(socket.user!._id.toString());
      if (user) {
        user.currentSeatId = undefined;
      }
      if (socket.currentRoomId) {
        io.to(`room:${socket.currentRoomId}`).emit('seat:released', {
          userId: socket.user!._id,
          seatId,
        });
      }
    });

    socket.on('whiteboard:update', ({ roomId, data }) => {
      socket.to(`room:${roomId}`).emit('whiteboard:updated', {
        userId: socket.user!._id,
        data,
      });
    });

    socket.on('voice:join', ({ voiceRoomId }) => {
      socket.join(`voice:${voiceRoomId}`);
      socket.to(`voice:${voiceRoomId}`).emit('voice:user-joined', {
        userId: socket.user!._id,
        displayName: socket.user!.displayName,
        socketId: socket.id,
      });
    });

    socket.on('voice:leave', ({ voiceRoomId }) => {
      socket.leave(`voice:${voiceRoomId}`);
      socket.to(`voice:${voiceRoomId}`).emit('voice:user-left', {
        userId: socket.user!._id,
        socketId: socket.id,
      });
    });

    socket.on('voice:signal', ({ targetSocketId, signal }) => {
      io.to(targetSocketId).emit('voice:signaling', {
        fromSocketId: socket.id,
        signal,
      });
    });

    socket.on('kick:user', ({ targetUserId, reason }, callback) => {
      if (socket.user?.role !== 'admin' && socket.user?.role !== 'moderator') {
        if (callback) callback({ success: false, message: '无权限操作' });
        return;
      }
      const target = onlineUsers.get(targetUserId);
      if (target) {
        io.to(target.socketId).emit('kick-notification', { reason });
        io.to(target.socketId).disconnectSockets(true);
        if (callback) callback({ success: true });
      } else if (callback) {
        callback({ success: false, message: '用户不在线' });
      }
    });

    socket.on('disconnect', () => {
      if (!socket.user) return;
      console.log(`🔌 用户断开: ${socket.user.displayName}`);

      const userId = socket.user._id.toString();
      const user = onlineUsers.get(userId);
      if (user && user.socketId === socket.id) {
        onlineUsers.delete(userId);
        io.emit('user:offline', { userId });
      }

      if (socket.user) {
        ActivityLogger.log({
          userId: socket.user._id as any,
          type: 'disconnect',
          entityType: 'user',
          entityId: userId,
          description: `${socket.user.displayName} 断开连接`,
        }).catch(() => {});
      }
    });
  });

  return io;
};

export const getSocketIO = (() => {
  let ioInstance: Server | null = null;
  return (): Server | null => ioInstance;
})();

export const setSocketIO = (io: Server): void => {
  (getSocketIO as any).ioInstance = io;
  Object.defineProperty(getSocketIO, 'ioInstance', {
    value: io,
    writable: true,
  });
};
