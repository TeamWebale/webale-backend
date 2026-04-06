/**
 * PaymentService.js — src/services/PaymentService.js
 * Unified payment abstraction layer for all providers
 * Supports: Mobile Money (MTN + Airtel), Flutterwave, PayPal, Stripe
 */

import { MobileMoneyProvider } from './providers/MobileMoneyProvider.js';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '2.5');

class PaymentService {
  constructor() {
    this.providers = {
      mtn_momo: new MobileMoneyProvider('mtn'),
      airtel_money: new MobileMoneyProvider('airtel'),
      // flutterwave: new FlutterwaveProvider(),  // Phase 2
      // paypal: new PayPalProvider(),              // Phase 3
      // stripe: new StripeProvider(),              // Phase 4
    };
  }

  /**
   * Calculate platform fee
   */
  calculateFee(amount) {
    const feeAmount = Math.round((amount * PLATFORM_FEE_PERCENT / 100) * 100) / 100;
    const netAmount = Math.round((amount - feeAmount) * 100) / 100;
    return { feePercent: PLATFORM_FEE_PERCENT, feeAmount, netAmount };
  }

  /**
   * Initiate a payment
   * @param {Object} params - { groupId, userId, pledgeId, amount, currency, provider, phoneNumber }
   * @returns {Object} - { paymentId, providerRef, status, message }
   */
  async initiate({ groupId, userId, pledgeId, amount, currency, provider, phoneNumber }) {
    // Validate provider
    const providerInstance = this.providers[provider];
    if (!providerInstance) {
      throw new Error(`Unsupported payment provider: ${provider}. Available: ${Object.keys(this.providers).join(', ')}`);
    }

    // Validate amount
    if (!amount || amount <= 0) {
      throw new Error('Payment amount must be greater than 0');
    }

    // Check for duplicate pending payment on same pledge
    if (pledgeId) {
      const existing = await pool.query(
        `SELECT id FROM payments WHERE pledge_id = $1 AND status IN ('pending', 'processing') AND created_at > NOW() - INTERVAL '30 minutes'`,
        [pledgeId]
      );
      if (existing.rows.length > 0) {
        throw new Error('A payment is already in progress for this pledge. Please wait or check your payment status.');
      }
    }

    // Calculate fee
    const { feePercent, feeAmount, netAmount } = this.calculateFee(amount);

    // Create payment record
    const paymentResult = await pool.query(
      `INSERT INTO payments (group_id, user_id, pledge_id, amount, currency, platform_fee, net_amount, provider, phone_number, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
       RETURNING id`,
      [groupId, userId, pledgeId || null, amount, currency, feeAmount, netAmount, provider, phoneNumber || null]
    );
    const paymentId = paymentResult.rows[0].id;

    try {
      // Call provider to initiate payment
      const providerResponse = await providerInstance.initiate({
        paymentId,
        amount,
        currency,
        phoneNumber,
        description: `Webale fundraising payment #${paymentId}`,
        callbackUrl: `${process.env.API_BASE_URL || 'https://webale-api.onrender.com'}/api/payments/webhook/${provider}`,
      });

      // Update payment with provider reference
      await pool.query(
        `UPDATE payments SET provider_ref = $1, status = 'processing', metadata = $2 WHERE id = $3`,
        [providerResponse.providerRef, JSON.stringify(providerResponse.metadata || {}), paymentId]
      );

      return {
        paymentId,
        providerRef: providerResponse.providerRef,
        status: 'processing',
        message: providerResponse.message || 'Payment initiated. Please check your phone to approve.',
      };
    } catch (err) {
      // Mark payment as failed
      await pool.query(
        `UPDATE payments SET status = 'failed', metadata = $1 WHERE id = $2`,
        [JSON.stringify({ error: err.message }), paymentId]
      );
      throw err;
    }
  }

  /**
   * Check payment status
   */
  async getStatus(paymentId) {
    const result = await pool.query(
      `SELECT p.*, u.first_name, u.last_name, g.name as group_name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       JOIN groups g ON g.id = p.group_id
       WHERE p.id = $1`,
      [paymentId]
    );
    if (result.rows.length === 0) throw new Error('Payment not found');
    return result.rows[0];
  }

