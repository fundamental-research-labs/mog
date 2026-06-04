Rating: 8/10

# Review of 011-kernel-src-document-collab.md

## Summary judgment

This is a strong, evidence-grounded plan for the kernel collaboration/CRDT transport folder. I verified its central claims against the source and they hold up: the wire protocol is duplicated client-side with a "must match `runtime/server/src/wire-format.ts`" comment (`wire-codec.ts:20`, `:62`), that server path is genuinely absent from this checkout, live `syncApply` errors are swallowed (`ws-sidecar.ts:399`), production `console.log` is unconditional even without an `eventLog` (`ws-sidecar.ts:237-245`, contradicting `event-log.ts`'s "zero overhead / production sidecars don't use this" docstring), lifecycle is governed by a scatter of implicit booleans (`bootstrapComplete`, `detached`, `flushInProgress`, `flushRequested`, `handshakeComplete`), the room-changed case is matched by `err.name` string rather than a typed error (`ws-sidecar.ts:698`), the `participants` map is exposed directly and mutably (`ws-sidecar.ts:874-876`), and tests gate on `describe.skip`/`test.skip` for the NAPI addon, collab server, and structural-sync convergence (`collab-e2e.test.ts:91,111,613+`, `ws-sidecar.test.ts:65`). The plan reads like it was written from the code, not from a summary.

The objectives are coherent, the invariants section is genuinely useful as a spec, and the verification gates are concrete and runnable. The main reasons it is not a 9–10: parts of the headline objective (a shared protocol package) are blocked by a dependency the plan itself admits is missing from the checkout, the scope is very large for a single folder and leans on cross-repo and cross-folder decisions, and a couple of correctness specifics in the current code could have been pinned down more sharply.

## Major strengths

- **Accurate problem diagnosis.** Every weakness it lists is real and locatable. It correctly distinguishes the transport folder's responsibility from workbook/CRDT semantics it must not absorb.
- **Invariants-as-contract section.** The "contracts and invariants to preserve or strengthen" list (fail-closed first join, hash/lineage matching, serialized `syncApply`, `lastServerSv` never advancing before ack, idempotent detach, immutable presence snapshots) is the best part of the plan — it is testable and directly mirrors the code's intent.
- **Honest about the blind spot.** It repeatedly flags that `runtime/server/src` is absent so protocol parity is "evidence-based rather than contract-based," and proposes the smallest investigation (locate the actual room service) rather than pretending. That is the right posture.
- **Verification gates are real commands** scoped to the four existing test files plus broader kernel/app/typecheck gates, and it correctly forbids running them in this planning-only task.
- **Sequencing and parallelization are sensible:** protocol contract first as the integration point, then independent owners for state/CRDT/presence/host-lifecycle/CI, with named dependencies.

## Major gaps or risks

- **The flagship objective depends on an unavailable repo.** "Shared, versioned protocol package consumed by both browser sidecar and room service" cannot be completed from this checkout. The plan hedges ("owned outside `collab` if the server is in another package"), but a reviewer should note the first parallel track is effectively blocked until the server package is located, which weakens the "integrate protocol first" sequencing.
- **Scope creep risk.** The plan proposes a 5-module split of `ws-sidecar.ts`, a full state-machine rewrite, a diagnostics-sink redesign, a presence-validation layer, and an architectural decision about sidecar-vs-document-provider. That is a multi-week effort spanning several folders. It is not wrong, but it under-states that this is a major refactor, not an incremental hardening, and offers no minimal-first slice that lands value without the protocol package.
- **A few correctness points are slightly under-specified.** The current `PULL_RESPONSE` handler (`ws-sidecar.ts:586-592`) applies the diff but never advances `lastServerSv` at all — the plan's point 5 talks about advancing it "only when the server includes a coordinator state vector," but doesn't explicitly call out that today it never advances, which is the more concrete bug to anchor on. Likewise the dead `if (participants.size > 0) {}` empty block (`ws-sidecar.ts:348-349`) is not mentioned; trivial, but symptomatic of the "implicit booleans" mess it wants cleaned.
- **`flushOutbound` "in_progress" sleep.** The plan correctly calls out replacing the 25ms sleep (`ws-sidecar.ts:448`) with deterministic waiting, but doesn't specify the mechanism (e.g., chaining onto the in-flight flush promise), leaving the hardest part as an exercise.
- **Migration safety for presence is asserted but not detailed.** It says preserve `CollaborationPresenceState` and not break `apps/spreadsheet` identity broadcasts, but does not enumerate the existing wire shape (`{ changes: { [pid]: stateJson } }`, double-JSON-encoded) that any validation layer must keep byte-compatible.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. The invariants are specific enough to write tests against, and the "tests to add" list maps cleanly onto them (lineage mismatch classes, out-of-order push responses, missing pushId, apply-failure-then-repair, final flush with in-flight apply, immutable presence snapshots, empty-map removal). The proposed fake-WebSocket harness is exactly what is missing today and would convert the skip-prone E2E suite into deterministic unit coverage — a real production-path improvement.

Verification gates are appropriate: focused per-file kernel tests, then `pnpm --filter @mog-sdk/kernel test/typecheck`, app-side collab tests, repo-wide typecheck, plus manual two-session UI convergence and reconnect/flush-on-dispose checks. The plan responsibly refuses to invent local acknowledgements to make final flush pass, and keeps structural-sync tests out of the transport success criteria until the compute cache-refresh dependency is fixed — a correct boundary. One gap: it does not define the exit criterion for the "make skips fail in CI" objective (which capabilities must be present for the gate to be considered satisfied vs. legitimately environment-skipped).

## Concrete changes that would raise the rating

1. **Add a minimal first slice** that delivers value without the missing server repo: (a) gate the unconditional `console.log` behind the diagnostics sink, (b) wrap `participants` exposure in a snapshot/frozen map, (c) promote `CollaborationRoomChangedRefetchError` to an exported typed error, (d) make `PULL_RESPONSE` advance `lastServerSv` correctly. These are pure-client, independently testable, and unblock immediately.
2. **Pin the `lastServerSv` bug precisely:** state that `PULL_RESPONSE` currently never advances it, and define the intended post-fix semantics tied to a coordinator SV field, including what happens if the server does not send one.
3. **Specify the deterministic-flush mechanism** (chain on the in-flight flush promise / await `applyChain` + pending-push settlement) instead of "instead of short sleeps."
4. **Document the existing presence wire shape** and require byte-compatibility tests before any validation/clamping layer ships, so the `apps/spreadsheet` contract is provably preserved.
5. **Mark the protocol-package track as dependency-blocked** and add a fallback (a single-source-of-truth client contract module with a version/feature field and a parity test fixture) that can ship before the server package is located.
6. **Add an explicit CI gate exit criterion** for which environment capabilities must be present for the collab stack tests to be considered enforced rather than skipped.
