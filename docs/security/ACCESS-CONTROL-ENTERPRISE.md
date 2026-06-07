---
title: Access Control for Enterprise Review
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, compute]
---

# Access Control for Enterprise Review

Mog's workbook access control is a shipped application-level policy engine for
workbook read, write, and redaction decisions. It applies to covered workbook
engine surfaces that pass through the bridged policy gates. It is not an
encryption layer and does not make an untrusted client process safe. For
hostile-client or multi-tenant deployments, identity must be assigned by a
trusted host or service before calls reach the workbook engine.

Status words in this page use the following meanings:

- `public`: exported from a public package or public SDK surface.
- `shipped`: implemented in the current public repository.
- `public-experimental`: publicly exposed but still experimental. This page
  does not claim any public-experimental hostile-client boundary.
- `workspace-internal`: present in workspace-private packages or trusted
  adapters, not a public SDK contract.
- `reserved`: names or tags are implementation-reserved and must not be minted
  from untrusted input.
- `not shipped`: not implemented or not available as a public contract.

## Current Scope

| Area | Status | Current truth |
|------|--------|---------------|
| Rust policy engine | shipped | The compute security crate implements principals, ordered access levels, workbook/sheet/column targets, policy resolution, redaction, and diagnostic events. |
| TypeScript contracts and SDK session APIs | public, shipped | Public types live in `contracts/src/security/types.ts`; the SDK exports workbook security types and forwards session methods such as `setActivePrincipal`, `makePrincipal`, and `securityActive`. |
| Python workbook security APIs | public, shipped | Python exposes `set_active_principal`, `make_principal`, `security_active`, `drain_security_events`, and `wb.security.*` policy operations. It does not currently implement an `active_principal()` workbook method, even though generated metadata contains an `activePrincipal` mapping. |
| Host-backed workbook construction | workspace-internal, shipped | The workspace-internal host adapter validates the host handoff and projects a host principal into the compute session. Public principal mutation APIs are then blocked on host-backed workbooks by the operation gate. |
| Reserved engine tags | reserved | `mog:owner` and `mog:non-owner` are engine-reserved tags. Treat all `mog:*` tags as trusted-host/service input only. |
| Row/range policy targets | not shipped | Current public targets are workbook, sheet, and column only. |
| Out-of-process authorization service or hostile-client boundary | not shipped | Mog does not ship a standalone authorization service for arbitrary untrusted clients. Put a trusted service boundary in front of the workbook engine for that deployment shape. |

## Guarantees

| Guarantee | Status | Validation basis |
|-----------|--------|------------------|
| Session principals and public principal construction canonicalize tag sets by sorting and deduplicating tags. | shipped | `compute/core/crates/compute-security/src/principal.rs`, `compute/api/src/bridge_service.rs`, `compute/api/tests/principal_state.rs`, and `compute/api/tests/security_e2e/principal_identity.rs`. |
| Policies grant ordered access levels: `none`, `structure`, `read`, `write`, and `admin`. | public, shipped | `compute/core/crates/compute-security/src/level.rs`, `compute/core/crates/compute-security/src/policy.rs`, and `contracts/src/security/types.ts`. |
| Policy targets are workbook, sheet, and column. More specific targets override broader targets; ambiguous same-specificity matches resolve to the lower access level. | public, shipped | `compute/core/crates/compute-security/src/engine.rs`, `compute/api/tests/security_e2e/enforcement.rs`, and `compute/api/tests/security_e2e/events_ambiguity.rs`. |
| Empty-policy documents do not enforce access decisions; after policies exist, anonymous callers do not inherit owner access and require a matching grant. | shipped | `compute/api/tests/security_e2e/bootstrap.rs` and `compute/api/tests/security_e2e/adversarial_core.rs`. |
| Covered bridged writes below required access fail with `SecurityDenied` and emit `AccessDenied` diagnostic events. | shipped | `infra/rust-bridge/bridge-delegate/macros/src/expand/gated.rs`, `compute/core/src/storage/engine/security.rs`, and `compute/api/tests/security_e2e/events_access_denied.rs`. |
| Covered reads below `read` are redacted consistently: `none` returns typed empty/null equivalents, while `structure` returns type placeholders. | shipped | `compute/core/crates/compute-security/src/filters.rs`, `compute/core/crates/compute-wire/src/security_filter.rs`, `compute/api/tests/security_e2e/enforcement.rs`, and `compute/api/tests/security_e2e/adversarial_bypass_runtime.rs`. |
| Bridged read surfaces that return known cell-data fragments are tracked by a coverage audit that requires explicit security scopes and records known exceptions. | shipped | `compute/api/tests/coverage_audit.rs` and the bridged gating macro in `infra/rust-bridge/bridge-delegate/macros/src/expand/gated.rs`. |
| Diagnostic events are available through drain APIs and are kept in a bounded in-memory buffer. | shipped | `compute/core/src/storage/engine/security_events.rs`, `compute/core/src/storage/engine/security_ops.rs`, and `contracts/src/events/security-events.ts`. |
| Workspace-internal host-backed construction validates host context consistency, projects the host principal into the compute session, and blocks later public principal mutation through `setActivePrincipal` and `makePrincipal`. | workspace-internal, shipped | `kernel/host-internal/src/validate.ts`, `kernel/host-internal/src/create.ts`, `kernel/src/document/document-lifecycle-system.ts`, `kernel/src/api/workbook/workbook-impl.ts`, and `kernel/src/document/__tests__/host-operation-gate-wiring.test.ts`. |

## Limits

| Limit | Classification | Customer interpretation |
|-------|----------------|-------------------------|
| Same-process application code and direct engine calls are not an out-of-process hostile-client boundary. | not shipped | Host-backed construction can lock the principal for cooperative workbook API callers, but a compromised or untrusted process can still attack the process boundary itself. Use a trusted service for multi-tenant deployments. |
| Access control is not encryption at rest. | not shipped | Denied users must not receive raw file, database, or memory access to protected workbook data. |
| Diagnostic events are in-memory and bounded, not durable audit logs. | not shipped | The engine keeps a bounded buffer and drops older entries when full. Treat drain APIs as diagnostics, not compliance-grade audit retention. |
| Formula evaluation may access denied cells internally; redaction happens at read time. | not shipped | The current model preserves calculation behavior and is not per-principal formula sandboxing or non-interference for derived values. |
| Row-level and range-level policy targets are not currently available. | not shipped | Current public targets are workbook, sheet, and column. |
| Some sheet-scoped non-byte vector read paths are outside the current enforcement guarantee. | not shipped | The gating macro redacts covered cell, range, and viewport-buffer reads, but sheet-scoped non-byte vector reads can remain pass-through. Enterprise deployments should exclude those read surfaces or validate a distribution that has remediated them. |
| Reserved-tag rejection in host-backed construction is not currently claimed. | not shipped | Enhanced principal verification rejects forged `mog:*` tags in unit tests, but the current host-backed construction path projects the principal after host-context validation with the legacy projection helper. Treat reserved-tag filtering as a trusted host/service responsibility until that verifier is wired into construction. |
| Python security session APIs do not mirror every TypeScript convenience method. | public, shipped | Python exposes principal setters and security operations, but `active_principal()` is not currently implemented in `workbook.py` or `workbook.pyi`. |

## Enterprise Deployment Rule

Use Mog access control to enforce workbook-level, sheet-level, and column-level application decisions for trusted clients and trusted host-backed sessions. For untrusted users or multi-tenant service deployments, terminate identity and authorization in a trusted server process and expose only narrowed operations to clients.