  /**
   * Process webhook callback from provider
   */
  async handleWebhook(provider, body, headers) {
    const providerInstance = this.providers[provider];
    if (!providerInstance) throw new Error(`Unknown provider: ${provider}`);

    // Verify webhook signature
    const isValid = providerInstance.verifyWebhook(body, headers);
    if (!isValid) throw new Error('Invalid webhook signature');

    // Parse the webhook data
    const webhookData = providerInstance.parseWebhook(body);
    // webhookData = { providerRef, status, amount, currency, metadata }

    // Find the payment by provider reference
    const paymentResult = await pool.query(
      `SELECT * FROM payments WHERE provider_ref = $1`,
      [webhookData.providerRef]
    );
    if (paymentResult.rows.length === 0) {
      console.warn(`Webhook: payment not found for ref ${webhookData.providerRef}`);
      return { acknowledged: true, message: 'Payment not found (may be duplicate)' };
    }

    const payment = paymentResult.rows[0];

    // Idempotency: skip if already completed
    if (payment.status === 'completed') {
      return { acknowledged: true, message: 'Already processed' };
    }

    if (webhookData.status === 'successful' || webhookData.status === 'completed') {
      // Mark payment as completed
      await pool.query(
        `UPDATE payments SET status = 'completed', completed_at = NOW(), metadata = $1 WHERE id = $2`,
        [JSON.stringify({ ...JSON.parse(payment.metadata || '{}'), webhook: webhookData.metadata }), payment.id]
      );

      // Record platform fee
      await pool.query(
        `INSERT INTO platform_fees (payment_id, fee_percentage, fee_amount, currency, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [payment.id, parseFloat(process.env.PLATFORM_FEE_PERCENT || '2.5'), payment.platform_fee, payment.currency]
      );

      // Credit group: update current_amount
      await pool.query(
        `UPDATE groups SET current_amount = COALESCE(current_amount, 0) + $1 WHERE id = $2`,
        [payment.net_amount, payment.group_id]
      );

      // If linked to a pledge, mark pledge as paid
      if (payment.pledge_id) {
        await pool.query(
          `UPDATE pledges SET status = 'paid', fulfillment_date = NOW() WHERE id = $1`,
          [payment.pledge_id]
        );
      }

      // Send thank-you DM
      try {
        const group = await pool.query('SELECT name, created_by FROM groups WHERE id = $1', [payment.group_id]);
        const user = await pool.query('SELECT first_name FROM users WHERE id = $1', [payment.user_id]);
        if (group.rows[0] && user.rows[0]) {
          const adminId = group.rows[0].created_by;
          const dmContent = `Thank you ${user.rows[0].first_name}! Your payment of ${payment.currency} ${payment.amount} for ${group.rows[0].name} has been received and confirmed. Your support makes a real difference!`;
          await pool.query(
            `INSERT INTO messages (group_id, sender_id, recipient_id, content, message_type, is_read, created_at)
             VALUES ($1, $2, $3, $4, 'text', false, NOW())`,
            [payment.group_id, adminId, payment.user_id, dmContent]
          );
        }
      } catch (dmErr) {
        console.warn('Payment DM failed (non-blocking):', dmErr.message);
      }

      // Log activity
      try {
        await pool.query(
          `INSERT INTO activity_log (group_id, user_id, activity_type, description, created_at)
           VALUES ($1, $2, 'payment', $3, NOW())`,
          [payment.group_id, payment.user_id, `Payment of ${payment.currency} ${payment.amount} received via ${payment.provider}`]
        );
      } catch {}

      return { acknowledged: true, message: 'Payment completed successfully' };

    } else if (webhookData.status === 'failed') {
      await pool.query(
        `UPDATE payments SET status = 'failed', metadata = $1 WHERE id = $2`,
        [JSON.stringify({ ...JSON.parse(payment.metadata || '{}'), webhook: webhookData.metadata }), payment.id]
      );
      return { acknowledged: true, message: 'Payment failed' };
    }

    return { acknowledged: true, message: 'Webhook received' };
  }

  /**
   * Get payment history for a group
   */
  async getGroupPayments(groupId, limit = 50) {
    const result = await pool.query(
      `SELECT p.*, u.first_name, u.last_name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE p.group_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [groupId, limit]
    );
    return result.rows;
  }

  /**
   * Get payment history for a user
   */
  async getUserPayments(userId, limit = 50) {
    const result = await pool.query(
      `SELECT p.*, g.name as group_name
       FROM payments p
       JOIN groups g ON g.id = p.group_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }
}

export default new PaymentService();
