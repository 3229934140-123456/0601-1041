# 元宇宙虚拟共创办公室后端服务 (Metaverse Office Backend)

基于 Node.js + TypeScript + Express + MongoDB + Socket.IO 构建的元宇宙虚拟办公室协作平台后端服务，为虚拟共创办公提供完整的空间管理和协作能力。

## ✨ 核心功能模块 (8类接口)

### 1. 🏢 空间创建 (Space Management)
- 创建楼层、房间、区域三级空间结构
- 空间树状层级查询
- 空间进入/离开管理
- 空间权限控制（公开/私有）

### 2. 🪑 座位管理 (Seat Management)
- 创建/编辑/删除工位
- 固定工位分配（支持为用户分配专属座位）
- 工位占用/释放（热座模式）
- 工位状态查询（空闲/占用/预留/维护）
- 我的座位查询

### 3. 😊 形象状态 (User Presence)
- 在线/离线/忙碌/离开 状态设置
- 空间内在线用户列表
- 房间成员查询
- 用户状态批量查询
- 用户心跳保活
- 踢出/封禁异常用户

### 4. 📋 白板同步 (Whiteboard Sync)
- 便利贴 (Sticky) 增删改
- 图形 (Shape) 绘制
- 文本、连线、图片元素
- 实时多人协作（Socket.IO）
- 白板锁定/解锁
- 元素批量操作

### 5. 🎙️ 语音房间 (Voice Rooms)
- 临时讨论圈创建
- 永久会议室支持
- 成员加入/离开管理
- 静音/闭麦/发言状态
- WebRTC 信令交换
- 访问码私有房间
- 成员移除

### 6. 👥 访客邀请 (Invitations)
- 生成访客/成员邀请码
- 邀请码有效期设置
- 可进入空间区域限制
- 邀请验证与接受
- 邀请撤销与删除
- 受邀历史查询

### 7. 📝 会议记录 (Meetings)
- 会议创建/排期
- 会议时间线（加入/离开/笔记/投票/议题/待办）
- 共享文件索引管理
- 参会人员状态管理
- 到会提醒发送
- 会议开始/结束控制
- 待办事项管理
- 会议协作摘要自动生成

### 8. 🔐 权限控制 (Permissions)
- 空间访问权限设置（公开/角色/白名单）
- 用户空间访问权限授予/撤销
- 用户角色管理 (admin/moderator/member/guest)
- 权限访问检查
- 空间热度统计热力图
- 仪表盘数据统计
- 活动日志查询
- 历史活动回溯
- 协作摘要生成

## 🏗️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 16 | 运行环境 |
| TypeScript | ^5.4 | 类型安全 |
| Express | ^4.19 | Web 框架 |
| Mongoose | ^8.4 | MongoDB ODM |
| Socket.IO | ^4.7 | 实时通信 |
| JSON Web Token | ^9.0 | 身份认证 |
| Zod | ^3.23 | 数据校验 |
| Bcryptjs | ^2.4 | 密码加密 |

## 🚀 快速开始

### 1. 环境准备

确保你的系统已安装：
- **Node.js** >= 16
- **MongoDB** >= 6.0 或 MongoDB Atlas 账号

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# 服务端口
PORT=8080
NODE_ENV=development

# MongoDB 连接串
MONGODB_URI=mongodb://localhost:27017/metaverse-office

# JWT 密钥（生产环境务必修改）
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=7d

# CORS 允许来源
CORS_ORIGIN=http://localhost:3000

# 默认管理员
ADMIN_EMAIL=admin@metaverse.com
ADMIN_PASSWORD=admin123456
```

### 4. 启动 MongoDB

如果使用本地 MongoDB，确保服务已启动：

```bash
# Windows (如果已安装为服务)
net start MongoDB

# 或使用 Docker
docker run -d -p 27017:27017 --name metaverse-mongo mongo:6
```

### 5. 启动开发服务器

```bash
npm run dev
```

### 6. 生产构建与启动

```bash
npm run build
npm start
```

## 📡 API 接口总览

### 基础路由

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | ❌ |
| GET | `/api` | API 信息 | ❌ |

### 🔐 认证模块 `/api/auth`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/register` | 注册新用户 | ❌ |
| POST | `/login` | 登录获取 Token | ❌ |
| POST | `/logout` | 登出 | ✅ 所有用户 |
| GET | `/me` | 获取当前用户信息 | ✅ 所有用户 |
| PATCH | `/me` | 更新个人资料 | ✅ 所有用户 |

