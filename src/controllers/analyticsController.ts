import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ActivityLog, { ActivityType, EntityType } from '../models/ActivityLog';
import Space from '../models/Space';
import User from '../models/User';
import Seat from '../models/Seat';
import Meeting from '../models/Meeting';
import Whiteboard from '../models/Whiteboard';
import VoiceRoom from '../models/VoiceRoom';
import AppError from '../utils/AppError';
import { sendSuccess } from '../utils/response';

export const getActivityLogs = asyncHandler(async (req: Request, res: Response) => {
  const {
    userId,
    type,
    entityType,
    roomId,
    spaceId,
    from,
    to,
    search,
    page = 1,
    limit = 100,
  } = req.query;

  const query: any = {};

  if (req.user!.role === 'member') {
    query.$or = [
      { userId: req.user!._id },
      { roomId: { $in: req.user!.currentRoomId ? [req.user!.currentRoomId] : [] } },
    ];
  } else if (userId) {
    query.userId = new mongoose.Types.ObjectId(userId as string);
  }

  if (type) query.type = type;
  if (entityType) query.entityType = entityType;
  if (roomId) query.roomId = new mongoose.Types.ObjectId(roomId as string);
  if (spaceId) query.spaceId = new mongoose.Types.ObjectId(spaceId as string);
  if (from || to) {
    query.timestamp = {};
    if (from) query.timestamp.$gte = new Date(from as string);
    if (to) query.timestamp.$lte = new Date(to as string);
  }
  if (search) {
    query.description = { $regex: search as string, $options: 'i' };
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const total = await ActivityLog.countDocuments(query);

  const logs = await ActivityLog.find(query)
    .populate('userId', 'displayName avatar email')
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(parseInt(limit as string));

  sendSuccess(
    res,
    { logs },
    200,
    {
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string)),
    }
  );
});

export const getUserActivityHistory = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;
  const {
    from,
    to,
    type,
    page = 1,
    limit = 100,
  } = req.query;

  if (req.user!.role === 'member' && req.user!._id.toString() !== userId) {
    return next(new AppError('您只能查看自己的活动历史', 403));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('用户不存在', 404));
  }

  const query: any = { userId: new mongoose.Types.ObjectId(userId) };
  if (type) query.type = type;
  if (from || to) {
    query.timestamp = {};
    if (from) query.timestamp.$gte = new Date(from as string);
    if (to) query.timestamp.$lte = new Date(to as string);
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const total = await ActivityLog.countDocuments(query);

  const logs = await ActivityLog.find(query)
    .populate('userId', 'displayName avatar')
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(parseInt(limit as string));

  const typeStats = await ActivityLog.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), ...(query.timestamp ? { timestamp: query.timestamp } : {}) } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  sendSuccess(
    res,
    {
      user: { _id: user._id, displayName: user.displayName, email: user.email },
      logs,
      typeStats,
    },
    200,
    {
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string)),
    }
  );
});

