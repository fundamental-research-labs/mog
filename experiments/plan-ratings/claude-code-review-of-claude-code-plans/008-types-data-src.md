Rating: 8/10

# Review of 008 — `mog/types/data/src`


## Summary judgment

This is a strong, unusually well-grounded plan. I independently verified a broad
sample of its evidence against the live tree and every claim I checked held:
the 12-file inventory and line counts match exactly; `index.ts:23` is `export {};`;
`ColumnFilterCriteria` (filter.ts:120) is a flat interface with a `type` discriminant
and all six payloads co-present and optional; the three divergent aggregate spellings
(`pivot.stdev|stdevp|var|varp|counta`, `grouping.stdDev|stdDevP|var|varP|countNums`,
`tables.stdDev|var|countNums`) are real; `SingleAxisConfig` carries the full set of
`?: string` fields plus the `alignment` alias and `@deprecated type`/`show`; `extra?: unknown`
and the `zOrder: 'front'|'back'|...` command enum live inside `ChartConfig`; the
pivot/sparklines/grouping "kept in sync manually" headers exist verbatim; and the table
migration is exactly backwards with precisely **2** `.rangeIdentity` readers repo-wide.
This level of citation accuracy is the plan's defining strength and makes it trustworthy.

The plan correctly frames a near-pure type package: "improvement" = completeness,
internal consistency, fidelity to the generated Rust source of truth, and making illegal
states unrepresentable, without weakening cell-identity / CRDT / wire invariants. It is
explicit about scope, out-of-scope coupling, tier boundaries, sequencing, and the cross-folder
ripple each step triggers. The verification section is appropriate for a `.d.ts`-surface package.

The deductions are about a few places where the proposed *mechanism* is in mild tension with
the cited evidence, where the headline objective may not be completable inside this folder, and
where per-step acceptance criteria are thinner than the rest of the document.

## Major strengths

- **Evidence fidelity.** Nearly every claim carries a file:line citation that checks out.
  This is the difference between a plan a worker can execute and one they must re-derive.
- **Invariant awareness.** The "contracts and invariants to preserve" section is excellent:
  it names cell-identity load-bearingness, wire/serde compatibility (member names are the
  serde contract), the Tier-1 import boundary, the intentional CF re-export cycle break in
  `data/index.ts`, and the single legitimate runtime value (`DEFAULT_SHEET_GROUPING_CONFIG`).
- **Risk-ordered sequencing.** Additive/isolated steps (barrel, discriminant, axis unions,
  `schemaVersion`) land first; high-ripple and cross-folder-blocked steps (vocab, branding,
  migrations, generated re-export) come later with explicit dependency notes and a sane
  intra-folder ordering (e.g. Step 7 before Step 6 so canonical fields exist before aliases die).
- **Honesty about the hardest decision.** Step 10 (re-export generated types instead of
  hand-mirroring) is correctly identified as the #1 objective *and* as the one with an
  unresolved import-direction hazard; the plan gives a defensible floor (a CI drift check)
  while naming the real goal (single source of truth, not perpetual hand-sync).
- **Right gates for a type package.** Workspace typecheck as the primary gate, `.d.ts`
  exported-symbol diffing, serde round-trip as a *hard* gate (with the correct callback to the
  prior chart-series `undefined`/non-`Option` serde breakage), and import-boundary lint.

## Major gaps or risks

- **Step 3's Extract/Pick mechanism contradicts the casing evidence.** The plan proposes
  deriving `TotalFunction`/`SubtotalFunction`/pivot `AggregateFunction` from one canonical
  family "via `Extract<…>`/`Pick`-style aliases." But the evidence the plan itself cites shows
  the three vocabularies differ by *casing and member naming* (`stdev` vs `stdDev`, `counta`
  vs `countNums`), so they are not subsets of a common string-literal union and cannot be
  `Extract`-derived without renaming members. Renaming members that cross a serde/persistence
  boundary is precisely the breaking change the plan elsewhere forbids. The plan acknowledges
  "reconcile casing to the wire spelling (generated pivot wins)" but does not establish whether
  `SubtotalFunction`/`TotalFunction` actually serialize to the Rust core; if they do, this step
  is a wire-breaking rename, not a safe type-only refactor. The mechanism and the safety claim
  need reconciling before this step is shippable.
