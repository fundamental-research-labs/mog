Rating: 9/10

# Review of Plan 070 — Harden `mog/infra/transport/src`

## Summary judgment

This is a strong, evidence-grounded plan. It demonstrates genuine comprehension
of the transport layer: the middleware composition order per host, the four
host-specific impedance mismatches (serde encoding, case, binary tuples, time),
the error taxonomy, and the lifecycle interception that makes NAPI behave like
WASM/Tauri. Every appendix evidence anchor I spot-checked is accurate:

- `napi-transport.ts` does layer three serde strategies — generated
  `NAPI_SERDE_PARAM_INDICES` (line 10/163), the hand map
  `DEFAULT_NAPI_SERDE_PARAMS` (lines 39–129), the per-call `Set` union in
  `getNapiSerdeIndices` (lines 159–167), and the type-based heuristic that the
  code itself flags as INCORRECT for primitive `[serde]` params (lines 273–277).
- `createHeadlessNapiTransport` does hardcode `() => 'UTC'` (line 361), with the
  acknowledging doc comment at lines 355–360.
- The WASM construction sequence is written three times (`factory.ts:68–77`,
  `:104–113`, `factory.browser.ts:46–55`) and the NAPI sequence twice
  (`factory.ts:57–65`, `:88–93`), matching the duplication claim.
- `bridge-error.ts:21` points at `__tests__/bridge-error-shape.test.ts`, which
  does not exist; the real file is `bridge-error.test.ts`, and its
  `it.each<BridgeError['kind']>([...])` enumeration is a hand-maintained list
  keyed off the TS union — it does NOT pin against the Rust enum, so a Rust-only
  variant addition would not fail the TS build. The plan's diagnosis is correct.
- `case-normalize.ts:94–98` rebuilds every plain object key-by-key on every
  response with no already-camelCase fast path, confirming the Phase F target.
- `NAPI_PARAM_ORDER` does not exist in `command-metadata.gen.ts` (grep empty),
  confirming objective 5 needs a new codegen emit.

The plan correctly identifies the highest-value, highest-risk work (serde
single-source-of-truth) and sequences it first. It is scrupulous about scope
boundaries — it refuses to hand-edit the generated artifact or configs, instead
routing fixes to the owning surface (codegen / package owner), which is the
right instinct for a generated-metadata dependency.

## Major strengths

- **Correctness framing is exact, not vibes.** It names silent FFI data
  corruption as the stakes of objective 1 and ties each objective to a concrete,
  verifiable production contract. The "Production-path contracts and invariants"
  section is unusually good: trap-classification narrowness, `resetWasmModule`
  dual-cache clearing, time-serial epoch parity, bytes-tuple LE length, browser
  bundle purity, loader idempotency — these are the real load-bearing invariants
  and they are spelled out as preservation constraints, not afterthoughts.
- **Each fix is staged behind a fallback before deletion.** Phase A keeps the
  (b)/(c) residue behind an asserted fallback until confirmed by integration
  test; the heuristic is demoted to a fenced/logged path (throw in dev, warn in
  prod) rather than ripped out. This is the disciplined way to retire a
  load-bearing heuristic without a flag day.
- **Defaults-preserving by construction.** Phases B and C are explicitly
  behavior-preserving (UTC default retained, opt-in TZ resolver), so no consumer
  edits are forced — and the plan says so and routes the kernel wiring to a
  follow-up. The dependency on the bridge codegen is called out as a hard
  dependency with a recommended landing order (codegen emits first).
- **Verification gates are specific and mostly falsifiable.** Table-driven serde
  cases per representative `[serde]` shape, a factory-parity structural test, a
  TZ day-boundary differential test, an arg-order trip test, a synthetic-extra-
  kind error-shape test, plus the bundle-purity assertion on
  `dist/index.browser.js`. These map cleanly to the objectives.

## Major gaps or risks

- **The plan's value is gated almost entirely on out-of-folder codegen work.**
  Objectives 1, 2, 5, and 6 require additive emits and corrected `[serde]`
  annotations in `bridge-ts`/compute-core. The plan acknowledges this, but the
  practical consequence is under-stated: the transport-side PR can land little of
  substance until that coordination completes. The plan would be stronger with an
  explicit decoupled fallback — e.g. land the precompute (4) and the fenced
  heuristic (5) immediately since they need no codegen, and stage the hand-map
  retirement separately.
