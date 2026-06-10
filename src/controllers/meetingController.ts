import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Meeting, { IAttendee, IMeetingTimelineEvent, ISharedFile, IMeeting } from '../models/Meeting';
import Space from '../models/Space';
import User from '../models/User';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';
import { v4 as uuidv4 } from 'uuid';

export const createMeeting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    title,
    description,
    roomId,
    scheduledStart,
    scheduledEnd,
    attendeeIds,
    isRecurring,
    recurringRule,
  } = req.body;

  if (!title || !roomId || !scheduledStart || !scheduledEnd) {
    return next(new AppError('请提供会议标题、房间、开始时间和结束时间', 400));
  }

  const room = await Space.findById(roomId);
  if (!room) {
    return next(new AppError('会议房间不存在', 404));
  }

  const start = new Date(scheduledStart);
  const end = new Date(scheduledEnd);
  if (start >= end) {
    return next(new AppError('结束时间必须晚于开始时间', 400));
  }

  const attendees: IAttendee[] = [];
  if (Array.isArray(attendeeIds) && attendeeIds.length > 0) {
    const validUserIds = await User.find({
      _id: { $in: attendeeIds.map((id: string) => new mongoose.Types.ObjectId(id)) },
    }).select('_id');
    for (const user of validUserIds) {
      attendees.push({
        userId: user._id,
        status: 'invited',
        reminderSent: false,
      });
    }
  }

  attendees.push({
    userId: req.user!._id as any,
    status: 'accepted',
    reminderSent: true,
  });

  const initialTimeline: IMeetingTimelineEvent[] = [
    {
      id: uuidv4(),
      type: 'topic',
      timestamp: new Date(),
      userId: req.user!._id as any,
      displayName: req.user!.displayName,
      content: `会议创建: ${title}`,
    },
  ];

  const meeting = await Meeting.create({
    title,
    description,
    roomId: new mongoose.Types.ObjectId(roomId),
    organizerId: req.user!._id,
    scheduledStart: start,
    scheduledEnd: end,
    attendees,
    timeline: initialTimeline,
    isRecurring: isRecurring || false,
    recurringRule,
  });

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'meeting_create',
    entityType: 'meeting',
    entityId: meeting._id as any,
    roomId: room._id as any,
    description: `创建会议: ${title}`,
    metadata: {
      scheduledStart,
      attendeeCount: attendees.length,
    },
  });

  const populated = await Meeting.findById(meeting._id)
    .populate('organizerId', 'displayName avatar email')
    .populate('attendees.userId', 'displayName avatar email')
    .populate('roomId', 'name type');

  sendSuccess(res, { meeting: populated }, 201);
});

export const getMeetings = asyncHandler(async (req: Request, res: Response) => {
  const {
    status,
    roomId,
    from,
    to,
    page = 1,
    limit = 50,
    myOnly,
  } = req.query;

  const query: any = {};

  if (myOnly === 'true' || req.user!.role === 'member') {
    query.$or = [
      { organizerId: req.user!._id },
      { 'attendees.userId': req.user!._id },
    ];
  }

  if (status) query.status = status;
  if (roomId) query.roomId = new mongoose.Types.ObjectId(roomId as string);
  if (from || to) {
    query.scheduledStart = {};
    if (from) query.scheduledStart.$gte = new Date(from as string);
    if (to) query.scheduledStart.$lte = new Date(to as string);
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const total = await Meeting.countDocuments(query);

  const meetings = await Meeting.find(query)
    .populate('organizerId', 'displayName avatar email')
    .populate('attendees.userId', 'displayName avatar email')
    .populate('roomId', 'name type')
    .sort({ scheduledStart: -1 })
    .skip(skip)
    .limit(parseInt(limit as string));

  sendSuccess(
    res,
    { meetings },
    200,
    {
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string)),
    }
  );
});

export const getMeetingById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const meeting = await Meeting.findById(req.params.id)
    .populate('organizerId', 'displayName avatar email')
    .populate('attendees.userId', 'displayName avatar email')
    .populate('roomId', 'name type')
    .populate('sharedFiles.uploadedBy', 'displayName avatar')
    .populate('actionItems.assigneeId', 'displayName avatar');

  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  sendSuccess(res, { meeting });
});

