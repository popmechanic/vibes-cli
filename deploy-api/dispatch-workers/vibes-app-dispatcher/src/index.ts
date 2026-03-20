interface Dispatcher {
  get(name: string): { fetch(request: Request): Promise<Response> };
}

interface Env {
  APP_DISPATCHER: Dispatcher;
  CONNECT_DISPATCHER: Dispatcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const hostname = new URL(request.url).hostname;
    const subdomain = hostname.split('.')[0];

    if (!subdomain || subdomain === 'vibesos' || subdomain === 'www') {
      return new Response('Not found', { status: 404 });
    }

    // Route connect-{appname}.vibesos.com → vibes-connect namespace
    if (subdomain.startsWith('connect-')) {
      const appName = subdomain.replace(/^connect-/, '');
      const workerName = `fireproof-dashboard-${appName}`;
      try {
        const worker = env.CONNECT_DISPATCHER.get(workerName);
        return await worker.fetch(request);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith('Worker not found')) {
          return new Response('Not found', { status: 404 });
        }
        console.error(`[dispatcher] Error dispatching connect ${workerName}:`, msg);
        return new Response('Internal error', { status: 500 });
      }
    }

    // Route {name}.vibesos.com → vibes-apps namespace
    try {
      const worker = env.APP_DISPATCHER.get(subdomain);
      return await worker.fetch(request);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('Worker not found')) {
        return new Response('App not found', { status: 404 });
      }
      console.error(`[dispatcher] Error dispatching app ${subdomain}:`, msg);
      return new Response('Internal error', { status: 500 });
    }
  },
};
