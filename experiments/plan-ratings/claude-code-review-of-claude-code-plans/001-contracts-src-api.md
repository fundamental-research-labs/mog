Rating: 8/10

# Review — Plan 001: Harden the public API contract surface in `mog/contracts/src/api`

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every concrete claim it makes is verifiable against the source today, and the central thesis — that `mog/contracts/src/api/types.ts` is a hand-maintained duplicate of the canonical `@mog/types-api` source that has already silently drifted — is correct and well-motivated. The plan correctly understands the runtime-vs-type split of this folder, respects the canonical-first authoring order mandated by the declaration-identity gate, and proposes verification gates that match the real build pipeline. It loses points only for slightly underspecifying the mechanics of its preferred de-duplication option (Option A), where a name-collision between the locally-authored runtime enums and a blanket `export type *` is a real wrinkle it glosses over, and for a couple of minor omissions in the build-chain description.

I verified the plan's factual basis directly (read-only):

- **File sizes exact.** Canonical `mog/types/api/src/api/types.ts` = 87,247 bytes; local copy = 86,838 bytes. Matches the plan verbatim.
- **Drift is real and as enumerated.** `WorkbookId`, `WorkbookSessionId`, `DocumentId`, `LinkId`, `ActorId`, `WorkbookPolicyPreservedEvent`, the `cells:policy-preserved` event entry, `ChartExportOptionsSnapshot`, `ResolvedChartSpecSnapshot`, and `WorkbookSettingsPatch` are all present in canonical and **absent** in the local copy. Every named drift item checks out.
- **Corrupted comments exact.** `spreadsheet special-cell type` appears 11× in `worksheet/format-mappings.ts` and 1× in `types.ts` — exactly the counts claimed.
- **`any` holes confirmed.** `types.ts:2106 rowGroups: any[]`, `:2108 columnGroups: any[]`, `:2151 criteria?: any`.
- **Build chain confirmed.** `package.json#build` runs the gates the plan names; `package.json#exports` declares `./api`, `./api/mutation-receipt`, `./api/worksheet/handles`, `./api/worksheet/handles/index` as stated.
- **Shim model confirmed.** `workbook.ts`/`worksheet.ts` are one-line `export type * from '@mog/types-api/...'` shims; `index.ts` re-exports enums from `./types` as runtime values.

## Major strengths

- **Falsifiable, source-backed claims.** The plan does not hand-wave; it cites byte counts, occurrence counts, line-level `any` sites, and named missing symbols. All of them are accurate. This is the single best quality signal — a reviewer can confirm the diagnosis without trusting the author.
- **Correct architectural framing.** It identifies the runtime-vs-type split as the organizing principle, recognizes that the enums/guards/format-mappings *must* be authored locally because they emit JS values, and scopes the duplication problem to the type-only body. This is the right seam.
- **Canonical-first ordering is correct and explicit.** Phase 0's note that all type-shape edits land in `@mog/types-api` first, then the mirror is regenerated, is the right sequencing and is consistent with the declaration-identity gate's existence.
- **Verification gates map to the real pipeline.** The named gates (`check-contracts-declaration-identity`, `verify-runtime-exports`, `check-contracts-runtime-inventory`, `check-contract-runtime-imports`) exist and are the right ones. Adding round-trip unit tests for `format-mappings.ts` boundaries and a post-Phase-3 drift assertion is exactly what closes the recurrence loop.
- **Risk-awareness is genuine.** It flags the no-"Excel" rule (consistent with the `no-excel-in-code` memory), the brittleness of declaration identity, public-surface stability, and treats de-`any` breakage as consumer bugs rather than a reason to retain `any`. The Option A / Option B fallback shows it anticipates the rollup possibly requiring a physical mirror.
- **Sensible phasing.** Comment repair (lowest risk) and `any`-typing are independent and parallelizable; de-duplication lands last to absorb both into one regenerated mirror. Good incremental de-risking.

## Major gaps or risks

