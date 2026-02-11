import express from 'express';
import { auth } from '../middleware/auth.js';
import { getActivities, getGroupActivities } from '../controllers/activityController.js';

const router = express.Router();

router.get('/', auth, getActivities);
router.get('/group/:id', auth, getGroupActivities);

export default router;