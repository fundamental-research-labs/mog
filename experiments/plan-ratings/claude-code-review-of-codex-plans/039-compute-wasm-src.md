Rating: 8/10

# Review of Plan 039: Compute WASM Source Boundary Improvements

## Summary judgment

This is a strong, evidence-grounded plan for a deceptively small folder. `compute/wasm/src`
is a single 124-line `lib.rs` whose only job is to assemble the browser binding boundary, and
the plan correctly recognizes that the real work is not in editing that file but in hardening
the contract it embodies. Nearly every factual claim in the plan was verifiable against the
tree: `wasm-transport.ts:91` does dispatch via `fn(...Object.values(args))`; `build.sh`
genuinely appends a `__wbindgen_reset()` export to both the JS glue and `.d.ts`; the
`compute_wb_security_drain_events` "Unknown WASM function" regression is documented inline at
`lib.rs:108-113`; and `compute/napi/src/lib.rs` carries the same ~29 `ComputeService`
descriptor groups, confirming the drift risk is real and not hypothetical. The plan builds on
existing test infrastructure (`bridge-ts/tests/manifest_coverage.rs`,
`generate_compute_bridge.rs`, `generate_handler_registry.rs` all exist), so its proposed gates
are extensions of working harnesses rather than green-field invention.

The dominant weakness is that the crux objective — a single shared, "generated or macro-backed"
binding-surface manifest consumed by both WASM and N-API — is left architecturally open. The
plan describes the *property* it wants (no silent per-target drift) thoroughly but does not
commit to *how* the manifest is produced or where it lives, which is precisely the hardest and
riskiest part of the work.

## Major strengths

- **Diagnosis matches the production failure mode.** The plan is organized around the exact
  class of bug that already shipped: a descriptor present in N-API/TS metadata but absent from
  the WASM `generate!` list, surfacing only at runtime as `Unknown WASM function`. Objectives 1,
  2, 3 and the parity test (step 3) target this directly. This is the right thing to fix.
- **Contract inventory is accurate and specific.** The "contracts and invariants" section
  (lines 71-87) reads like it was written from the source: `doc_id`-first at the JS boundary,
  `(Vec<u8>, MutationResult)` → `[Uint8Array, MutationResult]`, `compute_set_current_time`
  injection before recalc, no `SystemTime::now()` on the formatter path (confirmed by the
  `.without_time()` call at `lib.rs:27`), and the dual reset of transport reference + wasm-bindgen
  cached views. These are the genuine invariants a reviewer would lose sleep over.
- **Verification is real-module, not codegen-only.** Objective 7 and steps 8-10 insist on a
  smoke that loads the actual built `@mog-sdk/wasm` after `build.sh --profile dev`, exercises a
  bytes-tuple command, an XLSX parse, lifecycle teardown, and reset/reload. This closes the gap
  the plan itself names: macro tokens compiling proves nothing about the emitted package.
- **Risks section is honest about second-order effects.** It flags that descriptor
  centralization can *expose* converter gaps that manual lists hid (line 177) — i.e., the work
  may surface latent failures rather than only preventing them. That is the correct framing.
- **Good gate selection.** The listed gates (`cargo test -p bridge-wasm`, the bridge-ts generate
  tests, `pnpm --filter @mog/transport test/typecheck`, release-profile build + asset
  verification) map onto tooling that demonstrably exists, with a sensible split between
  per-change gates and heavier release-readiness gates.

## Major gaps or risks

- **The shared manifest mechanism is underspecified — and it is the keystone.** Steps 1, 2, and
  12 all hinge on "a generated or macro-backed manifest" / "public binding prelude," but the plan
  never decides between a generated artifact, a proc-macro, or a shared const, nor names the
  crate that owns it. Given that WASM (`use super::*;` semantics in the generated module) and
  N-API have different bare-identifier import needs, this abstraction is non-trivial and could
  fail to factor cleanly. Leaving it open means the highest-risk decision is deferred to
  implementation time.
