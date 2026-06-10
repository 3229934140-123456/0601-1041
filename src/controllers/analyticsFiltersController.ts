import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import SavedFilter, { ISavedFilter, FilterTarget } from '../models/SavedFilter';
import ScheduledExport, { IScheduledExport, ScheduleFrequency, ExportFormat, ExportTarget } from '../models/ScheduledExport';
import AppError from '../utils/AppError';
import { sendSuccess, sendMessage } from '../utils/response';
import ActivityLogger from '../services/ActivityLogger';

function calculateNextRun(
  frequency: ScheduleFrequency,
  hour: number,
  minute: number,
  dayOfWeek?: number
): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (frequency === 'daily') {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    const targetDow = dayOfWeek ?? 1;
    const currentDow = next.getDay();
    let daysToAdd = targetDow - currentDow;
    if (daysToAdd < 0 || (daysToAdd === 0 && next <= now)) {
      daysToAdd += 7;
    }
    next.setDate(next.getDate() + daysToAdd);
  } else if (frequency === 'biweekly') {
    const targetDow = dayOfWeek ?? 1;
    const currentDow = next.getDay();
    let daysToAdd = targetDow - currentDow;
    if (daysToAdd < 0 || (daysToAdd === 0 && next <= now)) {
      daysToAdd += 14;
    }
    next.setDate(next.getDate() + daysToAdd);
  } else if (frequency === 'monthly') {
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next;
}

export const getSavedFilters = asyncHandler(async (req: Request, res: Response) => {
  const { target, includeGlobal = 'true' } = req.query;

  const query: any = {
    $or: [
      { createdBy: req.user!._id },
    ],
  };

  if (includeGlobal === 'true') {
    query.$or.push({ isGlobal: true });
  }

  if (target) {
    query.target = target as FilterTarget;
  }

  const filters = await SavedFilter.find(query)
    .populate('createdBy', 'displayName')
    .sort({ isFavorite: -1, createdAt: -1 });

  sendSuccess(res, { filters });
});

export const createSavedFilter = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, description, target, filters, isGlobal = false } = req.body;

  if (!name || !target || !filters) {
    return next(new AppError('请提供名称、目标类型和筛选条件', 400));
  }

  if (isGlobal && req.user!.role !== 'admin') {
    return next(new AppError('只有管理员可以创建全局筛选条件', 403));
  }

  const savedFilter = new SavedFilter({
    name,
    description,
    target: target as FilterTarget,
    createdBy: req.user!._id,
    filters,
    isGlobal,
    isFavorite: true,
  });

  await savedFilter.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'system',
    entityId: savedFilter._id as any,
    description: `创建保存的筛选条件: ${name} (${target})`,
    metadata: { target, isGlobal },
  });

  sendSuccess(res, { filter: savedFilter }, 201);
});

export const updateSavedFilter = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { name, description, filters, isGlobal, isFavorite } = req.body;

  const savedFilter = await SavedFilter.findById(id);
  if (!savedFilter) {
    return next(new AppError('筛选条件不存在', 404));
  }

  if (savedFilter.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以修改此筛选条件', 403));
  }

  if (isGlobal !== undefined && isGlobal && req.user!.role !== 'admin') {
    return next(new AppError('只有管理员可以设置全局筛选条件', 403));
  }

  if (name !== undefined) savedFilter.name = name;
  if (description !== undefined) savedFilter.description = description;
  if (filters !== undefined) savedFilter.filters = filters;
  if (isGlobal !== undefined) savedFilter.isGlobal = isGlobal;
  if (isFavorite !== undefined) savedFilter.isFavorite = isFavorite;

  await savedFilter.save();

  sendSuccess(res, { filter: savedFilter });
});

export const deleteSavedFilter = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const savedFilter = await SavedFilter.findById(id);
  if (!savedFilter) {
    return next(new AppError('筛选条件不存在', 404));
  }

  if (savedFilter.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以删除此筛选条件', 403));
  }

  await SavedFilter.deleteOne({ _id: id });

  sendMessage(res, '筛选条件已删除');
});

export const getScheduledExports = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query;

  const query: any = {
    createdBy: req.user!._id,
  };

  if (status) {
    query.status = status;
  }

  const exports = await ScheduledExport.find(query)
    .sort({ createdAt: -1 })
    .limit(50);

  sendSuccess(res, { exports });
});

