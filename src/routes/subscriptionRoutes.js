/**
 * subscriptionRoutes.js — src/routes/subscriptionRoutes.js
 * Subscription management endpoints
 */

import express from 'express';
import { auth } from '../middleware/auth.js';
import SubscriptionService from '../services/SubscriptionService.js';

const router = express.Router();

// ── GET /api/subscriptions/check/:groupId ──────────────────────────
// Check if user can pledge in this group
router.get('/check/:groupId', auth, async (req, res) => {
  try {
    const result = await SubscriptionService.canPledge(req.user.id, parseInt(req.params.groupId));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Subscription check error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to check subscription status' });
  }
});

// ── POST /api/subscriptions/subscribe ──────────────────────────────
// Subscribe to a group (after payment)
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { groupId, paymentId } = req.body;
    if (!groupId) {
      return res.status(400).json({ success: false, message: 'groupId is required' });
    }

    const subscription = await SubscriptionService.subscribe(req.user.id, groupId, paymentId || null);
    res.json({
      success: true,
      message: 'Subscription activated! You can now make unlimited pledges in this group for the next 90 days.',
      data: subscription,
    });
  } catch (err) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to activate subscription' });
  }
});

// ── GET /api/subscriptions/my ──────────────────────────────────────
// Get all user's subscriptions
router.get('/my', auth, async (req, res) => {
  try {
    const subscriptions = await SubscriptionService.getUserSubscriptions(req.user.id);
    res.json({ success: true, data: subscriptions });
  } catch (err) {
    console.error('Get subscriptions error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch subscriptions' });
  }
});

// ── GET /api/subscriptions/group/:groupId ──────────────────────────
// Get subscription for specific group
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const sub = await SubscriptionService.getGroupSubscription(req.user.id, parseInt(req.params.groupId));
    res.json({ success: true, data: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch subscription' });
  }
});

export default router;
