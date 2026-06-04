# 075 - Types Document Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/document/src`

Queue item: 75

Scope: the `@mog-sdk/types-document` source shard for document lifecycle, filesystem, storage, security, platform, shell, and app contracts. This package is `private` and workspace-internal, but it is the source of many public-facing contract shapes re-exported through `@mog-sdk/contracts`, used by kernel providers, consumed by shell/apps, emitted in API reports, and mirrored by Rust compute/security storage code.

Files inspected in this folder:

- `index.ts`
- `app/index.ts`, `app/types.ts`
- `document/comments.ts`, `document/document.ts`, `document/index.ts`, `document/search.ts`
- `filesystem/index.ts`, `filesystem/paths.ts`, `filesystem/permissions.ts`, `filesystem/types.ts`
- `platform/identity.ts`, `platform/index.ts`, `platform/types.ts`
- `security/evaluator.ts`, `security/index.ts`, `security/types.ts`
- `shell/index.ts`, `shell/types.ts`
- `storage/capabilities.ts`, `storage/composition.ts`, `storage/connection.ts`, `storage/document-provider.ts`, `storage/errors.ts`, `storage/high-water-mark.ts`, `storage/inbound-updates.ts`, `storage/index.ts`, `storage/lifecycle.ts`, `storage/profiles.ts`, `storage/provider-capabilities.ts`, `storage/provider-configs.ts`, `storage/provider-identity.ts`, `storage/provider-kinds.ts`, `storage/query.ts`, `storage/table-driver.ts`

Adjacent production and contract paths inspected:

- `types/document/package.json`
- `types/document/tsconfig.json`
- `contracts/src/document/*`, `contracts/src/filesystem/*`, `contracts/src/platform/*`, `contracts/src/security/*`, `contracts/src/storage/*`
- `types/host/src/storage.ts`, `types/host/src/identity.ts`
- `kernel/src/document/providers/*`
- `kernel/src/document/providers/composition-validator.ts`
- `kernel/src/document/providers/registry.ts`
- `kernel/src/document/providers/provider.ts`
- `kernel/src/document/host-storage-preflight.ts`
- `kernel/src/document/high-water-mark-registry.ts`
- `kernel/src/api/workbook/security.ts`
- `compute/core/crates/compute-security/src/{policy.rs,engine.rs,events.rs,level.rs,principal.rs}`
- `types/events/src/security-events.ts`
- `types/api/src/api/workbook.ts`, `types/api/src/api/workbook/security.ts`
- `runtime/sdk/etc/node.api.md`
- `runtime/sdk/scripts/build-types.mjs`
- `tools/check-contract-identity.mjs`
- `fixtures/external/positive/contracts/smoke.ts`
- `fixtures/external/negative/types-star-import/smoke.ts`

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal in `mog-internal`.

## Current role of this folder in Mog

`types/document/src` is a Tier 1 leaf type shard. The root barrel intentionally exports nothing because inherited source areas have name collisions such as filesystem/table-driver `Unsubscribe` and app/filesystem `AppId`. Consumers import precise subpaths, for example `@mog-sdk/types-document/storage/provider-configs` or `@mog-sdk/types-document/security`.

The folder currently owns these contract families:

- Document lifecycle and import options: `DocumentSource`, provider config placeholders, create/import options, CSV import options, progress, import results, warnings, stable search result state, and comment/note shapes.
- Filesystem and sandboxing: branded `FilePath`, `DirPath`, `AnyPath`, app-scoped filesystem permissions, sandbox config, `IFileSystem`, file metadata, directory entries, and watch events.
- Storage providers and document durability: open intents, durability modes, provider roles/kinds, provider identity/scope/fingerprints, per-provider config unions, provider capabilities, runtime profiles, composition rule/result shapes, lifecycle phases, checkpoint/close results, structured errors, inbound update envelopes, and high-water mark/export proof shapes.
- Table data drivers: portable query AST, source connection configs, table bindings, row/table identifiers, schema, table records, driver capabilities, change events, and driver errors.
- Security policy contracts: access principals, tag/target matchers, access levels, policy ids, policy metadata, access policies, access ordering, document security config, and access explanations for Rust-enforced data policy calls.
- Platform/app/shell contracts: platform identity, platform file handles, dialogs, notifications, clipboard, shell operations, app IDs/manifests/data requirements, and shell document lifecycle service used by action handlers.

