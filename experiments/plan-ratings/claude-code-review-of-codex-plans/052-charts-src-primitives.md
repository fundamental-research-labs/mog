Rating: 8/10

# Review of 052 - charts/src/primitives Improvement Plan


## Summary judgment

This is a strong, evidence-grounded plan. I spot-checked nearly every distinctive technical
claim against the actual source in `mog/charts/src/primitives` (and its production consumers),
and they all hold:

- The mark type aliases really are `Extract<ChartMark, ...>` over `@mog-sdk/contracts/bridges`
  (`types.ts`), so the "bridge owns the IR, primitives own rendering" framing is correct.
- The grammar resolver **does** silently alias `pow`, `sqrt`, and `symlog` to a linear scale
  (`grammar/encoding-resolver.ts:298-304` collapses all three into `createLinearScale`), and
  `quantile`/`quantize`/`threshold` aren't handled at all — they fall through `default` to linear.
  This is exactly the "advertised-but-unimplemented scale type" gap objective 5 targets, and there
  are no primitive scale files for those types (`scales/` only has linear, log, time, ordinal, color).
- `CanvasRenderer` genuinely **duplicates** mark drawing: it defines its own `drawRect`/`drawArc`/
  `drawPath`/`drawSymbol`/`drawText` (`renderer/canvas-renderer.ts:130-225`) and only falls back to
  `renderMark` for unknown types — the "semantic drift between standalone and batched paths" is real.
- `WebGLRenderer.render` literally separates **all** circle symbols from other marks before drawing
  (`renderer/webgl-renderer.ts:512-525`), confirming the painter-order violation risk in objective 7.
- `ChartScale` is imported from the deep path `../primitives/scales/types` in production code
  (`algebra/color.ts`, `grammar/encoding-resolver.ts`) and is **not** re-exported from
  `scales/index.ts`, validating the public-surface cleanup task.
- `rangeRound` exists at runtime (`scales/ordinal.ts:123`) but is absent from `scales/types.ts`,
  validating the "missing type surface" task.
- `fill: 'none'`/paint `type === 'none'` sentinels are handled in `marks/rect.ts:49,111,117`, and the
  named production consumers (`kernel/src/domain/charts/bridge/chart-renderer.ts`,
  `apps/spreadsheet/src/infra/services/chart-image-exporter.ts`) exist at the cited paths.

Because the diagnosis is accurate, the plan's prescriptions are credible rather than speculative.
The reason it isn't a 9-10 is scope and one underspecified linchpin (below).

## Major strengths

- **Production-path tracing is excellent.** The plan names all four consumers (kernel sync paint,
  browser image export, DOM chart engine, node/native export) and ties each invariant back to them.
  This is the difference between "clean up a folder" and "preserve a contract across packages."
- **The invariants list is genuinely usable as a contract.** Arc-angle convention, symbol `size` =
  area, canvas state isolation, painter-order authority, mark-local CSS-pixel coordinates with DPR at
  the renderer boundary — these are concrete, testable, and correct against the code.
- **Verification gates are package-scoped and conditional** (charts vs kernel vs app-spreadsheet vs
  node/cargo), so a worker only runs the suites their change actually touches.
- **Parallelization slices are well chosen** (renderer / scale / resolver / hit-test / verification)
  with a stated central-integration owner, which matches the cross-package coupling.
- **Boundary discipline** (no `mog` → `mog-internal` dep; schema changes belong in contracts) is
  called out explicitly and repeated in non-goals.

## Major gaps or risks

- **The plan is really a program, not a single plan.** Seven objectives plus seven implementation
  sections span a near-total reworking of the folder (shared painting core, full scale matrix, new
  scale-type implementations, hit-test geometry rewrite, WebGL decision, integration tests across
  four packages). It is internally sequenced, but no effort/size estimate or phasing milestone is
  given, so "done" is not bounded. A reader cannot tell if this is days or weeks.
- **The equivalence harness — the linchpin of safety — is underspecified.** Step 3 says compare
  "semantic drawing operations after allowing for expected batching differences," but never defines
  what an "expected batching difference" is, what the comparison tolerance is, or how state-mutation
  ops (save/restore/setTransform/clip) are normalized between the per-mark and batched paths. The
  entire refactor's correctness rides on this gate, yet it's the vaguest part of the plan. Pixel
  vs op-recording trade-off (antialiasing/sub-pixel) is not addressed.
- **New scale implementations are sized as wiring.** Objective 5 lists `pow/sqrt/symlog/quantile/
  quantize/threshold` as things to "implement," but these are net-new primitive scales (no files
  exist today), each with its own invert/ticks/tickFormat/nice/clamp contract. That is substantial
  net-new code folded into a bullet, not a refactor of existing behavior.
- **No acceptance thresholds.** Gates list commands to run but no pass criteria beyond "tests pass."
  For an equivalence/visual-drift effort, the absence of a defined regression bar (e.g. zero op-diff
  for the slow path, bounded tolerance for batched) is a real gap.
- **The "contract document or inline test matrix" is left as an either/or**, so the canonical artifact
  (prose contract vs executable matrix) is ambiguous — a minor but recurring fuzziness.

## Contract and verification assessment

Contract clarity is the plan's best dimension: the canonical IR, coordinate space, painter order,
state isolation, and scale purity are all stated precisely and match the code. The scale-family
behavior enumeration (duplicates, reversed ranges, degenerate domains, non-finite inputs, UTC vs
local time, DST) is thorough and the right shape for a table-driven matrix.

Verification is good but incomplete. The per-package command list is correct and appropriately gated,
and the requirement to test through *real production render/scale paths* (not test shortcuts) plus a
real worksheet-chart browser exercise (not only `ChartPreview`) is exactly right given the kernel sync
paint and export consumers. What's missing is (a) a concrete definition and pass bar for the
renderMark-vs-CanvasRenderer equivalence comparison, and (b) acceptance thresholds tying the gates to
"no visual drift." The plan correctly identifies that equivalence tests must be established *before*
refactoring (Risks section), which partly mitigates this.

## Concrete changes that would raise the rating

1. **Specify the equivalence harness concretely**: define the recorded-op schema, list which canvas
   ops are compared vs normalized, state the tolerance, and give the pass bar (e.g. byte-identical op
   stream for `renderMark`/`renderMarks`; documented allowed reorderings for batched). This single
   change addresses the biggest risk.
2. **Split into phased milestones** with rough sizing: Phase A = equivalence harness + shared painting
   core (no behavior change); Phase B = scale contract + new scale types; Phase C = hit-test alignment;
   Phase D = WebGL decision + integration verification. Mark which phases gate which.
3. **Promote the new scale types to their own line items** with per-scale contract stubs (domain
   semantics, invert, ticks, edge handling) rather than a single enumerated bullet, since these are
   net-new implementations.
4. **State acceptance thresholds** for each gate (what counts as a regression for visual/op output)
   and name the specific existing app-spreadsheet chart/export tests instead of "relevant ... tests."
5. **Resolve the contract-artifact ambiguity**: commit to an executable test matrix as the canonical
   contract, with prose as derived documentation.
6. **Define the WebGL decision criteria up front** (the exact gates that must pass for promotion) so
   the "decide" task isn't deferred to implementer judgment.

---
Verification note: the only file created/modified by this review is
`mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/052-charts-src-primitives.md`.
All source inspection was read-only.
