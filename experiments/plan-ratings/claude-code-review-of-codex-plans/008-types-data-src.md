Rating: 8/10

# Review of Plan 008 — `types/data/src`


## Summary judgment

This is a strong, accurately-grounded plan for hardening the structured-data
domain-contract package. Nearly every factual claim it makes about the folder
checks out against the actual source, and the verification gates it names are
real, pre-existing repo scripts rather than invented ceremony. It correctly
identifies the central tension of this package — that it co-mingles canonical
public contracts, mirrors of generated compute DTOs, render snapshots, and
manager interfaces in one place with no machine-checkable ownership — and its
remediation strategy (ownership matrix → parity gates → layered split →
consumer integration) is sound and well-sequenced at the macro level.

It loses points for open-ended scope ("systematically audit" appears
repeatedly), an aspirational DTO-generation path with no concrete mechanism,
the absence of quantified acceptance criteria, and an understated blast radius
for the branded-ID and charts-split work. These keep it from being a
ready-to-execute spec, but it is a high-quality planning artifact.

## Evidence check (claims verified against source)

- `charts.ts` is **3712 lines** (plan says "3,700+") — confirmed. ✓
- `index.ts` is documentation-only `export {}`; real surface under `src/data`. ✓
- `src/data/index.ts` re-exports modules **plus** the conditional-format rules
  from `@mog/types-formatting/conditional-format/rules` with a cycle-avoidance
  comment — confirmed verbatim. ✓
- `package.json` is `private: true`, exports root + `./data` + exactly ten
  precise data subpaths. ✓
- `tools/package-inventory.jsonc` classifies `@mog/types-data` as
  `workspace-internal`, `requirePrivate: true`, `publicTarget: null`. ✓
- `kernel/src/bridges/compute/compute-types.gen.ts` exists (145 KB). ✓
- "Must stay in sync" parity comments exist in `slicers.ts`, `grouping.ts`,
  `sorting.ts`, `filter.ts`, `pivot.ts`, `sparklines.ts`. ✓
- Manager interfaces (`ISparklineManager`, `ISlicerManager`, `ITableManager`,
  `IFilterManager`, `IGroupingManager`, `IPivotEngine`) live across six modules. ✓
- `contracts/src/data/*` shims and short subpaths (`./filter`, `./pivot`, …)
  exist in `contracts/package.json`. ✓
- Verification scripts `check:contracts-declaration-identity`,
  `check:declaration-rollups`, `check:api-snapshots`, `check:external-fixtures`
  all exist in the root `package.json`. ✓
- No local tests under `types/data` — confirmed (no `.test.ts`/`.spec.ts`). ✓
- `: unknown` payloads present in `charts.ts` (11) and `pivot.ts` (1). ✓

This level of verifiable accuracy is the plan's strongest quality signal. It
was clearly written against the real tree, not from memory.

## Major strengths

- **Correct problem diagnosis.** The core finding — manual "stay in sync"
  comments instead of an automated parity gate against the authoritative
  generated source — is real and is the highest-leverage fix in the package.
