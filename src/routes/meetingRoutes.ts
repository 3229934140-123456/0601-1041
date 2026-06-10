import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  createMeeting,
  getMeetings,
  getMeetingById,
  updateMeeting,
  deleteMeeting,
  startMeeting,
  endMeeting,
  joinMeeting,
  leaveMeeting,
  addTimelineEvent,
  addSharedFile,
  addActionItem,
  updateActionItem,
  addAttendees,
  updateAttendeeStatus,
  sendMeetingReminder,
  generateMeetingSummary,
} from '../controllers/meetingController';

const router = Router();

router.use(protect);

router.get('/', getMeetings);
router.get('/:id', getMeetingById);
router.post('/', createMeeting);
router.patch('/:id', updateMeeting);
router.delete('/:id', deleteMeeting);

router.post('/:id/start', startMeeting);
router.post('/:id/end', endMeeting);
router.post('/:id/summary', generateMeetingSummary);

router.post('/join', joinMeeting);
router.post('/leave', leaveMeeting);
router.post('/attendee-status', updateAttendeeStatus);
router.post('/attendees', addAttendees);
router.post('/reminder', sendMeetingReminder);

router.post('/timeline', addTimelineEvent);
router.post('/files', addSharedFile);
router.post('/action-items', addActionItem);
router.patch('/action-items', updateActionItem);

export default router;
