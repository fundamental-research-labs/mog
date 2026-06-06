Rating: 9/10

# Review of Plan 039 — Harden the browser WASM binding boundary (`compute/wasm/src`)


## Summary judgment

This is an unusually strong, evidence-grounded plan. It targets a single 124-line
file (`compute/wasm/src/lib.rs`) but correctly identifies the highest-leverage
problem in it — the hand-duplicated descriptor list shared with the NAPI binding —
and anchors the whole plan on retiring the class of bug that already caused a
production fire drill (FIX-004). Nearly every factual claim I spot-checked against
the live source is accurate:

- `lib.rs` is exactly the structure described: `wasm_start` (panic hook +
  `tracing-web` subscriber, `without_time()`, `.init()` with **no** level filter),
  a wall of `#[allow(unused_imports)] use ...::*;` globs, and a ~40-entry
  `bridge_wasm::generate!` invocation (`lib.rs:80-123`).
- The duplicated descriptor list in `compute/napi/src/lib.rs:62-108` is
  byte-for-identical in group names, and `chart_render` / `coordinator` are
  indeed NAPI-only modules (`napi/src/lib.rs:110-111`) — confirming the
  intentional-platform-difference non-goals.
- The FIX-004 incident note is real and in-source (`lib.rs:108-114`).
- `emit.rs:53-55` generates `__bridge_descriptor_{Type}_{group}` exactly as the
  plan's Phase 1 mechanics assume; no roll-up/parity macro exists today.
- `wasm-transport.ts` classifies traps via `instanceof WebAssembly.RuntimeError`
  + exact `TRAP_MESSAGES.has(err.message)` and has the `Unknown WASM function`
  path — matching the Phase 3 gap analysis precisely.
- `chrono` is configured with `wasmbind` (`compute/wasm/Cargo.toml:62-63`),
  validating the "no `SystemTime` on wasm32" invariant.

The plan reads as written by someone who actually traced the code, not someone
paraphrasing a README. That accuracy is the single biggest reason for the high
rating.

## Major strengths

- **Correct problem prioritization.** It resists the obvious-but-wrong move
  (chase WASM/NAPI feature parity by porting `chart_render`/`coordinator`) and
  instead names that as an explicit non-goal with evidence. The anchor (single
  source of truth for the descriptor list) is the genuine production risk.
- **Contracts are concrete and falsifiable.** Symbol-name stability witnessed by
  the generated `.d.ts`; the no-clock invariant tied to `wasmbind`; trap = dead
  instance tied to the JS classifier. These are real invariants, not platitudes.
- **Verification gates map to the failure modes.** The surface-parity test is
  explicitly framed as "would have caught FIX-004," and the `.d.ts` snapshot diff
  is the right safety net for a "must be symbol-neutral" refactor.
- **Honest scoping.** It repeatedly flags that the substantive work (manifest
  emission) lands in `compute/api`/`compute/core`/`bridge-core`, outside the
  reviewed folder, and records those as cross-folder dependencies rather than
  pretending they're in-scope.
- **Independent, shippable phases** with a sensible sequencing note (Phase 4 as
  low-risk warm-up; Phases 2–3 additive Rust-first, JS consumes later).

## Major gaps or risks

- **The anchor's deliverable is thin *within this folder*.** Once the manifest
  exists, the `compute/wasm/src` change is "replace 40 lines with one macro
  invocation." The real engineering — emitting the roll-up manifest from the
  bridge generator — lives elsewhere. The plan is honest about this, but a reader
  scoring the *folder's* plan should note the headline value is mostly exported
  to other folders' plans, which weakens this plan as a standalone unit of work.
- **Manifest vs. parity-test redundancy is under-reconciled.** If both bindings
  consume the *same* generated manifest, the lists are identical by construction
  and the parity test becomes near-tautological belt-and-suspenders. The test
  only earns its keystone status in the *hand-written fallback* path. The plan
  should state plainly which world it's in: if the generator emits the manifest,
  the parity test's value is mostly guarding the platform-only exception list;
  if hand-written, the test is load-bearing. Right now it's pitched as keystone
  in both, which overstates its value in the codegen path.
- **Generator feasibility is asserted, not demonstrated.** `emit.rs` currently
  emits one macro per group in separate expansions; producing a single roll-up
  that enumerates *all* groups requires the generator to see the full group set
  in one pass. The plan hand-waves this with "ideally via the bridge generator"
  and a fallback. A short note on whether the bridge derive actually has the
  whole-type view at emit time (vs. per-method expansion) would de-risk Phase 1
  materially — this is the one place the plan could be proposing something the
  macro architecture can't cheaply support.
- **`set_log_level` / `reload::Handle` adds runtime machinery** for a
  debugging-ergonomics win. The plan flags the per-event indirection cost but
  doesn't weigh it against simply gating verbosity at the URL-param/loader level
  before init. For a hot-path-sensitive engine, "is a reloadable filter worth it
  vs. a static `WARN` + rebuild-to-debug" deserves an explicit decision, not just
  a risk bullet.
- **Default-to-`WARN` behavior change.** Today every event reaches the console;
  switching to `WARN` silently drops `info!` diagnostics some workflow may rely
  on. Listed as a risk, but no migration/comms step (e.g. announce in dev docs).

## Contract and verification assessment

The contract section is the plan's strongest part: it distinguishes
preserve-vs-strengthen, ties each invariant to a concrete witness, and the
symbol-stability + no-clock invariants are exactly the ones a refactor here could
break. The verification gates are well chosen and layered (preventive parity test
+ end-to-end app-eval load smoke + `.d.ts` snapshot). Two gaps:

1. The `.d.ts` snapshot gate depends on **macro-expansion ordering determinism**;
   the plan mentions this once as a risk but doesn't specify how ordering is
   pinned (the manifest macro must expand groups in a fixed order). Without that,
   the snapshot gate flaps.
2. The "no-clock guard" (test 4) is described as a `deny`/grep or smoke test, but
   reachability of `SystemTime` through a new filter/`reload` layer isn't
   trivially grep-able — a symbol-presence check on the linked wasm would be more
   robust than a source grep. The plan offers both but should commit to the
   stronger one.

Given the constraint that the plan itself runs no build/test commands, framing
these as "gates the implementing change must add and pass" is appropriate.

## Concrete changes that would raise the rating

1. **Resolve the manifest-vs-parity-test tension explicitly.** State the primary
   design (generator-emitted manifest) and demote the parity test to "guards the
   platform-exception list + the hand-written fallback," or commit to the
   hand-written manifest and make the parity test the keystone. Don't claim both.
2. **Add a one-paragraph feasibility check on emitting a roll-up macro from
   `bridge-core/emit.rs`** — does the derive see the full group set in a single
   expansion, or would the manifest itself have to be assembled per-type? This is
   the plan's single biggest unproven assumption.
3. **Pin macro-expansion ordering** as an explicit requirement for the manifest,
   so the `.d.ts` snapshot gate is stable.
4. **Make a real call on `reload::Handle`** vs. a static filter set from a
   loader-supplied value before init — justify the runtime machinery or drop it.
5. **Quantify the in-folder vs. cross-folder split** (e.g. "this folder's net
   diff is ~−40/+5 lines; the leverage is in the linked `compute/api` plan") so
   the scope expectation is unambiguous.
6. Add a brief **dev-comms/migration note** for the `WARN` default change.

None of these are correctness problems with the analysis — they're sharpenings of
an already-solid plan. The deduction from 10 is for the thin in-folder
deliverable, the unproven generator-feasibility assumption, and the
manifest/parity-test redundancy that the plan presents as fully complementary
when it is only partly so.
