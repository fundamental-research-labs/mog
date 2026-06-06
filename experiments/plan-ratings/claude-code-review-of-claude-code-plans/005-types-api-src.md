Rating: 8/10

# Review of 005 — Harden the `@mog/types-api` Public API Type Surface

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes is verifiable in the source, and the few I spot-checked were all correct:

- 133 `.ts` files under `src/`, 83 under `api/`, and the top-level subtree list match exactly.
- All eight `any`/`any[]` holes are real and at (approximately) the cited lines: `GroupState.rowGroups`/`columnGroups` (`api/types.ts` ~2118/2120), `FilterSortState.criteria` (~2163), `conditional-formats.cloneForPaste(... rules: any[])` (~145), `filters.getUniqueValues`/`getFilterUniqueValues` returning `Promise<any[]>` (~255/318), and `pivots.detectFields(): Promise<any[]>` (~520).
- The three-way import-path drift is real: `api/index.ts` header says `@mog-sdk/contracts/api`, `api/README.md` says `@mog/spreadsheet-contracts/api` (twice), package name is `@mog/types-api`.
- The README doctrine forbidding hollow copies / `Record<string, unknown>` bags exists ("What should never exist", "Anti-Patterns" tables).
- Both `containerId`-aware TODOs exist verbatim at line 1 of `store/store-types.ts` and `api/worksheet/objects.ts`.
- 42 `@deprecated` members across 10 files (plan said "~40"), with **zero** `@deprecated since`/`@removed-in` markers — confirming the missing-removal-policy claim.
- `package.json` is `private: true`, 131 export subpaths, and each entry has the `development`/`types`/`import` condition split the plan describes; `mog/contracts` depends on it as `workspace:*`.
- The `network:any` exclusion is correctly diagnosed as a capability **string literal value** (`capabilities/types.ts:109`), not a type hole.

The plan's verification discipline (it inspected the folder directly and labels exactly the one item — runtime element shapes behind each `any[]` — that needs kernel-side confirmation) is well above average for this experiment.

## Major strengths

- **Concrete, line-anchored worklist.** Phase 1's table names file:line, current type, and target type for each hole. This is implementable as written, not aspirational.
- **Correct framing of the real risk.** It identifies the dual `development`→`src` vs `types`/`import`→`dist` export condition as the actual locus of "downstream compatibility risk," and ties hardening to a declaration rollup (consistent with the contracts-declaration-rollup memory). The exports-parity gate (gate 4) directly targets dist drift.
- **Refuses the shim escape hatch.** Non-goals and invariants repeatedly forbid `any`-preserving overloads, test-only patches, and half-migrations; Phase 6 insists narrowings land with the contracts re-export and kernel implementation in lockstep.
- **Promotes existing doctrine to a mechanical guard.** Turning the README "Anti-Patterns" table into a lint check (Phase 5) with a seeded allowlist is the right move, and the plan pre-empts the obvious false positive (`network:any`).
- **Honest sequencing.** It separates genuinely independent work (inventory, import-path reconciliation, tooling, deprecation markers) from cross-package work (Phase 2/3 type reuse, Phase 6 landing) and names the gating dependency clearly.

## Major gaps or risks

- **"Types only" vs. the work that actually matters.** The plan asserts "This package is types only — there is no runtime logic to change here," yet the substance of Phases 2–3 (and all of Phase 6) cannot be completed inside this folder: the correct concrete shapes behind each `any[]` must be read from the kernel, and the narrowing only becomes real when the kernel returns those shapes and contracts re-exports them. The plan acknowledges this as a dependency, but the framing undersells that the hard, risk-bearing work lives outside the reviewed folder. A reader could mistake this for a self-contained types edit.
- **Deprecation "since version" is unanchored.** Phase 4/gate 5 require a `@deprecated since <version>` + removal target, but the package is `private: true` with `workspace:*` consumption — there is no established public version line the plan points to. For an unpublished/private package, "since version X.Y" is ambiguous unless tied to the `@mog-sdk/contracts` or SDK release cadence. The plan should specify *which* version namespace anchors these markers, or the gate is unenforceable.
- **One hole is imprecise.** Row 8 of the Phase 1 table ("`api/worksheet/pivots.ts` (compute readback) — pivot result `any[]`") has no line number and no confirmed member, unlike the other seven. It reads as a "probably also here" entry. It should be pinned or dropped to keep the worklist exact.
- **Breaking-change severity is slightly overstated.** Narrowing a *return* type from `any[]` to `CellValue[]` is generally safe for consumers that read the values; it only breaks consumers that forward the result into an `any`-permissive sink. The mitigation (coordinate + document) is sound, but the plan treats every narrowing as uniformly breaking, which may over-gate low-risk read-path changes.
- **Tooling placement asserted, not verified.** Phase 5 places the lint/parity checks in `mog/tools` "e.g." — the plan does not confirm that path exists or hosts comparable checks, so the home for the new guards is a guess.

## Contract and verification assessment

The contract invariants section is the plan's best part: single import boundary, source↔dist identity, no-accidental-widening, single-owner branded types, deprecated-with-migration-path, and README-as-enforced-spec are all the right invariants for a published type surface, and each is traceable to a concrete defect in the current source.

The six verification gates are concrete and mostly mechanically checkable: package `tsc -b`, consumer typecheck through the rollup, the new anti-pattern lint, exports parity, deprecation-marker presence, and api-eval/app-eval coverage of the narrowed read paths. Gate 2 is the one that genuinely proves end-to-end narrowing (not shimming), which is the correct linchpin. Weaknesses: gate 5 inherits the unanchored-version ambiguity above, and gate 6 is somewhat aspirational ("add scenario coverage where a typed read path has none") without identifying which paths currently lack it.

## Concrete changes that would raise the rating

1. **Reframe scope honestly.** Replace the flat "types only, no runtime logic" claim with an explicit statement that the load-bearing shape discovery and the narrowing's correctness depend on the kernel, and that Phases 2–3 produce *proposed* types pending kernel confirmation. This removes the only misleading sentence in the plan.
2. **Anchor the deprecation policy.** State which version line `@deprecated since`/removal targets reference (the `@mog-sdk/contracts`/SDK release version, presumably), since this package itself is private. Without this, gate 5 cannot be satisfied unambiguously.
3. **Pin or remove the eighth hole.** Give the pivot "compute readback" entry a file:line and member name, or fold it into `detectFields`, so the worklist is fully exact.
4. **Verify and name the tooling home.** Confirm where comparable lint/parity checks live and commit to that path rather than "e.g. `mog/tools`."
5. **Grade the breaking-change risk per hole.** Distinguish read-return narrowings (low risk) from parameter/structural narrowings (higher risk) so the coordinated-landing ceremony is applied where it's actually needed.
6. **Enumerate the api-eval/app-eval coverage gap.** List which of the four narrowed read paths already have scenario coverage and which need new scenarios, so gate 6 is concrete.
