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
  const { userId, roomId, spaceId, from, to, includeDetails = false } = req.body;

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

  if (roomId || spaceId) {
    const targetSpaceId = roomId || spaceId;
    const space = await Space.findById(targetSpaceId);
    if (!space) return next(new AppError('空间不存在', 404));

    const allRelatedSpaces = await Space.find({
      $or: [
        { _id: new mongoose.Types.ObjectId(targetSpaceId) },
        { spacePath: new mongoose.Types.ObjectId(targetSpaceId) },
        { parentId: new mongoose.Types.ObjectId(targetSpaceId) },
      ],
    }).select('_id');
    const spaceIds = allRelatedSpaces.map((s) => s._id);

    query.$or = [
      { spaceId: { $in: spaceIds } },
      { roomId: { $in: spaceIds } },
    ];
  }

  const [
    logs,
    userActivities,
    roomActivities,
    typeDistribution,
    meetings,
    whiteboardStats,
    voiceRoomStats,
    fileUploadStats,
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
    ActivityLog.aggregate([
      { $match: { ...query, entityType: 'whiteboard' } },
      {
        $group: {
          _id: '$entityId',
          activityCount: { $sum: 1 },
          updateCount: {
            $sum: { $cond: [{ $eq: ['$type', 'whiteboard_update'] }, 1, 0] },
          },
          lastActive: { $max: '$timestamp' },
          editors: { $addToSet: '$userId' },
        },
      },
      { $sort: { activityCount: -1 } },
      { $limit: 10 },
    ]),
    ActivityLog.aggregate([
      { $match: { ...query, entityType: 'voice_room' } },
      {
        $group: {
          _id: '$entityId',
          joinCount: {
            $sum: { $cond: [{ $eq: ['$type', 'voice_join'] }, 1, 0] },
          },
          participants: { $addToSet: '$userId' },
          lastActive: { $max: '$timestamp' },
        },
      },
      { $sort: { joinCount: -1 } },
      { $limit: 10 },
    ]),
    ActivityLog.aggregate([
      { $match: { ...query, type: 'file_upload' } },
      {
        $group: {
          _id: null,
          totalFiles: { $sum: 1 },
          uploaders: { $addToSet: '$userId' },
          lastUpload: { $max: '$timestamp' },
        },
      },
    ]),
  ]);

  const userIds = userActivities.map((u) => u._id);
  const users = await User.find({ _id: { $in: userIds } }).select('displayName avatar email role');
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const roomIds = roomActivities.map((r) => r._id);
  const rooms = await Space.find({ _id: { $in: roomIds } }).select('name type');
  const roomMap = new Map(rooms.map((r) => [r._id.toString(), r]));

  const wbIds = whiteboardStats.map((w) => w._id);
  const whiteboards = await Whiteboard.find({ _id: { $in: wbIds } }).select('name roomId');
  const whiteboardMap = new Map(whiteboards.map((w) => [w._id.toString(), w]));

  const vrIds = voiceRoomStats.map((v) => v._id);
  const voiceRooms = await VoiceRoom.find({ _id: { $in: vrIds } }).select('name roomId');
  const voiceRoomMap = new Map(voiceRooms.map((v) => [v._id.toString(), v]));

  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
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

  const topWhiteboards = whiteboardStats.map((ws) => ({
    whiteboard: whiteboardMap.get(ws._id.toString()),
    activityCount: ws.activityCount,
    updateCount: ws.updateCount,
    editorCount: ws.editors.length,
    lastActive: ws.lastActive,
  }));

  const topVoiceRooms = voiceRoomStats.map((vs) => ({
    voiceRoom: voiceRoomMap.get(vs._id.toString()),
    joinCount: vs.joinCount,
    participantCount: vs.participants.length,
    lastActive: vs.lastActive,
  }));

  const totalMeetingMinutes = meetings.reduce((sum, m) => {
    if (m.status === 'ended' && m.actualStart && m.actualEnd) {
      return sum + Math.round((m.actualEnd.getTime() - m.actualStart.getTime()) / 60000);
    }
    return sum;
  }, 0);

  const totalMeetingParticipants = new Set(
    meetings.flatMap((m) => m.attendees?.map((a: any) => a.userId?.toString()).filter(Boolean) || [])
  ).size;

  const totalFiles = fileUploadStats[0]?.totalFiles || 0;
  const totalUploaders = fileUploadStats[0]?.uploaders?.length || 0;

  const summary = [
    `【协作周期】${startDate.toLocaleDateString('zh-CN')} ~ ${endDate.toLocaleDateString('zh-CN')} (共 ${days} 天)`,
    `【总体活跃】总活动 ${totalActivities} 次，日均 ${avgDaily} 次`,
    `【参与人员】${uniqueUsers} 位用户参与协作`,
    uniqueUsers > 0 ? `【核心贡献者】${topContributors.slice(0, 3).map((t) => (t.user as any)?.displayName || '未知').filter(Boolean).join('、')}` : '',
    `【会议情况】共 ${meetings.length} 场会议，累计约 ${totalMeetingMinutes} 分钟，${totalMeetingParticipants} 人次参与`,
    `【白板协作】${topWhiteboards.length} 个白板被编辑，共 ${whiteboardStats.reduce((s, w) => s + w.updateCount, 0)} 次更新`,
    `【语音沟通】${topVoiceRooms.length} 个语音房间活跃，共 ${voiceRoomStats.reduce((s, v) => s + v.joinCount, 0)} 次加入`,
    totalFiles > 0 ? `【文件共享】${totalFiles} 个文件上传，来自 ${totalUploaders} 位用户` : '',
    `【活动类型分布】${typeDistribution.slice(0, 5).map((t) => `${t._id}:${t.count}`).join('、')}`,
    hotRooms.length > 0 ? `【热门区域】${hotRooms.slice(0, 3).map((h) => (h.room as any)?.name || '未知').filter(Boolean).join('、')}` : '',
  ].filter(Boolean).join('\n');

  const timeline = logs.slice(0, includeDetails ? 500 : 100).map((log) => ({
    id: log._id,
    timestamp: log.timestamp,
    type: log.type,
    entityType: log.entityType,
    entityId: log.entityId,
    userId: log.userId,
    userName: (log.userId as any)?.displayName,
    spaceId: log.spaceId,
    roomId: log.roomId,
    description: log.description,
    metadata: log.metadata,
  }));

  const meetingTimeline = meetings.map((m) => ({
    id: m._id,
    title: m.title,
    type: 'meeting',
    scheduledStart: m.scheduledStart,
    scheduledEnd: m.scheduledEnd,
    actualStart: m.actualStart,
    actualEnd: m.actualEnd,
    status: m.status,
    organizer: m.organizerId,
    room: m.roomId,
    participantCount: m.attendees?.length || 0,
  }));

  sendSuccess(res, {
    summary,
    period: { from: startDate, to: endDate, days },
    stats: {
      totalActivities,
      uniqueUsers,
      avgDailyActivities: avgDaily,
      typeDistribution,
      meetings: {
        count: meetings.length,
        totalMinutes: totalMeetingMinutes,
        totalParticipants: totalMeetingParticipants,
      },
      whiteboards: {
        activeCount: topWhiteboards.length,
        totalUpdates: whiteboardStats.reduce((s, w) => s + w.updateCount, 0),
      },
      voiceRooms: {
        activeCount: topVoiceRooms.length,
        totalJoins: voiceRoomStats.reduce((s, v) => s + v.joinCount, 0),
      },
      files: {
        totalUploads: totalFiles,
        uploaderCount: totalUploaders,
      },
    },
    topContributors,
    hotRooms,
    topWhiteboards,
    topVoiceRooms,
    meetings,
    timeline,
    meetingTimeline,
  });
});

