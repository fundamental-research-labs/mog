---
title: Security FAQ
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime, release]
---

# Security FAQ

These answers apply to the current public repository and to standalone or
customer-controlled deployments. Hosted SaaS, customer-specific desktop
packages, and separately supplied services need their own review before their
controls are represented as covered here.

Status words in this page use the following meanings:

- `shipped`: implemented in the current public repository.
- `public`: exported from a public package or SDK surface.
- `public-experimental`: exported publicly, but not claimed as a stable
  enterprise security boundary.
- `workspace-internal`: present in workspace-private packages or trusted
  adapters, not a public SDK contract.
- `reserved`: source or type shapes exist for future use, but are not a
  supported public deployment surface.
- `not shipped`: not implemented or not available as a public contract.

## Does Mog send workbook data to Mog-operated servers?

Not by the shipped public SDK/runtime surfaces on their own. `@mog-sdk/node`,
`@mog-sdk/wasm`, `@mog-sdk/spreadsheet-app`, and the public-experimental
`@mog-sdk/embed` entrypoints run in the customer process or page; the host owns
persistence callbacks, network policy, and any service integration.

The public workspace still contains network-capable paths that a deployment may
enable, including collaboration WebSockets, thesaurus lookup, remote
picture/content fetches, scoped network APIs, REST/provider drivers, configured
metrics endpoints, and reserved AI/agent service configuration. Review the exact
distribution's allowlist before claiming no external egress.

Surface status: **public, shipped** for local SDK/runtime surfaces;
**public-experimental** for same-page embed; Mog-hosted service egress is **not
shipped** in this repository.

Claim class: **Deployment-controlled**.

## Can Mog run fully offline?

Standalone workbook computation and local editing can run without a hosted Mog
service. A fully offline enterprise deployment must disable or remove
collaboration endpoints, thesaurus lookup, remote picture/content fetches,
scoped network grants, external table/database providers, distribution-loaded
extension origins, observability endpoints or handlers, update checks, crash
collection, AI/provider endpoints, agent callbacks, and any separately supplied
headless service routes.

Surface status: **shipped** for local computation and editing paths;
offline packaging and egress lockdown are **deployment-controlled**.

Claim class: **Deployment-controlled**.

## Is there telemetry or crash reporting?

Shell telemetry is a no-op in the current implementation. The spreadsheet app
metrics collector can send metrics only when a distribution configures an
endpoint or custom handler. No external crash-reporting service or dependency is
identified as shipped in the reviewed public workspace.

This is not a durable audit-log claim: workbook security events are bounded,
in-memory diagnostics, and any desktop-local logs or crash collection need a
distribution-specific review.

Surface status: **shipped** for no-op shell telemetry; **shipped** but
host-configured for optional app metrics; external crash reporting is **not
shipped**.

Claim class: **Deployment-controlled** for metrics configuration; **Not
claimed** for crash reporting and durable audit retention.

## Are updates automatic?

No packaged updater configuration or updater dependency is identified as shipped
in the current public workspace. Enterprise updates should be distributed
through a customer-approved software channel. If a separate desktop distribution
adds an updater, review update metadata endpoints, rollback behavior, signing,
and customer approval controls for that distribution.

Surface status: automatic updater is **not shipped**.

Claim class: **Deployment-controlled**.

## Are binaries signed?

Product artifact signing, durable release checksums, SBOMs, and provenance are
not documented as shipped controls in this repository. The public release
workflow can produce npm package candidates and temporary checksums, but those
are not the same as durable customer-verifiable signatures or release-integrity
artifacts attached beside every product binary.

Surface status: product signing and durable release-integrity artifacts are
**not shipped**.

Claim class: **Not claimed**.

## Is the headless HTTP server safe to expose to enterprise users?

No. `@mog-sdk/node` is a public, shipped same-process automation SDK; it is not
a hosted HTTP service or a hostile-client boundary. The public workspace does
not ship a supported `runtime/server` package, service binary, container image,
OpenAPI contract, or enterprise authentication and authorization boundary.
`@mog-sdk/runtime-service-contracts` is private and type-only, and reserved
service configuration such as agent policy fields is not a service
implementation.

Any distribution that adds headless HTTP, upload/download routes, code
execution, agent egress, callback routes, collaboration routes, or database
proxy behavior needs a separate service-security design before enterprise
exposure.

Surface status: Node/headless SDK is **public, shipped**; headless HTTP service
is **not shipped**; service config vocabulary is **reserved** or
**workspace-internal**.

Claim class: **Not claimed**.

## Does workbook access control protect against a malicious SDK client?

No. The workbook policy engine is shipped for application-level read, write, and
redaction decisions on covered bridged workbook-engine surfaces. It is not an
out-of-process authorization service, and same-process SDK callers are trusted
by the process owner.

Current limits also matter for enterprise review: access control is not
encryption at rest, formula evaluation is not a per-principal non-interference
sandbox, and some sheet-scoped non-byte vector read paths are outside the
current enforcement guarantee. Hostile-client or multi-tenant deployments need a
trusted service boundary in front of workbook-engine calls.

Surface status: workbook access control for covered bridge surfaces is
**shipped**; a hostile-client service boundary is **not shipped**.

Claim class: **Verified** for covered bridge surfaces; **Not claimed** for
malicious same-process clients.

## Is data encrypted at rest?

No. Encryption at rest is not shipped as part of Mog workbook access control.
Use customer storage encryption, OS policy, database encryption, or a separately
documented encryption-at-rest capability for that requirement.

Surface status: Mog workbook-policy encryption at rest is **not shipped**.

Claim class: **Not claimed**.

## Are macros or arbitrary scripts executed from workbook files?

Workbook formulas are parsed and evaluated by Mog's Rust formula engine, not by
running embedded workbook scripts. The XLSX parser detects VBA project metadata
and treats VBA payloads as opaque binary data; form-control, ActiveX, OLE, and
macro-name fields may be parsed or preserved for workbook fidelity, but they are
not interpreted as executable code by the import path.

Explicit code execution is a separate trusted automation surface, not workbook
file behavior. TypeScript `workbook.executeCode()` delegates to an optional
host-supplied executor when one is wired; Python currently marks
`wb.execute_code` unsupported; and the public spreadsheet-app facade denies
`executeCode` as a raw code-execution bypass. Do not expose code execution to
untrusted users.

Import paths still need release-specific malicious-file, fuzzing, and
import/export evidence before making a release-ready parser-hardening claim.

Surface status: parser handling for VBA/active-content metadata is **shipped**;
TypeScript `executeCode` is a **public** same-process automation API with
optional executor wiring; Python `execute_code` is **not shipped** as an
implemented API; spreadsheet-app exposure is **public, shipped** and denies raw
`executeCode`.

Claim class: **Verified** for the reviewed no-workbook-script-execution path;
**Not claimed** for complete malicious-file assurance.
