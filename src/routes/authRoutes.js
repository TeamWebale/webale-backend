import express from 'express';
import { auth } from '../middleware/auth.js';
import {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  getUserProfile,
  sendOtp,
  verifyOtp
} from '../controllers/authController.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/me', auth, getMe);
router.put('/profile', auth, updateProfile);
router.put('/password', auth, changePassword);
router.get('/user/:userId', auth, getUserProfile);

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);

export default router;