export const getActivityTimeline = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    userId,
    spaceId,
    roomId,
    type,
    entityType,
    from,
    to,
    groupBy = 'day',
    includeEntities = 'false',
  } = req.query;

  if (!from || !to) {
    return next(new AppError('请提供时间范围 (from, to)', 400));
  }

  const startDate = new Date(from as string);
  const endDate = new Date(to as string);

  const match: any = {
    timestamp: { $gte: startDate, $lte: endDate },
  };

  if (userId) match.userId = new mongoose.Types.ObjectId(userId as string);
  if (spaceId) match.spaceId = new mongoose.Types.ObjectId(spaceId as string);
  if (roomId) match.roomId = new mongoose.Types.ObjectId(roomId as string);
  if (type) match.type = type;
  if (entityType) match.entityType = entityType;

  const dateFormat = groupBy === 'hour'
    ? '%Y-%m-%d %H:00'
    : groupBy === 'week'
    ? '%Y-%U'
    : '%Y-%m-%d';

  const [timelineStats, rawLogs, typeBreakdown, entityBreakdown] = await Promise.all([
    ActivityLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$timestamp' } },
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
          types: { $addToSet: '$type' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    ActivityLog.find(match)
      .populate('userId', 'displayName avatar')
      .populate('spaceId', 'name type')
      .populate('roomId', 'name type')
      .sort({ timestamp: 1 })
      .limit(500),
    ActivityLog.aggregate([
      { $match: match },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    ActivityLog.aggregate([
      { $match: { ...match, entityId: { $exists: true } } },
      {
        $group: {
          _id: { entityType: '$entityType', entityId: '$entityId' },
          count: { $sum: 1 },
          lastActive: { $max: '$timestamp' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
  ]);

  const timeline = timelineStats.map((item) => ({
    date: item._id,
    activityCount: item.count,
    uniqueUsers: item.users.length,
    activityTypes: item.types,
  }));

  const totalActivities = rawLogs.length;
  const uniqueUsers = new Set(rawLogs.map((l) => l.userId?.toString())).size;
  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  let entities: any[] = [];
  if (includeEntities === 'true' && entityBreakdown.length > 0) {
    const entityMap = new Map<string, any>();

    const entityIdsByType: Record<string, mongoose.Types.ObjectId[]> = {};
    for (const item of entityBreakdown) {
      const t = item._id.entityType;
      if (!entityIdsByType[t]) entityIdsByType[t] = [];
      entityIdsByType[t].push(item._id.entityId);
    }

    if (entityIdsByType.meeting) {
      const meetings = await Meeting.find({ _id: { $in: entityIdsByType.meeting } }).select('title status scheduledStart');
      meetings.forEach((m) => entityMap.set(`meeting:${m._id}`, { type: 'meeting', data: m }));
    }
    if (entityIdsByType.whiteboard) {
      const whiteboards = await Whiteboard.find({ _id: { $in: entityIdsByType.whiteboard } }).select('name roomId');
      whiteboards.forEach((w) => entityMap.set(`whiteboard:${w._id}`, { type: 'whiteboard', data: w }));
    }
    if (entityIdsByType['voice_room']) {
      const voiceRooms = await VoiceRoom.find({ _id: { $in: entityIdsByType['voice_room'] } }).select('name status');
      voiceRooms.forEach((v) => entityMap.set(`voice_room:${v._id}`, { type: 'voice_room', data: v }));
    }
    if (entityIdsByType.space) {
      const spaces = await Space.find({ _id: { $in: entityIdsByType.space } }).select('name type');
      spaces.forEach((s) => entityMap.set(`space:${s._id}`, { type: 'space', data: s }));
    }
    if (entityIdsByType.seat) {
      const seats = await Seat.find({ _id: { $in: entityIdsByType.seat } }).select('name type');
      seats.forEach((s) => entityMap.set(`seat:${s._id}`, { type: 'seat', data: s }));
    }

    entities = entityBreakdown.map((item) => {
      const key = `${item._id.entityType}:${item._id.entityId}`;
      return {
        entityType: item._id.entityType,
        entityId: item._id.entityId,
        activityCount: item.count,
        lastActive: item.lastActive,
        entity: entityMap.get(key)?.data || null,
      };
    });
  }

  sendSuccess(res, {
    timeline,
    period: { from: startDate, to: endDate, days, groupBy },
    summary: {
      totalActivities,
      uniqueUsers,
      avgDailyActivities: Math.round(totalActivities / days),
      typeBreakdown,
    },
    entities: includeEntities === 'true' ? entities : undefined,
    logs: rawLogs,
  });
});

export const exportActivityLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    userId,
    spaceId,
    roomId,
    type,
    entityType,
    from,
    to,
    format = 'json',
  } = req.query;

  if (!from || !to) {
    return next(new AppError('请提供时间范围 (from, to)', 400));
  }

  const startDate = new Date(from as string);
  const endDate = new Date(to as string);

  const match: any = {
    timestamp: { $gte: startDate, $lte: endDate },
  };

  if (userId) match.userId = new mongoose.Types.ObjectId(userId as string);
  if (spaceId) match.spaceId = new mongoose.Types.ObjectId(spaceId as string);
  if (roomId) match.roomId = new mongoose.Types.ObjectId(roomId as string);
  if (type) match.type = type;
  if (entityType) match.entityType = entityType;

  const logs = await ActivityLog.find(match)
    .populate('userId', 'displayName email')
    .populate('spaceId', 'name type')
    .populate('roomId', 'name type')
    .sort({ timestamp: 1 })
    .limit(5000);

  if (format === 'csv') {
    const headers = ['时间', '用户', '类型', '实体类型', '实体ID', '空间', '房间', '描述', 'IP'];
    const rows = logs.map((log) => [
      log.timestamp.toISOString(),
      (log.userId as any)?.displayName || '',
      log.type,
      log.entityType,
      log.entityId?.toString() || '',
      (log.spaceId as any)?.name || '',
      (log.roomId as any)?.name || '',
      (log.description || '').replace(/"/g, '""').replace(/\n/g, ' '),
      log.ipAddress || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-logs-${Date.now()}.csv"`);
    res.send('\uFEFF' + csv);
    return;
  }

  const exportData = {
    exportTime: new Date().toISOString(),
    period: { from: startDate, to: endDate },
    filters: { userId, spaceId, roomId, type, entityType },
    totalCount: logs.length,
    logs: logs.map((log) => ({
      id: log._id,
      timestamp: log.timestamp,
      type: log.type,
      entityType: log.entityType,
      entityId: log.entityId,
      userId: log.userId,
      user: (log.userId as any)?.displayName,
      spaceId: log.spaceId,
      spaceName: (log.spaceId as any)?.name,
      roomId: log.roomId,
      roomName: (log.roomId as any)?.name,
      description: log.description,
      metadata: log.metadata,
      ipAddress: log.ipAddress,
    })),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="activity-logs-${Date.now()}.json"`);
  res.json(exportData);
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
