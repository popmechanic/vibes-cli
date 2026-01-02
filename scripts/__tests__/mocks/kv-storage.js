/**
 * Mock Cloudflare KV Namespace
 *
 * In-memory implementation of the Cloudflare Workers KV API.
 * Used for testing worker logic without real KV.
 *
 * API Reference: https://developers.cloudflare.com/kv/api/
 */

export class MockKV {
  constructor(initialData = {}) {
    this.store = new Map(Object.entries(initialData));
    this.operations = []; // Track operations for assertions
  }

  /**
   * Get a value by key
   * @param {string} key
   * @param {object} options - { type: 'text' | 'json' | 'arrayBuffer' | 'stream', cacheTtl: number }
   * @returns {Promise<string|object|null>}
   */
  async get(key, options = {}) {
    this.operations.push({ op: 'get', key, options });

    const value = this.store.get(key);
    if (value === undefined) {
      return null;
    }

    // Handle type option
    if (options.type === 'json' || options === 'json') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }

    return value;
  }

  /**
   * Get value with metadata
   * @param {string} key
   * @param {object} options
   * @returns {Promise<{ value: string|null, metadata: object|null }>}
   */
  async getWithMetadata(key, options = {}) {
    this.operations.push({ op: 'getWithMetadata', key, options });

    const value = await this.get(key, options);
    const metadata = this.store.get(`${key}:__metadata__`);

    return {
      value,
      metadata: metadata ? JSON.parse(metadata) : null
    };
  }

  /**
   * Store a value
   * @param {string} key
   * @param {string|ReadableStream|ArrayBuffer} value
   * @param {object} options - { expiration: number, expirationTtl: number, metadata: object }
   * @returns {Promise<void>}
   */
  async put(key, value, options = {}) {
    this.operations.push({ op: 'put', key, value, options });

    // Convert non-string values to string
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    this.store.set(key, stringValue);

    // Store metadata separately
    if (options.metadata) {
      this.store.set(`${key}:__metadata__`, JSON.stringify(options.metadata));
    }

    // Note: expiration/expirationTtl are tracked but not enforced in mock
    if (options.expiration || options.expirationTtl) {
      this.store.set(`${key}:__expires__`, JSON.stringify({
        expiration: options.expiration,
        expirationTtl: options.expirationTtl,
        setAt: Date.now()
      }));
    }
  }

  /**
   * Delete a key
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    this.operations.push({ op: 'delete', key });

    this.store.delete(key);
    this.store.delete(`${key}:__metadata__`);
    this.store.delete(`${key}:__expires__`);
  }

  /**
   * List keys with optional prefix and cursor pagination
   * @param {object} options - { prefix: string, limit: number, cursor: string }
   * @returns {Promise<{ keys: Array<{ name: string, expiration?: number, metadata?: object }>, list_complete: boolean, cursor?: string }>}
   */
  async list(options = {}) {
    this.operations.push({ op: 'list', options });

    const { prefix = '', limit = 1000, cursor } = options;

    // Get all keys matching prefix (excluding metadata keys)
    const allKeys = Array.from(this.store.keys())
      .filter(key => key.startsWith(prefix) && !key.includes(':__'))
      .sort();

    // Handle pagination
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = parseInt(cursor, 10);
      if (!isNaN(cursorIndex)) {
        startIndex = cursorIndex;
      }
    }

    const keys = allKeys
      .slice(startIndex, startIndex + limit)
      .map(name => {
        const result = { name };

        // Include metadata if present
        const metadata = this.store.get(`${name}:__metadata__`);
        if (metadata) {
          result.metadata = JSON.parse(metadata);
        }

        // Include expiration if present
        const expires = this.store.get(`${name}:__expires__`);
        if (expires) {
          const { expiration } = JSON.parse(expires);
          if (expiration) {
            result.expiration = expiration;
          }
        }

        return result;
      });

    const hasMore = startIndex + limit < allKeys.length;

    return {
      keys,
      list_complete: !hasMore,
      ...(hasMore ? { cursor: String(startIndex + limit) } : {})
    };
  }

  // ============== Test Helpers ==============

  /**
   * Clear all data and operations
   */
  clear() {
    this.store.clear();
    this.operations = [];
  }

  /**
   * Get all operations for assertions
   */
  getOperations() {
    return [...this.operations];
  }

  /**
   * Get operations filtered by type
   */
  getOperationsByType(type) {
    return this.operations.filter(op => op.op === type);
  }

  /**
   * Assert a specific operation was called
   */
  assertCalled(type, key) {
    const matches = this.operations.filter(op =>
      op.op === type && (!key || op.key === key)
    );
    if (matches.length === 0) {
      throw new Error(`Expected ${type}(${key || '*'}) to be called`);
    }
    return matches;
  }

  /**
   * Get raw store data for inspection
   */
  getData() {
    return Object.fromEntries(this.store);
  }

  /**
   * Get keys count (excluding metadata)
   */
  size() {
    return Array.from(this.store.keys())
      .filter(key => !key.includes(':__'))
      .length;
  }
}

/**
 * Create a fresh MockKV instance
 * @param {object} initialData - Initial key-value pairs
 * @returns {MockKV}
 */
export function createMockKV(initialData = {}) {
  return new MockKV(initialData);
}

/**
 * Create an env object with TENANTS KV binding
 * @param {object} initialData - Initial KV data
 * @param {object} envOverrides - Additional env vars
 * @returns {{ TENANTS: MockKV, ...envOverrides }}
 */
export function createMockEnv(initialData = {}, envOverrides = {}) {
  return {
    TENANTS: new MockKV(initialData),
    APP_DOMAIN: 'test.local',
    PAGES_HOSTNAME: 'test.pages.dev',
    MONTHLY_PRICE: '9',
    YEARLY_PRICE: '89',
    ...envOverrides
  };
}