- **Option A's enum/type name collision is underspecified.** The plan's preferred move is to "keep only the runtime enums" locally and replace the rest of `types.ts` with `export type * from '@mog/types-api/api/types'`. But the canonical module *also* declares `CellType`/`CellValueType`/`NumberFormatCategory`/`RangeValueType` as `export enum` (I confirmed: canonical lines ~1351/1382/1422/1441). A blanket `export type *` would re-export those four names as types, colliding with the locally-authored `export enum` declarations that `index.ts` depends on for the *runtime* values. The plan says "keep only the runtime enums" but does not acknowledge that this forces a *selective* re-export (TS `export type *` has no exclusion syntax), so the implementer must enumerate named type re-exports or split the canonical module. This is the plan's biggest practical gap — it reads as a one-line move but isn't.
- **Runtime-inventory ownership of the enums under Option A.** Because the enums must remain the local runtime owner while their *types* would ideally flow from canonical, the plan should state explicitly that the four enums stay fully locally-authored (value + type) and are excluded from the re-export, so `check-contracts-runtime-inventory` / `verify-runtime-exports` still see them. It implies this but never nails it down.
- **Drift-assertion design is named, not specified.** "byte-identical to / generated-from the canonical source" is the right goal, but under Option A the local file is deliberately *not* a copy (it's enums + a re-export), so a byte-identity check is inapplicable; the assertion would instead need to verify the exported *type symbol set* matches canonical. The plan conflates the two strategies' verification needs.
- **Minor build-chain inaccuracy.** The plan's pipeline description omits `clean-dist.mjs` (which runs after `check-no-source-dts` and before `tsc`). Harmless, but the gate list is presented as exhaustive.
- **Phase 2 type sourcing is aspirational.** "sourced from the existing outline/grouping domain types already used elsewhere" and "the established sort-criteria type" assume those types exist in a reusable form; the plan does not point to them concretely (unlike its precise drift evidence elsewhere). If no clean domain type exists, Phase 2 silently expands into defining new public types, which is a larger surface change than the plan implies.

## Contract and verification assessment

The "Must preserve" list is comprehensive and accurate — it enumerates the exact exported names, sub-entrypoints, and behavioral contracts (rotation clamps, `255↔180`, `MAX_INDENT_LEVEL = 250`, pattern fallbacks, single-owner `unique symbol` brands). Treating those conversion semantics as behavioral contracts and demanding round-trip tests around comment edits is exactly right, since the comment-repair phase touches the same files. The gate selection is correct and the consumer-typecheck step (with the memory caveat that a contracts build must precede downstream typecheck) is well-placed. The weakness is not in *which* gates are named but in the under-specification of *what the drift assertion actually asserts* once Option A changes the file from a copy into a re-export — the verification needs to follow the chosen strategy, and the plan leaves that coupling implicit.

## Concrete changes that would raise the rating

1. **Resolve the Option A enum collision explicitly.** State that the four enums remain locally authored (value + type) and are *excluded* from the type re-export, and specify the mechanism (explicit named `export type { ... } from '@mog/types-api/api/types'` for the non-enum surface, or a canonical split that isolates the enums). This is the difference between a plan that compiles and one that hits a name-collision wall on first attempt.
2. **Tie the drift assertion to the chosen strategy.** For Option A, assert export-symbol-set parity (every type exported by canonical `api/types` is re-exported here, minus the locally-owned enums); reserve byte-identity for Option B's generated mirror.
3. **Cite the concrete source types for Phase 2.** Name the existing outline/grouping and sort-criteria types (or state plainly that new public interfaces must be introduced and scope that as a deliberate surface addition). Match the evidentiary rigor the rest of the plan shows.
4. **Correct the build-chain list** to include `clean-dist.mjs`, so the gate enumeration is exact.
5. **Add a brand-ownership smoke step** to Phase 0: confirm `types.ts` declares no `unique symbol` brand owner today (I confirmed it does not), so the reviewer can be sure Option A's collapse cannot orphan or duplicate a brand — turning a stated risk into a discharged one.
