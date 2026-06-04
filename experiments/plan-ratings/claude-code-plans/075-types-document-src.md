# Plan 075 — Harden `@mog-sdk/types-document` document/storage/filesystem/security contracts

## Source folder and scope

- **Folder:** `mog/types/document/src`
- **Package:** `@mog-sdk/types-document` (version `0.1.0`, `private: true`, `"type": "module"`). Tier‑1 leaf of the domain graph; its only runtime dependency is `@mog/types-core`.
- **In scope:** the contract surface under `src/` — the seven domain groups and their per‑group barrels, the root `index.ts`, and `package.json`'s `exports` map (the only config that is *part of* the contract surface, since subpath imports are the public API). The groups:

  | Group | Files | LOC | Exports a value? |
  |---|---|---|---|
  | `storage/` | 16 files (query, connection, table‑driver, capabilities, document‑provider, provider‑kinds, provider‑identity, provider‑capabilities, provider‑configs, lifecycle, inbound‑updates, high‑water‑mark, errors, profiles, composition, index) | ~1,750 | no |
  | `platform/` | identity, types, index | ~510 | no |
  | `app/` | types, index | ~450 | **`appId()`** |
  | `filesystem/` | paths, permissions, types, index | ~510 | no |
  | `document/` | comments, search, document, index | ~730 | **`DEFAULT_SEARCH_OPTIONS`** |
  | `security/` | types, evaluator, index | ~245 | **`ACCESS_LEVEL_ORDER`** |
  | `shell/` | types, index | ~115 | no |

  Total ≈ 4,573 LOC, overwhelmingly type declarations.

- **Out of scope (folder boundary, referenced under *Dependencies*):** the runtime that implements/enforces these contracts — `mog/kernel/src/document/**` (lifecycle system, provider registry, composition validator, the eleven provider implementations), `mog/kernel/host-internal/src/{create,validate}.ts`, `mog/shell/src/services/shell-service.ts`, `mog/shell/src/platform/package-boundary-validator.ts`, the Rust `compute-security` crate and `compute-core storage::security_*`, and the `csv_parser` crate. These consume the contract and must move in lockstep, but they belong to other queue items and are touched here only as coordinated follow‑ups.

## Current role of this folder in Mog

This package is the **canonical, product‑neutral type vocabulary** for everything around a document that is *not* the spreadsheet cell model itself (cells/rich‑text/protection live in `@mog/types-core`). It is the agreed contract between the kernel, the shell, the host adapters, the Rust core, and external SDK consumers for six largely independent subsystems:

- **Document lifecycle & import** — `DocumentSource`, `CreateDocumentOptions`, `DocumentImportOptions`/`CsvImportOptions`, `DocumentImportResult`/`*Warning`/`ImportProgressInfo`. Mirrors the Rust `csv_parser::CsvImportOptions` wire shape.
- **Storage providers** — the largest and most safety‑critical group: the `StorageProviderConfig` discriminated union (11 kinds), `StorageProviderCapabilities`, role/durability/composition rule shapes, the lifecycle state machine (`DocumentStoragePhase`), structured `StorageError`s, and the authority/proof system for inbound updates and export barriers (`ProviderAuthorityProof`, `HighWaterMarkProof`, `InboundBarrierProof`). 133 import sites across kernel + shell consume these; the provider registry and `composition-validator` are the principal runtime consumers.
- **Filesystem** — `IFileSystem`, branded `FilePath`/`DirPath`, `FilePermission`/`SandboxConfig`, watch events.
- **Security data‑access policies** — `AccessPrincipal`/`AccessPolicy`/`AccessTarget`, the linear `AccessLevel` scale, `AccessExplanation` (declared to match the Rust `compute_security::engine::AccessExplanation` serde shape), `DocumentSecurityConfig`.
- **Platform & shell** — `IPlatform`/`IDialogs`/`INotifications`/`IClipboard`/`IShell`, `PlatformFileHandle`, `PlatformIdentity`, and the `ShellService` lifecycle facade.
- **App model & table data** — `IApp`/`IDocumentApp`/`IProjectApp`, `AppManifest`, `AppDataRequirements`, plus the portable `Query`/`ITableDriver`/`TableSchema` table‑driver contract.