### 🏢 空间模块 `/api/spaces`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/tree` | 获取完整空间树 | ✅ 所有用户 |
| GET | `/` | 查询空间列表 | ✅ 所有用户 |
| GET | `/:id` | 获取空间详情 | ✅ 所有用户 |
| POST | `/` | 创建空间（楼层/房间/区域） | 🔑 Admin/Moderator |
| PATCH | `/:id` | 更新空间信息 | 🔑 Admin/Moderator |
| DELETE | `/:id` | 删除空间 | 🔑 Admin |
| POST | `/enter` | 进入空间 | ✅ 所有用户 |
| POST | `/leave` | 离开空间 | ✅ 所有用户 |

### 🪑 座位模块 `/api/seats`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/my` | 获取我的座位 | ✅ 所有用户 |
| GET | `/` | 查询座位列表 | ✅ 所有用户 |
| GET | `/:id` | 获取座位详情 | ✅ 所有用户 |
| POST | `/` | 创建座位 | 🔑 Admin/Moderator |
| PATCH | `/:id` | 更新座位信息 | 🔑 Admin/Moderator |
| DELETE | `/:id` | 删除座位 | 🔑 Admin |
| POST | `/assign` | 分配固定工位 | 🔑 Admin/Moderator |
| POST | `/:id/unassign` | 取消工位分配 | 🔑 Admin/Moderator |
| POST | `/occupy` | 占用座位（就坐） | ✅ 所有用户 |
| POST | `/release` | 释放座位（离开） | ✅ 所有用户 |

### 😊 状态模块 `/api/presence`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/online` | 获取在线用户列表 | ✅ 所有用户 |
| GET | `/users` | 获取所有用户（分页） | ✅ 所有用户 |
| GET | `/room/:roomId` | 获取房间内成员 | ✅ 所有用户 |
| GET | `/user/:userId` | 获取用户状态 | ✅ 所有用户 |
| POST | `/batch` | 批量查询用户状态 | ✅ 所有用户 |
| POST | `/status` | 更新自己的状态 | ✅ 所有用户 |
| POST | `/heartbeat` | 心跳保活 | ✅ 所有用户 |
| POST | `/kick` | 踢出用户 | 🔑 Admin/Moderator |
| POST | `/ban` | 封禁用户 | 🔑 Admin |

### 📋 白板模块 `/api/whiteboards`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/room/:roomId` | 获取房间白板（不存在则创建） | ✅ 所有用户 |
| POST | `/` | 创建白板 | ✅ 所有用户 |
| PATCH | `/:id` | 更新白板设置 | ✅ 所有用户 |
| POST | `/:id/clear` | 清空白板 | 🔑 Admin/Moderator |
| POST | `/:whiteboardId/elements` | 添加元素（便利贴/图形等） | ✅ 所有用户 |
| PATCH | `/:whiteboardId/elements/:elementId` | 更新元素 | ✅ 所有用户 |
| DELETE | `/:whiteboardId/elements/:elementId` | 删除元素 | ✅ 所有用户 |
| POST | `/:whiteboardId/elements/batch` | 批量更新元素 | ✅ 所有用户 |
| POST | `/:whiteboardId/lock` | 锁定/解锁白板 | ✅ 所有用户 |

### 🎙️ 语音房间 `/api/voice-rooms`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/` | 获取语音房间列表 | ✅ 所有用户 |
| GET | `/:id` | 获取语音房间详情 | ✅ 所有用户 |
| POST | `/` | 创建语音房间（讨论圈） | ✅ 所有用户 |
| POST | `/join` | 加入语音房间 | ✅ 所有用户 |
| POST | `/leave` | 离开语音房间 | ✅ 所有用户 |
| POST | `/participant-state` | 更新自身状态（静音等） | ✅ 所有用户 |
| PATCH | `/:id` | 更新语音房间 | ✅ 创建者/Admin |
| POST | `/:id/end` | 结束语音房间 | ✅ 创建者/Admin |
| POST | `/remove-participant` | 移除房间成员 | 🔑 Admin/Moderator |

### 👥 访客邀请 `/api/invitations`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/code/:code` | 查询邀请码信息 | ❌ |
| POST | `/accept` | 接受邀请（注册/登录后） | ⚠️ 可选 |
| GET | `/mine` | 我收到的邀请 | ✅ 所有用户 |
| GET | `/` | 我发出的邀请列表 | ✅ 所有用户 |
| POST | `/` | 创建邀请（生成邀请码） | ✅ 所有用户 |
| POST | `/:id/revoke` | 撤销邀请 | ✅ 创建者/Admin |
| DELETE | `/:id` | 删除邀请 | 🔑 Admin |

