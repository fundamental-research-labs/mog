# Plan 004 — Harden `mog/contracts/runtime-services/src` (shared runtime↔kernel service contracts)

## Source folder and scope

- **Folder:** `mog/contracts/runtime-services/src`
- **Package:** `@mog-sdk/runtime-service-contracts` (`mog/contracts/runtime-services`, version `0.1.0`, `private: true`, `"type": "module"`)
- **Files in scope:**
  - `index.ts` — barrel that `export type {…}`-re-exports every contract.
  - `error-envelope.ts` — `RuntimeErrorCategory`, `RuntimeErrorEnvelope`.
  - `audit-event.ts` — `AuditActor`, `AuditOutcome`, `RuntimeAuditEvent`.
  - `service-contracts.ts` — `ServicePrincipal`, `SessionState`, `ServiceSession`, `TenantScope`, `RoomGrant`, `SourceImportHandoff`, `ExportMaterializationHandoff`, `ProviderMaterializationRef`, `RawByteMaterializationDecision`.
  - `protocol-version.ts` — `ProtocolVersion`, `CompatibilityStatus`, `CompatibilityResult`, `ProtocolHandshake`.
  - `deployment.ts` — `DeploymentProfile`, `ServiceHealth`, `ServiceReadiness`, `ServiceDiagnostics`.
- **Charter (must be preserved):** this is a **type-only** contract package. `mog/docs/security/DATA-FLOW-AND-EGRESS.md` states explicitly: *"Runtime service contracts are private/type-only contracts, not a shipped server."* The package's own `description` reads *"Types only, no implementation."* No server, route, handler, transport, or runtime side-effect may be added by this plan.
- **Adjacent surface this plan must reconcile with (coordinate, do not blindly edit):** `mog/contracts/src/runtime` in `@mog-sdk/contracts` (covered by **Plan 002**), which currently **re-declares** several of these exact types.

## Current role of this folder in Mog

This package is the shared type vocabulary for the boundary *between* the open-source Mog kernel/app and whatever runtime services (auth, collab, import/export, materialization/provider, compute, admin/ops) embed or front it. It defines five concern groups:

1. **Uniform failure shape** — `RuntimeErrorEnvelope` so every service boundary serializes errors identically for clients, proxies, and observability.
2. **Canonical audit record** — `RuntimeAuditEvent`, with decision-ref back-pointers into the capability system so auditors can trace *why* an action was permitted/denied.
3. **Service-boundary authorization handoffs** — `ServicePrincipal`/`ServiceSession`/`TenantScope`, plus the import/export/materialization/raw-byte handoff envelopes that bridge `file-io` and the capability system.
4. **Protocol negotiation** — `ProtocolVersion`/`ProtocolHandshake`/`CompatibilityResult` exchanged when two services first connect.
5. **Deployment & operability** — `DeploymentProfile`, health/readiness probes, and a redaction-safe `ServiceDiagnostics`.

It is registered in `mog/pnpm-workspace.yaml` and referenced by the root `mog/tsconfig.json` (so it is type-checked by the workspace build), but it has its own `typecheck` script and `dist`.

### Evidence-backed problems found

1. **Zero consumers, and the canonicity question is unresolved.** A repo-wide search (`mog`, `mog-internal`, `mog-website`, excluding `node_modules` and the package itself) finds **no importer** of `@mog-sdk/runtime-service-contracts` and no reference to its exported type names. This is expected for a contract whose services live outside the public workspace — but it means the package has **no compile-time pressure** keeping it honest, so drift and dead fields go undetected. The package is also **not** in `@mog-sdk/contracts`'s `tsconfig.json` `references`, so the natural consumer (`contracts`) does not even see it.

2. **Hard duplication / silent-drift hazard with `contracts/src/runtime`.** `RuntimeErrorCategory`, `RuntimeErrorEnvelope`, `AuditActor`, `AuditOutcome`, and `RuntimeAuditEvent` are declared **twice** — here and in `mog/contracts/src/runtime/{error-envelope,audit-event}.ts`. `DeploymentProfile` is declared **here** *and* in `mog/contracts/src/runtime/service-config.ts:1`. These are independent nominal declarations maintained by hand; they are structurally identical *today* but will diverge on the next one-sided edit. Worse (per Plan 002, finding 3): the `src/runtime` copies were **stripped of the security-bearing comments** that this folder still carries — so the two copies are already not equivalent as *contracts*, only as *shapes*.