export const createScheduledExport = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const {
    name,
    description,
    target,
    format = 'csv',
    filters,
    frequency = 'weekly',
    dayOfWeek = 1,
    hour = 9,
    minute = 0,
    timezone = 'Asia/Shanghai',
    recipientEmails = [],
  } = req.body;

  if (!name || !target || !filters) {
    return next(new AppError('请提供名称、目标类型和筛选条件', 400));
  }

  if (filters.periodDays && filters.periodDays > 90) {
    return next(new AppError('单次导出时间范围不能超过90天', 400));
  }

  const nextRunAt = calculateNextRun(
    frequency as ScheduleFrequency,
    hour,
    minute,
    dayOfWeek
  );

  const scheduledExport = new ScheduledExport({
    name,
    description,
    target: target as ExportTarget,
    format: format as ExportFormat,
    filters,
    frequency: frequency as ScheduleFrequency,
    dayOfWeek,
    hour,
    minute,
    timezone,
    createdBy: req.user!._id,
    recipientEmails,
    nextRunAt,
    status: 'active',
  });

  await scheduledExport.save();

  await ActivityLogger.log({
    userId: req.user!._id as any,
    type: 'custom',
    entityType: 'system',
    entityId: scheduledExport._id as any,
    description: `创建定时导出任务: ${name} (${frequency}, ${format})`,
    metadata: { target, frequency, format },
  });

  sendSuccess(res, { scheduledExport }, 201);
});

export const updateScheduledExport = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const {
    name,
    description,
    format,
    filters,
    frequency,
    dayOfWeek,
    hour,
    minute,
    timezone,
    recipientEmails,
    status,
  } = req.body;

  const scheduledExport = await ScheduledExport.findById(id);
  if (!scheduledExport) {
    return next(new AppError('定时导出任务不存在', 404));
  }

  if (scheduledExport.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以修改此任务', 403));
  }

  if (name !== undefined) scheduledExport.name = name;
  if (description !== undefined) scheduledExport.description = description;
  if (format !== undefined) scheduledExport.format = format as ExportFormat;
  if (filters !== undefined) scheduledExport.filters = filters;
  if (frequency !== undefined || dayOfWeek !== undefined || hour !== undefined || minute !== undefined) {
    const newFreq = frequency ?? scheduledExport.frequency;
    const newHour = hour ?? scheduledExport.hour;
    const newMinute = minute ?? scheduledExport.minute;
    const newDow = dayOfWeek ?? scheduledExport.dayOfWeek;
    scheduledExport.frequency = newFreq as ScheduleFrequency;
    scheduledExport.dayOfWeek = newDow;
    scheduledExport.hour = newHour;
    scheduledExport.minute = newMinute;
    scheduledExport.nextRunAt = calculateNextRun(newFreq as ScheduleFrequency, newHour, newMinute, newDow);
  }
  if (timezone !== undefined) scheduledExport.timezone = timezone;
  if (recipientEmails !== undefined) scheduledExport.recipientEmails = recipientEmails;
  if (status !== undefined) scheduledExport.status = status;

  await scheduledExport.save();

  sendSuccess(res, { scheduledExport });
});

export const deleteScheduledExport = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const scheduledExport = await ScheduledExport.findById(id);
  if (!scheduledExport) {
    return next(new AppError('定时导出任务不存在', 404));
  }

  if (scheduledExport.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以删除此任务', 403));
  }

  await ScheduledExport.deleteOne({ _id: id });

  sendMessage(res, '定时导出任务已删除');
});

export const executeScheduledExportNow = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const scheduledExport = await ScheduledExport.findById(id);
  if (!scheduledExport) {
    return next(new AppError('定时导出任务不存在', 404));
  }

  if (scheduledExport.createdBy.toString() !== req.user!._id.toString() && req.user!.role !== 'admin') {
    return next(new AppError('只有创建者或管理员可以执行此任务', 403));
  }

  (req as any).scheduledExport = scheduledExport;
  (req as any).exportMode = true;
  (req as any).exportFormat = scheduledExport.format;

  if (scheduledExport.target === 'collaboration_summary') {
    const periodDays = scheduledExport.filters.periodDays || 7;
    const to = new Date();
    const from = new Date(to.getTime() - periodDays * 24 * 60 * 60 * 1000);

    req.body = {
      userId: scheduledExport.filters.userId,
      floorId: scheduledExport.filters.floorId,
      roomId: scheduledExport.filters.roomId,
      spaceId: scheduledExport.filters.spaceId,
      from: from.toISOString(),
      to: to.toISOString(),
      includeDetails: scheduledExport.filters.includeDetails ?? true,
    };

    const { generateCollaborationSummary, exportAuditReport } = await import('./analyticsController');
    return generateCollaborationSummary(req, res, () => exportAuditReport(req, res, next));
  } else {
    const periodDays = scheduledExport.filters.periodDays || 7;
    const to = new Date();
    const from = new Date(to.getTime() - periodDays * 24 * 60 * 60 * 1000);

    req.query = {
      userId: scheduledExport.filters.userId,
      roomId: scheduledExport.filters.roomId,
      spaceId: scheduledExport.filters.spaceId,
      type: scheduledExport.filters.type,
      entityType: scheduledExport.filters.entityType,
      from: from.toISOString(),
      to: to.toISOString(),
      format: scheduledExport.format,
    } as any;

    const { exportActivityLogs } = await import('./analyticsController');
    return exportActivityLogs(req, res, next);
  }
});
