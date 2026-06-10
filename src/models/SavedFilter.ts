import mongoose, { Schema, Document, Model } from 'mongoose';

export type FilterTarget = 'collaboration_summary' | 'activity_logs' | 'activity_timeline';
export type ScheduleFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface ISavedFilter extends Document {
  name: string;
  description?: string;
  target: FilterTarget;
  createdBy: mongoose.Types.ObjectId;
  filters: {
    userId?: string;
    floorId?: string;
    roomId?: string;
    spaceId?: string;
    from?: string;
    to?: string;
    type?: string;
    entityType?: string;
    includeDetails?: boolean;
  };
  isGlobal: boolean;
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SavedFilterSchema: Schema<ISavedFilter> = new Schema(
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
      enum: ['collaboration_summary', 'activity_logs', 'activity_timeline'],
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    isGlobal: {
      type: Boolean,
      default: false,
      index: true,
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

SavedFilterSchema.index({ createdBy: 1, target: 1 });
SavedFilterSchema.index({ isGlobal: 1, target: 1 });

const SavedFilter: Model<ISavedFilter> = mongoose.model<ISavedFilter>(
  'SavedFilter',
  SavedFilterSchema
);

export default SavedFilter;