Important observed production dependencies:

- `kernel/src/document/providers/composition-validator.ts` hardcodes the provider kind trait matrix and durability rules using `StorageProviderKind`, `StorageProviderRole`, and `DocumentDurabilityMode` from this folder.
- Kernel provider implementations import `StorageProviderCapabilities`, `StorageProviderIdentity`, and concrete provider config types from this package.
- `kernel/src/document/host-storage-preflight.ts` currently carries a raw `StorageProviderConfig` interface with `kind: string` and `role: string`, separate from the typed provider config union.
- `compute-security` owns the Rust serde wire shapes for `AccessPolicy`, `AccessTarget`, `AccessLevel`, `AccessExplanation`, and security events. The TypeScript security files claim parity, but some fields diverge today.
- `@mog-sdk/contracts` re-exports selected document/storage/security/filesystem/platform types from this shard, and public SDK packages depend on those re-exported identities.
- `runtime/sdk/etc/node.api.md` currently shows imports for `DocumentSource`, `DocumentImportOptions`, and `DocumentImportWarning` from the comments subpath, and reports a forgotten export warning for `TargetMatcher`.
- `tools/check-contract-identity.mjs` already checks a small set of shared identities, including `DocumentSource`, `DocumentStorageConfig`, `StorageProviderConfig`, and `StorageProviderKind`, but it does not cover this folder's full public facade surface.

## Improvement objectives

1. Make `types/document/src` the executable source of truth for document, storage, filesystem, platform, shell, app, and data-policy contracts that cross package or language boundaries.

2. Preserve the intentional empty root barrel while making every supported subpath export explicit, complete, and verified against `types/document/package.json`, contracts re-export shims, and generated SDK declarations.

3. Replace stringly typed provider composition knowledge with a single typed storage-provider contract registry consumed by kernel validation, host preflight, provider tests, and public facade checks.

4. Split public document create/import options from internal bootstrap and collaboration escape hatches so public callers cannot accidentally depend on options that production browser facades reject.

5. Align TypeScript security policy and explanation contracts with Rust serde shapes through generated or fixture-backed parity tests, including metadata, reason codes, warnings, and event payloads.

6. Make high-water mark, inbound update, storage error, and lifecycle contracts wire-safe and exhaustively enumerable, including timestamp, sequence, hash, proof, and error-code semantics.

7. Strengthen filesystem/app/platform contracts so branded identifiers, sandbox permissions, file handles, path boundaries, and dialog handles have one route from type to runtime validation.

8. Tie optional table-driver methods to declared capabilities so table integrations cannot advertise operations they do not implement, or implement operations the app cannot discover.

9. Keep dependency direction clean: `types/document` may depend on `@mog/types-core` only; `mog` and public facade packages must never depend on `mog-internal`.

10. Add production-path verification gates for type identity, package exports, Rust/TS wire parity, kernel storage lifecycle conformance, host handoff validation, and public SDK declaration output.

## Production-path contracts and invariants to preserve or strengthen

Package and export surface:

- The root `@mog-sdk/types-document` entry must stay intentionally empty unless name collisions are resolved by a deliberate public API design.
- Every non-root public subpath in `types/document/package.json` must resolve to exactly one source file or index barrel, and every exposed source file must be either exported intentionally or documented as internal-only.
- `@mog-sdk/contracts` remains the public facade for SDK consumers; `@mog-sdk/types-document` remains workspace-internal/private.
- Public declaration emit and API Extractor output must not invent unstable subpath imports or forgotten-export warnings for types owned here.
- Shared contract identities must not be redeclared by public facade packages; they must be imported or re-exported through the intended source.

Document lifecycle and import:

- `DocumentSource` must preserve the current production distinction between native path sources and in-memory byte sources.
- Internal lifecycle bypasses such as provider injection, initial snapshots, Yrs state, and internal documents must remain available for the code paths that own them, but they should not be part of the ordinary public create/import option type.
- CSV formula evaluation must remain opt-in because `evaluateFormulas?: false` is a CSV injection guard.
- Import progress must keep phase, sheet, sheet count, cell count, and percentage semantics stable.
- Import warnings must be broad enough to represent all production XLSX/CSV warning categories without lossy casts in SDK adapters.

