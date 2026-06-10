import mongoose, { Schema, Document, Model } from 'mongoose';

export type ExportFormat = 'json' | 'csv';
export type ExportTarget = 'collaboration_summary' | 'activity_logs';
export type ExportStatus = 'active' | 'paused' | 'completed' | 'failed';
export type ScheduleFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface IExportHistory {
  exportedAt: Date;
  status: 'success' | 'failed';
  fileUrl?: string;
  recordCount: number;
  errorMessage?: string;
}

export interface IScheduledExport extends Document {
  name: string;
  description?: string;
  target: ExportTarget;
  format: ExportFormat;
  filters: {
    userId?: string;
    floorId?: string;
    roomId?: string;
    spaceId?: string;
    type?: string;
    entityType?: string;
    periodDays?: number;
    includeDetails?: boolean;
  };
  frequency: ScheduleFrequency;
  dayOfWeek?: number;
  hour: number;
  minute: number;
  timezone: string;
  createdBy: mongoose.Types.ObjectId;
  recipientEmails?: string[];
  lastRunAt?: Date;
  nextRunAt: Date;
  status: ExportStatus;
  history: IExportHistory[];
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledExportSchema: Schema<IScheduledExport> = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, '名称不能超过100个字符'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, '描述不能超过500个字符'],
    },
    target: {
      type: String,
      enum: ['collaboration_summary', 'activity_logs'],
      required: true,
      index: true,
    },
    format: {
      type: String,
      enum: ['json', 'csv'],
      default: 'csv',
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'biweekly', 'monthly'],
      default: 'weekly',
      index: true,
    },
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      default: 1,
    },
    hour: {
      type: Number,
      required: true,
      min: 0,
      max: 23,
      default: 9,
    },
    minute: {
      type: Number,
      required: true,
      min: 0,
      max: 59,
      default: 0,
    },
    timezone: {
      type: String,
      default: 'Asia/Shanghai',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientEmails: {
      type: [String],
      default: [],
    },
    lastRunAt: Date,
    nextRunAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'completed', 'failed'],
      default: 'active',
      index: true,
    },
    history: {
      type: [
        {
          exportedAt: { type: Date, required: true },
          status: {
            type: String,
            enum: ['success', 'failed'],
            required: true,
          },
          fileUrl: String,
          recordCount: { type: Number, default: 0 },
          errorMessage: String,
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

ScheduledExportSchema.index({ status: 1, nextRunAt: 1 });
ScheduledExportSchema.index({ createdBy: 1, status: 1 });

const ScheduledExport: Model<IScheduledExport> = mongoose.model<IScheduledExport>(
  'ScheduledExport',
  ScheduledExportSchema
);

export default ScheduledExport;
