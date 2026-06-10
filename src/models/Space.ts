import mongoose, { Schema, Document, Model } from 'mongoose';

export type SpaceType = 'floor' | 'room' | 'area';
export type RoomCategory = 'lobby' | 'meeting' | 'workstation' | 'lounge' | 'custom';

export interface IPosition {
  x: number;
  y: number;
  z?: number;
  width?: number;
  height?: number;
}

export interface ISpace extends Document {
  name: string;
  description?: string;
  type: SpaceType;
  category?: RoomCategory;
  parentId?: mongoose.Types.ObjectId;
  spacePath: mongoose.Types.ObjectId[];
  level: number;
  sortOrder: number;
  position?: IPosition;
  backgroundUrl?: string;
  capacity?: number;
  isPublic: boolean;
  allowedRoles?: string[];
  allowedUsers?: mongoose.Types.ObjectId[];
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SpaceSchema: Schema<ISpace> = new Schema(
  {
    name: {
      type: String,
      required: [true, '空间名称不能为空'],
      trim: true,
      maxlength: [100, '空间名称不能超过100个字符'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, '描述不能超过500个字符'],
    },
    type: {
      type: String,
      enum: ['floor', 'room', 'area'],
      required: [true, '空间类型不能为空'],
    },
    category: {
      type: String,
      enum: ['lobby', 'meeting', 'workstation', 'lounge', 'custom'],
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
    },
    spacePath: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Space',
      },
    ],
    level: {
      type: Number,
      default: 0,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      z: { type: Number, default: 0 },
      width: { type: Number },
      height: { type: Number },
    },
    backgroundUrl: {
      type: String,
      default: '',
    },
    capacity: {
      type: Number,
      default: 0,
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    allowedRoles: [
      {
        type: String,
      },
    ],
    allowedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

SpaceSchema.index({ parentId: 1, type: 1 });
SpaceSchema.index({ type: 1, isActive: 1 });
SpaceSchema.index({ spacePath: 1 });

const Space: Model<ISpace> = mongoose.model<ISpace>('Space', SpaceSchema);
export default Space;