Storage provider composition:

- `StorageProviderKind`, `StorageProviderRole`, `StorageProviderConfig`, `StorageProviderCapabilities`, `DocumentDurabilityMode`, `DocumentOpenIntent`, and `StorageRuntimeProfile` must be exhaustively covered by a single contract matrix.
- Provider config fields must carry materialization handles and redacted fingerprints, never raw secrets, raw URLs, raw credentials, or private host paths.
- Host handoff validation must fail closed: unrecognized kind/role/durability/profile, unauthorized provider refs, mismatched fingerprints, missing required providers, or unsupported raw-byte policies must not silently degrade to writable storage.
- Required durable storage, writable authority, snapshot-only fallback, export sinks, cache-only remote-backed compositions, role/kind compatibility, contract-version compatibility, and read-only fallback rules must be encoded once and consumed by kernel.
- Provider capability flags must remain a complete record; adding a new capability must break all capability tables until every provider declares it.
- A provider's advertised capabilities must match its production implementation: checkpoint, append log, cursor, subscription, lock, inbound update, asset, and batch flags must be tested through provider instances.

Storage lifecycle, errors, and proofs:

- `DocumentStoragePhase` is a finite state machine, not an arbitrary status string. Legal transitions, ready modes, close/destroy behavior, and error phases should be derivable from the contract.
- `StorageErrorBase.code` and `CompositionViolation.code` must be stable enumerated codes with categories, severity, phase, retryability, and involved provider refs.
- High-water mark proofs must be wire-safe and security-relevant: session id, issue/expiry time, payload hash, snapshot fields, consumption, and expiry are part of the export authorization contract.
- Inbound updates must be authority-bound to provider ref, session, scope, epoch, update id, sequence, payload kind/hash, raw bytes policy, and asset dependencies.
- Wire shapes must not contain non-JSON-safe values where bridge or host protocols serialize them. `bigint` sequence values need an explicit runtime-only vs wire-safe representation.
- Timestamp representation must be intentional: epoch milliseconds and ISO strings should not be mixed in the same proof/lifecycle family without adapter types.

Security and Rust parity:

- `AccessLevel` order must match Rust `#[repr(u8)]`: none, structure, read, write, admin.
- `AccessTarget` and `TargetMatcher` must keep workbook/sheet/column discriminants and `SheetId`/`ColId` identity-based targeting.
- `AccessPrincipal` tags must be canonicalized consistently with Rust principal handling: stable ordering, dedupe, derived tags, owner defaults, and no accidental empty-principal grants.
- `AccessPolicy` metadata must match the persisted Rust serde shape or be split into persisted metadata and UI-only metadata. Today TS includes `description`; Rust policy metadata only serializes created-by/time/template.
- `AccessExplanation` must either match Rust `compute_security::engine::AccessExplanation` after camelCase normalization or explicitly define an adapter result type. The current TS shape omits fields that Rust produces, including effective tags, sorted policies, ambiguity, clamp state, and reason enum.
- Security event unions in `types/events` and security policy types in this folder must grow in lockstep with Rust `SecurityEvent`.

Filesystem, app, platform, and shell:

- Branded `FilePath`, `DirPath`, `AppId`, table ids, row ids, and policy ids must be created by trusted constructors and not by unchecked arbitrary strings in production paths.
- Filesystem sandbox grants must preserve app id, path, access, grant time, expiry, and recursion semantics, and must not treat directory and file paths interchangeably without validation.
- Watch events must preserve old and new paths for rename and distinguish file-only modify from file/directory create/delete.
- `PlatformFileHandle` must be reachable through intended platform subpaths and public facade exports because it is the replacement for raw path or inline browser-file workarounds.
- Shell service state must not reference shell implementation classes; it should stay a capability contract over load/new/close/activate/handle/save-state operations.

Table driver/query:

- Portable queries must remain expressible across local, SQL, REST, GraphQL, and future providers without test-only shortcuts.
- Query filters must have operator-specific value types and stable null semantics.
- Table driver capabilities must align with optional interface methods: batch, native query, streaming, status, refresh, health, and subscriptions.
- Driver errors should use stable machine-readable codes and carry enough operation/query/table context for app diagnostics.

## Concrete implementation plan

