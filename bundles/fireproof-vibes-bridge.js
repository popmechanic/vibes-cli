/**
 * Vibes Bridge Module
 *
 * Sits between the import map and the raw Fireproof bundle.
 * Wraps useFireproofClerk with:
 *   1. Sync status bridge → window.__VIBES_SYNC_STATUS__ + custom event
 *   2. onTock kick → polls allDocs() after sync, fires noPayloadWatchers
 *
 * Import map: "use-fireproof" → this file
 * This file: imports from ./fireproof-clerk-bundle.js (relative, bypasses import map)
 */

import React from "react";
export * from "./fireproof-clerk-bundle.js";
import { useFireproofClerk as _originalUseFireproofClerk, useClerkFireproofContext } from "./fireproof-clerk-bundle.js";

export function useFireproofClerk(name, opts) {
  var ctx = useClerkFireproofContext();
  var dashApi = ctx && ctx.dashApi;
  var result = _originalUseFireproofClerk(name, opts);
  var syncVal = result.syncStatus || "idle";

  // Debug: log JWT payload + ledger list
  React.useEffect(function () {
    if (!dashApi) return;

    // Debug: decode Clerk JWT to verify params.email is present
    if (window.Clerk && window.Clerk.session) {
      window.Clerk.session.getToken({ template: 'with-email' }).then(function(token) {
        if (token) {
          try {
            var parts = token.split('.');
            var payload = JSON.parse(atob(parts[1]));
            console.log('[vibes-bridge] JWT with-email payload:', JSON.stringify(payload, null, 2));
          } catch(e) {
            console.log('[vibes-bridge] JWT decode error:', e.message);
          }
        } else {
          console.log('[vibes-bridge] No JWT token returned for template "with-email"');
        }
      }).catch(function(e) {
        console.log('[vibes-bridge] JWT template error:', e.message);
      });
    }

    dashApi.listLedgersByUser({}).then(function (res) {
      if (res.isOk()) {
        console.log('[vibes-bridge] listLedgersByUser:', JSON.stringify(res.Ok(), null, 2));
      } else {
        console.log('[vibes-bridge] listLedgersByUser error:', res.Err());
      }
    });

    // Check URL for ?invite=<id> param and auto-redeem
    var params = new URLSearchParams(window.location.search);
    var inviteId = params.get('invite');
    if (inviteId) {
      console.log('[vibes-bridge] Found invite param, redeeming:', inviteId);
      dashApi.redeemInvite({ inviteId: inviteId }).then(function (rr) {
        if (rr.isOk()) {
          console.log('[vibes-bridge] Redeemed invite OK:', JSON.stringify(rr.Ok(), null, 2));
          // Clean up URL param and reload so token strategy picks up shared ledger
          params.delete('invite');
          var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
          window.history.replaceState({}, '', newUrl);
          // Reload to re-run token strategy with the new ledger membership
          window.location.reload();
        } else {
          console.log('[vibes-bridge] redeemInvite error:', rr.Err());
        }
      });
    }
  }, [dashApi]);

  // Sync status bridge: forward to window global + dispatch event for SyncStatusDot
  React.useEffect(function () {
    if (window.__VIBES_SYNC_STATUS__ !== syncVal) {
      window.__VIBES_SYNC_STATUS__ = syncVal;
      window.dispatchEvent(new CustomEvent("vibes-sync-status-change"));
    }
  }, [syncVal]);

  // onTock kick: Fireproof's fast-forward path sets clock.head without
  // firing onTock. Poll allDocs and kick notifications when data appears.
  React.useEffect(function () {
    if (syncVal !== "synced") return;
    var db = result.database;
    var kicked = false;
    var poll = function () {
      if (kicked) return;
      db.allDocs()
        .then(function (res) {
          if (kicked) return;
          if (res.rows.length > 0) {
            kicked = true;
            try {
              db.ledger.crdt.clock.noPayloadWatchers.forEach(function (fn) {
                fn();
              });
              console.debug(
                "[vibes] Kicked onTock after detecting",
                res.rows.length,
                "docs"
              );
            } catch (e) {
              console.debug("[vibes] onTock kick failed:", e);
            }
          } else if (!kicked) {
            setTimeout(poll, 2000);
          }
        })
        .catch(function () {
          if (!kicked) setTimeout(poll, 2000);
        });
    };
    var start = setTimeout(poll, 2000);
    var max = setTimeout(function () {
      kicked = true;
    }, 20000);
    return function () {
      kicked = true;
      clearTimeout(start);
      clearTimeout(max);
    };
  }, [syncVal, result.database]);

  return result;
}
