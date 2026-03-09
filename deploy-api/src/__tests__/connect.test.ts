import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionConnect, BACKEND_MIGRATION_SQL, DASHBOARD_MIGRATION_SQL } from '../connect';

// Mock global fetch for CF API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function cfResponse(result: unknown, success = true) {
  return new Response(JSON.stringify({ success, result }), {
    status: success ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('provisionConnect', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('creates all resources and returns Connect info', async () => {
    const accountId = 'test-account';
    const apiToken = 'test-token';
    const stage = 'my-app';

    // Mock responses in order:
    // 1. R2 bucket creation
    // 2. AccountApiToken creation
    // 3. D1 backend creation
    // 4. D1 backend migration query (single statement, no breakpoints)
    // 5. D1 dashboard creation
    // 6-19. D1 dashboard migration queries (14 statements split by breakpoints)
    // 20. Cloud-backend Worker upload
    // 21. Cloud-backend subdomain enable
    // 22. Dashboard Worker upload
    // 23. Dashboard subdomain enable
    // 24. Workers subdomain lookup

    // Count dashboard migration statements
    const dashboardStatements = DASHBOARD_MIGRATION_SQL
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Backend migration has no breakpoints, so it's 1 statement
    const backendStatements = BACKEND_MIGRATION_SQL
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    mockFetch
      // R2 bucket creation
      .mockResolvedValueOnce(cfResponse({ name: `fp-storage-${stage}` }))
      // AccountApiToken creation
      .mockResolvedValueOnce(
        cfResponse({
          id: 'token-id',
          value: 'secret-token-value',
        }),
      );

    // D1 backend creation + migration statements
    mockFetch.mockResolvedValueOnce(cfResponse({ uuid: 'd1-backend-uuid' }));
    for (let i = 0; i < backendStatements.length; i++) {
      mockFetch.mockResolvedValueOnce(cfResponse([{ success: true }]));
    }

    // D1 dashboard creation + migration statements
    mockFetch.mockResolvedValueOnce(cfResponse({ uuid: 'd1-dashboard-uuid' }));
    for (let i = 0; i < dashboardStatements.length; i++) {
      mockFetch.mockResolvedValueOnce(cfResponse([{ success: true }]));
    }

    mockFetch
      // Cloud-backend Worker upload
      .mockResolvedValueOnce(cfResponse({}))
      // Cloud-backend subdomain enable
      .mockResolvedValueOnce(cfResponse({}))
      // Dashboard Worker upload
      .mockResolvedValueOnce(cfResponse({}))
      // Dashboard subdomain enable
      .mockResolvedValueOnce(cfResponse({}))
      // Workers subdomain lookup
      .mockResolvedValueOnce(cfResponse({ subdomain: 'acct' }));

    const result = await provisionConnect({
      accountId,
      apiToken,
      stage,
      oidcAuthority: 'https://vibesos.com',
      oidcServiceWorkerName: 'pocket-id',
      cloudBackendBundle:
        'export default { fetch() { return new Response("ok"); } }',
      dashboardBundle:
        'export default { fetch() { return new Response("ok"); } }',
    });

    expect(result.cloudBackendUrl).toContain(`fireproof-cloud-${stage}`);
    expect(result.dashboardUrl).toContain(`fireproof-dashboard-${stage}`);
    expect(result.apiUrl).toContain('/api');
    expect(result.cloudUrl).toMatch(/^fpcloud:\/\//);
    expect(result.r2BucketName).toBe(`fp-storage-${stage}`);
    expect(result.d1BackendId).toBe('d1-backend-uuid');
    expect(result.d1DashboardId).toBe('d1-dashboard-uuid');
    expect(result.sessionTokenPublic).toMatch(/^z/);
  });

  it('migration SQL constants are non-empty', () => {
    expect(BACKEND_MIGRATION_SQL.length).toBeGreaterThan(100);
    expect(DASHBOARD_MIGRATION_SQL.length).toBeGreaterThan(100);
  });
});