### 1. Create an export surface contract for `@mog-sdk/types-document`

Add a source-owned export manifest, for example `types/document/src/export-surface.ts`, that describes every intended subpath, whether it is public through `@mog-sdk/contracts`, whether it is workspace-internal only, and which source file owns it.

Use that manifest to drive or verify:

- `types/document/package.json` `exports`
- the empty root barrel policy
- sub-barrel exports in `document`, `filesystem`, `platform`, `security`, `shell`, and `storage`
- `contracts/src/*` re-export shims
- API Extractor import paths for `@mog-sdk/node`, embed, and contracts
- `tools/check-contract-identity.mjs` shared-symbol coverage

Specific export fixes to plan into the implementation:

- Decide whether `storage/provider-kinds` should be a direct package subpath. If it remains indirect only through `storage/document-provider` and `storage`, encode that as intentional.
- Export `PlatformFileHandle` from `types-document/platform` if `contracts/src/platform/index.ts` should not need a special extra re-export from `platform/types`.
- Ensure document lifecycle symbols are imported in generated reports from `document/document` or `document`, not from `document/comments`.
- Ensure `TargetMatcher` and any other security helper type used in public declarations are exported by the relevant public entry point.
- Keep root star import fixtures negative: `import type { DocumentState } from '@mog-sdk/types-document'` should continue to fail outside the monorepo unless the root API is deliberately redesigned.

### 2. Split public document options from internal bootstrap options

Refactor document lifecycle types into explicit option families:

- `PublicCreateDocumentOptions`: fields production SDK/browser callers may pass.
- `DocumentImportOptions`: public import knobs plus public create knobs.
- `CsvImportOptions`: wire-compatible with the Rust CSV parser, with CSV injection guard semantics preserved.
- `InternalDocumentBootstrapOptions`: provider injection, initial snapshot, Yrs state, internal hidden document flag, and any collaboration-only bootstrap hooks.
- `DocumentFactoryInternalCreateOptions`: the actual kernel/factory composition type if it needs both public and internal fields.

Then update kernel `DocumentFactory`, shell document loading, runtime SDK options, and type re-exports so public APIs do not expose fields that runtime production facades reject. Runtime validation should fail closed when internal-only fields appear on public entry points.

Also tighten import results:

- Use branded `SheetId` for `sheetIds` if callers need sheet identity, or explicitly document why plain strings are returned at this API boundary.
- Expand `DocumentImportWarning` into a stable warning-code union that covers XLSX, CSV, formatting, formulas, unsupported features, truncation, encoding, security, and bridge/import errors.
- Avoid generated SDK casts that coerce arbitrary warning strings into a narrower warning union.

### 3. Move storage composition knowledge into one typed contract registry

Create a storage contract registry module in this shard, for example `storage/provider-contracts.ts` or `storage/composition-rules.ts`, with these exported const records:

- `STORAGE_PROVIDER_KIND_TRAITS satisfies Record<StorageProviderKind, ProviderKindRoleCompatibility>`
- `DOCUMENT_DURABILITY_REQUIREMENTS satisfies Record<DocumentDurabilityMode, DurabilityRequirement>`
- `STORAGE_RUNTIME_PROFILE_RULES satisfies Record<StorageRuntimeProfile, CompositionRuleSet>`
- `STORAGE_PROVIDER_CAPABILITY_KEYS satisfies readonly (keyof StorageProviderCapabilities)[]`
- `STORAGE_PROVIDER_CONFIG_KIND_FIELDS satisfies Record<StorageProviderKind, readonly string[]>`
- `DOCUMENT_OPEN_INTENT_RULES satisfies Record<DocumentOpenIntent, ...>`

Kernel `composition-validator.ts`, registry preflight, provider conformance tests, and host validation should import these records instead of maintaining local copies. This makes adding a provider kind, role, durability mode, runtime profile, or capability a compile-time event across the production path.

Implementation requirements:

- Preserve current kernel behavior while moving the matrix: memory/indexeddb/filesystem/tauriSidecar/remoteApi/objectStore/databaseLog/hostCallback/readOnlySnapshot/redactedPublishedSnapshot/test kind traits must be copied exactly before any semantic change.
- Keep warnings and errors stable initially, then replace string codes with typed `CompositionViolationCode`.
- Add a `validateDocumentStorageConfigShape` function that is safe for host handoff and returns structured violations, not exceptions only.
- Keep the validation function production-compiled; do not hide it in tests.

