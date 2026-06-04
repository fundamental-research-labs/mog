Rating: 8/10

# Review of 011 — Harden the collaboration / CRDT consistency path (`mog/kernel/src/document/collab`)

## Summary judgment

This is a strong, evidence-grounded plan. Every line reference, comment quote, and behavioral claim I checked against the live source is accurate, and the diagnoses are real defects rather than cosmetic ones. The plan correctly identifies the headline correctness bug (inbound apply never advancing `lastServerSv`), the missing periodic-flush timer that the comments falsely promise, the lineage hole on resume, and a clutch of secondary robustness issues — all on the genuine production convergence path with no test-only shims. It is well-sequenced (client-only batch first, server-coordinated upgrades second), it preserves the wire and durability contracts explicitly, and it pairs each cross-folder dependency with a client-only fallback so the folder can land independently.

It falls short of a 9–10 because the two trickiest items — the echo-suppression mechanism for the headline objective (#1) and the resume-error surfacing for #3 — are underspecified in exactly the way the plan itself flags as "easy to get subtly wrong," and a real ordering race on `lastServerSv` is left unaddressed.

## Evidence verification

I verified the plan against the actual checkout. The following claims are all correct:

- `PULL_RESPONSE` advances local SV but not `lastServerSv` — confirmed, `ws-sidecar.ts:586-592` only calls `serialApply` (fire-and-forget) with no `lastServerSv` write.
- No periodic timer exists; "Retry on next periodic tick" (`:513`) and "Outbound periodic flush" (`:436`) are aspirational comments. Confirmed — there is no `setInterval` anywhere; flush is triggered only by `subscribeUpdateV1` (`:758-761`) and nudge (`:533-541`).
- Resume skips lineage validation — confirmed, lineage checks are inside `if (!isResumeHandshake)` (`:716-729`); resume applies `fullState`/`coordinatorSv` with no hash or epoch check (`:744-748`).
- `serialApply` swallows live errors "self-heal on next sync round" (`:399`) — confirmed.
- No jitter on backoff (`:855`, `:860`) — confirmed deterministic doubling.
- `handleMessage` calls `decode(event.data)` with no try/catch (`:530`) — confirmed, and `decode` genuinely throws on malformed/truncated frames (`wire-codec.ts:115/122/128`), so this is a real unhandled-throw path.
- `flushPresence` clears `pendingPresence` (`:379`) and reconnect never re-emits — confirmed.
- Dead `if (participants.size > 0) {}` block (`:348-349`) — confirmed.
- Wire contract: `MSG` table `0x01..0x11`, `BINARY_TYPES` set, and the `[type][u32 BE jsonLen][json][binary]` framing all match the plan's description (`wire-codec.ts:23-143`).

This level of fidelity is the plan's greatest asset — a reviewer or implementer can trust its problem statements without re-deriving them.

## Major strengths

- **Correct prioritization by consistency impact.** Objective #1 (echo / `arrEq(localSv, lastServerSv)` can never become true after a pull) is genuinely the most damaging defect, and the plan leads with it. The observation that idempotent Yrs applies are *masking* non-convergence rather than fixing it is exactly right.
- **Contracts section is excellent.** It enumerates the invariants that must not regress (byte-exact wire, first-join lineage, serial apply ordering, `flushAndDetach` durability, self-presence filtering, zero observability overhead) and is explicit about which are strengthened vs preserved. The "additive JSON fields only, decode-tolerate absence" rule for wire changes is the correct discipline.
- **Dual-deploy realism.** Splitting every server-coordinated upgrade into a "preferred (server-coordinated)" form and a "client-only fallback that lands now" is the right way to ship a client that shares a wire format with an out-of-checkout server. The `lastServerSv = localSv` fallback reasoning (post-apply SV is a safe lower bound on shared state; can only under-push, never lose local-only ops) is sound.
- **Verification gates are specific and falsifiable.** Each objective maps to a concrete test with a measurable assertion (e.g. "zero subsequent PUSH from B via `eventLog.stats().sent['PUSH'].count`", "successive reconnect delays not equal to the doubling sequence and within `[0, MAX_BACKOFF_MS]`", "timer cleared on detach — no leaked interval"). The plan also correctly leans on the existing two/three-peer harness rather than inventing infrastructure.

## Major gaps or risks

1. **The headline fix (#1) leaves a `lastServerSv` write-ordering race unaddressed.** `lastServerSv` is written by `PUSH_RESPONSE` (`:575`) and the plan now also wants it written from the `PULL_RESPONSE`/nudge path. Both run as fire-and-forget async continuations. The current `PULL_RESPONSE` apply (`:589`) is *not awaited* and does not chain its `lastServerSv` assignment after the apply, while a concurrent `PUSH_RESPONSE` may write a newer `coordinatorSv`. Without a defined ordering rule (e.g. only ever advance `lastServerSv` monotonically, or serialize the write through `applyChain`), a late `PULL_RESPONSE`-derived SV could clobber a newer `PUSH_RESPONSE` `coordinatorSv` and *regress* the source-of-truth — the opposite of the intended fix. The plan should state the write must be ordered after the apply and must never move `lastServerSv` backward.

2. **Echo-suppression "generation tracking" is hand-wavy for the riskiest change.** Step 1's guard ("record the `applyChain` generation at inbound-apply time and no-op the flush if the only thing that advanced the SV since the last flush was an inbound apply") is described as a goal, not an algorithm. The plan admits it is "async and easy to get subtly wrong" and then defers to "keep it conservative." Given that the fallback already drives the diff to empty (`empty_diff` skip at `:478`) once `lastServerSv` is advanced correctly, the explicit suppression guard may be redundant — the plan should clarify whether the guard is load-bearing or merely an optimization, since the convergence guarantee should come from the `lastServerSv` advance alone.

3. **Resume-error surfacing (#3) is harder than the plan implies, and the plan only asks to "confirm" it.** The consumer recovery the plan points to (`host-internal/src/create.ts:230-236`) is gated on `attempt === 0` — it only retries `CollaborationRoomChangedRefetchError` during *initial document creation*, before the sidecar promise resolves. A live resume happens later, inside the detached reconnect loop, whose `catch` (`:854-857`) simply schedules another backoff and never propagates to the consumer. The `WsSidecar` interface has no terminal-error / fatal-error channel (only `onStatusChange`). So a rejected resume as currently designed would loop forever re-attempting, not "surface to the consumer." The plan flags this in its risk list but does not design the mechanism (e.g. an `onFatal`/`onError` callback or an `offline` terminal status that the host treats as "re-snapshot and re-attach"). This is the plan's biggest structural gap, because Step 3's stated outcome cannot be achieved with the existing surface area.

4. **Periodic tick vs `flushUntilAcked` race is acknowledged but not guarded.** `flushAndDetach` calls `flushUntilAcked` *before* setting `detached = true`, so during the final-flush window the periodic tick's `detached` check is still false and it can call `flushOutbound()` concurrently. `flushInProgress` provides single-flight, but the tick will set `flushRequested = true`, queuing an extra microtask flush that may fire after detach intent. The plan says "the tick must observe detached/in-flush state" but the only state that exists today (`detached`) is set too late. The plan should specify a dedicated `finalFlushing` flag (or pause the tick at the top of `flushAndDetach`) rather than relying on `detached`.

5. **`flushUntilAcked` busy-spin concern (#8) is real but under-scoped.** The in-progress branch (`:444-451`) does `await sleep(25)` and returns without pushing; `flushUntilAcked` then loops. The plan correctly wants this bounded by the deadline, but does not note that the loop can spin tightly if `flushOutbound` keeps hitting the in-progress branch while another flush is genuinely stuck — the fix should ensure forward progress (the loop observes the deadline on every iteration, which it does at `:828`, but a 25ms sleep against a 10s deadline is ~400 iterations of no-op). Worth specifying that the in-progress path should await the in-flight flush rather than a fixed sleep.

## Contract and verification assessment

The contract section is the strongest part of the plan and is accurate. Wire byte-exactness, first-join lineage preservation, serial-apply FIFO ordering, and `flushAndDetach` durability are all correctly identified as hard invariants, and the requirement that new apply sites (re-pull recovery in #4) route through `serialApply` is the right call. The strengthened invariant for `lastServerSv` ("after any successful sync exchange in either direction, `lastServerSv ⊒` the union of what both sides hold") is the correct formal target — but see gap #1: the plan states the invariant without specifying the monotonic-advance discipline needed to actually maintain it under concurrent response handlers.

Verification gates are above average: each objective has a discriminating test, the durability regression case (tick firing during `flushUntilAcked`) is explicitly required, and the wire-codec gate correctly demands an "old-server response lacking the new field" decode-tolerance vector. The one missing gate is for gap #1 — there is no test asserting `lastServerSv` never regresses when a `PULL_RESPONSE` and `PUSH_RESPONSE` are processed out of order. Adding that would close the highest-risk hole.

## Concrete changes that would raise the rating

1. **Specify the `lastServerSv` write discipline:** advance only monotonically, serialize the `PULL_RESPONSE`-driven write through `applyChain` so it lands after the apply, and add a test asserting no regression under interleaved PULL/PUSH responses. (Closes gap #1 — would likely move this to a 9.)
2. **Design the resume-failure channel, don't just "confirm" it.** Add a terminal-error surface to the `WsSidecar` interface (or define the `offline`-status contract the host treats as refetch-and-reattach) and state explicitly that the reconnect loop must stop re-attempting on `CollaborationRoomChangedRefetchError` rather than backing off forever. Note that `create.ts`'s `attempt === 0` recovery does not cover the live-resume case.
3. **Replace the periodic-tick `detached` guard with a `finalFlushing` flag** set at the top of `flushAndDetach`, and add it to the durability test's assertions.
4. **Make the echo-suppression guard's role explicit:** state whether convergence relies on it or only on the `lastServerSv` advance, and if it is only an optimization, consider dropping it to reduce the "easy to get subtly wrong" surface.
5. **Tighten the in-progress flush path** so `flushUntilAcked` awaits the in-flight flush instead of polling a fixed 25ms sleep, eliminating the busy-spin.
