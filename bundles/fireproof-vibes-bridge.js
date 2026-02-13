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

var _patchedApis = typeof WeakSet !== 'undefined' ? new WeakSet() : { has: function(){return false;}, add: function(){} };

export function useFireproofClerk(name, opts) {
  var ctx = useClerkFireproofContext();
  var dashApi = ctx && ctx.dashApi;
  // Patch dashApi to route to shared ledger. Three tiers:
  // 1. Fast path: req.ledger already set (bundle found member ledger)
  // 2. Fast path: __VIBES_SHARED_LEDGER__ set (collaborator via /resolve, or cached discovery)
  // 3. Slow path: listLedgersByUser discovery (covers owner case — role=admin not found by bundle)
  if (dashApi && !_patchedApis.has(dashApi)) {
    _patchedApis.add(dashApi);
    var _origEnsure = dashApi.ensureCloudToken.bind(dashApi);
    dashApi.ensureCloudToken = function (req) {
      // Fast path 1: explicit ledger already provided
      if (req.ledger) return _origEnsure(req);

      // Fast path 2: window global set (from /resolve or previous discovery)
      if (typeof window !== 'undefined' && window.__VIBES_SHARED_LEDGER__) {
        req = Object.assign({}, req, { ledger: window.__VIBES_SHARED_LEDGER__ });
        console.debug('[vibes] Routing to shared ledger:', window.__VIBES_SHARED_LEDGER__);
        return _origEnsure(req);
      }

      // Slow path: discover via listLedgersByUser (covers owner case)
      return dashApi.listLedgersByUser({}).then(function (rLedgers) {
        if (rLedgers.isOk()) {
          var ledgers = rLedgers.Ok().ledgers || [];
          var appHost = typeof window !== 'undefined' ? window.location.hostname : '';
          var qpSub = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('subdomain')
            : null;

          var matched = ledgers.find(function (l) {
            if (!l.name) return false;
            if (appHost && l.name.includes(appHost)) return true;
            if (qpSub) {
              var workerName = appHost.split('.')[0];
              if (l.name.includes(workerName + '-' + qpSub)) return true;
            }
            return false;
          }) || ledgers[0];

          if (matched) {
            if (typeof window !== 'undefined') window.__VIBES_SHARED_LEDGER__ = matched.ledgerId;
            req = Object.assign({}, req, { ledger: matched.ledgerId });
            console.debug('[vibes] Discovered ledger:', matched.ledgerId, 'via', matched.name);
          }
        }
        return _origEnsure(req);
      }).catch(function () {
        return _origEnsure(req);
      });
    };
  }

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
