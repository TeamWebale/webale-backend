import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Get payment methods available
router.get('/methods', auth, async (req, res) => {
  res.json({
    success: true,
    data: {
      methods: [
        {
          id: 'mobile_money',
          name: 'Mobile Money',
          providers: ['mtn', 'airtel', 'africell', 'mpesa'],
          enabled: true
        },
        {
          id: 'card',
          name: 'Card Payment',
          providers: ['visa', 'mastercard'],
          enabled: true
        },
        {
          id: 'bank_transfer',
          name: 'Bank Transfer',
          enabled: true
        }
      ]
    }
  });
});

// Initiate a payment
router.post('/initiate', auth, async (req, res) => {
  try {
    const { pledgeId, groupId, amount, method, details } = req.body;

    // Validate pledge exists and belongs to user
    const pledgeCheck = await db.query(
      'SELECT * FROM pledges WHERE id = $1 AND user_id = $2',
      [pledgeId, req.user.id]
    );

    if (pledgeCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pledge not found' });
    }

    const pledge = pledgeCheck.rows[0];
    const remaining = parseFloat(pledge.amount) - parseFloat(pledge.amount_paid || 0);

    if (amount > remaining) {
      return res.status(400).json({ success: false, message: 'Amount exceeds remaining balance' });
    }

    // Create payment transaction
    const transactionId = `TXN${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

    const result = await db.query(
      `INSERT INTO payment_transactions 
       (group_id, pledge_id, user_id, amount, currency, payment_method, payment_provider, transaction_id, status, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, NOW())
       RETURNING *`,
      [
        groupId,
        pledgeId,
        req.user.id,
        amount,
        pledge.currency || 'USD',
        method,
        details?.provider || null,
        transactionId,
        JSON.stringify(details || {})
      ]
    );

    // In production, initiate actual payment here based on method
    // For mobile money: call MTN/Airtel API
    // For card: create Stripe PaymentIntent
    // For bank transfer: generate reference

    res.json({
      success: true,
      data: {
        transaction: result.rows[0],
        paymentUrl: null, // For redirect-based payments
        instructions: method === 'bank_transfer' ? {
          bankName: 'Standard Chartered',
          accountName: 'Webale Fundraising',
          accountNumber: '1234567890',
          reference: transactionId
        } : null
      }
    });
  } catch (error) {
    console.error('Initiate payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate payment' });
  }
});

// Process/verify a payment
router.post('/verify/:transactionId', auth, async (req, res) => {
  try {
    const { transactionId } = req.params;

    // Get transaction
    const txnResult = await db.query(
      'SELECT * FROM payment_transactions WHERE transaction_id = $1 AND user_id = $2',
      [transactionId, req.user.id]
    );

    if (txnResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const transaction = txnResult.rows[0];

    // In production, verify with payment provider here
    // For demo, we'll mark as completed

    // Update transaction status
    await db.query(
      `UPDATE payment_transactions 
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1`,
      [transaction.id]
    );

    // Update pledge amount_paid
    await db.query(
      `UPDATE pledges 
       SET amount_paid = COALESCE(amount_paid, 0) + $1,
           status = CASE 
             WHEN COALESCE(amount_paid, 0) + $1 >= amount THEN 'paid'
             WHEN COALESCE(amount_paid, 0) + $1 > 0 THEN 'partial'
             ELSE status
           END,
           paid_at = CASE 
             WHEN COALESCE(amount_paid, 0) + $1 >= amount THEN NOW()
             ELSE paid_at
           END
       WHERE id = $2`,
      [transaction.amount, transaction.pledge_id]
    );

    // Update group current_amount
    await db.query(
      `UPDATE groups 
       SET current_amount = COALESCE(current_amount, 0) + $1
       WHERE id = $2`,
      [transaction.amount, transaction.group_id]
    );

    res.json({
      success: true,
      data: {
        status: 'completed',
        transactionId,
        amount: transaction.amount
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
});

// Get payment history
router.get('/history', auth, async (req, res) => {
  try {
    const { groupId, pledgeId, limit = 50 } = req.query;

    let query = `
      SELECT 
        pt.*,
        g.name as group_name,
        g.currency as group_currency
      FROM payment_transactions pt
      JOIN groups g ON pt.group_id = g.id
      WHERE pt.user_id = $1
    `;
    const params = [req.user.id];

    if (groupId) {
      query += ` AND pt.group_id = $${params.length + 1}`;
      params.push(groupId);
    }

    if (pledgeId) {
      query += ` AND pt.pledge_id = $${params.length + 1}`;
      params.push(pledgeId);
    }

    query += ` ORDER BY pt.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);

    // Calculate totals
    const totals = await db.query(
      `SELECT 
         COUNT(*) as total_transactions,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) as total_paid,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as total_pending
       FROM payment_transactions
       WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        payments: result.rows,
        summary: totals.rows[0]
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get payment history' });
  }
});

// Mobile Money specific - initiate STK push (for M-Pesa, MTN MoMo)
router.post('/mobile-money/initiate', auth, async (req, res) => {
  try {
    const { pledgeId, groupId, amount, provider, phoneNumber } = req.body;

    // Validate phone number format
    const cleanPhone = phoneNumber.replace(/[^0-9+]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    // Create pending transaction
    const transactionId = `MM${Date.now()}`;
    
    await db.query(
      `INSERT INTO payment_transactions 
       (group_id, pledge_id, user_id, amount, currency, payment_method, payment_provider, transaction_id, status, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'UGX', 'mobile_money', $5, $6, 'pending', $7, NOW())`,
      [
        groupId,
        pledgeId,
        req.user.id,
        amount,
        provider,
        transactionId,
        JSON.stringify({ phone: cleanPhone })
      ]
    );

    // In production, call mobile money API here
    // MTN MoMo: POST to /collection/v1_0/requesttopay
    // Airtel Money: POST to /merchant/v1/payments

    res.json({
      success: true,
      data: {
        transactionId,
        status: 'pending',
        message: `A payment prompt has been sent to ${cleanPhone}. Please enter your PIN to confirm.`
      }
    });
  } catch (error) {
    console.error('Mobile money initiate error:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate mobile money payment' });
  }
});

// Check mobile money payment status
router.get('/mobile-money/status/:transactionId', auth, async (req, res) => {
  try {
    const { transactionId } = req.params;

    const result = await db.query(
      'SELECT * FROM payment_transactions WHERE transaction_id = $1 AND user_id = $2',
      [transactionId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // In production, check status with mobile money provider

    res.json({
      success: true,
      data: {
        status: result.rows[0].status,
        transaction: result.rows[0]
      }
    });
  } catch (error) {
    console.error('Check status error:', error);
    res.status(500).json({ success: false, message: 'Failed to check payment status' });
  }
});

// Webhook for payment provider callbacks
router.post('/webhook/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const payload = req.body;

    console.log(`Payment webhook received from ${provider}:`, payload);

    // Verify webhook signature based on provider
    // Update transaction status
    // Update pledge and group amounts if successful

    res.json({ success: true, received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false });
  }
});

export default router;
