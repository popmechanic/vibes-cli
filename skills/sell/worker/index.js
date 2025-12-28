/**
 * Cloudflare Worker for __APP_NAME__
 *
 * Handles:
 * - Wildcard subdomain proxying to Pages
 * - /api/tenants - List all tenants
 * - /api/stats - Get stats
 * - /api/tenants/register - Register tenant subdomain
 * - /webhooks/clerk - Clerk webhook handler
 *
 * Environment Variables (set in wrangler.toml or dashboard):
 * - PAGES_HOSTNAME: Your Pages project hostname (e.g., "myapp.pages.dev")
 * - APP_DOMAIN: Your app's root domain (e.g., "fantasy.wedding") - used as KV key prefix
 * - CLERK_SECRET_KEY: Your Clerk secret key (set via wrangler secret)
 *
 * KV Namespace:
 * - TENANTS: KV namespace for tenant data (keys prefixed with APP_DOMAIN)
 *
 * IMPORTANT: Each deployment MUST create its own KV namespace to avoid data collision.
 * KV keys are prefixed with APP_DOMAIN (e.g., "fantasy.wedding:tenant:alice")
 */

// Get domain prefix for KV keys (isolates data per deployment)
function getKeyPrefix(env) {
  return env.APP_DOMAIN || '__APP_DOMAIN__';
}

// Prefix a key with the domain
function prefixKey(env, key) {
  return `${getKeyPrefix(env)}:${key}`;
}

// Dynamic CORS headers (reflect origin for credentials support)
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const corsHeaders = getCorsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Handle API routes
    if (pathname.startsWith('/api/')) {
      return handleAPI(request, env, pathname, corsHeaders);
    }

    // Handle Clerk webhooks
    if (pathname === '/webhooks/clerk') {
      return handleClerkWebhook(request, env);
    }

    // Proxy to Pages
    return proxyToPages(request, env, url.hostname, corsHeaders);
  }
};