### 4. Normalize host storage handoff around typed provider configs

Replace the duplicated raw `StorageProviderConfig` interface in `kernel/src/document/host-storage-preflight.ts` with a two-stage contract:

- `HostStorageProviderWireConfig`: untrusted host shape with raw strings and optional raw storage scope.
- `ValidatedStorageProviderConfig`: actual `StorageProviderConfig` union from this folder after kind/role/scope/fingerprint/authority validation.

Host preflight should:

- Normalize raw config into the typed union only after matching `AuthorizedProviderSummary`.
- Validate provider ref uniqueness, authority references, required providers, storage scope equality, redacted fingerprint equality, contract version, provider protocol version, schema version, and raw byte exposure policy.
- Feed the resulting typed config into the same composition validator as kernel providers.
- Emit storage diagnostics with typed error/category/code fields from `storage/errors.ts`.

This keeps fail-closed host security without pretending untrusted host data is already a trusted typed provider config.

### 5. Make storage lifecycle and error contracts exhaustive

Add typed unions and tables for lifecycle and storage errors:

- `StorageReadyPhase = 'readyReadWrite' | 'readyReadOnly' | 'readyEphemeral'`
- `StorageTerminalPhase = 'closed' | 'destroyed' | 'error'`
- `StorageLifecycleTransitionRule` and `DOCUMENT_STORAGE_PHASE_TRANSITIONS`
- `StorageErrorCode` split by category, for example authorization/configuration/lock/durability/replay/sync/quota/policy/implementation
- `CompositionViolationCode`
- `ProofValidationErrorCode`

Use these unions in `StorageLifecycleError`, `StorageErrorBase`, `CompositionViolation`, proof validation, registry preflight, provider conformance tests, and diagnostics. The goal is not to make codes pretty; it is to make unhandled storage states impossible to add silently.

Also standardize timestamp and sequence fields:

- Use epoch milliseconds for lifecycle/provider timing fields unless a field is explicitly an ISO API report value.
- Use an explicit `ProviderSequence` wire type, likely a decimal string brand, for bridge/host serialization. Keep `bigint` only in internal runtime state if necessary.
- Define branded types for payload hashes, content fingerprints, provider epochs, update ids, cursor ids, proof ids, and session ids where they cross security/storage boundaries.

### 6. Harden high-water mark and inbound update proof contracts

Treat high-water marks and inbound envelopes as security contracts, not diagnostics-only types.

For high-water proofs:

- Define a canonical payload schema that includes proof id, session id, captured snapshot, provider origin watermarks, barrier state, pending asset count, issued/expiry times, and hash algorithm.
- Make proof validation errors exhaustive and include enough context for export denial.
- Ensure the registry, host operation gate, and public SDK docs agree on single-use vs revocable/session-scoped proof behavior.
- Replace generic `field: string` mismatch reporting with a typed field union.

For inbound updates:

- Require `authorityProof.coveredFields` to cover every field that the provider is expected to authenticate.
- Make `rawBytesPolicy` explicit in the envelope or explain where it is carried if it remains host-only.
- Add an asset dependency state contract for unresolved, materialized, unavailable, and policy-blocked assets.
- Decide whether inbound payload bytes are allowed on all host paths or must be referenced by a handle for large/remote updates.

### 7. Align TypeScript security contracts with Rust serde shapes

Create a security wire parity workstream across `types/document/src/security`, `types/events/src/security-events.ts`, `compute-security`, and bridge adapters.

Implementation steps:

- Define `AccessExplanation` to match Rust after camelCase normalization, or introduce `RustAccessExplanationWire` plus a deliberate smaller SDK-facing `AccessExplanation`. Do not keep a type comment claiming serde parity if fields differ.
- Add `ExplainReason`, `AmbiguityWarning`, `effectiveTags`, `sortedPolicies`, `ambiguity`, and `clampFired` fields if the public explanation should expose the Rust shape.
- Resolve `AccessPolicyMetadata.description`: either add it to Rust persisted metadata with tests and migration policy, or split it into UI-only metadata outside persisted `AccessPolicyMetadata`.
- Add a TS `AccessPolicyPatch` type if SDK/workbook APIs intentionally expose patch updates, matching Rust patch semantics.
- Make principal tag canonicalization explicit with a `normalizeAccessPrincipal` helper in kernel or contracts that sorts/dedupes tags and rejects invalid empty principals where required.
- Keep `ACCESS_LEVEL_ORDER` generated from or tested against the Rust order.
- Extend security event type tests so any new Rust `SecurityEvent` variant forces a TS event union update.

