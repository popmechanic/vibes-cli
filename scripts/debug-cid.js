// Debug script to diagnose CID [object Object] bug
// Add this to your HTML before the app loads:
// <script src="debug-cid.js"></script>

(function() {
  console.log('[CID Debug] Installing fetch interceptor...');

  const originalFetch = window.fetch;

  window.fetch = async function(url, options) {
    const urlStr = url instanceof Request ? url.url : String(url);

    // Check for the bug signature
    if (urlStr.includes('[object')) {
      console.error('[CID Debug] 🔴 BUG DETECTED! URL contains [object Object]:', urlStr);
      console.error('[CID Debug] Stack trace:', new Error().stack);

      // Try to extract what should have been there
      const match = urlStr.match(/\/car\/(.+)$/);
      if (match) {
        console.error('[CID Debug] The CID portion is:', match[1]);
      }
    }

    // Log all blob requests
    if (urlStr.includes('/blob/')) {
      const method = options?.method || 'GET';
      console.log(`[CID Debug] ${method} blob request:`, urlStr);
    }

    return originalFetch.apply(this, arguments);
  };

  // Also patch XMLHttpRequest just in case
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    const urlStr = String(url);
    if (urlStr.includes('[object')) {
      console.error('[CID Debug] 🔴 XHR BUG DETECTED! URL contains [object Object]:', urlStr);
    }
    return originalXHROpen.apply(this, arguments);
  };

  console.log('[CID Debug] Interceptors installed. Watching for [object Object] in URLs...');
})();
