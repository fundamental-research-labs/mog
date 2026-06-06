Rating: 8/10

# Review: 013 — Kernel Domain Cells Improvement Plan

## Summary judgment

This is a strong, evidence-grounded plan. I cross-checked nearly every factual
claim against the live source in `mog/kernel/src/domain/cells` and the compute
bridge, and the plan's diagnosis is accurate in the specifics that matter:

- `index.ts` does export the read functions (`getData`, `getRawValue`,
  `getValue`, `getEffectiveValue`, etc.) from `cell-values.ts`, not the richer
  `cell-reads.ts` (confirmed `index.ts:8-23`).
- `cell-reads.ts` is genuinely the richer adapter (region surfacing, projection
  anchor fallback, materialized-cell fallback, external-formula readback), while
  `cell-values.getData` omits region/projection/materialized behavior
  (confirmed `cell-values.ts:250-272`).
- Fake identity sentinels (`toCellId('')`) are real and used in production read
  paths and writes (`cell-reads.ts:163,219`; `cell-values.ts:88,225`).
- Writes are fire-and-forget `void (async () => …)()` (`cell-values.ts:72-92,
  169-179, 221-230`).
- Metadata is routed through `setFormatForRanges` with an explicit "metadata
  fields are passed to Rust via the format channel" comment
  (`cell-properties.ts:112-129, 315`).
- `getRowFormat`/`getColFormat` are no-op stubs returning `undefined`
  (`cell-properties.ts:861-874, 923-934`).
- `removeDuplicates` parses snake_case (`duplicates_removed`,
  `unique_remaining`) and ignores `caseSensitive` (`_caseSensitive`)
  (`cell-data-operations.ts:72, 100-113`).
- text-to-columns preview is reimplemented locally with regex/qualifier logic
  separate from the committed Rust mutation (`cell-data-operations.ts:341-352,
  358-462`).
- `cell-iteration.getCurrentRegion` and `getDataBoundsForRange` reimplement
  logic via `queryRange` rather than delegating to the bridge
  (`cell-iteration.ts:366-390, 521-549`).

The invariants section is unusually disciplined — the `region: null` vs
`region: undefined` distinction, formula-vs-literal effective value, and
copy-on-apply styles all match the code's actual contracts exactly. This is a
plan written by someone who read the folder, not skimmed it.

## Major strengths

- **Diagnosis precision.** Every named drift (duplicate read mappers, fake IDs,
  metadata-through-format, snake/camel result drift, TS-side region scans) is a
  real defect verifiable in the tree, not invented.
- **Correct architectural thesis.** "Make `cell-reads.ts` canonical; keep this
  folder a thin contract-preserving adapter; push semantics into Rust" is the
  right direction and is consistent with the existing `TODO(rust)` already in
  `cell-reads.ts:252-256` about collapsing the spill-member roundtrips.
- **Contract clarity.** Identity-less reads get a concrete proposed shape
  (optional `cellId`, or a branded `VirtualCellId`/`ReadCellIdentity` union)
  rather than a hand-wave, and the plan explicitly anticipates that
  `StoreCellData.id` may be required today and gates the migration on that.
- **Verification gates.** Genuinely thorough and layered: characterization
  tests first, kernel test/typecheck, targeted worksheet/API suites, Rust
  `cargo test -p compute-core` where wire contracts change, publish-readiness
  and API-snapshot gates, plus UI exercise paths. This matches the repo's real
  publish-readiness discipline.
- **Sequencing and dependency call-outs.** The "Rust must land before TS removes
  fallbacks" and "contract decisions before bulk caller migration" ordering is
  correct and explicitly stated.

## Major gaps or risks

