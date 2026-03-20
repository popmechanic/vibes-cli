interface Env {
  DISPATCHER: {
    get(name: string): { fetch(request: Request): Promise<Response> };
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const hostname = new URL(request.url).hostname;
    // connect-{appname}.vibesos.com → fireproof-dashboard-{appname}
    const subdomain = hostname.split('.')[0];
    const appName = subdomain.replace(/^connect-/, '');
    const workerName = `fireproof-dashboard-${appName}`;

    try {
      const worker = env.DISPATCHER.get(workerName);
      return await worker.fetch(request);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('Worker not found')) {
        return new Response('Not found', { status: 404 });
      }
      console.error(`[connect-dispatcher] Error dispatching ${workerName}:`, msg);
      return new Response('Internal error', { status: 500 });
    }
  },
};