export const updateMeeting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  if (meeting.organizerId.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有组织者或管理员可以修改会议', 403));
  }

  const allowedUpdates = [
    'title',
    'description',
    'roomId',
    'scheduledStart',
    'scheduledEnd',
    'notes',
    'summary',
    'recordingUrl',
    'isRecurring',
    'recurringRule',
  ];

  for (const field of allowedUpdates) {
    if (req.body[field] !== undefined) {
      (meeting as any)[field] = req.body[field];
    }
  }

  await meeting.save();

  sendSuccess(res, { meeting });
});

export const deleteMeeting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  if (meeting.organizerId.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有组织者或管理员可以删除会议', 403));
  }

  meeting.status = 'cancelled';
  await meeting.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'meeting',
    entityId: meeting._id as any,
    description: `取消会议: ${meeting.title}`,
  });

  sendMessage(res, '会议已取消');
});

export const startMeeting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  if (meeting.status !== 'scheduled') {
    return next(new AppError(`无法启动状态为 ${meeting.status} 的会议`, 400));
  }

  meeting.status = 'in_progress';
  meeting.actualStart = new Date();

  meeting.timeline.push({
    id: uuidv4(),
    type: 'start',
    timestamp: new Date(),
    userId: req.user!._id as any,
    displayName: req.user!.displayName,
    content: '会议开始',
  });

  await meeting.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'meeting_start',
    entityType: 'meeting',
    entityId: meeting._id as any,
    roomId: meeting.roomId as any,
    description: `开始会议: ${meeting.title}`,
  });

  sendSuccess(res, { meeting });
});

export const endMeeting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  if (meeting.status !== 'in_progress') {
    return next(new AppError(`无法结束状态为 ${meeting.status} 的会议`, 400));
  }

  meeting.status = 'ended';
  meeting.actualEnd = new Date();

  if (meeting.actualStart) {
    const durationMs = meeting.actualEnd.getTime() - meeting.actualStart.getTime();
    for (const attendee of meeting.attendees) {
      if (attendee.status === 'attended' && attendee.joinedAt) {
        const joinTime = attendee.joinedAt.getTime() > meeting.actualStart.getTime()
          ? attendee.joinedAt.getTime()
          : meeting.actualStart.getTime();
        const leaveTime = attendee.leftAt
          ? attendee.leftAt.getTime()
          : meeting.actualEnd.getTime();
        attendee.durationMinutes = Math.round((leaveTime - joinTime) / 60000);
      }
    }
  }

  meeting.timeline.push({
    id: uuidv4(),
    type: 'end',
    timestamp: new Date(),
    userId: req.user!._id as any,
    displayName: req.user!.displayName,
    content: '会议结束',
  });

  await meeting.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'meeting_end',
    entityType: 'meeting',
    entityId: meeting._id as any,
    roomId: meeting.roomId as any,
    description: `结束会议: ${meeting.title}`,
  });

  sendSuccess(res, { meeting });
});

export const joinMeeting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId } = req.body;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  let attendee = meeting.attendees.find(
    (a) => a.userId.toString() === req.user!._id.toString()
  );

  if (!attendee) {
    attendee = {
      userId: req.user!._id as any,
      status: 'attended',
      joinedAt: new Date(),
      reminderSent: true,
    };
    meeting.attendees.push(attendee);
  } else {
    attendee.status = 'attended';
    attendee.joinedAt = new Date();
  }

  meeting.timeline.push({
    id: uuidv4(),
    type: 'join',
    timestamp: new Date(),
    userId: req.user!._id as any,
    displayName: req.user!.displayName,
    content: `${req.user!.displayName} 加入会议`,
  });

  await meeting.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'meeting_join',
    entityType: 'meeting',
    entityId: meeting._id as any,
    roomId: meeting.roomId as any,
    description: `${req.user!.displayName} 加入会议: ${meeting.title}`,
  });

  sendSuccess(res, { meeting });
});

