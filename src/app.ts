import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRoutes from './routes/authRoutes';
import spaceRoutes from './routes/spaceRoutes';
import seatRoutes from './routes/seatRoutes';
import presenceRoutes from './routes/presenceRoutes';
import whiteboardRoutes from './routes/whiteboardRoutes';
import voiceRoomRoutes from './routes/voiceRoomRoutes';
import invitationRoutes from './routes/invitationRoutes';
import meetingRoutes from './routes/meetingRoutes';
import permissionRoutes from './routes/permissionRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import analyticsFiltersRoutes from './routes/analyticsFiltersRoutes';
import notificationRoutes from './routes/notificationRoutes';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

const createApp = (): express.Application => {
  const app = express();

  app.use(cors({
    origin: config.corsOrigin,
    credentials: true,
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.set('trust proxy', true);

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'success',
      message: '元宇宙虚拟共创办公室后端服务运行正常',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  app.get('/api', (_req, res) => {
    res.status(200).json({
      name: 'Metaverse Office Backend',
      version: '1.0.0',
      description: '元宇宙虚拟共创办公室后端服务 API',
      endpoints: {
        auth: '/api/auth',
        spaces: '/api/spaces',
        seats: '/api/seats',
        presence: '/api/presence',
        whiteboard: '/api/whiteboards',
        voiceRooms: '/api/voice-rooms',
        invitations: '/api/invitations',
        meetings: '/api/meetings',
        permissions: '/api/permissions',
        analytics: '/api/analytics',
        'analytics-filters': '/api/analytics-filters',
        notifications: '/api/notifications',
      },
      websocket: 'Socket.IO 实时通信已启用',
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/spaces', spaceRoutes);
  app.use('/api/seats', seatRoutes);
  app.use('/api/presence', presenceRoutes);
  app.use('/api/whiteboards', whiteboardRoutes);
  app.use('/api/voice-rooms', voiceRoomRoutes);
  app.use('/api/invitations', invitationRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/permissions', permissionRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/analytics-filters', analyticsFiltersRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
