# 011 — Harden the collaboration / CRDT consistency path (`mog/kernel/src/document/collab`)

## Source folder and scope

- **Folder:** `mog/kernel/src/document/collab`
- **Public source path:** `/Users/guangyuyang/Code/mog-all/mog/kernel/src/document/collab`
- **Files in scope:**
  - `ws-sidecar.ts` (~1000 lines) — the browser-side WebSocket sidecar: connect → join/hydrate → live sync → reconnect, presence/awareness, outbound flush, final-flush-and-detach, room snapshot fetch.
  - `wire-codec.ts` — browser-native binary wire codec (must stay byte-identical to the server's `runtime/server/src/wire-format.ts`).
  - `event-log.ts` — opt-in, in-memory observability ring buffer (test-only; zero production overhead).
  - `index.ts` — barrel exports.
  - `__tests__/` — `ws-sidecar.test.ts`, `collab-e2e.test.ts`, `wire-codec.test.ts`, `event-log.test.ts`, `test-log-collector.ts` (read for context; **not** modified by this plan).
- **Out of scope (cross-folder, noted as dependencies):** the compute bridge (`mog/kernel/src/bridges/compute/compute-bridge.ts`, `compute-core.ts`) that supplies `syncStateVector` / `syncDiff` / `syncApply` / `subscribeUpdateV1`; the Rust CRDT engine (`compute/core`, not in this checkout); the server (`runtime/server/src/wire-format.ts`, not in this checkout). Consumers: `mog/kernel/src/api/document/document-factory.ts` (`attachCollaborationSidecar`), `mog/kernel/src/host-lifecycle-internal.ts` and `mog/kernel/host-internal/src/create.ts` (host-backed first-join + `flushAndDetach`).

This is a **production-path** plan. No reduced scope, test-only fixes, or shims are proposed; every item changes the live client behavior on the convergence path.

## Current role of this folder in Mog

This folder is the **entire browser-side collaboration client**. A document's `ComputeBridge` (the local Yrs CRDT replica living in WASM/NAPI) is connected to the collaboration server through `attachWsSidecar`. The sidecar:

1. **Bootstraps** a first join from a host-verified room snapshot (`preflightStateVector`, `preflightRoomEpoch`, `preflightFullStateHash`, `preflightSnapshotToken`), validating the `JOIN_RESPONSE` full state by SHA-256 against the preflight hash before applying it.
2. **Syncs outbound**: subscribes to local `update_v1` commits; on each commit computes a diff against `lastServerSv` and `PUSH`es it, then advances `lastServerSv` from the server's `coordinatorSv` in the `PUSH_RESPONSE`.
3. **Syncs inbound**: on `BROADCAST_NUDGE` it sends a `PULL_REQUEST` with its current state vector and applies the returned `PULL_RESPONSE` diff; it also applies server-merged diffs piggybacked on `PUSH_RESPONSE`.
4. **Reconnects** with exponential backoff (1s→30s), using `RESUME_REQUEST`/`RESUME_RESPONSE` once bootstrap has completed once.
5. **Awareness/presence**: debounced `setPresence`, JSON-encoded awareness updates over `AWARENESS_UPDATE`, self-echo filtering, participant map + change listeners.
6. **Clean shutdown**: `flushAndDetach` drains all local edits to an acknowledged server SV before closing (used by the host-backed save path).

It is the consistency boundary: every correctness property a user perceives in multi-peer editing (no lost edits, eventual convergence, no stale presence, safe reconnect) is enforced here or not at all.

## Improvement objectives

Ordered by consistency impact.

1. **Eliminate the inbound-apply echo / guarantee convergence after `PULL`.** Today, applying an inbound diff advances the local state vector but **does not advance `lastServerSv`** (`handleMessage` `PULL_RESPONSE`, `ws-sidecar.ts:586-592`). The very next `update_v1` (plausibly fired by the inbound `syncApply` itself) computes `syncDiff(lastServerSv)`, which still includes the just-pulled remote ops, and `PUSH`es them back to the server. This is at best wasted bandwidth and a per-inbound round-trip amplification across N peers; at worst it masks non-convergence because `arrEq(localSv, lastServerSv)` is structurally unable to become true after any pull. This is the headline correctness/efficiency defect.

2. **Add a periodic flush / push-retry safety net.** Comments claim "Retry on next periodic tick" (`ws-sidecar.ts:513`) and a section header reads "Outbound periodic flush" (`:436`), but **there is no timer** — flushes are triggered *only* by `update_v1` and nudges. If a `PUSH` times out (`awaitPushResponse`, default 10s) or fails while the socket stays open, and no further local edit or nudge arrives, the unsynced local edits are **never re-sent** → silent permanent divergence until the user happens to type again. Make the comments true: add a bounded periodic reconciliation tick.

3. **Make reconnect lineage-safe.** `RESUME_RESPONSE` skips all lineage validation (`isResumeHandshake` branch, `:716-729`): it applies server-sent `fullState` bytes and `coordinatorSv` with no `fullStateHash` check and no `roomEpoch` comparison, even though the room may have changed epoch (snapshot reset / server restart) during the disconnect. The `ROOM_CHANGED_REFETCH` error is only handled on the *first* join. A resume into a re-epoched room can silently corrupt the local replica. Persist the room epoch and validate it (and any full-state hash the server provides) on resume; surface `CollaborationRoomChangedRefetchError` from the resume path.

4. **Recover from swallowed inbound apply failures.** `serialApply` for live updates swallows errors with the rationale "the CRDT will self-heal on the next sync round" (`:399`) — but there is no guaranteed next round (see #2), and an inbound `PULL_RESPONSE` apply failure drops that diff with no re-pull. Track inbound apply failure and trigger a re-`PULL` from the last successfully-applied SV.

5. **Reconnect-storm safety.** Backoff doubles deterministically with **no jitter** (`:855-860`), so a server restart reconnects all clients in lockstep. Add full jitter.

6. **Robustness of the inbound message path.** `handleMessage` (`:529`) calls `decode(event.data)` with no `try/catch`; a single malformed frame throws unhandled out of the WS `message` listener. Guard it and log a structured `ws_error`/decode-failure event instead of throwing.

7. **Re-send presence on reconnect.** `flushPresence` clears `pendingPresence` after sending and reconnect never re-emits it, so peers see this user's presence go stale until their next selection change. Re-publish last presence after a successful resume.

8. **Minor correctness/clarity cleanups.** Remove the dead `if (participants.size > 0) {}` empty block (`:348-349`); align the misleading "periodic" comments with the actual mechanism added in #2; ensure `flushOutbound`'s `rejectErrors`/`flushRequested` interaction in `flushUntilAcked` cannot busy-spin (`:444-451`, `:822-837`).

## Production-path contracts and invariants to preserve or strengthen

These MUST NOT regress; several are strengthened.

- **Wire compatibility (preserve, byte-exact).** `wire-codec.ts` must remain byte-identical to `runtime/server/src/wire-format.ts`: the `MSG` table (`0x01..0x11`), the pure-JSON vs `[type][u32 BE jsonLen][json][binary]` framing, and the `BINARY_TYPES` set. Any new field added to a message payload (objective #1/#3 may want a server SV on `PULL_RESPONSE` and an epoch on `RESUME_RESPONSE`) is an **additive, server-coordinated** wire change — additive JSON fields only, never a reordering or a new message type without server lock-step. Decode must continue to tolerate absent optional fields.
- **Bootstrap lineage integrity (preserve, extend to resume).** First join validates `roomId`, `roomEpoch`, `fullStateHash`, `snapshotToken`, and SHA-256 of `fullState` against preflight metadata before applying (`:711-728`). Objective #3 extends the *same* class of guarantee to `RESUME_RESPONSE`. Never weaken the first-join checks.
- **Serial apply ordering (preserve).** `applyChain` serializes all `syncApply` calls; flush waits on `applyChain` before reading the SV (`:461`, `:825`). All new apply sites (re-pull recovery) must go through `serialApply` to preserve FIFO/CRDT commit ordering.
- **`lastServerSv` is the single source of truth for "what the server has from us" (strengthen).** Today it is advanced only by `JOIN/RESUME` (`coordinatorSv`) and `PUSH_RESPONSE` (`coordinatorSv`). Objective #1 makes it also reflect inbound `PULL_RESPONSE`/nudge applies so the idempotence check `arrEq(localSv, lastServerSv)` is meaningful. The invariant to hold: *after any successful sync exchange in either direction, `lastServerSv` ⊒ the union of everything both sides are known to hold.*
- **`flushAndDetach` durability (preserve).** `flushUntilAcked` must continue to guarantee that, on success, every local edit has been acknowledged (`coordinatorSv` covers `localSv`) before the socket closes — this is the host save path's data-loss guard. The periodic tick (#2) must not race or short-circuit it.
- **Self-presence filtering (preserve).** Awareness updates for `participantId` are skipped (`:327`). Re-publishing presence on reconnect (#7) must not cause a peer to display its own cursor.
- **Zero production overhead for `event-log.ts` (preserve).** Observability stays opt-in; no new always-on allocation on the hot path.
- **Idempotent CRDT applies (rely on, don't abuse).** Yrs applies are idempotent, which is what keeps the current echo from corrupting state — but idempotence is a safety net, not a license to keep echoing; #1 removes the echo at the source.

## Concrete implementation plan

All edits are within `mog/kernel/src/document/collab`. Items marked **(server-coordinated)** require an additive server change tracked as a cross-folder dependency; each has a **client-only fallback** so the folder can land independently.

### Step 1 — Advance `lastServerSv` on inbound sync (objective #1)

- In `handleMessage`, on `PULL_RESPONSE`: after a successful `serialApply` of the diff, advance `lastServerSv`.
  - **Preferred (server-coordinated):** have the server include its post-merge state vector in the `PULL_RESPONSE` JSON meta (mirror of `PUSH_RESPONSE.coordinatorSv`); set `lastServerSv = new Uint8Array(meta.coordinatorSv)`.
  - **Client-only fallback (lands now):** after the inbound apply completes, recompute `localSv = await computeBridge.syncStateVector()` and set `lastServerSv = localSv`. Rationale: we just merged the server's diff into our replica, so our SV is a safe lower bound on "what the server has that we also have"; pushing from it can only send genuinely-local-only ops. Do the same on `BROADCAST_NUDGE`-driven pulls.
- **Suppress the self-triggered echo flush.** Wrap inbound applies in an "applying remote" guard: when an inbound `serialApply` triggers a subsequent `update_v1` callback purely as a result of that apply, skip the flush for that callback. Implement as a monotonically-checked guard rather than a boolean (the dispatch is async): record the `applyChain` generation at inbound-apply time and, in the `update_v1` handler, no-op the flush if the only thing that advanced the SV since the last flush was an inbound apply. Keep it conservative — when in doubt, flush (idempotent), but recompute against the freshly-advanced `lastServerSv` so the diff is empty (`empty_diff` skip at `:478`).
  - **Deeper cross-folder option (note only, do not block on):** origin-tagging in the compute engine so applied-remote updates do not fire `update_v1` at all. Cleaner and removes the echo categorically, but requires `compute/core` + bridge changes; capture as a follow-up dependency.

### Step 2 — Periodic reconciliation tick (objective #2)

- Add a single `setInterval`-style timer (default ~5s; constant alongside `INITIAL_BACKOFF_MS`) started after handshake completes and cleared in `teardownCurrentConnection`/`detach`. Each tick, if the socket is OPEN and not detached, call `flushOutbound()` (the existing SV-equality short-circuit makes it a cheap no-op when in sync).
- This makes the existing "retry on next periodic tick" comment true and guarantees that timed-out/failed pushes and dropped diffs are retried without requiring fresh user input.
- Guard against overlap with `flushInProgress` (already handled by the in-progress check) and with `flushUntilAcked` (the final-flush loop); the periodic tick must be a no-op while detaching.

### Step 3 — Lineage-safe resume (objective #3)

- Persist `currentRoomEpoch` (and the last validated `fullStateHash`/`snapshotToken`) in closure state, set on first join and refreshed on each accepted handshake.
- On `RESUME_RESPONSE`: if `meta.error === 'ROOM_CHANGED_REFETCH'` (or epoch differs from `currentRoomEpoch`), reject the resume with a `CollaborationRoomChangedRefetchError` and surface it to the consumer (do **not** silently apply). If the server provides a `fullStateHash` on resume, validate the applied `fullState` against it exactly as first-join does.
  - **Server-coordinated** if the resume response does not currently carry epoch/hash; **client-only fallback:** at minimum compare `meta.roomEpoch` (already present in the decoded meta shape, `:691`) to the persisted epoch and refetch on mismatch.
- Ensure `bootstrapComplete` is not used to imply trust — it currently gates only handshake *type*, not lineage.

### Step 4 — Inbound-apply failure recovery (objective #4)

- Track the last SV that was successfully synced inbound. If a live `serialApply` (PULL/nudge path) fails, instead of only logging `sync_apply ok:false`, schedule a re-`PULL_REQUEST` using the last-good SV (debounced, capped retry count with backoff) so the dropped diff is re-requested rather than lost.
- Keep `PUSH_RESPONSE` server-diff applies on the existing `swallowErrors=false` path (they already reject the push ack); only the fire-and-forget inbound path needs the recovery hook.

### Step 5 — Backoff jitter (objective #5)

- Apply full jitter to the scheduled reconnect delay: `delay = random_between(0, min(backoff, MAX_BACKOFF_MS))`, then advance `backoff`. Note the existing `Math.random()` use is fine here (this is client runtime, not a workflow script).

### Step 6 — Inbound decode hardening (objective #6)

- Wrap the `decode(event.data)` call in `handleMessage` in `try/catch`; on failure, log a structured decode-failure event and drop the frame (never throw out of the listener). Do the same defensive parse for `applyAwarenessUpdate` (already guarded) and for the first-message handshake (already guarded).

### Step 7 — Presence re-publish on reconnect (objective #7)

- Retain `lastPresence` separately from `pendingPresence`. After a successful resume reaches `online`, if `lastPresence` exists, re-queue it through the debounced `flushPresence` path so peers re-learn this user's cursor.

### Step 8 — Cleanups (objective #8)

- Remove the empty `if (participants.size > 0) {}` block (`:348-349`).
- Reconcile the "periodic" comments with Step 2.
- Audit `flushUntilAcked`/`flushOutbound({rejectErrors:true})` so the in-progress branch's `await sleep(25)` cannot loop indefinitely; bound by the existing deadline.

## Tests and verification gates

> Per task constraints this worker does not run builds/tests. The following are the gates the implementing change must add/satisfy; they live under `mog/kernel/src/document/collab/__tests__/` (existing harness `ws-sidecar.test.ts` already spins two/three in-process peers against a mock server, and `collab-e2e.test.ts` exercises full flows).

- **Echo elimination (objective #1):** With peers A and B, an edit on A that reaches B via nudge→pull must result in **zero** subsequent `PUSH` from B (assert via `eventLog.stats().sent['PUSH'].count` unchanged after B's inbound apply). Assert `arrEq(localSv, lastServerSv)` becomes true on B after applying A's diff.
- **Convergence under interleave:** Concurrent edits on A and B, then quiesce; assert both replicas' state vectors and full state converge and no peer is in a permanent push loop (bounded total PUSH count).
- **Periodic retry (objective #2):** Simulate a `PUSH_RESPONSE` drop (mock server withholds ack) with no further edits; assert the edit is re-pushed and acked within ~2 periodic ticks. Assert the timer is cleared on `detach` (no leaked interval).
- **Resume lineage safety (objective #3):** Disconnect a bootstrapped peer, mutate the mock room's epoch, reconnect; assert the resume rejects with `CollaborationRoomChangedRefetchError` and does **not** apply mismatched state. Assert hash mismatch on resume is rejected.
- **Inbound failure recovery (objective #4):** Inject a `syncApply` failure on a `PULL_RESPONSE`; assert a re-`PULL` is issued and convergence is eventually reached.
- **Jitter (objective #5):** Assert successive reconnect delays are not equal to the deterministic doubling sequence and stay within `[0, MAX_BACKOFF_MS]`.
- **Decode hardening (objective #6):** Feed a malformed/truncated frame to an online sidecar; assert the listener does not throw, the sidecar stays `online`, and a decode-failure event is logged.
- **Presence re-publish (objective #7):** Set presence on A, disconnect/reconnect A; assert B re-receives A's presence after A resumes without A changing selection.
- **`flushAndDetach` durability unchanged:** Existing host-save flush tests must still pass; add a case where the periodic tick fires during `flushUntilAcked` and assert no premature detach and no double-flush corruption.
- **Wire codec invariance:** `wire-codec.test.ts` round-trip and (if available) the cross-impl byte-equality vector against the server format must be unchanged; any new optional JSON field must decode-tolerate its absence (add a vector for an old-server response lacking the new field).

Static gates (run by the implementer, not this worker): `pnpm --filter @mog-sdk/contracts build` if any shared type touched (none expected here), kernel typecheck, and the collab vitest suite.

## Risks, edge cases, and non-goals

**Risks / edge cases**
- **`lastServerSv = localSv` fallback over-advances** if the server's merge differs from ours. Because Yrs SVs are per-client logical clocks and applies are idempotent, setting `lastServerSv` to our post-apply SV can only *under*-push (skip ops the server already has), never lose local-only ops — local-only ops are absent from the inbound diff so their clocks aren't covered. Still, prefer the server-coordinated `coordinatorSv` on `PULL_RESPONSE` when available; gate the fallback behind a test asserting no local-only op is ever dropped.
- **Periodic tick vs final flush race:** the tick must observe `detached`/in-flush state; mis-ordering could close the socket mid-push. Covered by the durability test above.
- **Echo-suppression generation tracking** is async and easy to get subtly wrong; keep it conservative (worst case = an extra empty-diff flush, which is cheap and safe) rather than aggressive (risking a *suppressed* genuine local edit). Never suppress a flush that follows a real local mutation.
- **Resume rejection UX:** turning silent resume into a `ROOM_CHANGED_REFETCH` rejection changes the consumer contract — `document-factory`/host paths must already handle the refetch error (first-join already produces it); confirm the resume-time surfacing is wired to the same recovery (re-snapshot + re-attach), not an unhandled rejection.
- **Wire changes are dual-deploy:** any server-coordinated field is additive and must be deployed server-first or be optional; the client-only fallbacks let the folder ship before the server.

**Non-goals**
- Rewriting the protocol, adding compression, or changing the CRDT (Yrs) itself.
- Origin-tagging inside the compute engine (captured as a follow-up dependency in Step 1, not required for this plan).
- Awareness payload schema changes beyond re-publish timing.
- The `event-log.ts` observability format (kept stable; only new event types added for new code paths).
- Server-side (`runtime/server`) implementation — only its wire contract is referenced.

## Parallelization notes and dependencies on other folders

- **Independent, can land first (client-only):** Steps 2 (periodic tick), 5 (jitter), 6 (decode guard), 7 (presence re-publish), 8 (cleanups), and the client-only fallbacks of Steps 1, 3, 4. These touch only `ws-sidecar.ts` and require no other folder.
- **Cross-folder, server-coordinated (track jointly):**
  - `runtime/server/src/wire-format.ts` (not in this checkout): additive `coordinatorSv` on `PULL_RESPONSE` (Step 1 preferred form) and epoch/hash on `RESUME_RESPONSE` (Step 3 preferred form). Wire-codec changes here must stay byte-identical to the server.
  - `mog/kernel/src/bridges/compute/compute-bridge.ts` + `compute/core` (Rust engine): the deeper origin-tagging option for Step 1's echo (follow-up only).
- **Downstream consumers to keep in sync:** `mog/kernel/src/api/document/document-factory.ts` (`attachCollaborationSidecar`) and `mog/kernel/host-internal/src/create.ts` / `host-lifecycle-internal.ts` (`flushAndDetach`, first-join bootstrap) — verify the resume-rejection surfacing (Step 3) is handled by the same refetch recovery as first-join, and that the new periodic timer does not perturb `flushAndDetach`'s durability contract.
- **Scheduling:** one engineer can do the client-only batch in a single pass; the server-coordinated upgrades for Steps 1 and 3 should follow as a paired client+server change once the fallbacks are proven, replacing the fallback heuristics with authoritative server SV/epoch.
