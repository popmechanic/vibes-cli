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
var _currentDbName = null;

export function useFireproofClerk(name, opts) {
  var ctx = useClerkFireproofContext();
  var dashApi = ctx && ctx.dashApi;
  // Patch dashApi to route to correct per-database ledger. Three tiers:
  // 1. Per-database ledger map (populated by sell template or Tier 3 discovery)
  // 2. Legacy global __VIBES_SHARED_LEDGER__ (backward compat)
  // 3. Discovery via listLedgersByUser (matches by dbName, then hostname)
  if (dashApi && !_patchedApis.has(dashApi)) {
    _patchedApis.add(dashApi);
    var _origEnsure = dashApi.ensureCloudToken.bind(dashApi);
    dashApi.ensureCloudToken = function (req) {
      var dbName = _currentDbName;

      // Tier 1: Per-database ledger map (populated by Tier 3 or sell /resolve)
      var ledgerMap = (typeof window !== 'undefined' && window.__VIBES_LEDGER_MAP__) || {};
      if (dbName && ledgerMap[dbName]) {
        req = Object.assign({}, req, { ledger: ledgerMap[dbName] });
        console.debug('[vibes] Using cached ledger for', dbName);
        return _origEnsure(req);
      }

      // Tier 2: Legacy global (sell template's /resolve sets this)
      if (typeof window !== 'undefined' && window.__VIBES_SHARED_LEDGER__) {
        req = Object.assign({}, req, { ledger: window.__VIBES_SHARED_LEDGER__ });
        console.debug('[vibes] Routing to shared ledger:', window.__VIBES_SHARED_LEDGER__);
        return _origEnsure(req);
      }

      // Tier 3: Discovery — find ledger matching this database name
      return dashApi.listLedgersByUser({}).then(function (rLedgers) {
        if (rLedgers.isOk()) {
          var ledgers = rLedgers.Ok().ledgers || [];
          var appHost = typeof window !== 'undefined' ? window.location.hostname : '';

          var matched = ledgers.find(function (l) {
            if (!l.name) return false;
            if (dbName && l.name.includes(dbName)) return true;
            if (appHost && l.name.includes(appHost)) return true;
            return false;
          });
          // NO fallback to ledgers[0] — unmatched databases get new ledgers

          if (matched) {
            if (typeof window !== 'undefined') {
              if (!window.__VIBES_LEDGER_MAP__) window.__VIBES_LEDGER_MAP__ = {};
              window.__VIBES_LEDGER_MAP__[dbName || appHost] = matched.ledgerId;
            }
            req = Object.assign({}, req, { ledger: matched.ledgerId });
            console.debug('[vibes] Discovered ledger:', matched.ledgerId, 'for', dbName);
          } else {
            // No match — clear bundle's wrong ledger so Connect creates a new one
            req = Object.assign({}, req, { ledger: undefined });
            console.debug('[vibes] No ledger match for', dbName, '— creating new');
          }
        }
        // After _origEnsure resolves, discover the newly created ledger (polling retry)
        var _noMatchKey = matched ? null : (dbName || appHost);
        return _origEnsure(req).then(function (result) {
          if (_noMatchKey && typeof window !== 'undefined') {
            var _attempts = 0;
            var _maxAttempts = 5;
            var _delay = 2000;
            function _discover() {
              // Early exit if gate or another path already populated the map
              var existingMap = window.__VIBES_LEDGER_MAP__;
              if (existingMap && existingMap[_noMatchKey]) {
                console.debug('[vibes] Ledger already cached for', _noMatchKey);
                return;
              }
              dashApi.listLedgersByUser({}).then(function (rL2) {
                if (rL2.isOk()) {
                  var newLedgers = rL2.Ok().ledgers || [];
                  var created = newLedgers.find(function (l) {
                    return l.name && l.name.includes(_noMatchKey);
                  });
                  if (created) {
                    if (!window.__VIBES_LEDGER_MAP__) window.__VIBES_LEDGER_MAP__ = {};
                    window.__VIBES_LEDGER_MAP__[_noMatchKey] = created.ledgerId;
                    console.debug('[vibes] Cached new ledger:', created.ledgerId, 'for', _noMatchKey);
                  } else if (++_attempts < _maxAttempts) {
                    setTimeout(_discover, _delay);
                    _delay = Math.min(_delay * 2, 8000);
                  }
                }
              }).catch(function () {
                if (++_attempts < _maxAttempts) {
                  setTimeout(_discover, _delay);
                  _delay = Math.min(_delay * 2, 8000);
                }
              });
            }
            setTimeout(_discover, 2000); // Wait 2s for Connect to register
          }
          return result;
        });
      }).catch(function () {
        return _origEnsure(req);
      });
    };
  }

  _currentDbName = name;
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