export const getSpaceHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const { from, to, spaceId } = req.query;

  const timeMatch: any = {};
  if (from) timeMatch.$gte = new Date(from as string);
  if (to) timeMatch.$lte = new Date(to as string);
  const timestampFilter = Object.keys(timeMatch).length > 0 ? { timestamp: timeMatch } : {};

  const spaceMatch = spaceId
    ? { $or: [{ spaceId: new mongoose.Types.ObjectId(spaceId as string) }, { roomId: new mongoose.Types.ObjectId(spaceId as string) }] }
    : {};

  const roomActivity = await ActivityLog.aggregate([
    {
      $match: {
        type: { $in: ['space_enter', 'seat_occupy', 'meeting_start', 'voice_join'] as ActivityType[] },
        ...timestampFilter,
        ...spaceMatch,
      },
    },
    {
      $group: {
        _id: {
          roomId: '$roomId',
          hour: { $hour: '$timestamp' },
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const roomStats = new Map<string, { total: number; peakHour?: number; hourly: Record<number, number> }>();

  for (const item of roomActivity) {
    const roomId = item._id.roomId?.toString();
    if (!roomId) continue;
    if (!roomStats.has(roomId)) {
      roomStats.set(roomId, { total: 0, hourly: {} });
    }
    const stats = roomStats.get(roomId)!;
    stats.total += item.count;
    stats.hourly[item._id.hour] = (stats.hourly[item._id.hour] || 0) + item.count;
  }

  for (const [, stats] of roomStats) {
    let peakHour = 0;
    let maxCount = 0;
    for (const [hour, count] of Object.entries(stats.hourly)) {
      if (count > maxCount) {
        maxCount = count;
        peakHour = parseInt(hour);
      }
    }
    stats.peakHour = peakHour;
  }

  const roomIds = Array.from(roomStats.keys()).map((id) => new mongoose.Types.ObjectId(id));
  const rooms = await Space.find({ _id: { $in: roomIds } }).select('name type level parentId');
  const roomMap = new Map(rooms.map((r) => [r._id.toString(), r]));

  const heatmapData = Array.from(roomStats.entries()).map(([roomId, stats]) => ({
    roomId,
    room: roomMap.get(roomId),
    totalVisits: stats.total,
    peakHour: stats.peakHour,
    hourlyDistribution: stats.hourly,
    heatLevel: stats.total > 100 ? 'hot' : stats.total > 30 ? 'warm' : stats.total > 10 ? 'moderate' : 'cool',
  })).sort((a, b) => b.totalVisits - a.totalVisits);

  sendSuccess(res, { heatmapData });
});

export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query;

  const timeMatch: any = {};
  if (from) timeMatch.$gte = new Date(from as string);
  if (to) timeMatch.$lte = new Date(to as string);
  const timestampFilter = Object.keys(timeMatch).length > 0 ? { timestamp: timeMatch } : {};

  const [
    totalUsers,
    activeUsers,
    totalSpaces,
    totalSeats,
    occupiedSeats,
    activeMeetings,
    activeVoiceRooms,
    totalMeetings,
    loginStats,
    spaceVisitStats,
    topActiveUsers,
  ] = await Promise.all([
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ onlineStatus: { $ne: 'offline' } }),
    Space.countDocuments({ isActive: true }),
    Seat.countDocuments({ isActive: true }),
    Seat.countDocuments({ status: 'occupied' }),
    Meeting.countDocuments({ status: 'in_progress' }),
    VoiceRoom.countDocuments({ status: 'active' }),
    Meeting.countDocuments(),
    ActivityLog.aggregate([
      { $match: { type: 'login' as ActivityType, ...timestampFilter } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 30 },
    ]),
    ActivityLog.aggregate([
      { $match: { type: 'space_enter' as ActivityType, ...timestampFilter } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 30 },
    ]),
    ActivityLog.aggregate([
      { $match: { ...timestampFilter } },
      {
        $group: {
          _id: '$userId',
          activityCount: { $sum: 1 },
          lastActive: { $max: '$timestamp' },
        },
      },
      { $sort: { activityCount: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const populatedTopUsers = await User.populate(
    topActiveUsers.map((u) => ({ ...u, _userDoc: u._id })),
    { path: '_userDoc', select: 'displayName avatar email' }
  );

  const topUsers = topActiveUsers.map((u, i) => ({
    userId: u._id,
    activityCount: u.activityCount,
    lastActive: u.lastActive,
    user: (populatedTopUsers[i] as any)._userDoc,
  }));

  sendSuccess(res, {
    overview: {
      totalUsers,
      activeUsers,
      totalSpaces,
      totalSeats,
      occupiedSeats,
      seatUtilization: totalSeats > 0 ? Math.round((occupiedSeats / totalSeats) * 100) : 0,
      activeMeetings,
      activeVoiceRooms,
      totalMeetings,
    },
    loginStats,
    spaceVisitStats,
    topActiveUsers: topUsers,
  });
});

export const generateCollaborationSummary = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { userId, roomId, from, to } = req.body;

  if (!from || !to) {
    return next(new AppError('请提供时间范围', 400));
  }

  const startDate = new Date(from as string);
  const endDate = new Date(to as string);

  const query: any = {
    timestamp: { $gte: startDate, $lte: endDate },
  };

  if (userId) {
    const user = await User.findById(userId);
    if (!user) return next(new AppError('用户不存在', 404));
    query.userId = new mongoose.Types.ObjectId(userId);
  }

  if (roomId) {
    const space = await Space.findById(roomId);
    if (!space) return next(new AppError('空间不存在', 404));
    query.$or = [{ roomId: new mongoose.Types.ObjectId(roomId) }, { spaceId: new mongoose.Types.ObjectId(roomId) }];
  }

  const [
    logs,
    userActivities,
    roomActivities,
    typeDistribution,
    meetings,
  ] = await Promise.all([
    ActivityLog.find(query)
      .populate('userId', 'displayName avatar')
      .sort({ timestamp: 1 }),
    ActivityLog.aggregate([
      { $match: query },
      { $group: { _id: '$userId', count: { $sum: 1 }, types: { $addToSet: '$type' } } },
      { $sort: { count: -1 } },
    ]),
    ActivityLog.aggregate([
      { $match: { ...query, roomId: { $exists: true } } },
      { $group: { _id: '$roomId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    ActivityLog.aggregate([
      { $match: query },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Meeting.find({
      $or: [
        { scheduledStart: { $gte: startDate, $lte: endDate } },
        { scheduledEnd: { $gte: startDate, $lte: endDate } },
        { actualStart: { $gte: startDate, $lte: endDate } },
      ],
    })
      .populate('organizerId', 'displayName avatar')
      .populate('roomId', 'name')
      .sort({ scheduledStart: 1 }),
  ]);

  const userIds = userActivities.map((u) => u._id);
  const users = await User.find({ _id: { $in: userIds } }).select('displayName avatar email');
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const roomIds = roomActivities.map((r) => r._id);
  const rooms = await Space.find({ _id: { $in: roomIds } }).select('name type');
  const roomMap = new Map(rooms.map((r) => [r._id.toString(), r]));

  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const totalActivities = logs.length;
  const uniqueUsers = userActivities.length;
  const avgDaily = days > 0 ? Math.round(totalActivities / days) : 0;

  const topContributors = userActivities.slice(0, 10).map((ua) => ({
    user: userMap.get(ua._id.toString()),
    activityCount: ua.count,
    activityTypes: ua.types,
    contributionScore: Math.round((ua.count / Math.max(totalActivities, 1)) * 100),
  }));

  const hotRooms = roomActivities.slice(0, 10).map((ra) => ({
    room: roomMap.get(ra._id.toString()),
    activityCount: ra.count,
    popularityScore: Math.round((ra.count / Math.max(roomActivities[0]?.count || 1, 1)) * 100),
  }));

  const summary = [
    `【协作周期】${startDate.toLocaleDateString()} ~ ${endDate.toLocaleDateString()} (共 ${days} 天)`,
    `【总体活跃】总活动 ${totalActivities} 次，日均 ${avgDaily} 次`,
    `【参与人员】${uniqueUsers} 位用户参与协作`,
    uniqueUsers > 0 ? `【核心贡献者】${topContributors.slice(0, 3).map((t) => (t.user as any)?.displayName || '未知').filter(Boolean).join('、')}` : '',
    `【活动类型分布】${typeDistribution.slice(0, 5).map((t) => `${t._id}:${t.count}`).join('、')}`,
    meetings.length > 0 ? `【会议情况】共 ${meetings.length} 场会议，其中已结束 ${meetings.filter((m) => m.status === 'ended').length} 场` : '',
    hotRooms.length > 0 ? `【热门区域】${hotRooms.slice(0, 3).map((h) => (h.room as any)?.name || '未知').filter(Boolean).join('、')}` : '',
  ].filter(Boolean).join('\n');

  sendSuccess(res, {
    summary,
    period: { from: startDate, to: endDate, days },
    stats: {
      totalActivities,
      uniqueUsers,
      avgDailyActivities: avgDaily,
      typeDistribution,
    },
    topContributors,
    hotRooms,
    meetings,
    logs: logs.slice(0, 200),
  });
});

export const getActivityTypes = asyncHandler(async (_req: Request, res: Response) => {
  const activityTypes: ActivityType[] = [
    'login', 'logout', 'disconnect', 'space_enter', 'space_leave',
    'seat_occupy', 'seat_release', 'seat_assign', 'seat_unassign',
    'whiteboard_create', 'whiteboard_update', 'whiteboard_delete',
    'voice_join', 'voice_leave',
    'meeting_create', 'meeting_start', 'meeting_end', 'meeting_join', 'meeting_leave',
    'file_upload', 'invitation_create', 'invitation_accept',
    'permission_grant', 'permission_revoke', 'user_kick', 'user_ban', 'custom',
  ];

  const entityTypes: EntityType[] = [
    'user', 'space', 'seat', 'whiteboard', 'voice_room', 'meeting', 'file', 'invitation', 'permission',
  ];

  sendSuccess(res, { activityTypes, entityTypes });
});
