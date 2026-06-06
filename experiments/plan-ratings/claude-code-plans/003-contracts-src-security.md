# Plan 003 — Strengthen `mog/contracts/src/security` (capability, trust & permission contracts)

## Source folder and scope

- **Folder:** `mog/contracts/src/security`
- **Package:** `@mog-sdk/contracts` (`mog/contracts`, version `0.8.0`), public subpath export `@mog-sdk/contracts/security`.
- **Files in scope:**
  - `index.ts` — the only file reachable through the package. `export type *` from `@mog-sdk/types-document/security`, plus a **locally redefined runtime** `ACCESS_LEVEL_ORDER` const.
  - `evaluator.ts` — a one-line `export type *` re-export shim pointing at `@mog-sdk/types-document/security/evaluator`.
  - `types.ts` — a **verbatim full copy** (confirmed byte-identical via `diff`) of the canonical `mog/types/document/src/security/types.ts`.
- **Canonical upstream (not edited blindly, but coordinated):** `mog/types/document/src/security/` (package `@mog-sdk/types-document`), comprising `index.ts`, `types.ts`, `evaluator.ts`. This is the real source surface; `contracts/src/security` is meant to be a thin re-export façade onto it.
- **Cross-language source of truth:** `mog/compute/core/crates/compute-security/src/level.rs` defines `enum AccessLevel { None=0, Structure=1, Read=2, Write=3, Admin=4 }` with explicit `#[repr(u8)]` discriminants. All TS access-level numeric ordering ultimately mirrors this.
- **Guardrail tooling:** `mog/tools/contracts-runtime-inventory.json` declares this folder's runtime export (`ACCESS_LEVEL_ORDER`) with `sourceOfTruth: "contracts/src/security/index.ts"` and `verificationFixture: "fixtures/external/positive/contracts-runtime-values"`. `mog/tools/api-snapshots/@mog-sdk__contracts.api.txt` snapshots the public surface.

These are **type-only contracts plus one tiny runtime constant**. Enforcement and policy evaluation live entirely in Rust (`compute-security` crate + `compute-core storage::security_*`), reached through `ComputeBridge.wbSecurity*`. This plan preserves that posture: no policy-evaluation logic is added to TS.

## Current role of this folder in Mog

`contracts/src/security` is the public TypeScript vocabulary for Mog's data access-control system — "Layer 2" of the documented three-layer enforcement stack (Layer 3 capabilities / API gate, Layer 2 data policies / value filter, Layer 1 cell protection / spreadsheet-compat). It defines the wire-shape contracts that the kernel and Node SDK consume to talk to the Rust engine:

- **Principals & matching:** `AccessPrincipal` (opaque tag set), `TagMatcher` (glob), `TagSpecificity`.
- **Targets:** `AccessTarget` / `TargetMatcher` discriminated unions (`workbook` | `sheet` | `column`).
- **Levels:** `AccessLevel` linear lattice (`none < structure < read < write < admin`) and the `ACCESS_LEVEL_ORDER` numeric map used by public policy-comparison helpers.
- **Policies:** `AccessPolicy`, `AccessPolicyMetadata`, `PolicyId`.
- **SDK surface:** `AccessExplanation` (the `wb.security.explainAccess(...)` derivation trace, declared to mirror the Rust `compute_security::engine::AccessExplanation` serde shape) and `DocumentSecurityConfig` (the `resolvePrincipal` callback the kernel invokes once per session).

Real consumers verified by `rg`: `kernel/src/api/workbook/security.ts`, `kernel/src/context/principal-projection.ts`, `kernel/src/document/document-lifecycle-system.ts`, `kernel/src/context/kernel-context.ts`, `kernel/src/services/workbook-links/types.ts`, `runtime/sdk/src/index.ts`, `runtime/sdk/src/boot.ts` — all import from `@mog-sdk/contracts/security`.

### Evidence-backed problems found

1. **`types.ts` is an orphaned, byte-identical duplicate of the canonical type module.** `diff mog/types/document/src/security/types.ts mog/contracts/src/security/types.ts` reports IDENTICAL. `index.ts` does **not** import `./types` (it re-exports from `@mog-sdk/types-document/security`), the package `exports` map exposes **only** `./security` (no `./security/types` subpath), and no file in the repo imports `@mog-sdk/contracts/security/types`. The file is therefore dead weight that maintains a second hand-edited copy of every principal/target/policy type. Any edit to the canonical types (add a target kind, change `AccessPolicyMetadata`) silently diverges from this copy, and a future careless re-point of `index.ts` to `./types` would resurrect the stale copy as the live contract.