Verification must include serde fixtures from Rust into TS and TS into Rust for workbook, sheet, column policies; metadata; explain results; and all security events.

### 8. Strengthen filesystem, app, platform, and shell contracts

Filesystem:

- Add a path validation/branding contract that distinguishes native absolute paths, sandbox-relative app paths, browser virtual paths, and display-only paths.
- Keep runtime constructors in kernel/platform code, but make their return brands and validation errors traceable to this type shard.
- Add stable filesystem error code types parallel to the current doc comments for file not found, directory not found, permission denied, already exists, not empty, symlink policy, and unsupported backend.
- Define watch event delivery guarantees: ordering, rename atomicity, directory recursion, and unsubscribe idempotence.

App:

- Keep `AppId` shared with filesystem permissions, but verify kernel/app-platform/type constructors produce the same brand and do not create incompatible nominal identities.
- Tighten `AppManifest.fileExtensions` to a normalized extension type if registration relies on leading-dot behavior.
- Align `AppDataRequirements.TableColumnType` with storage `ColumnType` or document the smaller app-manifest subset.

Platform:

- Export `PlatformFileHandle` through the intended platform barrel.
- Add discriminants or capability flags to `PlatformFileHandle` for read-only upload fallback, write-only download fallback, desktop path-backed handles, and File System Access handles.
- Replace `showOpenFolderDialog(): Promise<string | null>` with a branded or capability-shaped folder handle if production code needs more than display text.
- Add clipboard capability/error contracts for denied, unsupported, empty, type mismatch, and browser gesture requirements.

Shell:

- Keep `ShellService` implementation-free and action-handler focused.
- Expand `LoadDocumentOptions.csvOptions` to reuse `CsvImportOptions` when shell loading supports more than sheet name.
- Ensure shell document state handles preserve `undefined` vs `null` semantics for "never had handle" vs "explicitly cleared."

### 9. Tie table-driver capabilities to interface behavior

Introduce a table-driver conformance contract:

- `TableDriverCapabilityMethodMap` tying `supportsNativeQuery`, `supportsBatch`, `supportsWatch`, `canStream`, `canCreate`, `canUpdate`, `canDelete`, and transaction support to concrete methods.
- `DriverErrorCode` and stable error payloads instead of generic `type: 'unknown'`.
- A query normalizer that validates filter trees, limit/offset bounds, selected columns, null semantics, and string operator support before handing query ASTs to individual drivers.
- Optional cursor pagination support if REST/GraphQL/remote providers cannot safely emulate offset.

Production implementations should not rely on app-side capability checks alone. Driver methods should fail with typed errors when called without support, and provider conformance tests should compare capability flags to method behavior.

### 10. Extend public contract identity and declaration gates

Build on `tools/check-contract-identity.mjs` and public fixture tests:

- Add all shared document/security/storage/platform identity symbols that public facade packages must not redeclare locally.
- Add a package export map gate that compares `types/document/src/export-surface.ts` to `package.json`, contracts shims, and generated declarations.
- Add API Extractor snapshot checks for correct subpath imports and no forgotten-export warnings for `TargetMatcher`, `AccessExplanation`, `DocumentSource`, `DocumentImportOptions`, `DocumentImportWarning`, `PlatformFileHandle`, and storage provider types.
- Add external positive fixtures for `@mog-sdk/contracts/document`, `storage`, `security`, `platform`, and `filesystem`.
- Keep external negative fixtures proving workspace-internal `@mog-sdk/types-document` root imports and internal `@mog/types-*` packages do not leak into public consumers.

### 11. Integrate without changing dependency direction

Implementation should update consumers in place:

