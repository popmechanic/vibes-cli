/**
 * Unit tests for worker utility functions
 *
 * Tests pure functions extracted from worker/index.js:
 * - Key prefixing for KV namespace isolation
 * - CORS header generation
 * - Request routing logic
 */

import { describe, it, expect } from 'vitest';

// ============== Functions extracted from worker/index.js ==============

function getKeyPrefix(env) {
  return env.APP_DOMAIN || '__APP_DOMAIN__';
}

function prefixKey(env, key) {
  return `${getKeyPrefix(env)}:${key}`;
}

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

// Route matching logic (extracted from fetch handler)
function getRouteType(pathname) {
  if (pathname.startsWith('/api/')) {
    return 'api';
  }
  if (pathname === '/webhooks/clerk') {
    return 'webhook';
  }
  return 'proxy';
}

// API endpoint matching (extracted from handleAPI)
function matchApiEndpoint(pathname, method) {
  if (pathname === '/api/tenants' && method === 'GET') {
    return 'list-tenants';
  }
  if (pathname === '/api/stats' && method === 'GET') {
    return 'get-stats';
  }
  if (pathname === '/api/tenants/register' && method === 'POST') {
    return 'register-tenant';
  }
  return 'not-found';
}

// Mock request helper
function createMockRequest(options = {}) {
  const headers = new Map(Object.entries(options.headers || {}));
  return {
    headers: {
      get: (key) => headers.get(key) || null
    }
  };
}

// ============== Tests ==============

describe('getKeyPrefix', () => {
  it('returns APP_DOMAIN when set', () => {
    const env = { APP_DOMAIN: 'fantasy.wedding' };
    expect(getKeyPrefix(env)).toBe('fantasy.wedding');
  });

  it('returns placeholder when APP_DOMAIN not set', () => {
    const env = {};
    expect(getKeyPrefix(env)).toBe('__APP_DOMAIN__');
  });

  it('returns placeholder for undefined env', () => {
    const env = { APP_DOMAIN: undefined };
    expect(getKeyPrefix(env)).toBe('__APP_DOMAIN__');
  });
});

describe('prefixKey', () => {
  it('prefixes key with domain', () => {
    const env = { APP_DOMAIN: 'myapp.com' };
    expect(prefixKey(env, 'tenant:alice')).toBe('myapp.com:tenant:alice');
  });

  it('prefixes stats keys', () => {
    const env = { APP_DOMAIN: 'myapp.com' };
    expect(prefixKey(env, 'stats:userCount')).toBe('myapp.com:stats:userCount');
  });

  it('prefixes list keys', () => {
    const env = { APP_DOMAIN: 'myapp.com' };
    expect(prefixKey(env, 'tenants:list')).toBe('myapp.com:tenants:list');
  });

  it('uses placeholder for missing domain', () => {
    const env = {};
    expect(prefixKey(env, 'tenant:bob')).toBe('__APP_DOMAIN__:tenant:bob');
  });

  it('handles different domains correctly (isolation)', () => {
    const env1 = { APP_DOMAIN: 'app1.com' };
    const env2 = { APP_DOMAIN: 'app2.com' };

    expect(prefixKey(env1, 'tenant:alice')).toBe('app1.com:tenant:alice');
    expect(prefixKey(env2, 'tenant:alice')).toBe('app2.com:tenant:alice');
    expect(prefixKey(env1, 'tenant:alice')).not.toBe(prefixKey(env2, 'tenant:alice'));
  });
});

describe('getCorsHeaders', () => {
  it('reflects Origin header when present', () => {
    const request = createMockRequest({
      headers: { Origin: 'https://example.com' }
    });

    const headers = getCorsHeaders(request);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
  });

  it('uses wildcard when no Origin header', () => {
    const request = createMockRequest({});

    const headers = getCorsHeaders(request);
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('includes credentials support', () => {
    const request = createMockRequest({});

    const headers = getCorsHeaders(request);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('allows GET, POST, OPTIONS methods', () => {
    const request = createMockRequest({});

    const headers = getCorsHeaders(request);
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
  });

  it('allows Content-Type and Authorization headers', () => {
    const request = createMockRequest({});

    const headers = getCorsHeaders(request);
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
  });
});

describe('getRouteType', () => {
  it('returns api for /api/ paths', () => {
    expect(getRouteType('/api/tenants')).toBe('api');
    expect(getRouteType('/api/stats')).toBe('api');
    expect(getRouteType('/api/tenants/register')).toBe('api');
  });

  it('returns webhook for /webhooks/clerk', () => {
    expect(getRouteType('/webhooks/clerk')).toBe('webhook');
  });

  it('returns proxy for other paths', () => {
    expect(getRouteType('/')).toBe('proxy');
    expect(getRouteType('/index.html')).toBe('proxy');
    expect(getRouteType('/assets/app.js')).toBe('proxy');
  });

  it('returns proxy for non-clerk webhooks', () => {
    expect(getRouteType('/webhooks/stripe')).toBe('proxy');
    expect(getRouteType('/webhooks')).toBe('proxy');
  });
});

describe('matchApiEndpoint', () => {
  it('matches GET /api/tenants', () => {
    expect(matchApiEndpoint('/api/tenants', 'GET')).toBe('list-tenants');
  });

  it('matches GET /api/stats', () => {
    expect(matchApiEndpoint('/api/stats', 'GET')).toBe('get-stats');
  });

  it('matches POST /api/tenants/register', () => {
    expect(matchApiEndpoint('/api/tenants/register', 'POST')).toBe('register-tenant');
  });

  it('returns not-found for wrong method', () => {
    expect(matchApiEndpoint('/api/tenants', 'POST')).toBe('not-found');
    expect(matchApiEndpoint('/api/stats', 'POST')).toBe('not-found');
    expect(matchApiEndpoint('/api/tenants/register', 'GET')).toBe('not-found');
  });

  it('returns not-found for unknown paths', () => {
    expect(matchApiEndpoint('/api/unknown', 'GET')).toBe('not-found');
    expect(matchApiEndpoint('/api/users', 'GET')).toBe('not-found');
  });
});