- **Scope is a program, not a plan.** Workers A–G span TS domain, bridge
  contract regeneration, Rust compute-core endpoints, every consuming caller
  (charts/records/tables), and full UI E2E. Any one of steps 4, 6, 7, or 8 is a
  multi-day effort with Rust changes. As a single executable unit this is too
  large to land or review safely; it should be split into independently
  shippable slices with their own gates. The parallelization section helps but
  doesn't reduce the coupling between steps 3/4 and the rest.
- **A few "add new" items already exist.** The "Initial characterization tests
  before implementation" lists `cell-reads-region.test.ts` and
  `cell-properties-query.test.ts` as if to be created — both already exist in
  `__tests__/`. Likewise the bridge already exposes `getCurrentRegion`,
  `getDataBoundsForRange`, `getProjectionSource`, `setCellsByPosition`,
  `clearRangeByPosition`, and `clearFormatForRanges` (confirmed in
  `compute-bridge.gen.ts`). The plan's step 6 says "replace TS with the bridge
  endpoint," which is correct, but it never states these endpoints are already
  present — readers may over-scope the Rust work for step 6 when only the TS
  delegation is needed there.
- **Rust feasibility asserted, not demonstrated.** Steps 4 and 7 hinge on
  extending `compute_get_raw_cell_data` to return anchor formula + region, and
  adding first-class metadata bridge methods. The plan flags these as risks but
  does not point at the Rust endpoint shapes to confirm the additions are
  tractable, nor whether `RangeCellData` / `RegionMeta` already carry partial
  support (`cell-reads.ts` already reads `region` off both active-cell and
  `getCellData` payloads — so some Rust support exists and the delta is smaller
  than the prose implies). A short "current Rust surface" inventory would
  de-risk the largest unknowns.
- **No explicit rollback / incremental-landing story.** Because writes move from
  fire-and-forget to awaited (step 5), timing-dependent callers can regress.
  The plan names this risk but offers no staged toggle or migration order across
  callers to contain it.

## Contract and verification assessment

Contracts: above average. The empty-cell return contract is pinned (high-level
APIs return `null`; low-level helpers distinguish `undefined` for no
`StoreCellData` from `null` value), the region tri-state is specified, and the
identity-less shape has a concrete fallback. The one soft spot is that the
identity-contract decision is left as an either/or (`cellId?` vs branded union)
— acceptable for a plan, but it is the highest-blast-radius decision and would
benefit from a recommended default plus the API-snapshot consequence spelled
out.

Verification: strong. Gates are specific, command-level, and correctly tiered
across kernel/Rust/publish/UI. The plan correctly conditions Rust and
bridge-regen gates on "where wire contracts change." Minor: characterization
tests are named as new when they exist; should say "extend."

## Concrete changes that would raise the rating

1. **Slice into shippable phases with independent gates.** E.g. Phase 1: barrel
   re-point to `cell-reads.ts` + retire duplicate read mappers + characterization
   tests (TS-only, no Rust). Phase 2: awaitable mutations. Phase 3: region wire
   contract. Phase 4: metadata bridge. Phase 5: data-ops consolidation. Each
   landable and revertable on its own.
2. **Correct the test/endpoint inventory.** State that `cell-reads-region.test.ts`
   and `cell-properties-query.test.ts` already exist (extend them), and that
   `getCurrentRegion`/`getDataBoundsForRange`/`clearFormatForRanges` already
   exist on the bridge so step 6 is largely a TS delegation, not new Rust work.
3. **Add a one-paragraph Rust surface inventory** for steps 4 and 7: the current
   shape of `compute_get_raw_cell_data`, whether `RangeCellData`/`RegionMeta`
   already carry `region`, and the metadata storage path — so the Rust delta is
   sized, not assumed.
4. **Recommend a single default for the identity-less contract** (e.g. branded
   `ReadCellIdentity` union) and state the exact API-snapshot/declaration-rollup
   impact, rather than leaving two options open.
5. **Add a containment plan for the fire-and-forget → awaited migration**:
   caller-by-caller order and how to detect callers that relied on optimistic
   completion before flipping them.