- `kernel/src/document/providers/composition-validator.ts` imports the typed matrix from `@mog-sdk/types-document/storage`.
- `kernel/src/document/providers/registry.ts` uses typed violation codes and lifecycle ready phases.
- Provider implementations continue to import concrete provider config types and capabilities from this shard.
- `kernel/src/document/host-storage-preflight.ts` uses raw host wire types only before validation and typed provider config after validation.
- `contracts/src/*` remain public facade re-exports, not independent type redeclarations.
- Rust crates do not import TS; parity flows through fixtures, generated JSON, and bridge/API tests.

Do not introduce a dependency from `types/document` to kernel, contracts, runtime SDK, shell, or internal planning files.

## Tests and verification gates

Focused TypeScript/package gates:

- `pnpm --filter @mog-sdk/types-document typecheck`
- `pnpm --filter @mog-sdk/contracts typecheck`
- `pnpm --filter @mog-sdk/types-host typecheck`
- `pnpm --filter @mog-sdk/kernel test` focused on document provider registry, host storage preflight, high-water mark registry, security API, and filesystem services.
- `pnpm --filter @mog-sdk/kernel typecheck`
- `pnpm --filter @mog-sdk/shell test` for platform file handle, shell service, package boundary validator, and document load/save paths when platform/shell types change.
- `pnpm --filter @mog-sdk/runtime-test-host test` or the relevant runtime test-host package gate when storage host config conversion changes.
- `pnpm typecheck` for TypeScript changes unless an implementation PR has an explicit narrower type gate and explains it.
- `pnpm check:publish-readiness:fast` after public facade/export changes.

Focused Rust gates when security wire contracts change:

- `cargo test -p compute-security`
- `cargo clippy -p compute-security`
- `cargo test -p compute-core security`
- `cargo clippy -p compute-core`
- `cargo test -p compute-api security_e2e` or the current focused security bridge suite.
- Python/pyo3 API surface checks if generated security/document types feed the Python SDK.

Contract and fixture tests to add or update:

- Export-surface tests comparing `src/export-surface.ts`, `package.json` `exports`, sub-barrels, contracts re-export shims, and API Extractor reports.
- Type identity tests extending `check-contract-identity` to document/storage/security/platform symbols.
- External positive fixtures proving `@mog-sdk/contracts` exposes document source/import, storage provider config, storage proofs, security policy/explanation, filesystem path/permission, and platform handle types.
- External negative fixtures proving internal root or workspace-only imports fail.
- Storage composition conformance tests generated from the provider kind trait/durability/runtime profile matrices.
- Provider capability conformance tests for every provider implementation, including optional methods and capability flags.
- Host storage preflight tests for authorized provider matching, scope/fingerprint mismatch, unknown kind/role, missing required providers, read-only fallback, and secret/raw path rejection.
- High-water mark proof tests for issue, validate, consume, expiry, session mismatch, snapshot mismatch, inbound barrier active, and payload hash stability.
- Inbound update tests for authority proof coverage, payload hash mismatch, sequence ordering, epoch mismatch, scope mismatch, and asset dependency states.
- Security serde parity fixtures for AccessPolicy, AccessPolicyPatch, AccessTarget, AccessExplanation, AmbiguityWarning, and SecurityEvent from Rust to TS and TS to Rust.
- Filesystem/app/platform contract tests for path branding, sandbox permission expiry/recursion, platform handle read/write capability, and shell handle persistence.

Behavior verification must use production entry points:

- `DocumentFactory` and `MogDocumentFactory` for create/open/import option validation.
- Kernel storage provider registry and concrete providers for composition/capability behavior.
- Host storage preflight for authorized handoff validation.
- `HighWaterMarkProofRegistry` and host operation gate for export proof behavior.
- `wb.security.*` bridge-facing APIs for security policy/explanation behavior.
- Shell/platform services for dialogs, file handles, and save/load behavior.

Do not prove these contracts by mutating private state directly in tests except in narrow codec/serde unit tests whose purpose is to validate a wire shape.

## Risks, edge cases, and non-goals

Risks:

- Tightening public option types can reveal SDK callers using internal bootstrap fields. Route those callers to internal types; do not keep the public surface broad as a compatibility workaround.
- Moving provider composition matrices can change kernel behavior if the matrix is copied incorrectly. Start by duplicating current behavior exactly and add generated conformance tests before semantic changes.
- Replacing string error codes with unions can require touching many diagnostics. Do it category by category with stable names, not by preserving arbitrary string escape hatches.
- Security parity work may expose real Rust/TS drift in persisted policy metadata and explanation results. Resolve the contract at the source; do not paper over API Extractor output.
- Wire-safe sequence/timestamp changes can affect host protocols and generated SDKs. Split runtime-only and wire types deliberately before changing bridge payloads.
- Export-surface cleanup can change generated declaration imports. API snapshots and external fixtures should catch public breakage before publish.

