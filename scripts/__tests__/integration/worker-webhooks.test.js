/**
 * Integration tests for Clerk webhook handling in the worker
 *
 * Tests the full webhook flow with mocked KV storage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockEnv, MockKV } from '../mocks/kv-storage.js';
import {
  createUserCreatedEvent,
  createUserDeletedEvent,
  createSubscriptionCreatedEvent,
  createSubscriptionUpdatedEvent,
  createSubscriptionCanceledEvent,
  createInvoicePaidEvent,
  createInvoicePaymentFailedEvent,
  createUnknownEvent
} from '../mocks/clerk-webhooks.js';

// ============== Worker Handler (extracted from worker/index.js) ==============

function prefixKey(env, key) {
  const prefix = env.APP_DOMAIN || '__APP_DOMAIN__';
  return `${prefix}:${key}`;
}

async function handleClerkWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json();
    const eventType = body.type;
    const data = body.data;

    // User events
    if (eventType === 'user.created') {
      const user = {
        id: data.id,
        email: data.email_addresses?.[0]?.email_address,
        firstName: data.first_name,
        lastName: data.last_name,
        createdAt: new Date().toISOString()
      };

      await env.TENANTS.put(prefixKey(env, `user:${data.id}`), JSON.stringify(user));

      const count = parseInt(await env.TENANTS.get(prefixKey(env, 'stats:userCount')) || '0');
      await env.TENANTS.put(prefixKey(env, 'stats:userCount'), String(count + 1));
    }

    if (eventType === 'user.deleted') {
      await env.TENANTS.delete(prefixKey(env, `user:${data.id}`));

      const count = parseInt(await env.TENANTS.get(prefixKey(env, 'stats:userCount')) || '0');
      await env.TENANTS.put(prefixKey(env, 'stats:userCount'), String(Math.max(0, count - 1)));
    }

    if (eventType === 'subscription.created') {
      await handleSubscriptionCreated(env, data);
    }

    if (eventType === 'subscription.updated') {
      await handleSubscriptionUpdated(env, data);
    }

    if (eventType === 'subscription.canceled') {
      await handleSubscriptionCanceled(env, data);
    }

    if (eventType === 'invoice.paid') {
      await handleInvoicePaid(env, data);
    }

    if (eventType === 'invoice.payment_failed') {
      await handleInvoicePaymentFailed(env, data);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleSubscriptionCreated(env, data) {
  const userId = data.user_id || data.subscriber_id;
  const subscription = {
    id: data.id,
    status: data.status || 'active',
    planId: data.plan_id,
    billingPeriod: data.billing_period || 'monthly',
    amount: data.amount,
    createdAt: data.created_at || Date.now(),
    currentPeriodEnd: data.current_period_end
  };

  await env.TENANTS.put(prefixKey(env, `subscription:${userId}`), JSON.stringify(subscription));
  await updateTenantSubscriptionStatus(env, userId, 'active', subscription.billingPeriod);

  const countStr = await env.TENANTS.get(prefixKey(env, 'stats:subscriberCount')) || '0';
  await env.TENANTS.put(prefixKey(env, 'stats:subscriberCount'), String(parseInt(countStr) + 1));

  await updateMRR(env);
}

async function handleSubscriptionUpdated(env, data) {
  const userId = data.user_id || data.subscriber_id;
  const existingStr = await env.TENANTS.get(prefixKey(env, `subscription:${userId}`));
  const existing = existingStr ? JSON.parse(existingStr) : {};

  const subscription = {
    ...existing,
    id: data.id,
    status: data.status,
    planId: data.plan_id,
    billingPeriod: data.billing_period || existing.billingPeriod,
    amount: data.amount,
    updatedAt: Date.now(),
    currentPeriodEnd: data.current_period_end
  };

  await env.TENANTS.put(prefixKey(env, `subscription:${userId}`), JSON.stringify(subscription));

  const tenantStatus = subscription.status === 'active' ? 'active' :
                       subscription.status === 'past_due' ? 'past_due' : 'canceled';
  await updateTenantSubscriptionStatus(env, userId, tenantStatus, subscription.billingPeriod);

  await updateMRR(env);
}

async function handleSubscriptionCanceled(env, data) {
  const userId = data.user_id || data.subscriber_id;

  const existingStr = await env.TENANTS.get(prefixKey(env, `subscription:${userId}`));
  if (existingStr) {
    const subscription = JSON.parse(existingStr);
    subscription.status = 'canceled';
    subscription.canceledAt = Date.now();
    await env.TENANTS.put(prefixKey(env, `subscription:${userId}`), JSON.stringify(subscription));
  }

  await updateTenantSubscriptionStatus(env, userId, 'canceled');

  const countStr = await env.TENANTS.get(prefixKey(env, 'stats:subscriberCount')) || '1';
  await env.TENANTS.put(prefixKey(env, 'stats:subscriberCount'), String(Math.max(0, parseInt(countStr) - 1)));

  await updateMRR(env);
}

async function handleInvoicePaid(env, data) {
  const userId = data.user_id || data.subscriber_id;

  const invoice = {
    id: data.id,
    userId,
    amount: data.amount_paid || data.total,
    currency: data.currency || 'usd',
    paidAt: data.paid_at || Date.now(),
    status: 'paid'
  };

  await env.TENANTS.put(prefixKey(env, `invoice:${invoice.id}`), JSON.stringify(invoice));

  const monthKey = new Date().toISOString().slice(0, 7);
  const revenueStr = await env.TENANTS.get(prefixKey(env, `revenue:${monthKey}`)) || '0';
  const newRevenue = parseInt(revenueStr) + (invoice.amount || 0);
  await env.TENANTS.put(prefixKey(env, `revenue:${monthKey}`), String(newRevenue));
}

async function handleInvoicePaymentFailed(env, data) {
  const userId = data.user_id || data.subscriber_id;
  await updateTenantSubscriptionStatus(env, userId, 'past_due');
}

async function updateTenantSubscriptionStatus(env, userId, status, billingPeriod = null) {
  const listStr = await env.TENANTS.get(prefixKey(env, 'tenants:list')) || '[]';
  const subdomains = JSON.parse(listStr);

  for (const subdomain of subdomains) {
    const tenantStr = await env.TENANTS.get(prefixKey(env, `tenant:${subdomain}`));
    if (tenantStr) {
      const tenant = JSON.parse(tenantStr);
      if (tenant.userId === userId) {
        tenant.subscriptionStatus = status;
        if (billingPeriod) tenant.billingPeriod = billingPeriod;
        tenant.subscriptionUpdatedAt = Date.now();
        await env.TENANTS.put(prefixKey(env, `tenant:${subdomain}`), JSON.stringify(tenant));
        break;
      }
    }
  }
}

async function updateMRR(env) {
  const listStr = await env.TENANTS.get(prefixKey(env, 'tenants:list')) || '[]';
  const subdomains = JSON.parse(listStr);

  let mrr = 0;
  const monthlyPrice = parseInt(env.MONTHLY_PRICE || '9', 10);
  const yearlyPrice = parseInt(env.YEARLY_PRICE || '89', 10);

  for (const subdomain of subdomains) {
    const tenantStr = await env.TENANTS.get(prefixKey(env, `tenant:${subdomain}`));
    if (tenantStr) {
      const tenant = JSON.parse(tenantStr);
      if (tenant.subscriptionStatus === 'active') {
        if (tenant.billingPeriod === 'yearly') {
          mrr += yearlyPrice / 12;
        } else {
          mrr += monthlyPrice;
        }
      }
    }
  }

  await env.TENANTS.put(prefixKey(env, 'stats:mrr'), String(Math.round(mrr * 100) / 100));
}

// ============== Tests ==============

describe('Worker Webhook Handling', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
  });

  describe('user.created', () => {
    it('stores user in KV', async () => {
      const { request } = createUserCreatedEvent({
        userId: 'user_123',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith'
      });

      const response = await handleClerkWebhook(request, env);
      const result = await response.json();

      expect(result.received).toBe(true);

      const userStr = await env.TENANTS.get(prefixKey(env, 'user:user_123'));
      const user = JSON.parse(userStr);

      expect(user.id).toBe('user_123');
      expect(user.email).toBe('alice@example.com');
      expect(user.firstName).toBe('Alice');
    });

    it('increments user count', async () => {
      // Set initial count
      await env.TENANTS.put(prefixKey(env, 'stats:userCount'), '5');

      const { request } = createUserCreatedEvent({ userId: 'user_new' });
      await handleClerkWebhook(request, env);

      const count = await env.TENANTS.get(prefixKey(env, 'stats:userCount'));
      expect(count).toBe('6');
    });

    it('starts count at 1 when no previous users', async () => {
      const { request } = createUserCreatedEvent({ userId: 'user_first' });
      await handleClerkWebhook(request, env);

      const count = await env.TENANTS.get(prefixKey(env, 'stats:userCount'));
      expect(count).toBe('1');
    });
  });

  describe('user.deleted', () => {
    it('removes user from KV', async () => {
      // Create user first
      await env.TENANTS.put(prefixKey(env, 'user:user_del'), JSON.stringify({ id: 'user_del' }));
      await env.TENANTS.put(prefixKey(env, 'stats:userCount'), '3');

      const { request } = createUserDeletedEvent({ userId: 'user_del' });
      const response = await handleClerkWebhook(request, env);
      const result = await response.json();

      expect(result.received).toBe(true);

      const userStr = await env.TENANTS.get(prefixKey(env, 'user:user_del'));
      expect(userStr).toBeNull();
    });

    it('decrements user count', async () => {
      await env.TENANTS.put(prefixKey(env, 'stats:userCount'), '5');

      const { request } = createUserDeletedEvent({ userId: 'user_gone' });
      await handleClerkWebhook(request, env);

      const count = await env.TENANTS.get(prefixKey(env, 'stats:userCount'));
      expect(count).toBe('4');
    });

    it('does not go below zero', async () => {
      await env.TENANTS.put(prefixKey(env, 'stats:userCount'), '0');

      const { request } = createUserDeletedEvent({ userId: 'user_x' });
      await handleClerkWebhook(request, env);

      const count = await env.TENANTS.get(prefixKey(env, 'stats:userCount'));
      expect(count).toBe('0');
    });
  });

  describe('subscription.created', () => {
    it('stores subscription in KV', async () => {
      const { request } = createSubscriptionCreatedEvent({
        subscriptionId: 'sub_123',
        userId: 'user_sub',
        planId: 'pro',
        amount: 900
      });

      await handleClerkWebhook(request, env);

      const subStr = await env.TENANTS.get(prefixKey(env, 'subscription:user_sub'));
      const sub = JSON.parse(subStr);

      expect(sub.id).toBe('sub_123');
      expect(sub.planId).toBe('pro');
      expect(sub.status).toBe('active');
    });

    it('increments subscriber count', async () => {
      await env.TENANTS.put(prefixKey(env, 'stats:subscriberCount'), '2');

      const { request } = createSubscriptionCreatedEvent({ userId: 'user_new_sub' });
      await handleClerkWebhook(request, env);

      const count = await env.TENANTS.get(prefixKey(env, 'stats:subscriberCount'));
      expect(count).toBe('3');
    });

    it('updates tenant subscription status', async () => {
      // Create tenant first
      await env.TENANTS.put(prefixKey(env, 'tenants:list'), JSON.stringify(['alice']));
      await env.TENANTS.put(prefixKey(env, 'tenant:alice'), JSON.stringify({
        subdomain: 'alice',
        userId: 'user_alice'
      }));

      const { request } = createSubscriptionCreatedEvent({
        userId: 'user_alice',
        billingPeriod: 'monthly'
      });
      await handleClerkWebhook(request, env);

      const tenantStr = await env.TENANTS.get(prefixKey(env, 'tenant:alice'));
      const tenant = JSON.parse(tenantStr);

      expect(tenant.subscriptionStatus).toBe('active');
      expect(tenant.billingPeriod).toBe('monthly');
    });

    it('updates MRR correctly for monthly subscription', async () => {
      // Create subscribing tenant
      await env.TENANTS.put(prefixKey(env, 'tenants:list'), JSON.stringify(['bob']));
      await env.TENANTS.put(prefixKey(env, 'tenant:bob'), JSON.stringify({
        subdomain: 'bob',
        userId: 'user_bob',
        subscriptionStatus: 'active',
        billingPeriod: 'monthly'
      }));

      await updateMRR(env);

      const mrr = await env.TENANTS.get(prefixKey(env, 'stats:mrr'));
      expect(parseFloat(mrr)).toBe(9); // Default monthly price
    });

    it('updates MRR correctly for yearly subscription', async () => {
      await env.TENANTS.put(prefixKey(env, 'tenants:list'), JSON.stringify(['yearly']));
      await env.TENANTS.put(prefixKey(env, 'tenant:yearly'), JSON.stringify({
        subdomain: 'yearly',
        userId: 'user_yearly',
        subscriptionStatus: 'active',
        billingPeriod: 'yearly'
      }));

      await updateMRR(env);

      const mrr = await env.TENANTS.get(prefixKey(env, 'stats:mrr'));
      expect(parseFloat(mrr)).toBeCloseTo(89 / 12, 2); // Yearly divided by 12
    });
  });

  describe('subscription.canceled', () => {
    it('marks subscription as canceled', async () => {
      // Create subscription first
      await env.TENANTS.put(prefixKey(env, 'subscription:user_cancel'), JSON.stringify({
        id: 'sub_cancel',
        status: 'active'
      }));
      await env.TENANTS.put(prefixKey(env, 'stats:subscriberCount'), '3');

      const { request } = createSubscriptionCanceledEvent({ userId: 'user_cancel' });
      await handleClerkWebhook(request, env);

      const subStr = await env.TENANTS.get(prefixKey(env, 'subscription:user_cancel'));
      const sub = JSON.parse(subStr);

      expect(sub.status).toBe('canceled');
      expect(sub.canceledAt).toBeDefined();
    });

    it('decrements subscriber count', async () => {
      await env.TENANTS.put(prefixKey(env, 'stats:subscriberCount'), '5');

      const { request } = createSubscriptionCanceledEvent({ userId: 'user_unsub' });
      await handleClerkWebhook(request, env);

      const count = await env.TENANTS.get(prefixKey(env, 'stats:subscriberCount'));
      expect(count).toBe('4');
    });

    it('updates tenant status to canceled', async () => {
      await env.TENANTS.put(prefixKey(env, 'tenants:list'), JSON.stringify(['canceler']));
      await env.TENANTS.put(prefixKey(env, 'tenant:canceler'), JSON.stringify({
        subdomain: 'canceler',
        userId: 'user_canceler',
        subscriptionStatus: 'active'
      }));

      const { request } = createSubscriptionCanceledEvent({ userId: 'user_canceler' });
      await handleClerkWebhook(request, env);

      const tenantStr = await env.TENANTS.get(prefixKey(env, 'tenant:canceler'));
      const tenant = JSON.parse(tenantStr);

      expect(tenant.subscriptionStatus).toBe('canceled');
    });
  });

  describe('invoice.paid', () => {
    it('stores invoice in KV', async () => {
      const { request } = createInvoicePaidEvent({
        invoiceId: 'inv_123',
        userId: 'user_payer',
        amount: 2900
      });

      await handleClerkWebhook(request, env);

      const invStr = await env.TENANTS.get(prefixKey(env, 'invoice:inv_123'));
      const invoice = JSON.parse(invStr);

      expect(invoice.id).toBe('inv_123');
      expect(invoice.amount).toBe(2900);
      expect(invoice.status).toBe('paid');
    });

    it('updates monthly revenue', async () => {
      const monthKey = new Date().toISOString().slice(0, 7);
      await env.TENANTS.put(prefixKey(env, `revenue:${monthKey}`), '5000');

      const { request } = createInvoicePaidEvent({ amount: 900 });
      await handleClerkWebhook(request, env);

      const revenue = await env.TENANTS.get(prefixKey(env, `revenue:${monthKey}`));
      expect(parseInt(revenue)).toBe(5900);
    });
  });

  describe('invoice.payment_failed', () => {
    it('marks tenant as past_due', async () => {
      await env.TENANTS.put(prefixKey(env, 'tenants:list'), JSON.stringify(['delinquent']));
      await env.TENANTS.put(prefixKey(env, 'tenant:delinquent'), JSON.stringify({
        subdomain: 'delinquent',
        userId: 'user_delinquent',
        subscriptionStatus: 'active'
      }));

      const { request } = createInvoicePaymentFailedEvent({ userId: 'user_delinquent' });
      await handleClerkWebhook(request, env);

      const tenantStr = await env.TENANTS.get(prefixKey(env, 'tenant:delinquent'));
      const tenant = JSON.parse(tenantStr);

      expect(tenant.subscriptionStatus).toBe('past_due');
    });
  });

  describe('unknown events', () => {
    it('returns success for unknown event types', async () => {
      const { request } = createUnknownEvent();

      const response = await handleClerkWebhook(request, env);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.received).toBe(true);
    });

    it('does not modify KV for unknown events', async () => {
      const initialData = env.TENANTS.getData();

      const { request } = createUnknownEvent();
      await handleClerkWebhook(request, env);

      const finalData = env.TENANTS.getData();
      expect(finalData).toEqual(initialData);
    });
  });

  describe('error handling', () => {
    it('rejects non-POST requests', async () => {
      const request = {
        method: 'GET',
        json: async () => ({})
      };

      const response = await handleClerkWebhook(request, env);
      expect(response.status).toBe(405);
    });

    it('returns 500 for invalid JSON', async () => {
      const request = {
        method: 'POST',
        json: async () => { throw new Error('Invalid JSON'); }
      };

      const response = await handleClerkWebhook(request, env);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.error).toBeDefined();
    });
  });
});