export const leaveMeeting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId } = req.body;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  const attendee = meeting.attendees.find(
    (a) => a.userId.toString() === req.user!._id.toString()
  );
  if (!attendee) {
    return next(new AppError('您不在与会者列表中', 400));
  }

  attendee.leftAt = new Date();
  if (attendee.joinedAt) {
    attendee.durationMinutes = Math.round(
      (attendee.leftAt.getTime() - attendee.joinedAt.getTime()) / 60000
    );
  }

  meeting.timeline.push({
    id: uuidv4(),
    type: 'leave',
    timestamp: new Date(),
    userId: req.user!._id as any,
    displayName: req.user!.displayName,
    content: `${req.user!.displayName} 离开会议`,
  });

  await meeting.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'meeting_leave',
    entityType: 'meeting',
    entityId: meeting._id as any,
    description: `${req.user!.displayName} 离开会议: ${meeting.title}`,
  });

  sendSuccess(res, { meeting });
});

export const addTimelineEvent = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId, type, content, metadata } = req.body;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  const validTypes = ['note', 'file', 'vote', 'topic', 'action'];
  if (!validTypes.includes(type)) {
    return next(new AppError('无效的时间线事件类型', 400));
  }

  const event: IMeetingTimelineEvent = {
    id: uuidv4(),
    type,
    timestamp: new Date(),
    userId: req.user!._id as any,
    displayName: req.user!.displayName,
    content,
    metadata,
  };

  meeting.timeline.push(event);
  await meeting.save();

  sendSuccess(res, { event });
});

export const addSharedFile = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId, name, url, fileType, size } = req.body;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  const file: ISharedFile = {
    id: uuidv4(),
    name,
    url,
    fileType,
    size,
    uploadedBy: req.user!._id as any,
    uploadedAt: new Date(),
  };

  meeting.sharedFiles.push(file);

  meeting.timeline.push({
    id: uuidv4(),
    type: 'file',
    timestamp: new Date(),
    userId: req.user!._id as any,
    displayName: req.user!.displayName,
    content: `上传文件: ${name}`,
    metadata: { fileId: file.id, fileType },
  });

  await meeting.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'file_upload',
    entityType: 'meeting',
    entityId: meeting._id as any,
    description: `上传会议文件: ${name}`,
  });

  sendSuccess(res, { file }, 201);
});

export const addActionItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId, content, assigneeId, dueDate } = req.body;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  const actionItem = {
    id: uuidv4(),
    content,
    assigneeId: assigneeId ? new mongoose.Types.ObjectId(assigneeId) : undefined,
    dueDate: dueDate ? new Date(dueDate) : undefined,
    completed: false,
  };

  meeting.actionItems = meeting.actionItems || [];
  meeting.actionItems.push(actionItem as any);

  meeting.timeline.push({
    id: uuidv4(),
    type: 'action',
    timestamp: new Date(),
    userId: req.user!._id as any,
    displayName: req.user!.displayName,
    content: `新增待办: ${content}`,
    metadata: { actionId: actionItem.id, assigneeId },
  });

  await meeting.save();

  sendSuccess(res, { actionItem }, 201);
});

export const updateActionItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId, actionId, content, assigneeId, dueDate, completed } = req.body;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  const actionItem = (meeting.actionItems || []).find((a: any) => a.id === actionId);
  if (!actionItem) {
    return next(new AppError('待办事项不存在', 404));
  }

  if (content !== undefined) actionItem.content = content;
  if (assigneeId !== undefined) actionItem.assigneeId = new mongoose.Types.ObjectId(assigneeId);
  if (dueDate !== undefined) actionItem.dueDate = new Date(dueDate);
  if (completed !== undefined) actionItem.completed = completed;

  await meeting.save();

  sendSuccess(res, { actionItem });
});

export const addAttendees = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId, userIds } = req.body;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  if (!Array.isArray(userIds)) {
    return next(new AppError('请提供用户ID数组', 400));
  }

  let addedCount = 0;
  for (const userId of userIds) {
    const exists = meeting.attendees.some(
      (a) => a.userId.toString() === userId
    );
    if (!exists) {
      meeting.attendees.push({
        userId: new mongoose.Types.ObjectId(userId),
        status: 'invited',
        reminderSent: false,
      });
      addedCount++;
    }
  }

  await meeting.save();
  sendSuccess(res, { addedCount, totalAttendees: meeting.attendees.length });
});

