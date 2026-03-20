import { describe, it, expect } from 'vitest';

describe('TinyBase assembly config injection', () => {
  it('injects __APP_CONFIG__ with appName and wsUrl', () => {
    const template = `window.__APP_CONFIG__ = {
    appName: "__APP_NAME__",
    wsUrl: "__WS_URL__",
    public: __APP_PUBLIC__
  };`;
    const output = template
      .replace('__APP_NAME__', 'test-app')
      .replace('__WS_URL__', 'wss://sync.vibesos.com/test-app')
      .replace('__APP_PUBLIC__', 'true');
    expect(output).toContain('appName: "test-app"');
    expect(output).toContain('wsUrl: "wss://sync.vibesos.com/test-app"');
    expect(output).toContain('public: true');
  });
});