2. **`evaluator.ts` is an orphaned re-export shim.** It re-exports `@mog-sdk/types-document/security/evaluator`, but `index.ts` does not reference it and the package exposes no `./security/evaluator` subpath. The two SDK types it forwards (`AccessExplanation`, `DocumentSecurityConfig`) already reach consumers through `index.ts`'s `export type *`. So the file is unreachable through the package — shipped but unsupported.

3. **`ACCESS_LEVEL_ORDER` exists as three independent literals.** The same `Record<AccessLevel, number>` map (`none:0 … admin:4`) is declared in (a) `types/document/src/security/types.ts` (the canonical value, re-exported by `types-document/security/index.ts`), (b) `contracts/src/security/types.ts` (the orphan copy), and (c) `contracts/src/security/index.ts` (the live runtime redefinition). The redefinition exists because `index.ts` uses `export type *`, which cannot forward a runtime value — so rather than re-exporting the canonical const, it hand-copies it. These three literals plus the Rust `#[repr(u8)]` discriminants are kept in agreement purely by convention; nothing fails if one drifts. A wrong number here silently corrupts every `>=`/`<` access comparison built on the map.

4. **No enforced TS↔Rust alignment for the access lattice.** The Rust `AccessLevel` discriminants are the real wire contract (they bit-pack into 3 bits per cell per the `level.rs` comment and drive serde). The TS `ACCESS_LEVEL_ORDER` numbers must equal those discriminants, and the snake_case serde names (`"none"|"structure"|"read"|"write"|"admin"`) must equal the TS `AccessLevel` string union. Both correspondences are undocumented-as-tested and unenforced; a reordering on either side compiles cleanly and ships.

5. **`PolicyId`'s brand is non-nominal.** `type PolicyId = string & { readonly __brand?: 'PolicyId' }` uses an **optional** brand, so any plain `string` is assignable to `PolicyId` and vice versa with no friction. The intent ("branded policy identifier") is not actually enforced — accidental cross-assignment of a tag string, sheet id, or arbitrary string into a `PolicyId` field is silently legal.

6. **`AccessExplanation`'s "matches Rust serde" claim is prose-only.** The doc comment asserts the shape mirrors `compute_security::engine::AccessExplanation`, but there is no snapshot, test, or codegen tie binding the TS interface to the Rust struct. Field rename/optionality drift on the Rust side would break `explainAccess` deserialization at runtime with no compile-time or CI signal.

## Improvement objectives

1. **Eliminate the dead duplicates** (`types.ts`, `evaluator.ts`) so the folder contains exactly the reachable façade, removing the silent-drift hazard against the canonical `types-document` module.
2. **Single-source `ACCESS_LEVEL_ORDER`** so the public runtime value has exactly one literal definition, surfaced — not re-copied — through `@mog-sdk/contracts/security`.
3. **Enforce the TS↔Rust access-lattice alignment** (numeric discriminants and serde string names) with a CI-checked invariant, not convention.
4. **Make `PolicyId` a real nominal brand** so identifier confusion is a type error.
5. **Bind `AccessExplanation`/`AccessPolicy` wire shapes to the Rust serde structs** with an enforced check, preserving the cross-process contract.
6. **Keep the public surface and enforcement posture intact**: no API renames except additive, no policy-evaluation logic moved into TS, and the contracts-runtime-inventory / api-snapshot guardrails kept green (updated deliberately, never silently).

## Production-path contracts and invariants to preserve or strengthen

Preserve:
- The exact public export set of `@mog-sdk/contracts/security` (`AccessLevel`, `AccessPolicy`, `AccessPolicyMetadata`, `AccessPrincipal`, `AccessTarget`, `PolicyId`, `TagMatcher`, `TagSpecificity`, `TargetMatcher`, `ACCESS_LEVEL_ORDER`, `AccessExplanation`, `DocumentSecurityConfig`). All seven kernel/SDK import sites must keep compiling unchanged.
- The serialized shapes that cross the bridge: `AccessPolicy`, `AccessPolicyMetadata`, `AccessTarget`/`TargetMatcher`, `AccessExplanation`. Field names and `level:'none'`-is-deny semantics are wire-breaking — additive only.
- The linear lattice ordering `none(0) < structure(1) < read(2) < write(3) < admin(4)` and its agreement with Rust `AccessLevel` discriminants. This is the load-bearing numeric invariant; it must be strengthened, never altered.
- The "enforcement is Rust-side, TS is type-only + one constant" posture documented in `index.ts` / `evaluator.ts` headers and `docs/security/ACCESS-CONTROL-ENTERPRISE.md`.
- The discriminated-union form of `AccessTarget`/`TargetMatcher` (the `kind` discriminant enables exhaustive switching) and `DocumentSecurityConfig.resolvePrincipal` being invoked once per session.
- `contracts-runtime-inventory.json` and `api-snapshots/@mog-sdk__contracts.api.txt` must remain accurate descriptions of the shipped surface.

