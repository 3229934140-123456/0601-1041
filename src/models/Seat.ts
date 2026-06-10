import mongoose, { Schema, Document, Model } from 'mongoose';

export type SeatStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';
export type SeatType = 'fixed' | 'hot' | 'meeting';

export interface ISeat extends Document {
  code: string;
  name: string;
  description?: string;
  type: SeatType;
  roomId: mongoose.Types.ObjectId;
  position: {
    x: number;
    y: number;
    z?: number;
    rotation?: number;
  };
  status: SeatStatus;
  assignedUserId?: mongoose.Types.ObjectId;
  occupiedBy?: mongoose.Types.ObjectId;
  reservedUntil?: Date;
  equipment?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SeatSchema: Schema<ISeat> = new Schema(
  {
    code: {
      type: String,
      required: [true, '座位编号不能为空'],
      trim: true,
    },
    name: {
      type: String,
      required: [true, '座位名称不能为空'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ['fixed', 'hot', 'meeting'],
      default: 'hot',
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
    },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      z: { type: Number, default: 0 },
      rotation: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['available', 'occupied', 'reserved', 'maintenance'],
      default: 'available',
    },
    assignedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    occupiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reservedUntil: {
      type: Date,
    },
    equipment: [
      {
        type: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

SeatSchema.index({ roomId: 1, code: 1 }, { unique: true });
SeatSchema.index({ status: 1 });
SeatSchema.index({ assignedUserId: 1 });
SeatSchema.index({ occupiedBy: 1 });

const Seat: Model<ISeat> = mongoose.model<ISeat>('Seat', SeatSchema);
export default Seat;
