/**
 * Cloudflare Worker for Vibes Sell
 *
 * This worker serves two purposes:
 * 1. Proxies wildcard subdomain requests to Cloudflare Pages
 * 2. Provides an API endpoint to list tenants from Clerk
 *
 * Environment Variables (set in Cloudflare dashboard):
 * - CLERK_SECRET_KEY: Your Clerk secret key (sk_live_xxx or sk_test_xxx)
 * - PAGES_DOMAIN: Your Cloudflare Pages domain (e.g., my-app.pages.dev)
 * - ALLOWED_ORIGIN: Your root domain for CORS (e.g., https://fantasy.wedding)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle API routes
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url);
    }

    // Proxy all other requests to Cloudflare Pages
    return proxyToPages(request, env);
  }
};

/**
 * Handle API requests
 */
async function handleApiRequest(request, env, url) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: getCorsHeaders(env)
    });
  }

  // Route API endpoints
  if (url.pathname === '/api/tenants') {
    return handleGetTenants(request, env);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { ...getCorsHeaders(env), 'Content-Type': 'application/json' }
  });
}

/**
 * GET /api/tenants - List all tenants with subscriptions
 *
 * Optional query params:
 * - status: Filter by subscription status ('active', 'all')
 */
async function handleGetTenants(request, env) {
  const headers = { ...getCorsHeaders(env), 'Content-Type': 'application/json' };

  // Verify Clerk secret key is configured
  if (!env.CLERK_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'CLERK_SECRET_KEY not configured' }), {
      status: 500,
      headers
    });
  }

  try {
    // Fetch all users from Clerk with pagination
    const users = await fetchAllClerkUsers(env.CLERK_SECRET_KEY);

    // Transform to tenant format
    // Note: subdomain is stored in unsafe_metadata (writable from frontend)
    const tenants = users
      .filter(user => user.unsafe_metadata?.subdomain) // Only users with subdomains
      .map(user => ({
        id: user.id,
        subdomain: user.unsafe_metadata.subdomain,
        email: user.email_addresses?.[0]?.email_address,
        createdAt: user.unsafe_metadata.claimedAt || new Date(user.created_at).toISOString(),
        status: user.unsafe_metadata.subscriptionStatus || 'active',
        plan: user.unsafe_metadata.plan || 'unknown',
        imageUrl: user.image_url
      }));

    return new Response(JSON.stringify({ tenants }), {
      status: 200,
      headers
    });
  } catch (error) {
    console.error('Error fetching tenants:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch tenants', details: error.message }), {
      status: 500,
      headers
    });
  }
}

/**
 * Fetch all users from Clerk with pagination
 */
async function fetchAllClerkUsers(secretKey) {
  const users = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await fetch(
      `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`,
      {
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Clerk API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    users.push(...data);

    // If we got fewer than limit, we've reached the end
    if (data.length < limit) {
      break;
    }

    offset += limit;
  }

  return users;
}

/**
 * Proxy requests to Cloudflare Pages
 */
async function proxyToPages(request, env) {
  const url = new URL(request.url);

  // Replace hostname with Pages domain
  const pagesUrl = new URL(request.url);
  pagesUrl.hostname = env.PAGES_DOMAIN || 'your-project.pages.dev';

  // Forward the request
  return fetch(pagesUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body
  });
}

/**
 * Get CORS headers
 */
function getCorsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}
