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
| XLSX/CSV import | Malformed archives, parser bugs, resource exhaustion, crafted formulas or metadata | Rust parser packages, ZIP central-directory checks, unsupported compression rejection, per-entry size guard, CRC checks on recovery reads, CSV formula-injection defaults | Browser upload reads selected files into memory; parser fuzz targets and corpus tests exist, but release-specific scheduled CI evidence must be attached before making release-ready parser-hardening claims | Verified for listed parser controls; Roadmap for release evidence | `file-io/xlsx/parser/README.md`, `file-io/xlsx/parser/src/zip/`, `file-io/csv-parser/src/infer.rs`, `file-io/xlsx/parser/fuzz/README.md` |
| Formula parsing/evaluation | Formula payloads attempting code execution, excessive calculation, external data access | Formula engine is Rust code, not arbitrary script execution; parser/evaluator have depth, operation, scope, and deadline limits; full recalculation has a configurable timeout | External workbook links, provider-backed external values, and deployment-specific resource limits need release-specific audit | Verified for local evaluator limits; Roadmap for external-data policy | `compute/core/crates/compute-parser/`, `compute/core/src/eval/`, `compute/core/src/scheduler/` |
| Workbook access control | Unauthorized reads/writes through SDK/API surfaces | Rust-owned policy engine, generated delegate enforcement, coverage audit, redaction filters for covered bridge surfaces | Same-process SDK is not hostile-client isolation; access-control docs list known read-surface gaps and out-of-scope paths | Verified for covered bridge surfaces; Not claimed for complete hostile-client isolation | `docs/security/ACCESS-CONTROL.md`, `compute/api/tests/coverage_audit.rs` |
| Clipboard | Data exfiltration through copy/paste or paste of hostile content | Browser/OS user gesture and desktop permission model; CSV import defaults reduce formula injection; app-level handlers parse HTML through browser APIs | Clipboard HTML, CSS-like table data, SVG/image blobs, and downstream cell classification require a complete sanitization audit | Roadmap | Runtime clipboard packages and app handlers |
| Local filesystem | Unintended read/write outside expected app paths | Tauri filesystem scope for app-specific directories; custom file commands canonicalize paths, resolve symlinks, block strict paths outside app/temp, and block sensitive directories in dialog mode | User-selected files, SDK/headless `save(path)`, generated files, logs, credentials, caches, temp files, and command surfaces require distribution audit | Verified for listed desktop controls; Roadmap for full packaged-path inventory | `runtime/src-tauri/capabilities/default.json`, `runtime/src-tauri/src/security/sandbox.rs`, `runtime/src-tauri/src/commands/file.rs` |
| Network | Unexpected egress or provider calls | CSP and customer firewall/proxy can restrict egress | Supabase CSP allowlist and collaboration endpoints must be reviewed per distribution | Deployment-controlled | `runtime/src-tauri/tauri.conf.json` |
| Update channel | Malicious update metadata or binary | Automatic updater artifacts are not enabled in current Tauri config | Enterprise updater/signing story not documented | Verified; Roadmap | `runtime/src-tauri/tauri.conf.json` |
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

- Attach parser fuzzing and corpus-test evidence for workbook import paths; fuzz targets exist, but scheduled CI evidence must be attached before claiming release-ready coverage.
- Complete a clipboard sanitization and export-path inventory.
- Complete a packaged desktop file-path audit for logs, preferences, credentials, caches, and temp files.
- Decide whether external data functions are disabled, absent, or capability-gated in enterprise deployments.
- Add or document file-size and export-size guards for browser import/export paths.
