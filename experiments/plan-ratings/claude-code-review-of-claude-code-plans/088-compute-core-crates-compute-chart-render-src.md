Rating: 9/10

# Review of Plan 088 — `compute-chart-render/src`


## Summary judgment

This is an unusually strong plan. It is grounded in an accurate reading of the actual
crate, and every load-bearing factual claim I spot-checked against the source holds up.
The plan correctly frames the crate's role (stateless "mark IR → pixels" renderer, chart
semantics owned by TypeScript), enumerates concrete, verifiable defects, orders them by
production impact, and surrounds the risky parts with explicit invariants and verification
gates. The diff strategy (Phase 0 pure-move modularization first, then independent feature
phases) is exactly right for keeping a 1,730-line single-file crate reviewable. The single
biggest correctness risk — browser-canvas parity for text wrapping/fallback — is named as
the primary risk and made a gate, not an afterthought.

Verification against the real code confirms the plan's premises:
- `RawMark` (lib.rs) has **no** `max_width`/`line_height` fields, while the TS exporter
  (`node-chart-image-exporter.ts`) declares and sends `maxWidth`/`lineHeight`
  (`SerializableTextMark`, lines 105–106, 266–267). The drift claim is real, not
  hypothetical — and it is the strongest possible motivation for the Phase 7 parity gate.
- `render_text` resolves a single styled face and never calls `mark_clip` / passes no mask
  to its draw path, whereas `rect`/`path`/`arc`/`symbol` all honor clip via `mark_clip` +
  `clip_mask`. The clip-inconsistency claim is accurate.
- `physical_dimension` rejects only non-finite/non-integer/`> u32::MAX`, so a giant pixmap
  request is genuinely unbounded until `Pixmap::new` fails — the DoS-surface claim is real.
- `FontDb::with_defaults()` is called inside the per-render surface constructor, and
  `render_text` re-parses both a `rustybuzz::Face` and a `ttf_parser::Face` per text mark —
  the caching opportunity is real.
- The sibling crate exposes `wrap::wrap_text`, `shaper::measure_text_width`,
  `shaper::measure_line_height`, `FontDb::needs_cjk`, and `FontDb::load_cjk` — the reuse
  premise is sound.

## Major strengths

- **Evidence-based, not aspirational.** Claims name specific functions, fields, and
  divergences; I could confirm each one in the source. This is rare and high-value.
- **Contract section is excellent.** The "invariants to preserve" list captures the
  non-obvious traps a naive implementer would break: the premultiplied-vs-straight-alpha
  invariant (currently masked by always-opaque background), the intentional `size*dpr*dpr`
  area-scaling for symbols, the `round(w*pr) × round(h*pr)` dimension contract the TS
  exporter asserts on, and the DPR-at-path-build-time convention. Calling these out
  pre-empts the most likely regressions.
- **Backward-compat discipline.** Explicitly forbids bumping `version: 1` for additive
  optional fields and requires old/omitting requests to keep working — correct.
- **Sequencing and parallelization.** Phase 0 as a pure move that "blocks nothing but
  eases everything," then 3/4/5 declared mutually independent, with the text phases (1/2)
  flagged as the ones needing a canvas parity reference. This is a realistic dependency map.
- **Strictness asymmetry is precisely stated.** "Color parsing is the one area to loosen;
  keep numeric/mark validation strict." This is the right and non-obvious nuance.

## Major gaps or risks

- **`wrap_text` API mismatch (minor but concrete).** Phase 1 says use `wrap::wrap_text` to
  "compute break points; render each resulting line," but the sibling signature is
  `wrap_text(face, font_size, text, max_width) -> usize` — it returns a count, not break
  positions or line slices. As written it cannot drive per-line rendering without either a
  sibling-crate addition (line-segmentation API) or re-deriving breaks locally. The plan
  hedges ("coordinate if its API needs a small addition") but should state plainly that
  Phase 1 likely requires a new `compute-text-measurement` entry point, which makes Phase 1
  not purely read-only on that crate.
- **CJK font availability is an unresolved blocker, not a step.** Phase 2 offers options
  (a)/(b) but leaves the actual decision — and whether CJK bytes can even be shipped/threaded
  — open. The tofu/`.notdef` floor is a good fallback, but the phase's headline goal
  (render CJK) is contingent on a provenance/binary-size decision the plan can't close on its
  own. This is correctly flagged under risks, yet Phase 2 still reads as if it's
  schedulable; it should be gated behind that decision explicitly.
- **No concrete cap values.** Phase 4's `MAX_IMAGE_DIMENSION` / `MAX_TOTAL_PIXELS` are left
  as "e.g." A plan this precise should propose actual numbers (or a derivation from the
  exporter's known max export size) so the gate isn't relitigated at implementation time.
- **Canvas-parity reference is named but not located.** The plan points at
  `mog/kernel/src/domain/charts/...` as the parity source but doesn't confirm the exact
  wrap/truncate/baseline-anchoring code there. Since parity is the #1 risk, an upfront
  pointer to the specific canvas routine would de-risk Phases 1–2 substantially; leaving it
  as "derive behavior from the canvas implementation" defers the hardest investigation.
- **"Byte-for-byte if feasible" single-line test** is likely infeasible if Phase 1 swaps
  `measure_text_advance` for `shaper::measure_text_width` (different rounding can shift a
  pixel). The plan even proposes that swap in the same phase, so the no-change baseline test
  may need softening to a coverage/quantized-hash assertion.

## Contract and verification assessment

Strong. The plan does not run commands (per its constraints) but specifies the gates an
implementer must satisfy, and they are well-targeted: existing named tests must stay green
(it lists them), new unit tests map one-to-one onto each objective, and the snapshot tests
sensibly hedge against AA/platform float nondeterminism by hashing quantized/downsampled
buffers rather than exact bytes. The premultiplied-alpha guard test (semi-transparent fill
over opaque background, check interior straight-alpha) is the right test for the most
dangerous invariant. The contract-parity gate (shared fixtures consumed by both Rust and TS,
"all fields consumed" assertion) directly addresses the root cause of the `maxWidth` drift
and is the highest-leverage item in the plan. The NAPI surface is correctly identified as
unchanged. The one weakness is that several gates depend on behavior (canvas parity, exact
cap, wrap semantics) the plan hasn't fully pinned down, so the gates are well-specified but
some of their *expected values* remain TBD.

## Concrete changes that would raise the rating

1. Resolve the `wrap_text` API gap: state whether Phase 1 adds a line-segmentation function
   to `compute-text-measurement` (and thus edits that crate) or derives breaks locally, and
   reflect that in the dependency/parallelization notes.
2. Make Phase 2 explicitly conditional: a decision step "confirm CJK font bytes are
   shippable + provenance-cleared" that gates the CJK work, with the tofu fallback as the
   committed deliverable if the answer is no.
3. Resolve the wrap-vs-truncate question up front by citing the exact browser-canvas chart
   text routine (file + function), rather than deferring it into Phase 1 — it is the gating
   correctness decision.
4. Propose concrete `MAX_IMAGE_DIMENSION` / `MAX_TOTAL_PIXELS` values tied to the exporter's
   real maximum export size.
5. Soften the "byte-for-byte single-line" test to a quantized/coverage assertion, since
   Phase 1 intentionally changes the measurement function.
