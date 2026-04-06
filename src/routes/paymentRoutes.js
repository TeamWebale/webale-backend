/**
 * paymentRoutes.js — src/routes/paymentRoutes.js
 * Payment API endpoints for all providers
 * IMPORTANT: Specific routes (/methods, /user/history, /group/:id) must come
 * BEFORE parameterized routes (/:id/status) to avoid Express matching "methods" as an id.
 */

import express from 'express';
import { auth } from '../middleware/auth.js';
import PaymentService from '../services/PaymentService.js';

const router = express.Router();

// ── POST /api/payments/initiate ────────────────────────────────────
router.post('/initiate', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { groupId, pledgeId, amount, currency, provider, phoneNumber } = req.body;

    if (!groupId || !amount || !currency || !provider) {
      return res.status(400).json({
        success: false,
        message: 'groupId, amount, currency, and provider are required',
      });
    }

    const recentAttempts = await PaymentService.getUserPayments(userId, 100);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = recentAttempts.filter(p => new Date(p.created_at) > oneHourAgo).length;
    if (recentCount >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many payment attempts. Please wait before trying again.',
      });
    }

    const result = await PaymentService.initiate({
      groupId,
      userId,
      pledgeId: pledgeId || null,
      amount: parseFloat(amount),
      currency,
      provider,
      phoneNumber,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('Payment initiate error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /api/payments/webhook/:provider ───────────────────────────
router.post('/webhook/:provider', async (req, res) => {
  try {
    const provider = req.params.provider;
    console.log(`Payment webhook from ${provider}:`, JSON.stringify(req.body).substring(0, 500));
    const result = await PaymentService.handleWebhook(provider, req.body, req.headers);
    res.json(result);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.json({ acknowledged: true, error: err.message });
  }
});

// ── GET /api/payments/methods ──────────────────────────────────────
router.get('/methods', auth, async (req, res) => {
  try {
    const { Pool } = (await import('pg')).default;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const result = await pool.query(
      'SELECT id, type, provider, details, is_default, created_at FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment methods' });
  }
});

// ── POST /api/payments/methods ─────────────────────────────────────
router.post('/methods', auth, async (req, res) => {
  try {
    const { type, provider, details } = req.body;
    if (!type || !details) {
      return res.status(400).json({ success: false, message: 'type and details are required' });
    }
    const { Pool } = (await import('pg')).default;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const result = await pool.query(
      `INSERT INTO payment_methods (user_id, type, provider, details, is_default, created_at)
       VALUES ($1, $2, $3, $4, false, NOW()) RETURNING id, type, provider, is_default, created_at`,
      [req.user.id, type, provider || null, JSON.stringify(details)]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save payment method' });
  }
});

// ── DELETE /api/payments/methods/:id ───────────────────────────────
router.delete('/methods/:id', auth, async (req, res) => {
  try {
    const { Pool } = (await import('pg')).default;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('DELETE FROM payment_methods WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Payment method removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove payment method' });
  }
});

// ── GET /api/payments/user/history ─────────────────────────────────
router.get('/user/history', auth, async (req, res) => {
  try {
    const payments = await PaymentService.getUserPayments(req.user.id);
    res.json({ success: true, data: payments });
  } catch (err) {
    console.error('User payments error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch payments' });
  }
});

// ── GET /api/payments/group/:groupId ───────────────────────────────
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const payments = await PaymentService.getGroupPayments(parseInt(req.params.groupId));
    res.json({ success: true, data: payments });
  } catch (err) {
    console.error('Group payments error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch payments' });
  }
});

// ── GET /api/payments/:id/status (MUST BE LAST - catches /:id) ────
router.get('/:id/status', auth, async (req, res) => {
  try {
    const payment = await PaymentService.getStatus(parseInt(req.params.id));

    if (String(payment.user_id) !== String(req.user.id)) {
      const { Pool } = (await import('pg')).default;
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      const adminCheck = await pool.query(
        `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [payment.group_id, req.user.id]
      );
      if (!adminCheck.rows[0] || adminCheck.rows[0].role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Not authorized to view this payment' });
      }
    }

    if (payment.status === 'processing' && payment.provider_ref) {
      try {
        const providerKey = payment.provider;
        const provider = PaymentService.providers[providerKey];
        if (provider && provider.checkStatus) {
          const providerStatus = await provider.checkStatus(payment.provider_ref);
          if (providerStatus.status !== 'processing') {
            await PaymentService.handleWebhook(providerKey, {
              referenceId: payment.provider_ref,
              externalId: payment.provider_ref,
              status: providerStatus.status === 'successful' ? 'SUCCESSFUL' : 'FAILED',
              ...providerStatus.metadata,
            }, {});
            const updated = await PaymentService.getStatus(parseInt(req.params.id));
            return res.json({ success: true, data: updated });
          }
        }
      } catch (pollErr) {
        console.warn('Provider status poll failed:', pollErr.message);
      }
    }

    res.json({ success: true, data: payment });
  } catch (err) {
    console.error('Payment status error:', err.message);
    res.status(404).json({ success: false, message: err.message });
  }
});

export default router;
