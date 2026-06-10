import http from 'http';
import createApp from './app';
import { config } from './config';
import { connectDatabase } from './config/database';
import { initializeSocket } from './socket';
import { initAdminUser } from './controllers/authController';

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();
    await initAdminUser();

    const app = createApp();
    const server = http.createServer(app);

    const io = initializeSocket(server);
    console.log('🔌 Socket.IO 实时通信已初始化');

    server.listen(config.port, () => {
      console.log('');
      console.log('🚀 ========================================== 🚀');
      console.log('  元宇宙虚拟共创办公室后端服务启动成功!');
      console.log('🚀 ========================================== 🚀');
      console.log(`  📡 服务器端口:  ${config.port}`);
      console.log(`  🌍 环境:         ${config.nodeEnv}`);
      console.log(`  🔗 API地址:      http://localhost:${config.port}/api`);
      console.log(`  💚 健康检查:     http://localhost:${config.port}/api/health`);
      console.log(`  🔌 Socket.IO:    http://localhost:${config.port}`);
      console.log('');
      console.log(`  👤 默认管理员邮箱: ${config.adminEmail}`);
      console.log(`  🔑 默认管理员密码: ${config.adminPassword}`);
      console.log('');
    });

    process.on('unhandledRejection', (err: Error) => {
      console.error(`❌ 未处理的 Promise 拒绝: ${err.message}`);
      console.error(err.stack);
    });

    process.on('SIGTERM', () => {
      console.log('👋 收到 SIGTERM 信号，正在优雅关闭...');
      server.close(() => {
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('👋 收到 SIGINT 信号，正在优雅关闭...');
      server.close(() => {
        process.exit(0);
      });
    });
  } catch (error) {
    console.error(`❌ 服务器启动失败: ${(error as Error).message}`);
    console.error((error as Error).stack);
    process.exit(1);
  }
};

startServer();