**Critical observation — the contract describes invariants in prose that nothing enforces, and several of those invariants have already drifted into duplicate, divergent representations.** The root `index.ts` is deliberately `export {}` (no `export *`) because the inherited folder layout has *name collisions across subpaths* (`AccessLevel`, `Unsubscribe`, `AppId`, `ProviderConfig`/`StorageProviderConfig`, two column‑type enums, two watermark shapes). That collision is the symptom; the disease is that the package grew by absorbing `contracts/src/` wholesale without reconciling the overlapping vocabularies. This plan hardens the contract so the *types* become the single source of truth the kernel and Rust core can be mechanically checked against, instead of a prose description they can silently diverge from.

## Improvement objectives

1. **Eliminate divergent duplicate vocabularies** so each concept has exactly one type. Targets: the two column‑type enums (`storage.ColumnType` vs `app.TableColumnType`) and the two table‑schema shapes; the two provider‑config families (legacy `document.ProviderConfig` vs `storage.StorageProviderConfig`); the two origin‑watermark shapes (`ProviderOriginWatermark` vs `HighWaterMarkSnapshot.providerOriginWatermarks`); and the duplicate re‑export of `StorageProviderKind`/`StorageProviderRole` from both `provider-kinds` and `document-provider`.
2. **Make union types the source of truth for their runtime** by pairing every product‑neutral string union the kernel must enumerate (`StorageProviderKind`, `StorageProviderRole`, `DocumentStoragePhase`, `StorageRuntimeProfile`, `DriverType`, `ConnectionStatus`, `StorageErrorCategory`, `AccessLevel`, …) with an exported `as const` tuple from which the union is *derived*, so the kernel stops hand‑maintaining parallel arrays.
3. **Close serialization hazards in the wire contracts.** Reconcile the inconsistent `sequence` representations (`bigint` in `ProviderInboundUpdateEnvelope` vs `string` vs `number` elsewhere) onto a single JSON‑safe type, and pin the version fields (`contractVersion`, `providerProtocolVersion`, `storageSchemaVersion`) to a structured/branded form with a documented negotiation contract instead of free `string`.
4. **Promote documented defaults and magic numbers to exported named constants** (Excel row/col limits 1,048,576 / 16,384, `maxCells` 1,000,000, proof `expiryMs` 30,000, policy `priority` bands) so the kernel and Rust boundaries reference one canonical value rather than re‑hardcoding it in JSDoc‑only form.
5. **Model "runtime‑rejected" option combinations in the type system** rather than as `@internal`/`@deprecated` prose escape hatches on `CreateDocumentOptions` (`providers`, `initialSnapshot: Record<string, unknown>`, `yrsState`, `internal`), so the public facade cannot express a shape that is only valid on an internal/collaboration path.
6. **Fix the contracts‑only invariant breach.** `app/types.ts` ships a runtime `appId()` function from a package whose sibling modules explicitly state "TYPES ONLY — constructors live in kernel." Decide and apply one convention.
7. **Make the cross‑boundary serde‑match claims checkable.** Where a type is annotated "matches the Rust `…` serde shape" (`AccessExplanation`, `CsvImportOptions`), establish a conformance mechanism (golden fixtures / a generated‑from‑Rust check) so the claim is verified, not asserted.
8. **Restore a safe, ergonomic root surface** without reintroducing collisions — either a curated namespaced root barrel or an explicit, documented "subpath‑only" contract that tooling enforces.

## Production-path contracts and invariants to preserve or strengthen

