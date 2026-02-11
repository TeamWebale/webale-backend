import express from 'express';
import { auth } from '../middleware/auth.js';
import {
  createPledge,
  cancelPledge,
  markPledgeAsPaid,
  addManualContribution,
  getGroupPledges,
  getUserNotificationPreferences,
  updateNotificationPreferences,
} from '../controllers/pledgeController.js';

const router = express.Router();

router.post('/:groupId/pledge', auth, createPledge);
router.delete('/:groupId/pledge/:pledgeId', auth, cancelPledge);
router.put('/:groupId/pledge/:pledgeId/paid', auth, markPledgeAsPaid);
router.post('/:groupId/contribution', auth, addManualContribution);
router.get('/:groupId/pledges', auth, getGroupPledges);
router.get('/preferences', auth, getUserNotificationPreferences);
router.put('/preferences', auth, updateNotificationPreferences);

export default router;