- **Scope vastly exceeds the nominal folder.** The implementation plan touches `compute/napi`,
  `infra/transport`, `bridge-ts`, `bridge-wasm`, `xlsx-api`, the kernel compute bridge, and the
  app/embed runtimes (the dependency list at lines 206-216 names eight folders). The plan
  acknowledges this and gates it as "only where necessary to make the boundary verifiable," but
  a 16-step, 6-parallel-agent program is large for a folder whose own source is one file. There
  is real risk this becomes a multi-folder refactor wearing a folder-plan label, complicating
  sequencing and review.
- **camelCase/snake_case mapping is named as a risk but never resolved.** Steps 4-5 propose
  `WASM_COMMAND_PARAM_ORDER` to replace `Object.values(args)`, and the risks section (lines
  178-179) correctly notes that generated `.d.ts` uses snake_case Rust param names while TS
  bridge methods pass camelCase keys. But the plan only says metadata "must define the exact
  mapping" without specifying it. Since this directly governs whether browser dispatch sends
  arguments in the right slots, an unresolved mapping is a correctness hazard, not a detail.
- **Parallelization has hidden ordering dependencies.** Agents A/B produce the manifest and
  metadata that C and D consume; E depends on the built package from C; F depends on everything.
  The "parallel" framing understates that A→B→C/D→E is effectively a chain. The plan would
  benefit from stating the barrier points rather than presenting six agents as independent.
- **Idempotent `wasm_start` via `try_init()` needs more care.** Step 11 swaps `.init()` for a
  non-panicking path, but the current code uses `registry().with(fmt_layer).init()`. The plan
  should confirm whether `try_init` is available on this builder shape and what "documented
  ignored already-initialized case" means for the second module load — otherwise this is a
  plausible-looking change that may not compile as described.

## Contract and verification assessment

The contract section is the plan's best feature: it enumerates the boundary invariants with
enough precision to write tests against, and the proposed contract tests (parity, expected
export set against the *built* package, param-order, lifecycle create/destroy/recreate,
return-shape across all seven categories, error-shape, reset/reload) cover the surface
comprehensively. The return-shape and error-shape tests are particularly well-judged because
they distinguish raw WASM output from post-normalization transport output (line 182), which is
exactly where subtle drift hides.

Two gaps keep this from full marks. First, several gates name tests that do not yet exist as
named entities (`--test manifest_coverage` exists, but the WASM export smoke, param-order
comparison, and behavior smoke are net-new and named only descriptively) — fine for a plan, but
the freshness-check step (15) assumes a single regeneration command and one failing stale test
without naming either, so "regenerate via one obvious command" is asserted, not designed.
Second, the plan does not state an acceptance threshold for the browser runtime smoke (line 161)
— "performs a real workbook edit/recalc" is a behavior, not a pass condition, and a reviewer
cannot tell what failure would block release.

## Concrete changes that would raise the rating

1. **Commit to the manifest mechanism.** Pick generated-artifact vs. proc-macro vs. shared
   const, name the owning crate (the dependency list implies `compute-api` or a bridge crate),
   and sketch how WASM's `use super::*;` import expectations are satisfied without
   per-target hand-editing. This is the single change that would most de-risk the plan.
2. **Specify the camelCase↔snake_case param mapping** concretely (which layer canonicalizes,
   and how `doc_id`/`docId` is reconciled) rather than deferring it to "metadata must define."
3. **Redraw the parallelization as a dependency graph with explicit barriers** (A/B → C/D → E →
   F), so the sequencing risk is visible up front.
4. **Name the regeneration command and the freshness test** in steps 13/15, and add a stated
   pass/fail condition for the browser runtime smoke in the release gates.
5. **Validate the `try_init` change against the actual subscriber builder** in `lib.rs:24-29`,
   or specify the exact non-panicking installation pattern, so step 11 is implementable as
   written.
6. **Add an explicit folder-boundary statement** clarifying that edits to `compute/wasm/src`
   itself are limited to consuming the shared surface + prelude and the `wasm_start` change, with
   all other work tracked as cross-folder dependencies — keeping the plan honest about what lands
   in this folder versus elsewhere.