3. **Security invariants are documented but unenforceable.** `RuntimeAuditEvent.redactedMetadata`, `RuntimeErrorEnvelope.details`, and `ServiceDiagnostics.config` all carry prose like *"Must never contain secrets, tokens, credentials, PII, or raw byte content"* / *"must strip secrets, connection strings, and credentials."* As bare `Record<string, unknown>` (or `Record<string, string|number|boolean>`) these are unverifiable: nothing forces a producer through a redactor, and nothing flags a violation at the boundary. For a contract whose entire purpose is the security boundary, the most safety-critical clauses have no teeth.

4. **Open `string` where a closed/branded type is the contract.** Discriminants and identifiers that callers must agree on are typed as bare `string`:
   - **Discriminants:** `ServicePrincipal.principalType`, `AuditActor.actorType`, `service` (in audit/health/readiness/diagnostics/handshake), `RawByteMaterializationDecision`/`SourceImportHandoff.sourceMimeType`, `ExportMaterializationHandoff.outputFormat`, `ProviderMaterializationRef.providerType`, `RuntimeErrorEnvelope.code`.
   - **Identifiers:** `principalId`, `tenantId`, `workspaceId`, `documentId`, `eventId`, `roomId`, `ServiceSession.id`, and the **decision-ref family** (`importDecisionRef`, `exportDecisionRef`, `materializationDecisionRef`, `rawByteDecisionRef`, `capabilityDecisionId`).
   - These are all interchangeable to the type system: a `tenantId` flows wherever a `documentId` is wanted; a `materializationDecisionRef` is accepted where an `importDecisionRef` is required. For an authorization boundary this is the highest-value place to add nominal (branded) types.

5. **Two parallel, drift-prone principal representations.** `ServicePrincipal` is the rich principal (`principalId`, `principalType`, `tenantId`, `displayName?`); `AuditActor` is a slim copy (`principalId`, **`actorType`**). The discriminant field is even *renamed* (`principalType` → `actorType`) between the two, so the same concept has two names and two shapes. An audit event built from a `ServicePrincipal` must be re-keyed by hand, inviting silent mismatch.

6. **Decision-ref "soup" with no shared type or invariants.** Five differently-named ref fields scatter across `audit-event.ts` and `service-contracts.ts` with no common type, no documented format, and no link to the capability system's identifiers. There is also no invariant tying `RawByteMaterializationDecision.granted: false` to the *absence* of downstream permission, nor any relationship between `ExportMaterializationHandoff.{exportDecisionRef, materializationDecisionRef}` and the `RuntimeAuditEvent` fields that are supposed to record them.

7. **`RuntimeErrorEnvelope` has uncorrelated fields.** It carries a **closed** `category` (`RuntimeErrorCategory`), an **open** `code: string`, an unconstrained `status?: number`, and a free `retryable: boolean`. Nothing documents or enforces the relationships an observability pipeline will assume (e.g. `category: 'not-found'` ⇒ `status` in the 404 family; `category: 'auth' | 'permission' | 'validation' | 'not-found'` ⇒ `retryable: false`; `category: 'quota' | 'runtime'` ⇒ typically `retryable: true`). Consumers must rediscover these by reading producers.

8. **Scope vocabulary overlaps `types/api` capabilities with no stated relationship.** `TenantScope` (here) and `CapabilityScope`/`ParsedScope` (in `types/api/src/capabilities/scope.ts`, re-exported by `contracts/src/capabilities`) both express "what resources does this principal touch." `ServiceSession.scopes: string[]` and `RoomGrant.scopes: string[]` are free string arrays even though collab uses a known `"read"`/`"write"` vocabulary. The boundary between the *service-scope* model and the *capability-scope* model is undocumented, so implementers will conflate them.

9. **Timestamps are unbranded `string`.** `timestamp`, `expiresAt`, etc. are documented "ISO-8601" but typed as `string`, so any string passes. An `Iso8601` brand makes the format part of the contract.

10. **Publish/versioning posture is ambiguous and self-inconsistent.** The package is `private: true` yet named `@mog-sdk/*` with a full `exports` map (`development`/`types`/`import` conditions) as if published. It defines `ProtocolVersion` to negotiate *runtime* compatibility but has no semver/compat discipline, `README`, `CHANGELOG`, or `LICENSE` for its **own** contract surface — the package that versions protocols does not version itself. There is also **no test directory** at all.

## Improvement objectives