- **Real, ordered verification gates.** The gate list (sections "Tests and
  verification gates" 1–15) chains existing scripts in dependency order and
  ends with repo-wide typecheck. It explicitly flags snapshot/API-snapshot
  diffs as "contract change, not mechanical output" — the right framing.
- **Disciplined non-goals.** Refuses to publish the package, move generated
  bridge code public, add compatibility shims to dodge fixing callers, or
  recreate the formatting↔data cycle. These match the actual constraints
  (`mog` must not depend on `mog-internal`; cycle-avoidance is load-bearing).
- **Cell Identity Model invariants are first-class.** The plan treats durable
  state as `CellId`/`CellIdRange`/`IdentityFormula` and position shapes as API
  inputs / render projections / deprecated — consistent with the package's
  documented role.
- **Contract-preserving refactor discipline.** The charts split mandates
  snapshot + import-fixture gates *before and after* and keeps the barrel path
  stable, so the declaration-identity check is the safety net.
- **Realistic parallelization.** The A–F + integrator decomposition maps
  cleanly to the implementation sections and isolates the high-blast-radius
  consumer integration to a single integrator role.

## Major gaps or risks

- **The DTO-generation path is aspirational, not specified.** Section 3 says
  "prefer generating public-safe TypeScript DTO declarations from the Rust /
  domain-types bridge source into `types/data/src/generated`." But there is no
  existing `generated/` directory in any `types/*` package, and the plan does
  not describe how generation would run, what tool emits it, or how
  `compute-types.gen.ts` (itself generated into `kernel`) would be re-projected
  public-safe. The fallback ("type-level parity tests") is more realistic but
  the *mechanism* is unstated — comparing handwritten contracts against a
  145 KB `.gen.ts` needs a named approach (e.g. `expectTypeOf`, structural
  `extends` assertions, or a custom AST checker). Without that, section 3 is a
  goal, not a plan.
- **Open-ended scope language.** "Systematically audit," "harden discriminated
  unions," and "normalize compatibility aliases" cover the entire package
  surface (7231 lines across 11 modules) with no triage of which types are in
  scope first. This reads closer to "improve the whole package" than a bounded
  slice, which makes effort unestimable and risks an enormous uncommitted delta.
- **No quantified acceptance criteria.** "Every exported type classified" has
  no count, and the ownership-matrix artifact has no specified format or
  location (file path, schema, where it lives in the public repo). Without a
  concrete deliverable definition, "done" is subjective.
- **Branded-ID churn is understated.** Branding chart/table/slicer/sparkline/
  pivot/trace-arrow IDs (section 5) touches every construction and assignment
  site across kernel, charts, canvas, apps, and table-engine. The plan lists
  this as one bullet but it is potentially the largest mechanical-churn and
  blast-radius item in the whole effort; it deserves its own risk treatment and
  possibly its own slice.
- **Front-loaded contract changes.** Sections 1–8 all land before consumer
  integration (section 9). For a package this widely imported, that is a large
  in-flight delta. The plan would be safer sliced per-domain (e.g. land filter
  end-to-end through consumers, then pivot, then charts) rather than all
  contracts first, then all consumers.

## Contract and verification assessment

Contract clarity is high. The "Production-path contracts and invariants"
section enumerates the right boundaries: public consumption only through
`@mog-sdk/contracts`, package stays private, no new cycles, identity-model
authority, Rust-generated DTOs authoritative for compute-owned shapes, and
runtime JS free of private imports. These are precise and testable.

Verification is the plan's strongest dimension — gates are real and ordered,
and the new gates it *proposes* (ownership/export/projection parity checker,
generated-DTO parity checker) are well-placed to run in the public repo
alongside the existing boundary checks. The one weakness is that the two *new*
checkers are described by what they validate, not how they are implemented; the
generated-DTO parity checker in particular inherits the unresolved generation
mechanism from section 3.

## Concrete changes that would raise the rating

1. **Resolve the generation question.** Pick one path explicitly: either name
   the generator and where it emits public-safe DTOs, or commit to type-level
   parity tests and specify the assertion mechanism (e.g. structural `extends`
   checks per mirrored type against `compute-types.gen.ts`). Show a one-type
   worked example.
2. **Define the ownership-matrix deliverable concretely** — its file path in
   the public repo, its schema (type name → classification → owner → reason),
   and roughly how many exported types it must cover, so the checker has a
   fixed input.
3. **Triage scope into a first slice.** Name the 1–2 domains to land
   end-to-end first (filter + sorting are the smallest, lowest-risk; charts is
   the largest) instead of "systematically" across all 11 modules at once.
4. **Promote branded IDs to its own risk item** with an estimate of
   assignment-site churn across consumers, or defer it behind the parity work.
5. **Re-sequence toward vertical slices** (contract → consumers per domain)
   rather than all contracts then all consumers, to shrink in-flight delta and
   keep the declaration-identity gate green incrementally.
6. **Add explicit pass/fail acceptance criteria** for each section (e.g. "zero
   un-classified exported types," "zero un-named `unknown` outside the
   inventory," "all 10 `@mog-sdk/contracts` short subpaths covered by an import
   fixture").
