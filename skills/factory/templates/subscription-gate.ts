// subscription-gate.ts — bundled into factory app HTML.
// Apps import this and call handleSubscriptionError() from their AI-client error
// handler. When an AI request returns 403 (instance frozen / subscription cancelled),
// the user is redirected to Stripe Checkout to restart their subscription.

export function handleSubscriptionError(status: number): void {
  const appName = (window as any).__VIBES_APP_NAME__ || "app";
  const factoryBase = (window as any).__VIBES_FACTORY_BASE__ || "https://factory.vibesos.com";
  if (status === 403) {
    window.location.href = `${factoryBase}/checkout/${appName}`;
  }
}
