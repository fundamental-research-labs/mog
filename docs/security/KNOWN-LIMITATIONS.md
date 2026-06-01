---
title: Known Limitations
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime, release]
---

# Known Limitations

These limitations are explicit so enterprise customers can evaluate the current
deployment without relying on ambiguous security language.

Status words follow the public package and security docs: `shipped public`,
`public-experimental`, `workspace-internal`, `reserved`, and `not shipped`.
Source-visible code or types do not become an enterprise control unless the
status says that control is shipped.

| Limitation | Current status | Required action or mitigation |
|------------|----------------|-------------------------------|
| Workbook access control is an application-level policy engine, not encryption at rest. | Access control is shipped for covered workbook engine surfaces; encryption at rest is not shipped as a Mog workbook-policy control. | Use customer storage encryption, OS policy, database encryption, or a separately documented encryption-at-rest capability. |
| Workbook security diagnostic events are bounded and in-memory. | Shipped diagnostic buffer; not shipped as durable audit-log retention. | Treat drain APIs as diagnostics; add persistent audit logging before claiming compliance-grade workbook-policy audit retention. |
| Same-process SDK, host, shell, runtime, and direct engine access are trusted by the process owner. | `@mog-sdk/node` is shipped public same-process automation; hostile-client or multi-tenant service isolation is not shipped. | Put a trusted service boundary in front of workbook operations for untrusted users or multi-tenant deployments. |
| Access-control read coverage has documented gaps and limits. | Covered bridged cell, range, and viewport-buffer reads are shipped; complete data-path coverage is not shipped. Sheet-scoped non-byte vector reads can pass through, and formula evaluation is not a per-principal non-interference sandbox for derived values. | Exclude affected read surfaces, validate a remediation build, and separately review formulas, aggregates, charts, filters, comments, exports, and summaries before relying on non-interference claims. |
| Row-level and range-level policy targets are unavailable. | Not shipped; current public targets are workbook, sheet, and column. | Model policies with workbook/sheet/column targets or wait for documented row/range target support. |
| Public same-page embeds are not browser-origin isolation, and iframe isolation is not a released public guarantee. | Same-page embed packages are shipped public or public-experimental; iframe embed is reserved/not shipped as a customer-facing isolation boundary. | Use a trusted host page for same-page embeds; do not claim iframe isolation until a reviewed iframe host/child distribution ships. |
| Browser rendering/content hardening is distribution-specific. | Not shipped as a repo-wide enterprise control. CSP, Trusted Types, clickjacking defenses, postMessage validation, HTML/rich-text/comment/hyperlink/SVG/image handling, and external content policy depend on the shipping host. | Audit the exact browser or desktop host package and document the controls before relying on rendering-isolation or content-sanitization claims. |
| Desktop/Tauri packaged controls and final OS storage paths are incomplete in this repository. | Tauri adapters and TypeScript IPC wrappers are source-visible; packaged capability configuration, installer/updater policy, OS entitlements, crash collection, and final paths for logs, caches, preferences, credentials, autosave, and temp files are not shipped here. | Run a distribution-specific desktop and OS storage audit before marking a deployment enterprise-ready. |
| Self-hosted and HTTP service contracts are not customer-ready. | Runtime service contracts are workspace-internal; supported `runtime/server`, service binary, container image, OpenAPI contract, authentication, SSO/SCIM, tenant isolation, backup/restore, and audit-retention controls are not shipped. | Do not claim self-hosted service controls until a reviewed service distribution and deployment guide exist. |
| Headless HTTP, agent, callback, optional database proxy, code-execution, upload/download, automation, and collaboration server surfaces are not enterprise service-security boundaries. | Current public APIs are package APIs; service routes and collaboration deployment boundaries are reserved/not shipped. `workbook.executeCode()` is trusted same-process automation with optional host executor wiring, not hostile-code isolation. | Keep these surfaces disabled, bound to trusted loopback, or behind a reviewed service authentication and authorization boundary before exposure. |
| AI/provider data boundary is not claimed. | No default public AI provider client or supported agent service route is shipped, but host code, workflow helpers, scoped network APIs, or customer integrations can still call providers. | Keep AI/provider and agent routes disabled until opt-in controls, endpoints, payload classes, retention, region, deletion, logging, and access-control interactions are documented and tested. |
| Product release-integrity artifacts are incomplete. | The SDK publish workflow builds and publishes packages and creates short-lived npm tarball checksum artifacts; durable project-published signatures, release checksums, SBOMs, npm/PyPI provenance attestations, signed desktop installers, container image signatures, and reproducible-build claims are not shipped. | Attach checksums, signatures, SBOMs, provenance, and immutable release evidence beside every customer-distributed artifact. |
| Security-document build artifacts are not generated by this repository. | The source manifest at `docs/security/manifest.json` is shipped; generated `dist/trust` HTML, PDFs, and trust manifests with hashes are not shipped. | Review the Markdown source set or add a documented docs publishing pipeline before claiming generated security artifacts as verified. |
| Parser hardening evidence is not release-complete. | XLSX/CSV parser controls, generated corpus fixtures, corpus tests, and crashtest tooling are source-visible; public fuzz-target/CI evidence and release-attached malicious-file/import-export evidence are not shipped here. | Attach parser fuzzing or corpus CI evidence, malicious-file import/export reports, and browser import/export size guard evidence for the exact distribution. |