1. **Resolve canonicity and reachability.** Make `runtime-services` the **single source of truth** for the shared runtime types (`RuntimeErrorEnvelope`, `RuntimeErrorCategory`, audit types, `DeploymentProfile`); have the `contracts/src/runtime` copies (Plan 002) **re-export** rather than re-declare. Decide whether the natural consumer (`@mog-sdk/contracts`) should add this package to its `tsconfig.json` `references` so it is built/checked in the consumer graph.
2. **Give the security invariants teeth — without breaking the type-only charter.** Introduce *type-level* enforcement (branded "redacted" payload types that can only be produced by passing through a documented sanitizer signature) so producers cannot accidentally hand a raw record to a field that promises redaction. The sanitizer *contract* (function type) lives here; its *implementation* does not.
3. **Replace open `string` with closed unions and branded identifiers** for discriminants and IDs at the authorization boundary, eliminating ID-transposition and unknown-discriminant classes of bug at compile time.
4. **Unify the principal model** so `AuditActor` is derived from / structurally compatible with `ServicePrincipal`, eliminating the `principalType`/`actorType` split.
5. **Consolidate decision references** into one branded, optionally-discriminated `DecisionRef`/`DecisionReference` type, and document the invariants tying handoffs ↔ audit fields ↔ the capability system.
6. **Correlate `RuntimeErrorEnvelope` fields** by encoding category↔retryable↔status relationships in the type and/or documentation, so observability/retry logic is derivable from the contract.
7. **Document the scope model boundary** between `TenantScope` and capability scopes, and close `scopes` vocabularies where a fixed set exists (collab room scopes).
8. **Establish contract-surface hygiene:** explicit publish decision, semver/compat note, `README`, and a type-level test suite (`tsd`/`expectTypeError`-style) that locks the invariants in (1)–(7) and detects drift.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (do not regress):**
- **Type-only / not-a-server posture** — no implementation, route, or side effect added. This is asserted by `DATA-FLOW-AND-EGRESS.md`; any change that introduced executable server behavior would invalidate that security doc.
- **Existing structural compatibility** for any out-of-repo consumer: all currently-exported names remain exported; widenings (string→branded-string, string→union) must be designed so existing valid values still type-check (brands erase to `string`; unions must be supersets of values producers already emit, or land behind a major version bump — see Risks).
- **`export type`-only barrel** (`index.ts`) — these are erasable types; the package must continue to emit no runtime JS beyond what `tsc` produces for type-only modules.

**Strengthen (turn into enforced invariants):**
- *Redaction:* `redactedMetadata`, `details`, and `ServiceDiagnostics.config` become branded "must-have-passed-the-redactor" types.
- *Identity nominal safety:* IDs and decision-refs become brands so they cannot be transposed.
- *Principal singularity:* one principal shape; `AuditActor` derived from it.
- *Error correlation:* `category`/`retryable`/`status` consistency documented and, where expressible, type-encoded (e.g. a discriminated union keyed on `category` that fixes `retryable`).
- *Protocol/format vocabularies:* `outputFormat`, `providerType`, `sourceMimeType`, `principalType`, room `scopes`, and `service` become closed unions (with a documented extension story) instead of open strings.
- *Single source of truth:* shared types declared once here; re-exported elsewhere.

## Concrete implementation plan

> All work is inside `mog/contracts/runtime-services/src` plus the package's own `package.json`/`tsconfig.json`/test scaffolding, **except** the re-export rewiring in step 2 which is coordinated with Plan 002 (the `contracts/src/runtime` owner). Touching `contracts/src/runtime` is out of this plan's edit scope; this plan *defines the canonical shapes* and *requests* the re-export.

1. **Introduce a `branded.ts` (or `ids.ts`) primitives module.**
   - Add a `Brand<T, K>` helper and brand the identifier types: `PrincipalId`, `TenantId`, `WorkspaceId`, `DocumentId`, `EventId`, `RoomId`, `SessionId`, `Iso8601`, and a `DecisionRef` (with optional sub-brands `ImportDecisionRef`, `ExportDecisionRef`, `MaterializationDecisionRef`, `RawByteDecisionRef`, `CapabilityDecisionId`). Brands erase to `string`, so this is zero-runtime-cost and source-compatible for value producers that pass real strings through a constructor; document the intended "construct at the trust boundary" pattern.
   - Export a *type signature* (not an implementation) for the brand constructors so downstream services share one parsing contract.

2. **Establish single source of truth + re-export wiring.**
   - Keep `error-envelope.ts`, `audit-event.ts`, and `DeploymentProfile` canonical **here** (they retain the security comments).
   - Coordinate with Plan 002 to replace the `contracts/src/runtime` re-declarations with `export type * from '@mog-sdk/runtime-service-contracts/...'` (or move them entirely), and add `{ "path": "../runtime-services" }` to `@mog-sdk/contracts`'s `tsconfig.json` `references` if `contracts` becomes the re-export host. Record the agreed direction in both plans.