Edge cases to cover:

- Snapshot-only storage with and without read-only fallback.
- Remote-backed config with cache-only providers.
- Export-sink-only compositions under durable modes.
- Multiple writable authorities and explicit future multi-authority policy.
- Optional provider factory missing vs required provider factory missing.
- Provider contract version mismatch, provider protocol version mismatch, and schema version mismatch.
- Untrusted host handoff containing raw URLs, raw paths, credentials, duplicate provider refs, unknown kinds, and mismatched fingerprints.
- Inbound update `bigint` sequence through JSON/bridge boundaries.
- Proof expiry around clock skew, already-consumed proofs, session mismatch, and high-water snapshot drift.
- Access policy metadata with UI descriptions, template ids, disabled policies, owner defaults, no tags, ambiguous ties, and owner-lockout clamp behavior.
- Security events after remote policy reload, not only local add/update/remove calls.
- File handles that are read-only upload fallbacks, write-only download fallbacks, desktop path-backed handles, and FSA handles.
- Filesystem grants on directory paths with recursion disabled, expired grants, symlinks, and rename watch events.
- Table drivers that advertise batch/watch/native query support but omit the corresponding method.

Non-goals:

- Do not make `@mog-sdk/types-document` a public root package API.
- Do not move runtime provider implementations, filesystem implementations, shell services, or Rust security enforcement into the type package.
- Do not add compatibility shims that allow invalid storage configs, invalid host handoffs, or invalid policy wire shapes to pass.
- Do not optimize test-only paths or generated reports as the primary outcome; fixes must target the source contract and production consumers.
- Do not introduce dependencies from `mog` to `mog-internal`.
- Do not collapse document data-policy security into app capability security; they are separate enforcement layers with different principals and targets.

## Parallelization notes and dependencies on other folders, if any

The implementation is naturally parallelizable after the export-surface and storage/security contract decisions are made.

Suggested workstreams:

- Export-surface and declaration worker: owns `types/document/package.json`, sub-barrels, contracts shims, API Extractor output, external fixtures, and `check-contract-identity` extensions.
- Storage contract worker: owns provider kind traits, durability/profile rule registry, capability keys, composition violation codes, kernel composition validator integration, and provider conformance tests.
- Host/proof worker: owns host storage preflight normalization, high-water mark proof contracts, inbound update wire safety, and host operation gate tests.
- Security parity worker: owns TS/Rust AccessPolicy/AccessExplanation/SecurityEvent parity, metadata decisions, security API tests, and generated SDK/Python normalization.
- Filesystem/platform/app/shell worker: owns path/app brands, platform handle exports/capabilities, shell load options, filesystem error/watch contracts, and shell/platform tests.
- Table-driver worker: owns query normalization, capability-method conformance, driver errors, and external source tests.

Dependency order:

1. Decide export-surface ownership and add the manifest/gate first, so later work cannot add untracked subpaths.
2. Land storage provider registry records before changing kernel validators or provider tests.
3. Resolve security TS/Rust wire shape before updating public SDK declaration snapshots.
4. Update contracts/public fixtures after source contracts are stable.
5. Run package and repo-wide type gates last, then focused kernel/Rust behavior gates for touched production paths.

Cross-folder dependencies:

- `kernel/src/document/providers`, `kernel/src/document/host-storage-preflight.ts`, and `kernel/src/document/high-water-mark-registry.ts` for storage and proof behavior.
- `compute/core/crates/compute-security`, `compute/core/src/storage/security_*`, `types/events/src/security-events.ts`, and `kernel/src/api/workbook/security.ts` for data-policy security parity.
- `contracts/src/*`, `runtime/sdk`, `tools/check-contract-identity.mjs`, and external fixtures for public facade/declaration verification.
- `shell/src/platform`, `shell/src/services/shell-service.ts`, and `apps/spreadsheet` action handlers for platform file handles and shell service contracts.