- **The headline objective (Step 10) may not be completable in this folder.** Objective 1 is
  the most valuable change, yet the plan concedes resolving where generated type-only shapes
  should live "may not be fully closable within this folder alone." That is honest, but it means
  the plan's marquee deliverable degrades to a drift-check in the realistic case — worth stating
  up front in the objectives, not only in Risks.
- **Per-step acceptance criteria are light.** Verification is described globally and well, but
  most steps lack a crisp done-definition (e.g. "exported-symbol diff shows only N additions and
  zero removals/renames," or "serde round-trip corpus unchanged"). For a contract package where
  the whole point is *no accidental surface change*, each step should bind to a measurable gate.
- **"Each step is independently shippable" is overstated.** Steps 5 and 6 explicitly require a
  multi-commit, cross-folder sequence (populate → flip optionality → delete; migrate ~200 refs →
  remove aliases). The Risks section says this correctly; the implementation-plan preamble
  oversells it.
- **`schemaVersion` (Step 9) under-specified.** The plan adds versioning to six persisted Yjs
  types but does not state whether the field is required vs optional, its initial literal value,
  or how read-of-old-documents default-fills it beyond "persistence code must default-fill."
  Adding a required field to a persisted shape without a migration story is itself a risk.

## Contract and verification assessment

The contract analysis is the best part of the plan. It treats union members and field names as
the serde contract, insists vocabulary unification *map to* rather than replace the wire spelling,
preserves the deliberate CF re-export, and refuses to physically nest previously-flat `ChartConfig`
fields (keeping decomposition structural via `&`/optionals). The discriminant strengthening is
correctly characterized as additive to safety with an unchanged serialized form.

Verification gates are appropriate and complete for a type-only package: project-wide typecheck,
declaration emit + symbol-list diff, serde/OOXML round-trip as a hard gate, generated-vs-mirror
drift check, and import-boundary lint. The one gap is the absence of per-step pass/fail bindings
(see above) and the unaddressed question of whether the Step 3 casing reconciliation triggers the
serde gate it relies on — i.e. the gate exists but the plan does not predict it will fire.

## Concrete changes that would raise the rating

1. **Resolve the Step 3 contradiction.** Determine whether `SubtotalFunction`/`TotalFunction`
   serialize across the Rust boundary. If they do, replace the `Extract`/`Pick` framing with an
   explicit *mapping layer* (canonical TS vocabulary ↔ wire spelling) and keep the on-wire members
   byte-identical; if they do not, say so and justify the rename. Either way, predict whether the
   serde gate fires for this step.
2. **Promote the realistic Step 10 outcome into the objectives.** State that the in-folder
   deliverable is the drift check + canonicalization where the tier allows, and that true
   single-source-of-truth depends on a kernel/codegen decision tracked elsewhere.
3. **Add per-step acceptance criteria.** Bind each step to a measurable gate — e.g. exported-symbol
   diff (additions only), serde corpus unchanged, branded-ID typecheck reaches zero errors.
4. **Down-scope the "independently shippable" claim** to the genuinely isolated steps (1, 2, 7,
   9-versioning, 7) and mark 5/6/10 as multi-commit cross-folder sequences.
5. **Specify `schemaVersion` shape and migration default** (optional vs required, initial value,
   read-path default-fill) for the six target types.
6. **Note that Step 1 is largely already done.** `index.ts` already carries the subpath-only doc
   block; the only actionable choice is whether to populate `.` via `export * from './data'`.
   Framing it as a decision still to be made slightly overstates remaining work.
