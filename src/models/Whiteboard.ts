import mongoose, { Schema, Document, Model } from 'mongoose';

export type BoardElementType = 'sticky' | 'shape' | 'line' | 'text' | 'image';

export interface IBoardElement {
  id: string;
  type: BoardElementType;
  content?: string;
  color?: string;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  rotation?: number;
  zIndex: number;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWhiteboard extends Document {
  roomId: mongoose.Types.ObjectId;
  name: string;
  elements: IBoardElement[];
  backgroundColor?: string;
  width: number;
  height: number;
  isLocked: boolean;
  lockedBy?: mongoose.Types.ObjectId;
  lastModifiedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BoardElementSchema: Schema<IBoardElement> = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['sticky', 'shape', 'line', 'text', 'image'],
      required: true,
    },
    content: { type: String },
    color: { type: String },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
    size: {
      width: { type: Number, required: true },
      height: { type: Number, required: true },
    },
    rotation: { type: Number, default: 0 },
    zIndex: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    _id: false,
  }
);

const WhiteboardSchema: Schema<IWhiteboard> = new Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: [true, '白板名称不能为空'],
      default: '默认白板',
    },
    elements: [BoardElementSchema],
    backgroundColor: {
      type: String,
      default: '#ffffff',
    },
    width: {
      type: Number,
      default: 3840,
    },
    height: {
      type: Number,
      default: 2160,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

WhiteboardSchema.index({ roomId: 1 });

const Whiteboard: Model<IWhiteboard> = mongoose.model<IWhiteboard>('Whiteboard', WhiteboardSchema);
export default Whiteboard;
