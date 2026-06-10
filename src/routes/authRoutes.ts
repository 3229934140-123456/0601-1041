import { Router } from 'express';
import { protect } from '../middleware/auth';
import {
  register,
  login,
  logout,
  getCurrentUser,
  updateProfile,
} from '../controllers/authController';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', protect, logout);
router.get('/me', protect, getCurrentUser);
router.patch('/me', protect, updateProfile);

export default router;
