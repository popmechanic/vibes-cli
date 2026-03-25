// vibes-desktop/src/bun/setup-ipc.ts
// Minimal IPC server for setup HTML → Bun communication.
// loadHTML() pages can't reliably use __electrobunSendToHost (FFI race condition),
// and window.location.href navigation crashes ElectroBun for unknown schemes.
// Instead, setup buttons call fetch('http://localhost:3335/<action>') and this
// server resolves the waiting promise.

type SetupActionHandler = (action: string) => void;
let _handler: SetupActionHandler | null = null;
let _server: ReturnType<typeof Bun.serve> | null = null;

// Session token prevents cross-origin requests from triggering setup actions.
// Injected into setup HTML templates so only our own pages can authenticate.
const SESSION_TOKEN = crypto.randomUUID();

export function getSetupSessionToken(): string {
	return SESSION_TOKEN;
}

export function startSetupIpc() {
	if (_server) return;
	_server = Bun.serve({
		port: 3335,
		hostname: "127.0.0.1",
		fetch(req) {
			const url = new URL(req.url);
			const token = url.searchParams.get("token");
			if (token !== SESSION_TOKEN) {
				return new Response("unauthorized", { status: 403 });
			}
			const action = url.pathname.slice(1); // '/auth' → 'auth'
			_handler?.(action);
			return new Response("ok");
		},
	});
}

/**
 * Wait for any of the given actions to be received from the setup UI.
 * Resolves with the action string.
 */
export function waitForSetupAction(validActions: string[]): Promise<string> {
	return new Promise((resolve) => {
		_handler = (action) => {
			if (validActions.includes(action)) {
				_handler = null;
				resolve(action);
			}
		};
	});
}

export function stopSetupIpc() {
	_handler = null;
	_server?.stop();
	_server = null;
}
