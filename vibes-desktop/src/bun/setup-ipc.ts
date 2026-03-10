// vibes-desktop/src/bun/setup-ipc.ts
// Minimal IPC server for setup HTML → Bun communication.
// loadHTML() pages can't reliably use __electrobunSendToHost (FFI race condition),
// and window.location.href navigation crashes ElectroBun for unknown schemes.
// Instead, setup buttons call fetch('http://localhost:3335/<action>') and this
// server resolves the waiting promise.

type SetupActionHandler = (action: string) => void;
let _handler: SetupActionHandler | null = null;

export const setupIpc = Bun.serve({
	port: 3335,
	fetch(req) {
		const action = new URL(req.url).pathname.slice(1); // '/auth' → 'auth'
		_handler?.(action);
		return new Response("ok", {
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET",
			},
		});
	},
});

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
	setupIpc.stop();
}