- **Tier‑1 leaf purity.** The package must keep depending *only* on `@mog/types-core`. No kernel, shell, React, Tauri, or runtime imports. (`shell/types.ts` already documents this and references shell types only in prose — preserve that discipline.) Any new `as const` tuples/constants must be zero‑dependency and tree‑shakable.
- **Subpath import stability.** Every key in `package.json` `exports` is a published entry point with live consumers; renaming or removing a subpath is a breaking change. New canonical types may be *added*; existing subpaths must continue to resolve (re‑export from the old location during any consolidation).
- **Discriminated‑union discipline.** `StorageProviderConfig` (on `kind`), `StorageError` (on `category`), `FilterCondition` (on `operator`), `AccessTarget`/`TargetMatcher` (on `kind`), `DriverError`, `TableChange`, `RefreshBehavior`, `SourceConfig`, `StorageScopeBinding` are all exhaustively switchable today. Preserve this; any consolidation must keep the discriminant literal and total.
- **`AccessLevel` linear scale + `ACCESS_LEVEL_ORDER`.** The security ordering (`none<structure<read<write<admin`) is load‑bearing for policy resolution. Keep the numeric map total and in sync with the union, and keep it distinct from the filesystem `AccessLevel` ('read'|'write'|'read-write') — these are genuinely different axes and must not be merged, only disambiguated by name.
- **Authority/proof wire shapes** (`ProviderAuthorityProof`, `ProviderInboundUpdateEnvelope`, `HighWaterMarkProof`, `ProviderBarrierReceipt`, proof‑field enums, `ProofValidationError` codes) are security‑critical and round‑tripped to/from signed payloads. Field names, optionality, and `coveredFields` enums must remain stable; the only changes permitted are making `sequence`/version fields *more* precise without changing the canonical serialized form.
- **Credentials‑never‑in‑config invariant.** `connection.ts` and `provider-configs.ts` store *handles/refs* (`pathHandle`, `endpointHandle`, `credentialRef`, `bucketHandle`), never secrets. Strengthen this with a brand on handle/ref fields so a raw URL/secret cannot be assigned where a materialization handle is expected.
- **Cell‑identity‑based results.** `SearchResult`/`Comment` reference `CellId` (stable) not positions; this survives row/col edits. Preserve.
- **CSV‑injection guard.** `CsvImportOptions.evaluateFormulas` defaults to `false`. Preserve the default and the documented guard.

## Concrete implementation plan

Work proceeds in dependency order; each step is independently shippable and additive‑first (old names re‑exported until consumers migrate).

### Phase 1 — Reconcile duplicate vocabularies (highest correctness value)

1. **Column types & table schema.** Establish the storage group's `ColumnType` + `ColumnSchema` + `TableSchema` as canonical. Redefine `app/types.ts`'s `TableColumnType`/`TableColumnDefinition`/`TableSchemaDefinition` as either aliases of, or documented subsets of, the canonical types (the app variant adds `json`, lacks `array`/`unknown`, and uses `required` instead of `nullable` — pick one polarity and derive the other). Re‑export the old names from `app/types` so `AppDataRequirements` consumers don't break.
2. **Provider configs.** Mark `document/document.ts`'s `ProviderConfig`/`IndexedDBProviderConfig`/`WebSocketProviderConfig` as the *legacy collaboration‑bootstrap* shape and document its relationship to the canonical `storage/StorageProviderConfig`; gate the deprecated `CreateDocumentOptions.providers` field (see Phase 4). Do **not** delete — it is wired to the deprecated path — but make the divergence explicit and add a `@see` cross‑link so future readers don't add a third.
3. **Origin watermarks.** Collapse `HighWaterMarkSnapshot.providerOriginWatermarks: Record<string, number>` and the richer `ProviderOriginWatermark` interface onto one representation (the structured interface, keyed by `providerRefId`), or document why the snapshot deliberately uses a flattened numeric map. Whichever is canonical, the other references it.
4. **Provider kind/role export source.** Make `provider-kinds.ts` the sole declaration site and have `document-provider.ts` *only* re‑export (it already does, but `composition.ts` imports the pair from `document-provider` while `provider-configs.ts` imports from `provider-kinds`). Repoint all internal imports to `provider-kinds` so there is one canonical path.

### Phase 2 — Unions as source of truth

5. For each enumerable, product‑neutral union, add an exported `as const` tuple and derive the union, e.g.:
   ```ts
   export const STORAGE_PROVIDER_KINDS = ['memory','indexeddb', /* … */ 'test'] as const;
   export type StorageProviderKind = (typeof STORAGE_PROVIDER_KINDS)[number];
   ```
   Apply to `StorageProviderKind`, `StorageProviderRole`, `DocumentStoragePhase`, `DocumentDurabilityMode`, `DocumentOpenIntent`, `StorageRuntimeProfile`, `StorageErrorCategory`, `StorageErrorSeverity`, `DriverType`, `ConnectionStatus`, `ColumnType`, `FilterOperator`, and security `AccessLevel`. This lets the kernel registry, `composition-validator`, and conformance tests iterate the canonical set instead of duplicating it. Keep the type name unchanged so existing imports are untouched.
