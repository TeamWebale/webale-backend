/**
 * MobileMoneyProvider.js — src/services/providers/MobileMoneyProvider.js
 * Handles MTN MoMo and Airtel Money Collection APIs
 * Supports: Uganda, Kenya, Ghana, Tanzania, Rwanda, Zambia, Cameroon
 */

import crypto from 'crypto';

// MTN MoMo API endpoints
const MTN_CONFIG = {
  sandbox: {
    baseUrl: 'https://sandbox.momodeveloper.mtn.com',
    tokenUrl: 'https://sandbox.momodeveloper.mtn.com/collection/token/',
    collectUrl: 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay',
    statusUrl: 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay',
  },
  production: {
    baseUrl: 'https://proxy.momoapi.mtn.com',
    tokenUrl: 'https://proxy.momoapi.mtn.com/collection/token/',
    collectUrl: 'https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay',
    statusUrl: 'https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay',
  }
};

// Airtel Money API endpoints
const AIRTEL_CONFIG = {
  sandbox: {
    baseUrl: 'https://openapiuat.airtel.africa',
    tokenUrl: 'https://openapiuat.airtel.africa/auth/oauth2/token',
    collectUrl: 'https://openapiuat.airtel.africa/merchant/v1/payments/',
    statusUrl: 'https://openapiuat.airtel.africa/standard/v1/payments/',
  },
  production: {
    baseUrl: 'https://openapi.airtel.africa',
    tokenUrl: 'https://openapi.airtel.africa/auth/oauth2/token',
    collectUrl: 'https://openapi.airtel.africa/merchant/v1/payments/',
    statusUrl: 'https://openapi.airtel.africa/standard/v1/payments/',
  }
};

// Country to currency mapping
const COUNTRY_CURRENCY = {
  UG: 'UGX', KE: 'KES', GH: 'GHS', TZ: 'TZS', RW: 'RWF',
  ZM: 'ZMW', CM: 'XAF', NG: 'NGN', MW: 'MWK', CD: 'CDF',
};

export class MobileMoneyProvider {
  constructor(network) {
    this.network = network; // 'mtn' or 'airtel'
    this.environment = process.env.MTN_MOMO_ENVIRONMENT || process.env.AIRTEL_ENVIRONMENT || 'sandbox';
  }

  /**
   * Get OAuth2 access token
   */
  async getAccessToken() {
    if (this.network === 'mtn') {
      return this._getMTNToken();
    } else if (this.network === 'airtel') {
      return this._getAirtelToken();
    }
    throw new Error(`Unsupported network: ${this.network}`);
  }

  async _getMTNToken() {
    const config = MTN_CONFIG[this.environment];
    const apiUser = process.env.MTN_MOMO_API_USER;
    const apiKey = process.env.MTN_MOMO_API_KEY;
    const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;

    if (!apiUser || !apiKey || !subscriptionKey) {
      throw new Error('MTN MoMo credentials not configured. Set MTN_MOMO_API_USER, MTN_MOMO_API_KEY, MTN_MOMO_SUBSCRIPTION_KEY in environment.');
    }

    const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`MTN token error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  async _getAirtelToken() {
    const config = AIRTEL_CONFIG[this.environment];
    const clientId = process.env.AIRTEL_CLIENT_ID;
    const clientSecret = process.env.AIRTEL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Airtel Money credentials not configured. Set AIRTEL_CLIENT_ID, AIRTEL_CLIENT_SECRET in environment.');
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Airtel token error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  /**
   * Initiate a collection (request payment from user)
   * @param {Object} params - { paymentId, amount, currency, phoneNumber, description, callbackUrl }
   * @returns {Object} - { providerRef, status, message, metadata }
   */
  async initiate({ paymentId, amount, currency, phoneNumber, description, callbackUrl }) {
    if (!phoneNumber) {
      throw new Error('Phone number is required for mobile money payments');
    }

    // Clean phone number (remove spaces, dashes, leading +)
    const cleanPhone = phoneNumber.replace(/[\s\-\+]/g, '');

    if (this.network === 'mtn') {
      return this._initiateMTN({ paymentId, amount, currency, phoneNumber: cleanPhone, description, callbackUrl });
    } else if (this.network === 'airtel') {
      return this._initiateAirtel({ paymentId, amount, currency, phoneNumber: cleanPhone, description, callbackUrl });
    }
    throw new Error(`Unsupported network: ${this.network}`);
  }

  async _initiateMTN({ paymentId, amount, currency, phoneNumber, description, callbackUrl }) {
    const config = MTN_CONFIG[this.environment];
    const token = await this.getAccessToken();
    const referenceId = crypto.randomUUID();
    const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
    const targetEnv = this.environment === 'sandbox' ? 'sandbox' : process.env.MTN_MOMO_TARGET_ENV || 'mtnglobal';

    const body = {
      amount: String(amount),
      currency: currency,
      externalId: String(paymentId),
      payer: {
        partyIdType: 'MSISDN',
        partyId: phoneNumber,
      },
      payerMessage: description || 'Webale fundraising payment',
      payeeNote: `Payment #${paymentId}`,
    };

    const response = await fetch(config.collectUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': targetEnv,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'Content-Type': 'application/json',
        'X-Callback-Url': callbackUrl,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok && response.status !== 202) {
      const err = await response.text();
      throw new Error(`MTN MoMo collection failed: ${response.status} - ${err}`);
    }

