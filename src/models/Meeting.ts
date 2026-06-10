import mongoose, { Schema, Document, Model } from 'mongoose';

export type MeetingStatus = 'scheduled' | 'in_progress' | 'ended' | 'cancelled';

export interface IMeetingTimelineEvent {
  id: string;
  type: 'start' | 'end' | 'join' | 'leave' | 'note' | 'file' | 'vote' | 'topic' | 'action';
  timestamp: Date;
  userId?: mongoose.Types.ObjectId;
  displayName?: string;
  content?: string;
  metadata?: Record<string, any>;
}

export interface ISharedFile {
  id: string;
  name: string;
  url: string;
  fileType: string;
  size?: number;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedAt: Date;
}

export interface IAttendee {
  userId: mongoose.Types.ObjectId;
  joinedAt?: Date;
  leftAt?: Date;
  durationMinutes?: number;
  status: 'invited' | 'accepted' | 'declined' | 'attended' | 'absent';
  reminderSent: boolean;
}

export interface IMeeting extends Document {
  title: string;
  description?: string;
  roomId: mongoose.Types.ObjectId;
  organizerId: mongoose.Types.ObjectId;
  status: MeetingStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStart?: Date;
  actualEnd?: Date;
  attendees: IAttendee[];
  timeline: IMeetingTimelineEvent[];
  sharedFiles: ISharedFile[];
  notes?: string;
  actionItems?: Array<{
    id: string;
    content: string;
    assigneeId?: mongoose.Types.ObjectId;
    dueDate?: Date;
    completed: boolean;
  }>;
  summary?: string;
  recordingUrl?: string;
  isRecurring: boolean;
  recurringRule?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingTimelineSchema: Schema<IMeetingTimelineEvent> = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['start', 'end', 'join', 'leave', 'note', 'file', 'vote', 'topic', 'action'],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    displayName: String,
    content: String,
    metadata: Schema.Types.Mixed,
  },
  {
    _id: false,
  }
);

const SharedFileSchema: Schema<ISharedFile> = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    fileType: { type: String, required: true },
    size: Number,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  {
    _id: false,
  }
);

const AttendeeSchema: Schema<IAttendee> = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    joinedAt: Date,
    leftAt: Date,
    durationMinutes: Number,
    status: {
      type: String,
      enum: ['invited', 'accepted', 'declined', 'attended', 'absent'],
      default: 'invited',
    },
    reminderSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

const MeetingSchema: Schema<IMeeting> = new Schema(
  {
    title: {
      type: String,
      required: [true, '会议标题不能为空'],
      trim: true,
      maxlength: [200, '会议标题不能超过200个字符'],
    },
    description: {
      type: String,
      trim: true,
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
    },
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'ended', 'cancelled'],
      default: 'scheduled',
    },
    scheduledStart: {
      type: Date,
      required: true,
    },
    scheduledEnd: {
      type: Date,
      required: true,
    },
    actualStart: Date,
    actualEnd: Date,
    attendees: [AttendeeSchema],
    timeline: [MeetingTimelineSchema],
    sharedFiles: [SharedFileSchema],
    notes: String,
    actionItems: [
      {
        id: String,
        content: String,
        assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        dueDate: Date,
        completed: { type: Boolean, default: false },
      },
    ],
    summary: String,
    recordingUrl: String,
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurringRule: String,
  },
  {
    timestamps: true,
  }
);

MeetingSchema.index({ roomId: 1, scheduledStart: 1 });
MeetingSchema.index({ organizerId: 1 });
MeetingSchema.index({ status: 1, scheduledStart: 1 });
MeetingSchema.index({ 'attendees.userId': 1 });

const Meeting: Model<IMeeting> = mongoose.model<IMeeting>('Meeting', MeetingSchema);
export default Meeting;
