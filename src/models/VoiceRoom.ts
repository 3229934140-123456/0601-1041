import mongoose, { Schema, Document, Model } from 'mongoose';

export type VoiceRoomType = 'temporary' | 'permanent';
export type VoiceRoomStatus = 'active' | 'ended';

export interface IVoiceParticipant {
  userId: mongoose.Types.ObjectId;
  joinedAt: Date;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaker: boolean;
  signalData?: string;
}

export interface IVoiceRoom extends Document {
  name: string;
  description?: string;
  type: VoiceRoomType;
  roomId?: mongoose.Types.ObjectId;
  position?: {
    x: number;
    y: number;
    radius?: number;
  };
  createdBy: mongoose.Types.ObjectId;
  participants: IVoiceParticipant[];
  maxParticipants: number;
  status: VoiceRoomStatus;
  endedAt?: Date;
  accessCode?: string;
  isPrivate: boolean;
  allowedUsers?: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const VoiceParticipantSchema: Schema<IVoiceParticipant> = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    isMuted: {
      type: Boolean,
      default: false,
    },
    isDeafened: {
      type: Boolean,
      default: false,
    },
    isSpeaker: {
      type: Boolean,
      default: true,
    },
    signalData: String,
  },
  {
    _id: false,
  }
);

const VoiceRoomSchema: Schema<IVoiceRoom> = new Schema(
  {
    name: {
      type: String,
      required: [true, '语音房间名称不能为空'],
      trim: true,
      maxlength: [100, '名称不能超过100个字符'],
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ['temporary', 'permanent'],
      default: 'temporary',
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
    },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      radius: { type: Number, default: 5 },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    participants: [VoiceParticipantSchema],
    maxParticipants: {
      type: Number,
      default: 10,
    },
    status: {
      type: String,
      enum: ['active', 'ended'],
      default: 'active',
    },
    endedAt: Date,
    accessCode: {
      type: String,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    allowedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

VoiceRoomSchema.index({ status: 1, type: 1 });
VoiceRoomSchema.index({ roomId: 1 });
VoiceRoomSchema.index({ 'participants.userId': 1 });

const VoiceRoom: Model<IVoiceRoom> = mongoose.model<IVoiceRoom>('VoiceRoom', VoiceRoomSchema);
export default VoiceRoom;