3. **Unify the principal model in `service-contracts.ts` + `audit-event.ts`.**
   - Make `AuditActor` a structural subset of `ServicePrincipal`: rename `actorType` → `principalType` (or define `AuditActor = Pick<ServicePrincipal, 'principalId' | 'principalType'>`). Provide a documented `principalType` union (`'user' | 'service' | 'system'` with an explicit `(string & {})` escape hatch if open-endedness is required).
   - Re-key `RuntimeAuditEvent.tenantId/workspaceId/documentId` to the branded IDs.

4. **Consolidate decision references.**
   - In `service-contracts.ts` and `audit-event.ts`, replace the five loose ref strings with the branded `DecisionRef` family from step 1. Optionally add a `DecisionReference` discriminated union (`{ kind: 'import' | 'export' | 'materialization' | 'raw-byte' | 'capability'; ref: DecisionRef }`) for places that record heterogeneous refs.
   - Add doc-invariants: which audit fields must be populated for each handoff/decision type (e.g. an `ExportMaterializationHandoff`-driven operation MUST set both `exportDecisionRef` and `materializationDecisionRef` on its `RuntimeAuditEvent`).

5. **Correlate `RuntimeErrorEnvelope`.**
   - Either (a) document the `category → retryable`/`status` matrix in the type's JSDoc and add a `tsd` test that locks producers' expectations, or (b, stronger) model the envelope as a discriminated union on `category` where each arm fixes `retryable` and narrows `status` (e.g. the `auth`/`permission`/`validation`/`not-found` arms set `retryable: false`). Prefer (b) where it does not over-constrain real producers; fall back to (a) for arms that legitimately vary.
   - Brand `requestId`/`traceId` consistently with `audit-event.ts` (same brands in both files).

6. **Close vocabularies and brand timestamps.**
   - `outputFormat` → `'xlsx' | 'pdf' | 'csv' | …` (extensible union), `providerType` → `'s3' | 'gcs' | 'local' | …`, `sourceMimeType`/`allowedMimeTypes` → a `MimeType` brand, `service` → a `ServiceName` union covering the known services (`'http' | 'collab' | 'compute' | …`), `RoomGrant.scopes` → `RoomScope[]` (`'read' | 'write' | …`).
   - All `timestamp`/`expiresAt` fields → `Iso8601`.
   - For each closed union, document the extension policy so adding a service/format is a deliberate, reviewed contract change.

7. **Enforce redaction at the type level.**
   - Define a `Redacted<T>` brand and a `RedactionContract` function *type* (`(raw: Record<string, unknown>) => RedactedMetadata`). Re-type `RuntimeAuditEvent.redactedMetadata`, `RuntimeErrorEnvelope.details`, and `ServiceDiagnostics.config` to the branded redacted variants so a value can only land there after passing the (caller-supplied) redactor. Keep the runtime redactor out of this package; only its *signature* is the contract.

8. **Document the scope-model boundary.**
   - Add JSDoc to `TenantScope` clarifying it is the *service/resource* scope (tenant/workspace/document join) and how it relates to / differs from `@mog/types-api` `CapabilityScope` (the app-capability string scope). Cross-link in both directions.

9. **Contract-surface hygiene.**
   - Add a `README.md` describing the package's role, the type-only/not-a-server posture, the closed-union extension policy, and the redaction contract.
   - Make the publish decision explicit: either drop `private: true` with a `publishConfig`/`LICENSE`/`CHANGELOG`, or keep it private and remove the publish-shaped `development` export ambiguity in `package.json`. Add a semver/compat note (the package that versions protocols should version itself).
   - Keep `index.ts` exhaustive: re-export every new type (brands, unions, `Redacted*`, `DecisionReference`).

## Tests and verification gates

> Constraint compliance: this *planning* task runs no build/test/typecheck commands. The gates below are what the **implementing** change must add and pass.

1. **Type-level test suite (new).** Add `src/__tests__/` (or `tests/`) using `tsd`/`expectTypeOf` (type-only, no runtime) to lock:
   - Branded IDs are **not** mutually assignable (e.g. a `TenantId` is rejected where a `DocumentId` is required, and vice-versa).
   - `AuditActor` is assignable from `Pick<ServicePrincipal, …>` (principal unification holds).
   - `RuntimeErrorEnvelope` arms enforce the `category → retryable` matrix (negative tests: a `not-found` envelope with `retryable: true` fails to type-check, if option (b) chosen).
   - A raw `Record<string, unknown>` is **rejected** by `redactedMetadata`/`details`/`config`; only `Redacted*`/output-of-redactor is accepted.
   - Closed-union fields reject unknown members (e.g. `outputFormat: 'docx'` fails unless added).
