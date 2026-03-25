---
globs:
  - "**/SharingBridge*"
  - "**/sharing*"
  - "**/invite*"
description: Sharing architecture status — Fireproof system removed, TinyBase redesign pending
---

> **DEPRECATED:** The pre-TinyBase sharing system (Fireproof ledgers, dashApi, DOM event bridge) has been removed. TinyBase uses room-based sync via Durable Objects (one DO per app). Sharing/invite functionality will be redesigned in a future task. Do not reference Fireproof patterns, `dashApi`, `useFireproofClerk`, or ledger discovery when working on sharing code.