    return {
      providerRef: referenceId,
      status: 'processing',
      message: `Please check your phone (${phoneNumber}) and approve the payment of ${currency} ${amount}.`,
      metadata: { network: 'mtn', referenceId, phoneNumber },
    };
  }

  async _initiateAirtel({ paymentId, amount, currency, phoneNumber, description, callbackUrl }) {
    const config = AIRTEL_CONFIG[this.environment];
    const token = await this.getAccessToken();
    const referenceId = `webale-${paymentId}-${Date.now()}`;

    // Detect country from phone number or currency
    const countryCode = this._detectCountry(phoneNumber, currency);

    const body = {
      reference: referenceId,
      subscriber: {
        country: countryCode,
        currency: currency,
        msisdn: phoneNumber,
      },
      transaction: {
        amount: amount,
        country: countryCode,
        currency: currency,
        id: referenceId,
      },
    };

    const response = await fetch(config.collectUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Country': countryCode,
        'X-Currency': currency,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Airtel Money collection failed: ${response.status} - ${err}`);
    }

    const data = await response.json();

    return {
      providerRef: referenceId,
      status: 'processing',
      message: `Please check your phone (${phoneNumber}) and approve the payment of ${currency} ${amount}.`,
      metadata: { network: 'airtel', referenceId, phoneNumber, airtelResponse: data },
    };
  }

  /**
   * Check payment status with provider
   */
  async checkStatus(providerRef) {
    if (this.network === 'mtn') {
      return this._checkMTNStatus(providerRef);
    } else if (this.network === 'airtel') {
      return this._checkAirtelStatus(providerRef);
    }
  }

  async _checkMTNStatus(referenceId) {
    const config = MTN_CONFIG[this.environment];
    const token = await this.getAccessToken();
    const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
    const targetEnv = this.environment === 'sandbox' ? 'sandbox' : process.env.MTN_MOMO_TARGET_ENV || 'mtnglobal';

    const response = await fetch(`${config.statusUrl}/${referenceId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Target-Environment': targetEnv,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
    });

    if (!response.ok) {
      throw new Error(`MTN status check failed: ${response.status}`);
    }

    const data = await response.json();
    // MTN returns: { status: "SUCCESSFUL" | "FAILED" | "PENDING" }
    const statusMap = { SUCCESSFUL: 'successful', FAILED: 'failed', PENDING: 'processing' };

    return {
      providerRef: referenceId,
      status: statusMap[data.status] || 'processing',
      metadata: data,
    };
  }

  async _checkAirtelStatus(referenceId) {
    const config = AIRTEL_CONFIG[this.environment];
    const token = await this.getAccessToken();

    const response = await fetch(`${config.statusUrl}${referenceId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Airtel status check failed: ${response.status}`);
    }

    const data = await response.json();
    // Airtel returns: { data: { transaction: { status: "TS" | "TF" | "TP" } } }
    const statusMap = { TS: 'successful', TF: 'failed', TP: 'processing' };
    const airtelStatus = data?.data?.transaction?.status;

    return {
      providerRef: referenceId,
      status: statusMap[airtelStatus] || 'processing',
      metadata: data,
    };
  }

  /**
   * Verify webhook signature
   */
  verifyWebhook(body, headers) {
    if (this.network === 'mtn') {
      // MTN sandbox doesn't enforce signatures; production uses subscription key
      // For production, verify the callback URL matches and X-Reference-Id exists
      return true; // Simplified for sandbox; add signature check for production
    } else if (this.network === 'airtel') {
      // Airtel uses the callback URL + reference matching
      return true; // Simplified for sandbox
    }
    return false;
  }

  /**
   * Parse webhook body into standardized format
   */
  parseWebhook(body) {
    if (this.network === 'mtn') {
      // MTN callback body: { referenceId, status, financialTransactionId, ... }
      return {
        providerRef: body.externalId || body.referenceId,
        status: body.status === 'SUCCESSFUL' ? 'successful' : body.status === 'FAILED' ? 'failed' : 'processing',
        amount: body.amount,
        currency: body.currency,
        metadata: body,
      };
    } else if (this.network === 'airtel') {
      // Airtel callback body: { transaction: { id, status_code, ... } }
      const tx = body.transaction || body;
      return {
        providerRef: tx.id || tx.airtel_money_id,
        status: tx.status_code === 'TS' ? 'successful' : tx.status_code === 'TF' ? 'failed' : 'processing',
        amount: tx.amount,
        currency: tx.currency,
        metadata: body,
      };
    }
    return { providerRef: null, status: 'unknown', metadata: body };
  }

  /**
   * Detect country code from phone number or currency
   */
  _detectCountry(phone, currency) {
    // By phone prefix
    if (phone.startsWith('256')) return 'UG';
    if (phone.startsWith('254')) return 'KE';
    if (phone.startsWith('233')) return 'GH';
    if (phone.startsWith('255')) return 'TZ';
    if (phone.startsWith('250')) return 'RW';
    if (phone.startsWith('260')) return 'ZM';
    if (phone.startsWith('237')) return 'CM';
    if (phone.startsWith('234')) return 'NG';
    if (phone.startsWith('265')) return 'MW';

    // By currency fallback
    const currencyCountry = Object.entries(COUNTRY_CURRENCY).find(([, cur]) => cur === currency);
    return currencyCountry ? currencyCountry[0] : 'UG'; // Default Uganda
  }
}
