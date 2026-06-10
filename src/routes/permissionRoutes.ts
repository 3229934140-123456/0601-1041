import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  setSpacePermissions,
  grantUserSpaces,
  revokeUserSpaces,
  getUserPermissions,
  checkSpaceAccess,
  updateUserRole,
} from '../controllers/permissionController';

const router = Router();

router.use(protect);

router.post('/space-access', checkSpaceAccess);
router.get('/user/:userId', getUserPermissions);

router.use(restrictTo('admin', 'moderator'));

router.post('/spaces', setSpacePermissions);
router.post('/user-spaces/grant', grantUserSpaces);
router.post('/user-spaces/revoke', revokeUserSpaces);
router.post('/user-role', updateUserRole);

export default router;
