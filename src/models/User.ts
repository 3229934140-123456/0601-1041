import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'admin' | 'moderator' | 'member' | 'guest';
export type UserStatus = 'active' | 'banned' | 'inactive';
export type OnlineStatus = 'online' | 'offline' | 'busy' | 'away';

export interface IUser extends Document {
  email: string;
  password: string;
  displayName: string;
  avatar?: string;
  role: UserRole;
  status: UserStatus;
  onlineStatus: OnlineStatus;
  currentSpaceId?: mongoose.Types.ObjectId;
  currentRoomId?: mongoose.Types.ObjectId;
  currentSeatId?: mongoose.Types.ObjectId;
  allowedSpaces: mongoose.Types.ObjectId[];
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema: Schema<IUser> = new Schema(
  {
    email: {
      type: String,
      required: [true, '邮箱不能为空'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, '请输入有效的邮箱地址'],
    },
    password: {
      type: String,
      required: [true, '密码不能为空'],
      minlength: [6, '密码长度至少6位'],
      select: false,
    },
    displayName: {
      type: String,
      required: [true, '显示名称不能为空'],
      trim: true,
      maxlength: [50, '显示名称不能超过50个字符'],
    },
    avatar: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      enum: ['admin', 'moderator', 'member', 'guest'],
      default: 'member',
    },
    status: {
      type: String,
      enum: ['active', 'banned', 'inactive'],
      default: 'active',
    },
    onlineStatus: {
      type: String,
      enum: ['online', 'offline', 'busy', 'away'],
      default: 'offline',
    },
    currentSpaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
    },
    currentRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
    },
    currentSeatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seat',
    },
    allowedSpaces: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Space',
      },
    ],
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ onlineStatus: 1 });

const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);
export default User;