6. Keep `ACCESS_LEVEL_ORDER` and `DEFAULT_SEARCH_OPTIONS` as the existing exported constants; add a compile‑time exhaustiveness assertion tying `ACCESS_LEVEL_ORDER`'s keys to the derived `AccessLevel` tuple.

### Phase 3 — Wire‑contract precision

7. **Sequence type.** Choose one JSON‑safe sequence representation (recommend a branded decimal `string`, since `bigint` does not survive `JSON.stringify` and the proof payloads are hashed as canonical JSON). Replace `ProviderInboundUpdateEnvelope.sequence?: bigint` and align `ProviderOriginWatermark.lastAppliedSequence`, `ProviderBarrierReceipt.serverSequenceOrCursor`, and `StorageReplayError.failedAtSequence` onto it (or document why one is intentionally numeric). Add an ADR‑style comment recording the decision because it touches signed payloads.
8. **Version fields.** Introduce a branded `ContractVersion`/`ProviderProtocolVersion`/`StorageSchemaVersion` (semver‑shaped `string` brands) and document the negotiation contract: who compares, what "compatible" means, and what happens on mismatch. Apply across `StorageProviderIdentity`.
9. **Handle/ref brands.** Brand the materialization‑handle and credential‑ref fields in `connection.ts`/`provider-configs.ts` (`PathHandle`, `EndpointHandle`, `CredentialRef`, `BucketHandle`, …) so a raw secret/URL cannot be passed where a host‑resolved handle is required, reinforcing the credentials‑never‑in‑config invariant at compile time.

### Phase 4 — Model invalid combinations out of existence

10. Split `CreateDocumentOptions` so the public/browser facade type cannot express the internal/collaboration‑only fields (`initialSnapshot`, `yrsState`, deprecated `providers`, `internal`). Recommended: a discriminated/branded `InternalCreateDocumentOptions extends CreateDocumentOptions` carrying the bootstrap fields, exported on a clearly internal subpath, with the public type omitting them. Replace `initialSnapshot: Record<string, unknown>` with the real `WorkbookSnapshot` type (imported from `@mog/types-core` if it lives there) or a branded opaque `OpaqueWorkbookSnapshot` if the concrete type must stay engine‑internal.

### Phase 5 — Convention & ergonomics

11. **`appId()` runtime function.** Either (a) move `appId()` to the kernel alongside the other brand constructors and keep `AppId` type‑only here (consistent with `paths.ts`/`permissions.ts`), or (b) decide brand constructors are allowed in this package and bring `filePath()`/`dirPath()`/`appId()` here together. Pick one and document it in the root header. Recommend (a) for consistency with the stated "TYPES ONLY" convention; if (a), repoint `app/types` consumers to the kernel constructor.
12. **Root barrel.** Replace the bare `export {}` with a curated, collision‑free root surface — either namespaced re‑exports (`export * as storage from './storage'`, etc.) or an explicit allow‑list of non‑colliding symbols — and keep the subpath‑only guidance for the colliding names. Document the chosen rule in the header so it doesn't silently regress.
13. **Dead‑header / redundancy cleanup.** Remove the empty "Type Guards" section trailer in `comments.ts`; clarify the `Comment.commentType` vs separate `CellNote` relationship (one model with a discriminant, or two clearly‑scoped models with a documented boundary).

### Phase 6 — Cross‑boundary conformance

14. Establish a conformance check for the serde‑match claims (`AccessExplanation` ↔ `compute_security::engine::AccessExplanation`; `CsvImportOptions` ↔ `csv_parser::CsvImportOptions`). Preferred: a golden‑fixture round‑trip test in the kernel/Rust boundary package (other queue item) that fails when either side drifts; minimum: a checked‑in note linking the two declarations with the exact crate path. This makes objective (7) durable.

## Tests and verification gates

This is a contracts package, so verification is primarily *type‑level* plus boundary conformance. (Per task constraints I am not running any of these; they are the gates the implementer must pass.)

