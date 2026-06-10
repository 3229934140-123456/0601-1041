import mongoose, { Schema, Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface IInvitation extends Document {
  code: string;
  inviterId: mongoose.Types.ObjectId;
  inviteeEmail?: string;
  inviteeName?: string;
  type: 'guest' | 'member';
  allowedSpaces: mongoose.Types.ObjectId[];
  expiresAt: Date;
  status: InvitationStatus;
  acceptedBy?: mongoose.Types.ObjectId;
  acceptedAt?: Date;
  maxUses: number;
  usedCount: number;
  message?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvitationSchema: Schema<IInvitation> = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase(),
    },
    inviterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    inviteeEmail: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, '请输入有效的邮箱地址'],
    },
    inviteeName: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ['guest', 'member'],
      default: 'guest',
    },
    allowedSpaces: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Space',
      },
    ],
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired', 'revoked'],
      default: 'pending',
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    acceptedAt: Date,
    maxUses: {
      type: Number,
      default: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    message: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

InvitationSchema.index({ code: 1 });
InvitationSchema.index({ inviterId: 1, status: 1 });
InvitationSchema.index({ status: 1, expiresAt: 1 });

InvitationSchema.pre('save', function (next) {
  if (this.expiresAt < new Date() && this.status === 'pending') {
    this.status = 'expired';
  }
  next();
});

const Invitation: Model<IInvitation> = mongoose.model<IInvitation>('Invitation', InvitationSchema);
export default Invitation;
