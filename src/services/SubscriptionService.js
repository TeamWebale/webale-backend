/**
 * SubscriptionService.js — src/services/SubscriptionService.js
 * Handles subscription checks, free pledge tracking, and subscription management
 * Model: $1/month per group, billed quarterly ($3/quarter)
 * Free tier: 3 pledges across all groups, then paywall per group
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const QUARTERLY_PRICE = 3.00;
const QUARTERLY_CURRENCY = 'USD';
const FREE_PLEDGE_LIMIT = 3;
const QUARTER_DAYS = 90;

class SubscriptionService {

  /**
   * Check if user can make a pledge/contribution in a specific group
   * Returns { allowed, reason, subscription, freePledgesRemaining }
   */
  async canPledge(userId, groupId) {
    // 1. Check if user has an active subscription for this group
    const subResult = await pool.query(
      `SELECT * FROM group_subscriptions 
       WHERE user_id = $1 AND group_id = $2 AND status = 'active' AND expires_at > NOW()`,
      [userId, groupId]
    );

    if (subResult.rows.length > 0) {
      return {
        allowed: true,
        reason: 'active_subscription',
        subscription: subResult.rows[0],
        freePledgesRemaining: 0,
      };
    }

    // 2. Check free pledges remaining
    const userResult = await pool.query(
      'SELECT free_pledges_remaining, total_pledges_made FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return { allowed: false, reason: 'user_not_found' };
    }

    const freePledges = userResult.rows[0].free_pledges_remaining ?? FREE_PLEDGE_LIMIT;

    if (freePledges > 0) {
      return {
        allowed: true,
        reason: 'free_pledge',
        freePledgesRemaining: freePledges,
      };
    }

    // 3. No subscription and no free pledges — paywall
    return {
      allowed: false,
      reason: 'subscription_required',
      freePledgesRemaining: 0,
      subscriptionPrice: QUARTERLY_PRICE,
      subscriptionCurrency: QUARTERLY_CURRENCY,
      message: `You've used your ${FREE_PLEDGE_LIMIT} free pledges. Subscribe for $${QUARTERLY_PRICE}/quarter to continue pledging in this group.`,
    };
  }

  /**
   * Decrement free pledge count after a successful pledge
   */
  async useFreesPledge(userId) {
    await pool.query(
      `UPDATE users SET 
         free_pledges_remaining = GREATEST(COALESCE(free_pledges_remaining, ${FREE_PLEDGE_LIMIT}) - 1, 0),
         total_pledges_made = COALESCE(total_pledges_made, 0) + 1
       WHERE id = $1`,
      [userId]
    );
  }

  /**
   * Increment total pledges (for subscribed users who don't use free pledges)
   */
  async incrementPledgeCount(userId) {
    await pool.query(
      'UPDATE users SET total_pledges_made = COALESCE(total_pledges_made, 0) + 1 WHERE id = $1',
      [userId]
    );
  }

  /**
   * Create or renew a group subscription
   */
  async subscribe(userId, groupId, paymentId = null) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + QUARTER_DAYS * 24 * 60 * 60 * 1000);

    // Upsert: create or update subscription
    const result = await pool.query(
      `INSERT INTO group_subscriptions (user_id, group_id, status, plan, amount, currency, payment_id, starts_at, expires_at, created_at)
       VALUES ($1, $2, 'active', 'quarterly', $3, $4, $5, NOW(), $6, NOW())
       ON CONFLICT (user_id, group_id)
       DO UPDATE SET status = 'active', payment_id = $5, starts_at = NOW(), expires_at = $6, amount = $3
       RETURNING *`,
      [userId, groupId, QUARTERLY_PRICE, QUARTERLY_CURRENCY, paymentId, expiresAt]
    );

    return result.rows[0];
  }

  /**
   * Get user's subscriptions across all groups
   */
  async getUserSubscriptions(userId) {
    const result = await pool.query(
      `SELECT gs.*, g.name as group_name, g.currency as group_currency
       FROM group_subscriptions gs
       JOIN groups g ON g.id = gs.group_id
       WHERE gs.user_id = $1
       ORDER BY gs.expires_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Get subscription status for a specific group
   */
  async getGroupSubscription(userId, groupId) {
    const result = await pool.query(
      `SELECT * FROM group_subscriptions 
       WHERE user_id = $1 AND group_id = $2`,
      [userId, groupId]
    );
    return result.rows[0] || null;
  }

  /**
   * Check and expire old subscriptions (run periodically)
   */
  async expireSubscriptions() {
    const result = await pool.query(
      `UPDATE group_subscriptions SET status = 'expired' 
       WHERE status = 'active' AND expires_at < NOW()
       RETURNING id, user_id, group_id`
    );
    return result.rows;
  }
}

export default new SubscriptionService();