- **`pnpm --filter @mog-sdk/types-document typecheck`** (`tsc -b .`) must pass with zero errors after each phase.
- **Whole‑graph typecheck** of the 133 import sites (kernel `document/**`, host‑internal, shell, `types-host`, `types-editor`, `types-machines`, `types-events`, `types-rendering`, `runtime/test-host`, `apps/spreadsheet`) — additive‑first ensures green; the migration steps that repoint imports must be verified package‑by‑package.
- **Compile‑time invariant assertions** added in this package: exhaustiveness of `ACCESS_LEVEL_ORDER` keys vs `AccessLevel`; each `as const` tuple's `[number]` equals the prior hand‑written union (a `satisfies`/`Equals` type‑assert that fails the build if they diverge).
- **`mog/kernel/src/document/__tests__/composition-conformance.test.ts`** and the `package-boundary-validator` test must stay green; if Phase 2 lets them switch to the exported tuples, update them in the kernel queue item (not here) and confirm.
- **Provider‑config exhaustiveness:** a `switch (cfg.kind)` over `StorageProviderConfig` in the kernel registry must remain total; verify after any Phase 1/2 change.
- **Serde conformance fixtures** (Phase 6) for `AccessExplanation` and `CsvImportOptions` round‑trip green.
- **No‑runtime check:** confirm the package still emits no runtime code beyond the intentional constants (`ACCESS_LEVEL_ORDER`, `DEFAULT_SEARCH_OPTIONS`, the new `as const` tuples, and — per the Phase 5 decision — the brand constructors), keeping it tree‑shakable.
- **Export‑map integrity:** every `package.json` subpath still resolves; no entry point removed. A `git diff` review of `exports` is the gate.

## Risks, edge cases, and non-goals

- **Breaking the wire format.** The proof/authority and inbound‑update shapes are hashed and signed. Changing `sequence` from `bigint` to a branded string changes nothing on the wire *only if* the current code never actually serialized a `bigint` (it can't via plain JSON) — so the change likely *fixes* a latent bug, but must be confirmed against the kernel's actual canonicalization. Treat Phase 3.7 as the highest‑risk step; gate behind the Rust/kernel boundary owners.
- **`AccessLevel` collision is intentional, not a bug.** The security scale and the filesystem permission scale are different domains. The fix is disambiguation (naming/namespacing at the root), **not** unification. Do not merge them.
- **Additive‑first or break consumers.** With 133 import sites, every consolidation must re‑export old names until the kernel/shell queue items migrate. Removing a name in the same change that introduces its replacement is out of scope.
- **`initialSnapshot`/`yrsState` typing depends on engine‑internal types** that may deliberately not be public. If the concrete `WorkbookSnapshot`/Yrs‑state type cannot be exposed at Tier‑1 without a dependency violation, use an opaque brand rather than forcing a dependency — preserving leaf purity wins over precise typing here.
- **Non‑goals:** implementing or changing any enforcement (that is Rust/kernel); adding new provider kinds, dialog/clipboard capabilities, or query operators; touching `dist/`; renaming/removing existing exported names; test‑only or shim solutions. The deprecated `providers` field is *gated and documented*, not removed, this round.

## Parallelization notes and dependencies on other folders

- **Self‑contained, parallelizable phases:** Phases 1 (duplicate reconciliation), 2 (tuples), 5 (root barrel, `appId()` decision, dead headers), and 6 (note/fixture scaffolding) are largely internal to this package and can proceed concurrently by different workers, since they touch disjoint files.
- **Phase 3 (wire precision) and Phase 4 (option modelling) are sequenced and gated** on the runtime owners — they cannot land safely without coordinating with:
  - **`mog/kernel/src/document/**`** (queue items for the lifecycle system, provider registry, `composition-validator`, and the eleven provider impls) — they enumerate the unions, build the configs, and emit the proofs.
  - **`mog/kernel/host-internal/src/{create,validate}.ts`** and **`mog/shell/src/host-adapters/*`** — they construct `CreateDocumentOptions`/`DocumentStorageConfig` and are where the Phase 4 split surfaces.
  - **The Rust `compute-security` crate and `csv_parser` crate** — owners of the serde counterparts for the Phase 6 conformance check.
  - **`@mog/types-core`** — if `WorkbookSnapshot`/Yrs‑state types are to be referenced (Phase 4.10) or `AccessLevel`/cell types are involved, confirm they live there first.
- **Downstream typecheck fan‑out:** `types-host`, `types-editor`, `types-machines`, `types-events`, `types-rendering`, `runtime/test-host`, and `apps/spreadsheet` all import from these subpaths; their queue items must re‑verify after any import‑repointing step. Keep changes additive so their builds stay green until they migrate on their own schedule.
