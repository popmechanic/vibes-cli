/**
 * Auto-provision a public invite link for private apps.
 *
 * Checks /status/:name for an existing link. If the app is private
 * (has oidcClientId) and has no link, provisions one via the Deploy API.
 * Fire-and-forget — errors are logged, never thrown.
 *
 * @param {string} deployApiUrl - Deploy API base URL
 * @param {string} appName - App name (subdomain)
 * @param {string} accessToken - Bearer token for auth
 * @param {object} [options]
 * @param {string} [options.logPrefix=''] - Prefix for console output
 * @returns {Promise<string|null>} The invite link URL, or null
 */
export async function provisionInviteLink(deployApiUrl, appName, accessToken, options = {}) {
  const prefix = options.logPrefix || '';
  try {
    const statusResp = await fetch(`${deployApiUrl}/status/${encodeURIComponent(appName)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!statusResp.ok) return null;

    const statusData = await statusResp.json();

    // Only provision for private apps (have oidcClientId) without existing link
    if (statusData.oidcClientId && !statusData.publicInvite?.token) {
      const linkResp = await fetch(`${deployApiUrl}/apps/${encodeURIComponent(appName)}/public-link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ right: 'write' }),
      });
      if (linkResp.ok) {
        const linkData = await linkResp.json();
        if (linkData.joinUrl) {
          console.log(`${prefix}Invite link: ${linkData.joinUrl}`);
          return linkData.joinUrl;
        }
      }
      return null;
    }

    const existingToken = statusData.publicInvite?.token;
    if (typeof existingToken === 'string' && existingToken.length > 0) {
      const link = `${deployApiUrl}/join/${encodeURIComponent(appName)}/${existingToken}`;
      console.log(`${prefix}Invite link: ${link}`);
      return link;
    }

    return null;
  } catch (err) {
    console.warn(`${prefix}Could not provision invite link:`, err.message);
    return null;
  }
}