- **Phase A step 1 (the audit table) is the actual crux and is deferred to "the
  PR description."** The hardest, most error-prone judgment — classifying each of
  the ~50 hand-map commands as identical / superset / conflict — is the work that
  determines whether reclassification breaks live commands. Producing that table
  is itself a sizable investigation that the plan treats as a single bullet.
  A genuine conflict (case c) implies the running binary's serde annotation
  disagrees with the hand map's belief, which is exactly where silent corruption
  hides; the plan should commit to integration-testing each (c) against a real
  engine before any deletion, not just "investigate."
- **Phase F is soft and may not be actionable.** Driving Rust-side
  `rename_all = "camelCase"` coverage "high enough" has no defined target or
  measurement threshold, and the stale-binary risk means the walk can never
  actually be removed — only made allocation-light. The plan correctly keeps the
  net, but objective 7 as stated ("make the walk a no-op safety check") slightly
  overpromises; the realistic deliverable is just the fast-path optimization.
- **The arg-order guard (Phase D) is compiled out in production**, so the very
  scenario it protects against — a codegen reordering keys — would only be caught
  in dev/test, not in a production build running an updated client. That is a
  reasonable perf tradeoff, but it means the guard is a CI gate, not a runtime
  safety net; the plan should say so plainly.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. The `BridgeTransport.call`
signature is correctly identified as the immutable public seam; docId
strip/passthrough asymmetry, lifecycle interception (including the
`compute_init_from_yrs_state` collaboration path, which exists at
`napi-transport.ts:420`), and trap-classification narrowness are all preserved
as named invariants. The serde contract is sharpened from "generated ∪ hand ∪
heuristic" to "generated, verified complete" — the right target.

Verification gates are concrete and tied to existing test files that I confirmed
exist (`napi-transport-serde.test.ts`, `time-injection.test.ts`,
`synthetic-trap.test.ts`, `trap-error.test.ts`, `wasm-loader-reset.test.ts`,
`lazy-napi-transport.test.ts`). The codegen-drift gate and bundle-purity check
are appropriate. One soft spot: the "property-style check that every command in
`NAPI_SERDE_PARAM_INDICES` round-trips through a stub engine without throwing the
new guard" only proves the guard isn't over-firing — it does not prove the serde
encoding is *correct* for those commands; correctness still rests on the (largely
manual) Phase A audit. The plan would benefit from naming an integration-level
oracle (real engine round-trip of stringify-vs-passthrough) as the correctness
backstop rather than relying on the per-shape table being exhaustive.

## Concrete changes that would raise the rating

1. **Decouple the codegen-independent work into a first, shippable PR**: the
   `getNapiSerdeIndices` precompute (objective 2, step 4), the fenced/logged
   heuristic (step 5), the factory dedup (Phase B), and the headless TZ thread
   (Phase C) all land without any bridge-codegen change. Make that the critical
   path; stage the hand-map retirement behind the codegen.
2. **Promote the Phase A audit to a deliverable with a defined artifact and
   gate**: commit the classification table into the repo (or the PR), and require
   an integration test against a real `.node` engine for every (b)/(c) command
   before its hand-map entry is deleted. State the rollback if a (c) conflict is
   found.
3. **Give Phase F a measurable bar** (e.g. "no rename observed on full-sheet read
   / large range / XLSX parse-meta in the profiling spike") and restate
   objective 7's deliverable as the allocation-light fast path, explicitly
   conceding the walk stays for stale-binary safety.
4. **State plainly that the Phase D guard is a dev/CI-only gate**, not a
   production runtime check, and confirm the production build genuinely compiles
   it out (so it doesn't add per-call overhead on the hot path).
5. **Resolve the bridge-error doc/file inconsistency decisively**: pick one name,
   and require the new test to import a generated `BRIDGE_ERROR_KINDS` list so the
   gate is cross-language-enforced rather than a hand-maintained TS array (the
   current `bridge-error.test.ts` weakness the plan correctly diagnoses).