### 📝 会议记录 `/api/meetings`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/` | 获取会议列表 | ✅ 所有用户 |
| GET | `/:id` | 获取会议详情 | ✅ 所有用户 |
| POST | `/` | 创建会议 | ✅ 所有用户 |
| PATCH | `/:id` | 更新会议 | ✅ 组织者/Admin |
| DELETE | `/:id` | 取消会议 | ✅ 组织者/Admin |
| POST | `/:id/start` | 开始会议 | ✅ 组织者/Admin |
| POST | `/:id/end` | 结束会议 | ✅ 组织者/Admin |
| POST | `/:id/summary` | 生成会议摘要 | ✅ 所有用户 |
| POST | `/join` | 加入会议 | ✅ 所有用户 |
| POST | `/leave` | 离开会议 | ✅ 所有用户 |
| POST | `/attendee-status` | 更新参会状态 | ✅ 所有用户 |
| POST | `/attendees` | 添加参会人员 | ✅ 所有用户 |
| POST | `/reminder` | 发送到会提醒 | ✅ 所有用户 |
| POST | `/timeline` | 添加时间线事件 | ✅ 所有用户 |
| POST | `/files` | 上传共享文件索引 | ✅ 所有用户 |
| POST | `/action-items` | 新增待办事项 | ✅ 所有用户 |
| PATCH | `/action-items` | 更新待办事项 | ✅ 所有用户 |

### 🔐 权限控制 `/api/permissions`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/space-access` | 检查空间访问权限 | ✅ 所有用户 |
| GET | `/user/:userId` | 获取用户权限信息 | ✅ 所有用户 |
| POST | `/spaces` | 设置空间权限 | 🔑 Admin/Moderator |
| POST | `/user-spaces/grant` | 授予用户空间权限 | 🔑 Admin/Moderator |
| POST | `/user-spaces/revoke` | 撤销用户空间权限 | 🔑 Admin/Moderator |
| POST | `/user-role` | 修改用户角色 | 🔑 Admin/Moderator |

### 📊 分析统计 `/api/analytics`

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/activity-types` | 获取活动类型枚举 | ✅ 所有用户 |
| GET | `/logs` | 查询活动日志 | ✅ 所有用户 |
| GET | `/user/:userId/history` | 用户活动历史 | ✅ 所有用户 |
| GET | `/heatmap` | 空间热度热力图 | ✅ 所有用户 |
| GET | `/dashboard` | 仪表盘统计数据 | ✅ 所有用户 |
| POST | `/collaboration-summary` | 生成协作摘要 | 🔑 Admin/Moderator |

## 🔌 Socket.IO 实时事件

### 连接认证
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8080', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});
```

### 用户状态
| 事件 | 方向 | 描述 |
|------|------|------|
| `user:online` | Server → All | 用户上线通知 |
| `user:offline` | Server → All | 用户下线通知 |
| `user:status-changed` | Server → All | 用户状态变更 |
| `user:update-status` | Client → Server | 更新自身状态 |
| `force-disconnect` | Server → Client | 强制断开 |

### 空间/房间
| 事件 | 方向 | 描述 |
|------|------|------|
| `space:enter` | Client → Server | 进入空间 |
| `space:leave` | Client → Server | 离开空间 |
| `room:user-joined` | Server → Room | 房间内用户加入通知 |
| `room:user-left` | Server → Room | 房间内用户离开通知 |

### 座位
| 事件 | 方向 | 描述 |
|------|------|------|
| `seat:occupy` | Client → Server | 占用座位 |
| `seat:release` | Client → Server | 释放座位 |
| `seat:occupied` | Server → Room | 座位被占用通知 |
| `seat:released` | Server → Room | 座位被释放通知 |

### 白板
| 事件 | 方向 | 描述 |
|------|------|------|
| `whiteboard:update` | Client → Server | 白板更新（广播到房间） |
| `whiteboard:updated` | Server → Room | 白板变更通知 |

### 语音房间
| 事件 | 方向 | 描述 |
|------|------|------|
| `voice:join` | Client → Server | 加入语音房间 |
| `voice:leave` | Client → Server | 离开语音房间 |
| `voice:user-joined` | Server → VoiceRoom | 语音成员加入 |
| `voice:user-left` | Server → VoiceRoom | 语音成员离开 |
| `voice:signal` | Client → Server | WebRTC 信令转发 |
| `voice:signaling` | Server → Target | WebRTC 信令接收 |

### 管理
| 事件 | 方向 | 描述 |
|------|------|------|
| `kick:user` | Client → Server | 踢出用户 |
| `kick-notification` | Server → Target | 被踢出通知 |