export const updateAttendeeStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId, status } = req.body;

  const validStatuses = ['accepted', 'declined', 'attended', 'absent'];
  if (!validStatuses.includes(status)) {
    return next(new AppError('无效的状态值', 400));
  }

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  const attendee = meeting.attendees.find(
    (a) => a.userId.toString() === req.user!._id.toString()
  );
  if (!attendee) {
    return next(new AppError('您不在与会者列表中', 400));
  }

  attendee.status = status as any;
  await meeting.save();

  sendSuccess(res, { attendee });
});

export const sendMeetingReminder = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { meetingId, userIds } = req.body;

  const meeting = await Meeting.findById(meetingId)
    .populate('attendees.userId', 'displayName email');
  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  const targets = userIds && userIds.length > 0
    ? meeting.attendees.filter((a) => userIds.includes(a.userId.toString()))
    : meeting.attendees.filter((a) => !a.reminderSent);

  const sent: string[] = [];
  for (const attendee of targets) {
    attendee.reminderSent = true;
    sent.push(attendee.userId.toString());

    const user = (attendee.userId as any);
    console.log(`📧 发送会议提醒: ${meeting.title} -> ${user?.displayName || user?.email}`);
  }

  await meeting.save();

  sendSuccess(res, {
    sentCount: sent.length,
    sentUserIds: sent,
  });
});

export const generateMeetingSummary = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const meeting = await Meeting.findById(req.params.id)
    .populate('attendees.userId', 'displayName avatar email')
    .populate('organizerId', 'displayName avatar');

  if (!meeting) {
    return next(new AppError('会议不存在', 404));
  }

  if (meeting.status !== 'ended') {
    return next(new AppError('只能为已结束的会议生成摘要', 400));
  }

  const attendeesList = meeting.attendees
    .filter((a) => a.status === 'attended')
    .map((a) => (a.userId as any)?.displayName || '未知用户');
  const absenteesList = meeting.attendees
    .filter((a) => a.status !== 'attended' && a.status !== 'invited')
    .map((a) => (a.userId as any)?.displayName || '未知用户');

  const timelineNotes = meeting.timeline
    .filter((e) => e.type === 'note' || e.type === 'topic')
    .map((e) => e.content)
    .filter(Boolean);

  const duration = meeting.actualStart && meeting.actualEnd
    ? Math.round((meeting.actualEnd.getTime() - meeting.actualStart.getTime()) / 60000)
    : 0;

  const summary = [
    `【会议主题】${meeting.title}`,
    meeting.description ? `【会议描述】${meeting.description}` : null,
    `【组织者】${(meeting.organizerId as any)?.displayName || '未知'}`,
    `【会议时长】${duration} 分钟`,
    `【实际时间】${meeting.actualStart?.toLocaleString()} ~ ${meeting.actualEnd?.toLocaleString()}`,
    `【参会人员 (${attendeesList.length})】${attendeesList.join('、')}`,
    absenteesList.length > 0 ? `【缺席人员】${absenteesList.join('、')}` : null,
    timelineNotes.length > 0 ? `【议题/记录】\n${timelineNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}` : null,
    meeting.sharedFiles.length > 0 ? `【共享文件 (${meeting.sharedFiles.length})】${meeting.sharedFiles.map((f) => f.name).join('、')}` : null,
    meeting.actionItems && meeting.actionItems.length > 0
      ? `【待办事项 (${meeting.actionItems.length})】\n${meeting.actionItems
          .map((a: any, i: number) => `${i + 1}. [${a.completed ? '✓' : ' '}] ${a.content}${a.assigneeId ? ' @' + (a.assigneeId as any)?.displayName : ''}${a.dueDate ? ` (截止: ${new Date(a.dueDate).toLocaleDateString()})` : ''}`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  meeting.summary = summary;
  await meeting.save();

  sendSuccess(res, { summary, meeting });
});
