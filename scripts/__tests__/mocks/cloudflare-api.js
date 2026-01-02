/**
 * Cloudflare API Mock
 *
 * Intercepts fetch calls to api.cloudflare.com and returns realistic responses.
 * Used for testing deploy-sell.js without real API calls.
 */

/**
 * Mock state - tracks created resources
 */
let mockState = {
  zones: new Map(),
  dnsRecords: new Map(),
  kvNamespaces: new Map(),
  workers: new Map(),
  workerRoutes: new Map()
};

/**
 * Reset mock state between tests
 */
export function resetCloudflareApiMock() {
  mockState = {
    zones: new Map(),
    dnsRecords: new Map(),
    kvNamespaces: new Map(),
    workers: new Map(),
    workerRoutes: new Map()
  };
}

/**
 * Add a zone to mock state
 */
export function addMockZone(domain, zoneId = `zone_${Date.now()}`) {
  mockState.zones.set(domain, {
    id: zoneId,
    name: domain,
    status: 'active'
  });
  return zoneId;
}

/**
 * Add a DNS record to mock state
 */
export function addMockDnsRecord(zoneId, record) {
  const recordId = record.id || `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const records = mockState.dnsRecords.get(zoneId) || [];
  records.push({
    id: recordId,
    ...record
  });
  mockState.dnsRecords.set(zoneId, records);
  return recordId;
}

/**
 * Add a KV namespace to mock state
 */
export function addMockKvNamespace(accountId, name, namespaceId = `ns_${Date.now()}`) {
  const key = `${accountId}:${name}`;
  mockState.kvNamespaces.set(key, {
    id: namespaceId,
    title: name
  });
  return namespaceId;
}

/**
 * Get mock state for assertions
 */
export function getMockState() {
  return mockState;
}

/**
 * Mock Cloudflare API response generator
 */
function createApiResponse(result, success = true, errors = [], messages = []) {
  return {
    success,
    errors,
    messages,
    result
  };
}

/**
 * Route handlers for different API endpoints
 */
const apiHandlers = {
  // GET /zones?name=domain
  'GET /zones': (url, options, state) => {
    const searchParams = new URL(url).searchParams;
    const name = searchParams.get('name');

    if (name && state.zones.has(name)) {
      return createApiResponse([state.zones.get(name)]);
    }

    // Return all zones if no filter
    if (!name) {
      return createApiResponse(Array.from(state.zones.values()));
    }

    return createApiResponse([]);
  },

  // GET /zones/:zoneId/dns_records
  'GET /zones/*/dns_records': (url, options, state) => {
    const match = url.match(/\/zones\/([^/]+)\/dns_records/);
    if (!match) return createApiResponse([], false, [{ message: 'Invalid URL' }]);

    const zoneId = match[1];
    const records = state.dnsRecords.get(zoneId) || [];

    // Handle query params for filtering
    const searchParams = new URL(url).searchParams;
    const type = searchParams.get('type');
    const name = searchParams.get('name');

    let filtered = records;
    if (type) filtered = filtered.filter(r => r.type === type);
    if (name) filtered = filtered.filter(r => r.name === name);

    return createApiResponse(filtered);
  },

  // POST /zones/:zoneId/dns_records
  'POST /zones/*/dns_records': (url, options, state) => {
    const match = url.match(/\/zones\/([^/]+)\/dns_records/);
    if (!match) return createApiResponse(null, false, [{ message: 'Invalid URL' }]);

    const zoneId = match[1];
    const body = JSON.parse(options.body);
    const recordId = `rec_${Date.now()}`;

    const record = {
      id: recordId,
      ...body,
      created_on: new Date().toISOString(),
      modified_on: new Date().toISOString()
    };

    const records = state.dnsRecords.get(zoneId) || [];
    records.push(record);
    state.dnsRecords.set(zoneId, records);

    return createApiResponse(record);
  },

  // DELETE /zones/:zoneId/dns_records/:recordId
  'DELETE /zones/*/dns_records/*': (url, options, state) => {
    const match = url.match(/\/zones\/([^/]+)\/dns_records\/([^/]+)/);
    if (!match) return createApiResponse(null, false, [{ message: 'Invalid URL' }]);

    const [, zoneId, recordId] = match;
    const records = state.dnsRecords.get(zoneId) || [];
    const index = records.findIndex(r => r.id === recordId);

    if (index === -1) {
      return createApiResponse(null, false, [{ message: 'Record not found' }]);
    }

    records.splice(index, 1);
    state.dnsRecords.set(zoneId, records);

    return createApiResponse({ id: recordId });
  },

  // GET /zones/:zoneId/workers/routes
  'GET /zones/*/workers/routes': (url, options, state) => {
    const match = url.match(/\/zones\/([^/]+)\/workers\/routes/);
    if (!match) return createApiResponse([], false, [{ message: 'Invalid URL' }]);

    const zoneId = match[1];
    const routes = state.workerRoutes.get(zoneId) || [];

    return createApiResponse(routes);
  },

  // POST /zones/:zoneId/workers/routes
  'POST /zones/*/workers/routes': (url, options, state) => {
    const match = url.match(/\/zones\/([^/]+)\/workers\/routes/);
    if (!match) return createApiResponse(null, false, [{ message: 'Invalid URL' }]);

    const zoneId = match[1];
    const body = JSON.parse(options.body);
    const routeId = `route_${Date.now()}`;

    const route = {
      id: routeId,
      pattern: body.pattern,
      script: body.script
    };

    const routes = state.workerRoutes.get(zoneId) || [];
    routes.push(route);
    state.workerRoutes.set(zoneId, routes);

    return createApiResponse(route);
  },

  // DELETE /zones/:zoneId/workers/routes/:routeId
  'DELETE /zones/*/workers/routes/*': (url, options, state) => {
    const match = url.match(/\/zones\/([^/]+)\/workers\/routes\/([^/]+)/);
    if (!match) return createApiResponse(null, false, [{ message: 'Invalid URL' }]);

    const [, zoneId, routeId] = match;
    const routes = state.workerRoutes.get(zoneId) || [];
    const index = routes.findIndex(r => r.id === routeId);

    if (index === -1) {
      return createApiResponse(null, false, [{ message: 'Route not found' }]);
    }

    routes.splice(index, 1);
    state.workerRoutes.set(zoneId, routes);

    return createApiResponse({ id: routeId });
  }
};

/**
 * Match a URL pattern to a handler
 */
function matchHandler(method, pathname) {
  const fullPath = `${method} ${pathname}`;

  // Exact match first
  if (apiHandlers[fullPath]) {
    return apiHandlers[fullPath];
  }

  // Pattern matching (convert * to regex)
  for (const [pattern, handler] of Object.entries(apiHandlers)) {
    const [patternMethod, patternPath] = pattern.split(' ');
    if (patternMethod !== method) continue;

    const regex = new RegExp('^' + patternPath.replace(/\*/g, '[^/]+') + '$');
    if (regex.test(pathname)) {
      return handler;
    }
  }

  return null;
}

/**
 * Create a mock fetch function that intercepts Cloudflare API calls
 */
export function createMockFetch(options = {}) {
  const {
    simulateErrors = {},  // { 'GET /zones': 403 }
    delay = 0             // Simulate network latency
  } = options;

  return async function mockFetch(url, fetchOptions = {}) {
    const urlObj = new URL(url);
    const method = fetchOptions.method || 'GET';
    const pathname = urlObj.pathname.replace('/client/v4', '');

    // Check for simulated errors
    for (const [pattern, statusCode] of Object.entries(simulateErrors)) {
      const [errorMethod, errorPath] = pattern.split(' ');
      if (method === errorMethod && pathname.includes(errorPath.replace('*', ''))) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        return {
          ok: false,
          status: statusCode,
          json: async () => createApiResponse(null, false, [{
            code: statusCode,
            message: statusCode === 403 ? 'Forbidden' :
                     statusCode === 429 ? 'Rate limited' :
                     statusCode === 404 ? 'Not found' : 'Error'
          }])
        };
      }
    }

    // Find matching handler
    const handler = matchHandler(method, pathname);

    if (delay) await new Promise(r => setTimeout(r, delay));

    if (!handler) {
      return {
        ok: false,
        status: 404,
        json: async () => createApiResponse(null, false, [{ message: `No handler for ${method} ${pathname}` }])
      };
    }

    const response = handler(url, fetchOptions, mockState);

    return {
      ok: response.success,
      status: response.success ? 200 : 400,
      json: async () => response
    };
  };
}

/**
 * CloudflareAPI class mock (matches deploy-sell.js interface)
 */
export class MockCloudflareAPI {
  constructor(apiToken, options = {}) {
    this.apiToken = apiToken;
    this.fetch = createMockFetch(options);
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
  }

  async request(method, endpoint, body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await this.fetch(url, options);
    return response.json();
  }

  async getZoneId(domain) {
    const result = await this.request('GET', `/zones?name=${domain}`);
    if (result.success && result.result.length > 0) {
      return result.result[0].id;
    }
    return null;
  }

  async listDnsRecords(zoneId, params = {}) {
    const query = new URLSearchParams(params).toString();
    const endpoint = `/zones/${zoneId}/dns_records${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  async createDnsRecord(zoneId, record) {
    return this.request('POST', `/zones/${zoneId}/dns_records`, record);
  }

  async deleteDnsRecord(zoneId, recordId) {
    return this.request('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }

  async listWorkerRoutes(zoneId) {
    return this.request('GET', `/zones/${zoneId}/workers/routes`);
  }

  async createWorkerRoute(zoneId, pattern, workerName) {
    return this.request('POST', `/zones/${zoneId}/workers/routes`, {
      pattern,
      script: workerName
    });
  }

  async deleteWorkerRoute(zoneId, routeId) {
    return this.request('DELETE', `/zones/${zoneId}/workers/routes/${routeId}`);
  }
}
