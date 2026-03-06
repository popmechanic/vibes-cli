/**
 * Vibes Bridge Module
 *
 * Thin wrapper around @necrodome/fireproof-clerk (resolved via import map to esm.sh).
 * Adds Vibes-specific application logic:
 *   1. Sync status bridge -> window.__VIBES_SYNC_STATUS__ + custom event for SyncStatusDot
 *   2. Ledger discovery -> 3-tier routing for multi-tenant apps
 *   3. dashApi patching -> routes ensureCloudToken to correct per-database ledger
 *   4. Invite auto-redemption -> reads ?invite= URL param
 *   5. onTock kick -> polls allDocs() after sync, fires noPayloadWatchers
 *
 * Import map: "use-fireproof" -> this file
 *             "@fireproof/clerk" -> esm.sh (raw package)
 */

import React from "react";
export * from "@fireproof/clerk";
import { useFireproofClerk as _originalUseFireproofClerk, useClerkFireproofContext } from "@fireproof/clerk";

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

      // Tier 0: URL ?ledger= parameter (set by invite redemption flow)
      // After invite redemption, the URL keeps ?ledger=<id> so the invited
      // user routes to the correct shared ledger instead of creating a new one.
      if (typeof window !== 'undefined') {
        var _urlParams = new URLSearchParams(window.location.search);
        var _urlLedger = _urlParams.get('ledger');
        if (_urlLedger) {
          // Cache it so subsequent calls don't re-parse
          if (!window.__VIBES_LEDGER_MAP__) window.__VIBES_LEDGER_MAP__ = {};
          if (dbName) window.__VIBES_LEDGER_MAP__[dbName] = _urlLedger;
          req = Object.assign({}, req, { ledger: _urlLedger });
          console.debug('[vibes] Using ledger from URL param:', _urlLedger);
          return _origEnsure(req);
        }
      }

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

      // Tier 3: Discovery -- find ledger matching this database name
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
          // NO fallback to ledgers[0] -- unmatched databases get new ledgers

          if (matched) {
            if (typeof window !== 'undefined') {
              if (!window.__VIBES_LEDGER_MAP__) window.__VIBES_LEDGER_MAP__ = {};
              window.__VIBES_LEDGER_MAP__[dbName || appHost] = matched.ledgerId;
            }
            req = Object.assign({}, req, { ledger: matched.ledgerId });
            console.debug('[vibes] Discovered ledger:', matched.ledgerId, 'for', dbName);
          } else {
            // No match -- clear bundle's wrong ledger so Connect creates a new one
            req = Object.assign({}, req, { ledger: undefined });
            console.debug('[vibes] No ledger match for', dbName, '-- creating new');
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
              }).catch(function (err) {
                console.warn('[vibes] Ledger re-discovery failed:', err && err.message);
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
      }).catch(function (err) {
        console.warn('[vibes] Ledger discovery failed, falling back:', err && err.message);
        return _origEnsure(req);
      });
    };
  }

  _currentDbName = name;
  var result = _originalUseFireproofClerk(name, opts);
  var syncVal = result.syncStatus || "idle";
  var syncErr = result.lastSyncError ? String(result.lastSyncError) : null;

  // Auto-redeem pending invites when ?ledger= or ?invite= is in URL.
  // The dashboard finds invites by the user's email (not by inviteId),
  // so we trigger redemption whenever a shared ledger URL is detected.
  // sessionStorage guard prevents infinite reload loops.
  React.useEffect(function () {
    if (!dashApi) return;

    var params = new URLSearchParams(window.location.search);
    var ledgerParam = params.get('ledger');
    var inviteParam = params.get('invite');

    // Only attempt redemption if there's a ledger or invite hint in the URL
    if (!ledgerParam && !inviteParam) return;

    // Guard: don't retry redemption after we've already tried for this ledger
    var redeemKey = '_vibes_redeemed_' + (ledgerParam || inviteParam || '');
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(redeemKey)) return;

    console.debug('[vibes] Attempting invite redemption for ledger:', ledgerParam);
    dashApi.redeemInvite({}).then(function (rr) {
      if (rr.isOk()) {
        var invites = rr.Ok().invites || [];
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(redeemKey, '1');

        if (invites.length > 0) {
          console.debug('[vibes] Redeemed', invites.length, 'invite(s), reloading');
          // Clean up ?invite= but keep ?ledger= for Tier 0 routing
          if (inviteParam) params.delete('invite');
          var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
          window.history.replaceState({}, '', newUrl);
          window.location.reload();
        } else {
          console.debug('[vibes] No pending invites found for this user');
        }
      } else {
        console.warn('[vibes] redeemInvite failed:', rr.Err());
        // Still mark as attempted so we don't retry on every render
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(redeemKey, '1');
      }
    });
  }, [dashApi]);

  // Sync status bridge: forward to window global + dispatch event for SyncStatusDot
  React.useEffect(function () {
    var changed = window.__VIBES_SYNC_STATUS__ !== syncVal;
    var errChanged = window.__VIBES_SYNC_ERROR__ !== syncErr;
    if (changed || errChanged) {
      window.__VIBES_SYNC_STATUS__ = syncVal;
      window.__VIBES_SYNC_ERROR__ = syncErr;
      window.dispatchEvent(new CustomEvent("vibes-sync-status-change"));
    }
  }, [syncVal, syncErr]);

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
              console.warn("[vibes] onTock kick failed:", e);
            }
          } else if (!kicked) {
            setTimeout(poll, 2000);
          }
        })
        .catch(function (err) {
          console.debug('[vibes] allDocs poll error:', err && err.message);
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