Strengthen:
- Shared types/values get exactly one declaration; the public module re-exports rather than re-declares.
- `PolicyId` becomes nominally distinct from `string`.
- The TS↔Rust lattice and the `AccessExplanation` shape become enforced invariants.

## Concrete implementation plan

Work proceeds from lowest-risk cleanup to invariant hardening. The canonical edits land in `types-document`; the `contracts/src/security` façade is reduced to re-exports.

**Step 1 — Remove the orphaned duplicates.**
- Delete `mog/contracts/src/security/types.ts` (byte-identical orphan) and `mog/contracts/src/security/evaluator.ts` (unreachable shim).
- Pre-deletion confirmation gate: re-run `rg "contracts/security/(types|evaluator)|contracts/src/security/(types|evaluator)"` across `src`/non-dist to prove zero importers (current result: none), and confirm the package `exports` map has no `./security/types` or `./security/evaluator` subpath (confirmed: it does not). Only delete after both checks are clean.

**Step 2 — Single-source the runtime `ACCESS_LEVEL_ORDER`.**
- In `mog/contracts/src/security/index.ts`, replace the locally redefined `export const ACCESS_LEVEL_ORDER = {…}` with a value re-export of the canonical const:
  `export { ACCESS_LEVEL_ORDER } from '@mog-sdk/types-document/security';`
  This keeps the public runtime export on `@mog-sdk/contracts/security` (so the inventory's `publicModules` stays correct) while removing the third copy of the literal. `@mog-sdk/contracts` already depends on `@mog-sdk/types-document` (`workspace:*`), so no dependency change is required.
- Keep the `export type *` line for the type surface; the file becomes a pure re-export façade.
- Update `contracts-runtime-inventory.json` for this entry: set `sourceOfTruth` to `types/document/src/security/types.ts` (the now-singular literal), keeping `publicModules: ["@mog-sdk/contracts/security"]`. This is a deliberate, reviewed inventory edit, not a silent one.

**Step 3 — Make the access lattice the single canonical definition and derive ordering from it.**
- In `types/document/src/security/types.ts`, define the level order as an `as const` tuple that is the one place the sequence is written, and derive both the string union and the numeric map from it:
  - `const ACCESS_LEVELS = ['none','structure','read','write','admin'] as const;`
  - `export type AccessLevel = typeof ACCESS_LEVELS[number];`
  - `export const ACCESS_LEVEL_ORDER = Object.freeze(Object.fromEntries(ACCESS_LEVELS.map((l, i) => [l, i]))) as Record<AccessLevel, number>;`
  This makes "the order" un-duplicable within TS and guarantees the map indices equal array position. `Object.freeze` prevents downstream mutation of the shared map. Preserve all existing doc comments on `AccessLevel`.

**Step 4 — Enforce TS↔Rust alignment.**
- Add a CI-checked invariant binding `ACCESS_LEVELS`/`ACCESS_LEVEL_ORDER` to `compute-security/src/level.rs`. Preferred mechanism: extend the existing Rust→TS contract-snapshot/codegen path used for other wire enums (locate via `rg "repr\(u8\)|serde\(rename_all" ` around bridge codegen) so the Rust discriminants and snake_case names are emitted and diffed against the TS const. If no codegen hook covers this enum, add a focused test (in the existing contracts or types-document test suite) that asserts, for each level, `ACCESS_LEVEL_ORDER[name] === rustDiscriminant` using a small fixture exported from the Rust side, and that the TS string union exactly equals the Rust serde names. The test is a *guard on the invariant*, not the fix itself (the fix is the single-source const in Step 3).

**Step 5 — Strengthen `PolicyId` to a real brand.**
- In `types/document/src/security/types.ts`, change `PolicyId` to a non-optional unique brand, e.g. `declare const PolicyIdBrand: unique symbol; export type PolicyId = string & { readonly [PolicyIdBrand]: 'PolicyId' };`. Provide a tiny `asPolicyId(s: string): PolicyId` constructor co-located with the type so the (few) construction sites mint ids explicitly. Audit construction/consumption sites via `rg "PolicyId"` across kernel/runtime and add the cast at the boundaries where ids originate (bridge deserialization, policy creation), so the brand is introduced exactly once per id.

**Step 6 — Bind `AccessExplanation`/`AccessPolicy` wire shape to Rust.**
- Extend the Step-4 snapshot/codegen tie (or add a serde-shape fixture test) to cover `AccessExplanation` (`level`, `matchedPolicy`, `reason`, `candidatePolicies`, `warnings`) and `AccessPolicy`/`AccessPolicyMetadata` field names and optionality against the Rust `compute_security` structs. Replace the prose "Matches the Rust … serde shape" comment with a reference to the enforcing check.

**Step 7 — Refresh guardrail artifacts deliberately.**
- After Steps 1–6, the api-snapshot (`@mog-sdk__contracts.api.txt`) and runtime inventory must be regenerated/updated through their normal tooling and reviewed in the diff so the surface change (none expected beyond the inventory `sourceOfTruth` field) is intentional and visible.

## Tests and verification gates

(Authoring guidance — this plan does not run these; the implementing change must.)
- **Type-surface regression:** typecheck `@mog-sdk/contracts` and all seven consumer files; the public export set of `@mog-sdk/contracts/security` must be unchanged (verify against the api-snapshot).
- **Runtime-value fixture:** the existing `fixtures/external/positive/contracts-runtime-values` check for `ACCESS_LEVEL_ORDER` must stay green after the re-export; confirm the emitted value is still `{none:0,structure:1,read:2,write:3,admin:4}`.
- **Lattice invariant test (new):** asserts `ACCESS_LEVEL_ORDER` numeric values and `AccessLevel` string names equal the Rust `AccessLevel` discriminants and serde names. Must fail if either side is reordered/renamed.
- **`AccessExplanation`/`AccessPolicy` shape test (new):** asserts field-name/optionality parity with the Rust serde structs.
- **Brand test (new):** a negative type-level test (e.g. `expect-type`/`@ts-expect-error`) proving a plain `string` is no longer assignable to `PolicyId`.
- **Dead-import proof:** `rg` shows zero importers of the deleted `types.ts`/`evaluator.ts` before deletion; full repo typecheck after deletion confirms nothing depended on them transitively.
- **Boundary-validator:** `mog/shell/src/platform/__tests__/package-boundary-validator.test.ts` (which references security types) must still pass.

## Risks, edge cases, and non-goals

- **Risk — `export type *` vs value re-export semantics.** The current file deliberately separates type re-export from the runtime const. Step 2's `export { ACCESS_LEVEL_ORDER } from …` must coexist with `export type *` without a duplicate-export or isolatedModules error; verify under the package's `verbatimModuleSyntax`/`isolatedModules` settings. Mitigation: this is exactly how `types-document/security/index.ts` already mixes `export type {…}` and `export { ACCESS_LEVEL_ORDER }`.
- **Risk — `Object.freeze`/`Object.fromEntries` at module load.** Deriving the map changes it from a literal to a computed-then-frozen object. Confirm the runtime-values fixture compares values structurally (not identity) and that no consumer mutates the map (mutation would now throw). `rg "ACCESS_LEVEL_ORDER\[" ` to audit usage; all observed uses are reads/comparisons.
- **Risk — `PolicyId` brand churn.** Tightening the brand can surface latent `string`-where-`PolicyId`-expected sites. These are real bugs to fix at the boundary, not to paper over with `as any`. Scope the cast helper to id-origination points only.
- **Edge case — Rust enum is the authority.** If TS and Rust disagree during Step 4, the **Rust discriminants win** (they bit-pack into stored cells and define the wire format); TS must be corrected to match, never the reverse.
- **Non-goals:** No new access levels, target kinds, or policy fields. No movement of policy evaluation/resolution into TS (it stays in `compute-security`). No change to the `level:'none'`-is-deny model or the priority/specificity resolution algorithm. No reduced-scope shim or compatibility alias for the deleted files — they are unreferenced, so deletion is the production-correct path.

## Parallelization notes and dependencies on other folders

- **Upstream dependency:** the canonical edits (Steps 3, 5, 6) land in `mog/types/document/src/security` (covered by a sibling plan if one exists for that folder). `contracts/src/security` changes (Steps 1, 2) depend on the canonical `ACCESS_LEVEL_ORDER` being a re-exportable value (already true today), so Steps 1–2 can proceed independently and immediately; Steps 3/5/6 should be sequenced after or jointly with the `types-document` owner to avoid two PRs editing the same canonical const.
- **Cross-language dependency:** Steps 4 and 6 touch the Rust↔TS contract tooling and require coordination with `mog/compute/core/crates/compute-security` (read-only authority) and whichever bridge-codegen owns enum/struct snapshots (`mog/infra/rust-bridge/*`). These can run in parallel with Steps 1–2 since they only *add* a guard.
- **Consumer coordination:** the seven kernel/runtime import sites are read-only re-validation (typecheck), not edits — no blocking dependency, but they are the regression surface for Step 2 and the `PolicyId` brand audit (Step 5).
- **Guardrail coordination:** `contracts-runtime-inventory.json` and the api-snapshot are shared across all `contracts/src/*` plans (e.g. Plan 001 `api`, Plan 002 `runtime`); the inventory edit in Step 2 should be merged in awareness of those parallel edits to avoid snapshot conflicts.
