Rating: 7/10

Summary judgment

The plan is directionally strong and mostly grounded in the current source: `@mog-sdk/contracts` does not currently expose `./runtime`, `contracts/src/index.ts` does not re-export the runtime folder, `contracts/src/runtime` is type-only, and `contracts/runtime-services/src` duplicates `RuntimeErrorEnvelope`, `RuntimeAuditEvent`, and `DeploymentProfile` while adding protocol/deployment/service-boundary types. It correctly treats runtime contracts as a place where executable validation, versioning, and package-boundary verification matter.

The rating is held back because the plan makes a large public-API decision before specifying the product boundary it is committing to. Current public docs explicitly say self-hosted service behavior is reserved/not shipped and that `contracts/runtime-services` is workspace-internal, not a published deployment API. The plan should first separate public host/embed/runtime asset contracts from future self-hosted service contracts, then decide which parts deserve a stable public `@mog-sdk/contracts/runtime` surface.

Major strengths

- The plan identifies real contract gaps in the folder: permissive `AssetLocation` accepts both `path` and `url` or neither, error/audit details are unconstrained `Record<string, unknown>`, asset manifests lack explicit schema/integrity semantics, and service config contains many topology/security invariants that TypeScript alone cannot enforce.
- The proposed source-of-truth cleanup is architecturally valuable. Leaving public-looking runtime contracts beside private runtime-service contracts invites drift, especially for error envelopes, audit events, and deployment profile names.
- The validator objective is production-relevant. These shapes are JSON/config/error/audit boundary types, so zero-dependency validators with path-addressed failures are appropriate for `@mog-sdk/contracts` if the runtime-value surface is intentionally accepted.
- The verification section is unusually concrete for a plan: package build/typecheck, runtime import self-containment, runtime inventory checks, publish readiness, import fixtures, and real runtime bootstrap smoke coverage.
- The parallelization notes are sensible once the source-of-truth decision is made, with distinct slices for contract expansion, package exports, dependent runtime-services work, and consumer wiring.

Major gaps or risks

- The plan blurs public host integration with unshipped self-hosted service contracts. `docs/guides/self-hosting.md` says Mog does not currently publish a supported self-hosted service distribution or deployment API, and `docs/architecture/os/packages.md` classifies `@mog-sdk/runtime-service-contracts` as workspace-internal. Publishing self-host config, service health, readiness, diagnostics, protocol handshakes, room grants, and raw-byte handoff records would change that boundary and needs an explicit architecture decision.
- It does not provide a concrete export taxonomy. `@mog-sdk/contracts/runtime` might be right for asset manifests, host config, safe errors, and audit envelopes, but service-only types from `runtime-services/src/service-contracts.ts` may not belong in the same public module.
- The consumer migration step is too evidence-light. A read-only search found no current imports of `@mog-sdk/runtime-service-contracts` or `@mog-sdk/contracts/runtime` outside definitions/docs, so the plan should require an inventory of actual duplicate runtime shapes in `runtime/sdk`, `runtime/embed`, `runtime/spreadsheet-app`, `shell`, and `kernel` before assuming broad production wiring.
- The validator API contract is under-specified. The plan says path-addressed failures and typed validation results, but it should name the result shape, error codes, path format, redaction failure taxonomy, and whether validators are type guards, parsers, or diagnostics-only checkers.
- Compatibility semantics are underspecified for a public API. Adding envelope/schema versions and protocol versions is good, but the plan should define deprecation policy, unknown-field handling, minor-version extensibility rules, and whether validators reject or preserve forward-compatible fields.
- Documentation and release-status updates are missing. If the plan makes any self-host/service contract public, it must update self-hosting, HTTP service, security/trust-model, package inventory, and public API docs so docs do not continue saying those surfaces are not shipped.

Contract and verification assessment

The proposed contract direction is mostly appropriate for the existing files. The current runtime index exports only types from `error-envelope`, `audit-event`, `service-config`, and `asset-manifest`; the asset and config shapes need discriminants and invariants; error/audit envelopes need safe structured metadata rules; and package export coverage is missing. The plan also correctly calls out runtime artifact self-containment after adding validator runtime values.

The weak point is contract clarity at the package boundary. `contracts/src/runtime/service-config.ts` already defines a large `MogSelfHostConfig`, but the public docs say self-hosting is reserved. Moving additional `runtime-services` concepts into `contracts/src/runtime` without a public/private split risks freezing service internals as public API before there is a shipped service implementation. The plan should make "public runtime host contract" and "workspace-internal service boundary contract" separate categories, each with its own export and verification rules.

The listed gates are good, but incomplete for the architectural change. Add checks for package docs/inventory consistency, declaration identity for the new subpath, negative import fixtures proving private service-only contracts are not exposed, and representative downstream imports from the actual public packages that are supposed to consume the surface. The plan should also state that review-only or plan-only work does not run these gates, while implementation must.

Concrete changes that would raise the rating

- Add a first implementation milestone that decides and records the public/private boundary: which runtime contracts are public now, which are public-experimental, and which remain workspace-internal until a service distribution ships.
- Replace "move or recreate richer documented concepts from runtime-services" with an explicit symbol-by-symbol migration table for `RuntimeErrorEnvelope`, `RuntimeAuditEvent`, `DeploymentProfile`, `ProtocolHandshake`, `ServiceHealth`, `ServiceReadiness`, `ServiceDiagnostics`, `ServicePrincipal`, `RoomGrant`, import/export handoffs, provider materialization refs, and raw-byte decisions.
- Define the validator API before implementation: `ValidationResult` shape, issue code taxonomy, path syntax, unknown-field policy, redaction checks, normalization boundaries, and public names for each validator/normalizer.
- Add a consumer inventory deliverable before wiring changes, including exact local duplicate shapes found in `runtime/sdk`, `runtime/embed`, `runtime/spreadsheet-app`, `shell`, and `kernel`, or an explicit finding that there are no current production consumers.
- Add docs and inventory updates to the plan: self-hosting/HTTP-service status, trust model/security docs, package inventory, package exports docs, and release notes for the new public subpath.
- Add negative verification fixtures that prove service-only internals are not exported from `@mog-sdk/contracts/runtime` unless the architecture decision intentionally promotes them.
