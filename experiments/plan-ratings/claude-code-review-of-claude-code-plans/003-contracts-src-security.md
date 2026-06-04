Rating: 8/10

# Review — Plan 003 `mog/contracts/src/security`


## Summary judgment

A strong, unusually evidence-grounded plan. I independently verified nearly every
factual assertion against the live tree and they hold: `contracts/src/security/types.ts`
is byte-identical to the canonical `types/document/src/security/types.ts` (`diff` →
IDENTICAL); `evaluator.ts` is an unreachable `export type *` shim; the package `exports`
map exposes only `./security` (no `./security/types` or `./security/evaluator` subpath)
and no file imports those subpaths; `ACCESS_LEVEL_ORDER` genuinely exists as three
literals plus the Rust `#[repr(u8)]` source in `compute-security/src/level.rs`
(`None=0 … Admin=4`, confirmed); `PolicyId`'s brand is optional (`__brand?`) and thus
non-nominal; `AccessExplanation`'s "Matches the Rust … serde shape" is a prose comment
with no enforcing test; and `@mog-sdk/contracts` already depends on `@mog-sdk/types-document`
via `workspace:*`. The diagnosis is correct, the architectural posture (enforcement stays
in Rust; TS is type-only + one constant) is respected, and the sequencing is sound. The
gap between this and a 9 is (a) a factual undercount of the regression surface and (b) the
highest-value steps being the least concrete.

## Major strengths

- **Evidence discipline.** Claims are backed by reproducible commands (`diff`, `rg`,
  exports-map inspection) and almost all reproduce exactly. The inventory entry it
  proposes to edit really does carry `sourceOfTruth: "contracts/src/security/index.ts"`
  (line 245), so Step 2's deliberate inventory edit is real, not invented.
- **Correct risk-ordered sequencing.** Dead-file deletion (zero-importer, gated on a
  re-run `rg` proof) first; canonical single-sourcing next; invariant hardening last.
- **Preserve/Strengthen split is precise.** It enumerates the exact public export set and
  the load-bearing lattice ordering as invariants, and confines changes to additive /
  re-export-only, with explicit non-goals (no new levels/targets, no policy logic into TS).
- **Genuinely good risk section.** The `export type *` vs value-re-export coexistence
  concern is real, and its mitigation is verifiable: the canonical
  `types-document/security/index.ts` already mixes `export type { … }` with
  `export { ACCESS_LEVEL_ORDER }`, so the pattern is proven. The `Object.freeze` /
  identity-vs-structural-compare caveat and the `PolicyId` brand-churn caveat are both
  the right things to worry about.

## Major gaps or risks

- **The "seven import sites" figure is wrong — there are 11.** The plan names seven
  consumers and repeatedly frames "all seven kernel/SDK import sites" as the regression
  surface. `rg -l "@mog-sdk/contracts/security"` returns 11 `.ts` files, including
  `kernel/src/api/workbook/workbook-impl.ts`, `kernel/src/api/workbook/types.ts`,
  `kernel/src/api/document/document-factory.ts`, and
  `kernel/src/api/document/mog-document-factory.ts`, which the plan omits. The
  conclusions (re-export keeps them compiling) are unaffected, but the named blast radius
  for Step 2 and the Step-5 brand audit is understated, which matters because the plan
  leans on that count as its verification scope.
- **Steps 4 and 6 — the highest-value hardening — are the least concrete and least
  verified.** The plan proposes "extend the existing Rust→TS contract-snapshot/codegen
  path… (locate via `rg`)" but never confirms such a path exists for this enum; it then
  falls back to "a small fixture exported from the Rust side," which is hand-waved. There
  is a `compute-security/tests/level.rs`, but no demonstrated TS-visible discriminant
  fixture or codegen hook. As scoped, these steps could either balloon in cost or prove
  infeasible without new cross-language plumbing the plan hasn't budgeted. The single
  most important invariant ("a reordering on either side compiles cleanly and ships")
  rests on the vaguest step.
- **Most of the substantive work lands outside the assigned folder.** Steps 3, 5, and 6
  edit `types/document/src/security`, not `contracts/src/security`. The actual changes to
  the reviewed folder are: delete two files and change one line to a value re-export. This
  is honestly disclosed in the parallelization notes and is arguably the correct factoring
  (the folder is a façade), but a reader should understand that approving this plan mostly
  approves edits to a sibling package, gated on coordination with its owner.
- **`PolicyId` blast radius is asserted, not shown.** Step 5 says "(few) construction
  sites" and "add the cast at the boundaries," but the plan does not enumerate the
  origination points or show the audit result. Tightening an optional brand to a `unique
  symbol` brand can surface many latent `string`→`PolicyId` sites across 11 consumers;
  the cost is unquantified.

## Contract and verification assessment

The wire-shape preservation list is accurate and complete for the public surface, and the
`level:'none'`-is-deny / linear-lattice invariants are correctly identified as
wire-breaking and additive-only. The verification gates for Steps 1–3 and 5 are concrete
and checkable (zero-importer proof before deletion; runtime-values fixture must still emit
`{none:0,…,admin:4}`; negative `@ts-expect-error` brand test; boundary-validator test
named as a real file). The gates for Steps 4 and 6 are appropriately *described* as new
tests, but they assert an outcome whose mechanism is unresolved — the plan asks the
implementer to discover whether codegen exists, which is investigation deferred into
implementation rather than de-risked in the plan. The "Rust discriminants win on conflict"
tie-break rule is the correct authority decision and is stated explicitly. One unaddressed
detail: the plan says "none expected beyond the inventory `sourceOfTruth` field" for the
api-snapshot diff but does not confirm that re-exporting `ACCESS_LEVEL_ORDER` via
`export { … } from` renders identically to the current `export const` in
`@mog-sdk__contracts.api.txt`; this is plausible but stated as expectation, not verified.

## Concrete changes that would raise the rating

1. **Correct the importer count** to the actual 11 (list all sites) and re-scope the
   "keep compiling unchanged" gate to that set. This is a one-command fix and removes the
   only outright factual error.
2. **De-risk Steps 4/6 before approval:** run the `rg` for existing Rust→TS enum
   snapshot/codegen and state the finding. If none exists, either (a) commit to the
   concrete fixture mechanism (which Rust test emits the discriminants, in what format,
   read by which TS test) or (b) downgrade the step to "add a TS-only invariant test +
   a documented manual cross-check" and say so, rather than implying CI codegen that may
   not be reachable.
3. **Show the `PolicyId` audit:** enumerate the id-origination sites (bridge deser, policy
   creation) and the expected number of `asPolicyId` insertions, so the brand-tightening
   cost is bounded rather than asserted as "few."
4. **Confirm the api-snapshot is byte-stable** under the `export const` → `export { } from`
   change (or note the exact expected line delta), so Step 7's "no surface change" claim is
   verified, not assumed.
5. **State the cross-folder dependency as a hard gate:** Steps 3/5/6 must merge with or
   after the `types-document` owner's edit to the same canonical const; make explicit that
   approving 003 in isolation lands only Steps 1–2.