async function handleAPI(request, env, pathname, corsHeaders) {
  // Get all tenants
  if (pathname === '/api/tenants' && request.method === 'GET') {
    try {
      const listResult = await env.TENANTS.get(prefixKey(env, 'tenants:list'));
      const subdomains = listResult ? JSON.parse(listResult) : [];

      const tenants = [];
      for (const subdomain of subdomains) {
        const tenant = await env.TENANTS.get(prefixKey(env, `tenant:${subdomain}`));
        if (tenant) {
          tenants.push(JSON.parse(tenant));
        }
      }

      return new Response(JSON.stringify({ tenants }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Get stats (includes billing metrics)
  if (pathname === '/api/stats' && request.method === 'GET') {
    try {
      const [tenantCount, userCount, subscriberCount, mrr] = await Promise.all([
        env.TENANTS.get(prefixKey(env, 'stats:tenantCount')),
        env.TENANTS.get(prefixKey(env, 'stats:userCount')),
        env.TENANTS.get(prefixKey(env, 'stats:subscriberCount')),
        env.TENANTS.get(prefixKey(env, 'stats:mrr'))
      ]);

      return new Response(JSON.stringify({
        tenantCount: parseInt(tenantCount || '0'),
        userCount: parseInt(userCount || '0'),
        subscriberCount: parseInt(subscriberCount || '0'),
        mrr: parseFloat(mrr || '0')
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Register tenant (upsert - allows same user to re-register, blocks different user)
  if (pathname === '/api/tenants/register' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { subdomain, userId, email, plan } = body;

      if (!subdomain || !userId) {
        return new Response(JSON.stringify({ error: 'Missing subdomain or userId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Check if subdomain is taken by a DIFFERENT user
      const existingStr = await env.TENANTS.get(prefixKey(env, `tenant:${subdomain}`));
      if (existingStr) {
        const existing = JSON.parse(existingStr);
        if (existing.userId !== userId) {
          // Different user trying to claim this subdomain
          return new Response(JSON.stringify({ error: 'Subdomain already taken' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        // Same user - update lastVisit and return success
        existing.lastVisit = new Date().toISOString();
        if (email && !existing.email) existing.email = email;
        await env.TENANTS.put(prefixKey(env, `tenant:${subdomain}`), JSON.stringify(existing));
        return new Response(JSON.stringify({ success: true, tenant: existing, updated: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Create new tenant
      const tenant = {
        subdomain,
        userId,
        email,
        plan: plan || 'pro',
        status: 'active',
        createdAt: new Date().toISOString(),
        lastVisit: new Date().toISOString()
      };

      await env.TENANTS.put(prefixKey(env, `tenant:${subdomain}`), JSON.stringify(tenant));

      // Update tenant list
      const listResult = await env.TENANTS.get(prefixKey(env, 'tenants:list'));
      const subdomains = listResult ? JSON.parse(listResult) : [];
      if (!subdomains.includes(subdomain)) {
        subdomains.push(subdomain);
        await env.TENANTS.put(prefixKey(env, 'tenants:list'), JSON.stringify(subdomains));

        // Update count
        await env.TENANTS.put(prefixKey(env, 'stats:tenantCount'), String(subdomains.length));
      }

      return new Response(JSON.stringify({ success: true, tenant, created: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleClerkWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json();
    const eventType = body.type;
    const data = body.data;

    console.log(`Clerk webhook: ${eventType}`);

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

    // Billing events - Subscription lifecycle
    if (eventType === 'subscription.created') {
      await handleSubscriptionCreated(env, data);
    }

    if (eventType === 'subscription.updated') {
      await handleSubscriptionUpdated(env, data);
    }

    if (eventType === 'subscription.canceled') {
      await handleSubscriptionCanceled(env, data);
    }

    // Billing events - Invoices
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
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// === Billing Event Handlers ===

async function handleSubscriptionCreated(env, subscriptionData) {
  const userId = subscriptionData.user_id || subscriptionData.subscriber_id;
  const subscription = {
    id: subscriptionData.id,
    status: subscriptionData.status || 'active',
    planId: subscriptionData.plan_id,
    billingPeriod: subscriptionData.billing_period || 'monthly',
    amount: subscriptionData.amount,
    createdAt: subscriptionData.created_at || Date.now(),
    currentPeriodEnd: subscriptionData.current_period_end
  };

  // Store subscription
  await env.TENANTS.put(prefixKey(env, `subscription:${userId}`), JSON.stringify(subscription));

  // Update tenant's subscription status
  await updateTenantSubscriptionStatus(env, userId, 'active', subscription.billingPeriod);

  // Update subscriber count
  const countStr = await env.TENANTS.get(prefixKey(env, 'stats:subscriberCount')) || '0';
  await env.TENANTS.put(prefixKey(env, 'stats:subscriberCount'), String(parseInt(countStr) + 1));

  // Update MRR
  await updateMRR(env);
}

async function handleSubscriptionUpdated(env, subscriptionData) {
  const userId = subscriptionData.user_id || subscriptionData.subscriber_id;
  const existingStr = await env.TENANTS.get(prefixKey(env, `subscription:${userId}`));
  const existing = existingStr ? JSON.parse(existingStr) : {};

  const subscription = {
    ...existing,
    id: subscriptionData.id,
    status: subscriptionData.status,
    planId: subscriptionData.plan_id,
    billingPeriod: subscriptionData.billing_period || existing.billingPeriod,
    amount: subscriptionData.amount,
    updatedAt: Date.now(),
    currentPeriodEnd: subscriptionData.current_period_end
  };

  await env.TENANTS.put(prefixKey(env, `subscription:${userId}`), JSON.stringify(subscription));

  // Update tenant status based on subscription status
  const tenantStatus = subscription.status === 'active' ? 'active' :
                       subscription.status === 'past_due' ? 'past_due' : 'canceled';
  await updateTenantSubscriptionStatus(env, userId, tenantStatus, subscription.billingPeriod);

  await updateMRR(env);
}

async function handleSubscriptionCanceled(env, subscriptionData) {
  const userId = subscriptionData.user_id || subscriptionData.subscriber_id;

  // Update subscription status
  const existingStr = await env.TENANTS.get(prefixKey(env, `subscription:${userId}`));
  if (existingStr) {
    const subscription = JSON.parse(existingStr);
    subscription.status = 'canceled';
    subscription.canceledAt = Date.now();
    await env.TENANTS.put(prefixKey(env, `subscription:${userId}`), JSON.stringify(subscription));
  }

  // Update tenant status
  await updateTenantSubscriptionStatus(env, userId, 'canceled');

  // Update subscriber count
  const countStr = await env.TENANTS.get(prefixKey(env, 'stats:subscriberCount')) || '1';
  await env.TENANTS.put(prefixKey(env, 'stats:subscriberCount'), String(Math.max(0, parseInt(countStr) - 1)));

  await updateMRR(env);
}

async function handleInvoicePaid(env, invoiceData) {
  const userId = invoiceData.user_id || invoiceData.subscriber_id;

  const invoice = {
    id: invoiceData.id,
    userId,
    amount: invoiceData.amount_paid || invoiceData.total,
    currency: invoiceData.currency || 'usd',
    paidAt: invoiceData.paid_at || Date.now(),
    status: 'paid'
  };

  await env.TENANTS.put(prefixKey(env, `invoice:${invoice.id}`), JSON.stringify(invoice));

  // Track monthly revenue
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const revenueStr = await env.TENANTS.get(prefixKey(env, `revenue:${monthKey}`)) || '0';
  const newRevenue = parseInt(revenueStr) + (invoice.amount || 0);
  await env.TENANTS.put(prefixKey(env, `revenue:${monthKey}`), String(newRevenue));
}

async function handleInvoicePaymentFailed(env, invoiceData) {
  const userId = invoiceData.user_id || invoiceData.subscriber_id;
  await updateTenantSubscriptionStatus(env, userId, 'past_due');
}

// === Helper Functions ===

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
  // Prices from wrangler.toml env vars (set during assembly)
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

async function proxyToPages(request, env, hostname, corsHeaders) {
  // Construct Pages URL
  const pagesUrl = new URL(request.url);
  pagesUrl.hostname = env.PAGES_HOSTNAME || '__PAGES_PROJECT__.pages.dev';

  // Clone request with new URL
  const proxyRequest = new Request(pagesUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual'
  });

  const response = await fetch(proxyRequest);

  // Clone response with CORS headers
  const newHeaders = new Headers(response.headers);
  // Don't override CORS on HTML pages
  if (!newHeaders.get('Content-Type')?.includes('text/html')) {
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  }

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}
