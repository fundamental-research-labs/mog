---
title: Threat Model
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime]
---

# Threat Model

This threat model focuses on standalone and customer-controlled Mog deployments. It treats workbook files and imported data as untrusted input unless the customer deployment policy says otherwise.

## Attack Surface Matrix

| Surface | Threat | Existing mitigation | Residual risk | Claim class | Evidence |
|---------|--------|---------------------|---------------|-------------|----------|
| XLSX/CSV import | Malformed archives, parser bugs, resource exhaustion, crafted formulas or metadata | Rust parser packages, ZIP central-directory checks, unsupported compression rejection, per-entry size guard, CRC checks on recovery reads, CSV formula-injection defaults | Browser byte imports materialize selected files in memory; corpus tests exist, but no public fuzz-target path was found in this workspace, so release-specific fuzzing and CI evidence must be attached before making release-ready parser-hardening claims | Verified for listed parser controls and corpus tests; Roadmap for fuzzing/release evidence | `file-io/xlsx/parser/README.md`, `file-io/xlsx/parser/src/zip/`, `file-io/csv-parser/src/infer.rs`, `file-io/xlsx/parser/test-corpus/README.md`, `file-io/xlsx/parser/tests/corpus_tests.rs` |
| Formula parsing/evaluation | Formula payloads attempting code execution, excessive calculation, external data access | Formula engine is Rust code, not arbitrary script execution; parser/evaluator have depth, operation, scope, and deadline limits; full recalculation has a configurable timeout | External workbook links, provider-backed external values, and deployment-specific resource limits need release-specific audit | Verified for local evaluator limits; Roadmap for external-data policy | `compute/core/crates/compute-parser/`, `compute/core/src/eval/`, `compute/core/src/scheduler/` |
| Workbook access control | Unauthorized reads/writes through SDK/API surfaces | Rust-owned policy engine, generated delegate enforcement, coverage audit, redaction filters for covered bridge surfaces | Same-process SDK is not hostile-client isolation; access-control docs list known read-surface gaps and out-of-scope paths | Verified for covered bridge surfaces; Not claimed for complete hostile-client isolation | `docs/security/ACCESS-CONTROL.md`, `compute/api/tests/coverage_audit.rs` |
| Clipboard | Data exfiltration through copy/paste or paste of hostile content | Browser/OS clipboard permission model; scoped app clipboard API separates read/write capabilities; CSV import defaults reduce formula injection | Clipboard HTML, CSS-like table data, SVG/image blobs, and downstream cell classification require a complete sanitization audit | Roadmap | `kernel/src/services/clipboard/`, `kernel/src/api/app/capability-gated/scoped-clipboard-api.ts`, `shell/src/platform/host-services.ts`, `file-io/csv-parser/src/infer.rs` |
| Local filesystem | Unintended read/write outside expected app paths | Tauri IPC/client wrappers classify secured file commands through `secureInvoke`; packaged Rust/Tauri backend capability configuration is not present in the current workspace | User-selected files, SDK/headless `save(path)`, generated files, logs, credentials, caches, temp files, command surfaces, and packaged desktop paths require distribution audit | Deployment-controlled; Not claimed for packaged desktop controls | `infra/platform/tauri/secure-invoke.ts`, `infra/platform/tauri/filesystem.ts`, `shell/src/services/project/tauri-ipc.ts`, `docs/security/DATA-FLOW-AND-EGRESS.md` |
| Network | Unexpected egress or provider calls | Scoped app network API gates host-granted network capabilities; CSP and customer firewall/proxy controls remain distribution responsibilities | Collaboration, provider, external content, lookup, and host-configured network APIs must be reviewed per distribution | Deployment-controlled | `kernel/src/api/app/capability-gated/scoped-network-api.ts`, `docs/security/DATA-FLOW-AND-EGRESS.md`, `docs/security/ENTERPRISE-DEPLOYMENT.md` |
| Update channel | Malicious update metadata or binary | No packaged updater configuration or updater dependency is identified in the current workspace; enterprise updates should route through customer-approved channels | Enterprise updater/signing story not documented | Verified for current workspace absence; Roadmap | `docs/security/DATA-FLOW-AND-EGRESS.md`, `docs/security/SUPPLY-CHAIN.md`, `docs/security/ENTERPRISE-DEPLOYMENT.md` |
| Plugins/extensions | Hostile extension code | Plugin docs are contributor-facing; no enterprise extension boundary is claimed | Extension security model not claimed | Not claimed | `docs/guides/plugins.md` |
| AI/provider integrations | Workbook data sent to third-party providers | No standalone AI data boundary is claimed | Must be opt-in and documented before shipment | Not claimed | `docs/security/AI-DATA-BOUNDARY.md` |
| Apps/agent command surfaces | Same-realm first-party apps, capability-gated APIs, future plugin/agent controllers | App capability flow exists for first-party/trusted shells | Runtime spreadsheet app and first-party app auto-grants must not be treated as plugin/marketplace sandboxing | Not claimed | `shell/src/app-launcher/launch-app.ts`, `runtime/spreadsheet-app/src/shell-documents.ts` |

## Design Assumptions

- Imported workbook, CSV, clipboard, and HTML data are untrusted input.
- Embedded OOXML relationships, hyperlinks, external references, drawings/images, VBA/OLE/control metadata, and custom XML are untrusted even when not executed.
- Workbook formulas are data interpreted by Mog's engine, not a general-purpose user script runtime.
- Same-process SDK callers are trusted by the process owner.
- Multi-tenant or hostile-client deployments require a trusted service boundary between callers and the engine.
- Customer network controls are part of the standalone/offline enterprise deployment contract.
- Claim class `Verified` in this document means the listed control exists in source or tests. It does not mean a full independent penetration test, SOC 2 audit, or release-signing review has been completed.

## Required Hardening Before Release-Ready Claims

- Add or attach parser fuzzing evidence for workbook import paths and attach corpus-test CI evidence; corpus tests exist, but no public fuzz target path was found in this workspace.
- Complete a clipboard sanitization and export-path inventory.
- Complete a packaged desktop file-path audit for logs, preferences, credentials, caches, and temp files.
- Decide whether external data functions are disabled, absent, or capability-gated in enterprise deployments.
- Add or document file-size and export-size guards for browser import/export paths.