2. **Barrel-completeness test.** A test asserting every type declared in the five modules is re-exported by `index.ts` (drift guard for the barrel).
3. **Cross-package drift guard.** A `tsd` assertion (in this package or in `contracts`) that the `contracts/src/runtime` re-exports are *identical* to the canonical types here — catches the duplication regression that motivated step 2.
4. **`pnpm --filter @mog-sdk/runtime-service-contracts typecheck`** (its existing `tsc -b .` script) must pass clean.
5. **Workspace build gate.** Because the package is in root `mog/tsconfig.json` references, the full `tsc -b` workspace build must stay green; if `contracts` adds the new reference, build ordering must remain acyclic (verify no `runtime-services → contracts → runtime-services` cycle is introduced — keep `runtime-services` a leaf with no `@mog-sdk/contracts` dependency).
6. **Lint:** ESLint (`tools/eslint-plugin-mog`) clean on the changed files.
7. **Security-doc consistency:** confirm `DATA-FLOW-AND-EGRESS.md`'s claim ("type-only contracts, not a shipped server") still holds — i.e. grep the diff for any added runtime/route/IO; the change must add **none**.

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Out-of-repo consumers.** Because the real services live outside this workspace, tightening open `string`s to closed unions can break a consumer we cannot see in-repo. Mitigation: brands erase to `string` (safe); unions ship as supersets of currently-emitted values *plus* a documented `(string & {})` escape hatch where true open-endedness is required; anything genuinely narrowing lands behind a **major** version bump (`0.1.0` → `0.2.0`/`1.0.0`) with a `CHANGELOG` entry. This is exactly why step 9 (versioning discipline) is in-scope.
- **Discriminated-union error envelope (option b)** can over-constrain producers that legitimately set unusual `status` for a `category`. Decide per-arm; fall back to documented matrix + `tsd` test (option a) where reality is messier than the model.
- **Re-export direction with Plan 002.** Picking the wrong canonical home creates a build cycle. Mitigation: `runtime-services` stays a dependency-free leaf; `contracts` (or `src/runtime`) is the re-exporter. The two plans must agree the direction before either lands.
- **Brand ergonomics.** Branded IDs require construction at the boundary; if downstream code casts indiscriminately the safety is lost. Mitigation: document the "construct once at the trust boundary" pattern and provide the constructor *signatures* here.

**Non-goals (explicitly out of scope):**
- Implementing any service, route, HTTP handler, redactor body, or transport — the charter forbids it; only *types/signatures* change.
- Editing production code, tests, fixtures, configs, package/lock files **outside** this package (the only cross-package touch — adding a `references` entry / re-export in `@mog-sdk/contracts` — is delegated to and coordinated with Plan 002).
- Reduced-scope, test-only, or compatibility-shim fixes — this plan strengthens the production contract surface itself.
- Unifying `TenantScope` with `CapabilityScope` into one type (they are distinct models); we only **document** the boundary, not merge it.

## Parallelization notes and dependencies on other folders

- **Hard dependency / must-coordinate: Plan 002 (`mog/contracts/src/runtime`).** The two folders re-declare `RuntimeErrorEnvelope`, `RuntimeErrorCategory`, audit types, and `DeploymentProfile`. Steps 2–5 here and Plan 002's de-duplication objective must agree on a **single** canonical home (recommendation: canonical here, re-exported there) and the re-export/`references` direction **before either lands**, or they will conflict. Sequence: agree direction → land canonical-side changes here → land re-export side in Plan 002.
- **Soft dependency: `mog/types/api/src/capabilities`** (Plan 005). Step 8 cross-links `TenantScope` ↔ `CapabilityScope`; if `types/api` capability scope shapes change under Plan 005, the cross-reference doc must follow. No code dependency, doc-only.
- **Soft dependency: `@mog-sdk/contracts` (`mog/contracts/src`, Plan 001).** Only relevant if `contracts` becomes the re-export host and gains a `tsconfig` reference to this package; verify no build cycle.
- **Independent of:** kernel, canvas, file-io, charts, and all runtime/app packages — none consume these contracts today, so this work can proceed in parallel with those folders' plans without code conflict (its only blast radius is the duplication overlap above).
