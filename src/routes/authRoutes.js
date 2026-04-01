import express from 'express';
import { auth } from '../middleware/auth.js';
import {
  register, login, getMe, updateProfile, changePassword,
  getUserProfile, sendOtp, verifyOtp, deleteAccount
} from '../controllers/authController.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);

router.get('/me', auth, getMe);
router.put('/profile', auth, updateProfile);
router.put('/password', auth, changePassword);
router.delete('/account', auth, deleteAccount);
router.get('/user/:userId', auth, getUserProfile);

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);

export default router;