## 🗄️ 数据模型概览

```
User          用户（含角色、状态、当前位置）
├─ Space      空间（楼层/房间/区域 三级嵌套）
│  └─ Seat    座位（房间内，支持分配与占用）
│  └─ Whiteboard 白板（房间 1:1，元素数组存储）
│  └─ Meeting    会议（房间内，含时间线/文件/待办）
│  └─ VoiceRoom  语音房间（临时/永久，成员管理）
├─ Invitation   邀请码（含允许进入的空间列表）
├─ Permission   权限记录（用户-空间授权）
└─ ActivityLog  活动日志（全局审计）
```

## 📁 项目目录结构

```
metaverse-office-backend/
├── src/
│   ├── config/              # 配置模块
│   │   ├── index.ts         # 环境变量配置
│   │   └── database.ts      # 数据库连接
│   ├── controllers/         # 控制器 (业务逻辑)
│   │   ├── authController.ts
│   │   ├── spaceController.ts
│   │   ├── seatController.ts
│   │   ├── presenceController.ts
│   │   ├── whiteboardController.ts
│   │   ├── voiceRoomController.ts
│   │   ├── invitationController.ts
│   │   ├── meetingController.ts
│   │   ├── permissionController.ts
│   │   └── analyticsController.ts
│   ├── middleware/          # Express 中间件
│   │   ├── auth.ts          # JWT 认证中间件
│   │   └── errorHandler.ts  # 全局错误处理
│   ├── models/              # Mongoose 数据模型
│   │   ├── User.ts
│   │   ├── Space.ts
│   │   ├── Seat.ts
│   │   ├── Whiteboard.ts
│   │   ├── VoiceRoom.ts
│   │   ├── Invitation.ts
│   │   ├── Meeting.ts
│   │   └── ActivityLog.ts
│   ├── routes/              # 路由定义
│   │   ├── authRoutes.ts
│   │   ├── spaceRoutes.ts
│   │   ├── seatRoutes.ts
│   │   ├── presenceRoutes.ts
│   │   ├── whiteboardRoutes.ts
│   │   ├── voiceRoomRoutes.ts
│   │   ├── invitationRoutes.ts
│   │   ├── meetingRoutes.ts
│   │   ├── permissionRoutes.ts
│   │   └── analyticsRoutes.ts
│   ├── services/            # 业务服务
│   │   └── ActivityLogger.ts # 活动日志服务
│   ├── socket/              # Socket.IO
│   │   └── index.ts         # 实时通信逻辑
│   ├── utils/               # 工具函数
│   │   ├── AppError.ts      # 自定义错误类
│   │   └── response.ts      # 响应格式化
│   ├── app.ts               # Express App 配置
│   └── server.ts            # 服务启动入口
├── .env.example             # 环境变量示例
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔑 默认角色说明

| 角色 | 权限范围 |
|------|----------|
| `admin` | 管理员 - 系统所有操作权限 |
| `moderator` | 协调员 - 空间/座位管理、用户踢出、邀请等 |
| `member` | 正式成员 - 正常协作、创建会议、邀请访客等 |
| `guest` | 访客 - 受限访问，仅能进入被邀请的空间 |

## ⚡ 快速测试流程

1. **启动服务**后，使用默认管理员登录：
   ```
   POST /api/auth/login
   { email: "admin@metaverse.com", password: "admin123456" }
   ```

2. **创建空间结构**：
   - 创建 1 楼 (floor)
   - 创建 办公房间A (room, parentId = 1楼ID)
   - 创建 会议房间B (room, parentId = 1楼ID)

3. **添加座位**：在 办公房间A 内创建若干工位

4. **创建普通用户**：调用 `/register` 创建成员用户

5. **分配工位**：用管理员账号为成员分配固定工位

6. **测试实时协作**：两个浏览器窗口，分别登录不同用户，进入同一房间
   - 观察在线用户列表实时更新
   - 操作白板元素同步查看

7. **创建会议**：安排一场会议并添加时间线、文件、待办

## 🛡️ 生产环境注意事项

1. **JWT 密钥**：务必修改 `JWT_SECRET` 为强随机字符串
2. **HTTPS**：生产环境启用 HTTPS
3. **CORS**：限制 `CORS_ORIGIN` 为你的前端域名
4. **MongoDB 认证**：启用 MongoDB 用户名密码认证
5. **速率限制**：建议在反向代理层添加 API 速率限制
6. **日志**：接入 ELK / Loki 等日志收集系统
7. **监控**：添加 Prometheus / Grafana 监控告警

## 📝 License

MIT License
