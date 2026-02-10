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

  // Auto-redeem invite from ?invite=<id> URL param
  React.useEffect(function () {
    if (!dashApi) return;

    var params = new URLSearchParams(window.location.search);
    var inviteId = params.get('invite');
    if (inviteId) {
      console.debug('[vibes] Redeeming invite:', inviteId);
      dashApi.redeemInvite({ inviteId: inviteId }).then(function (rr) {
        if (rr.isOk()) {
          console.debug('[vibes] Invite redeemed, reloading');
          // Clean up URL param and reload so token strategy picks up shared ledger
          params.delete('invite');
          var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
          window.history.replaceState({}, '', newUrl);
          window.location.reload();
        } else {
          console.warn('[vibes] redeemInvite failed:', rr.Err());
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
