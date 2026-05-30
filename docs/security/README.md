---
title: Mog Enterprise Security Overview
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime, release]
---

# Mog Enterprise Security Overview

This security overview is for external reviewers evaluating standalone and customer-controlled Mog deployments. It describes current software behavior, controls enforced by Mog, controls that depend on customer deployment policy, and security claims Mog does not currently make. Hosted SaaS tenant isolation and managed-cloud compliance controls are outside this document unless a page explicitly says otherwise.

## Current Scope Snapshot

| Area | Current status | Security meaning |
|------|----------------|------------------|
| Public SDK and embed packages | `public`, `shipped`; selected subpaths are `public-experimental` | Same-process SDK callers and same-page embeds are trusted by their process or host origin; they are not hostile-client isolation boundaries. |
| Workbook access control | `shipped` for covered bridged workbook-engine surfaces | Application-level policy and redaction are enforced for covered paths; encryption at rest, complete non-interference, and complete same-process isolation are not claimed. |
| Desktop/Tauri distribution controls | adapter code is `workspace-internal`; packaged desktop controls are `not shipped` in this repository | Installer, updater, Tauri backend capability, CSP, entitlement, and OS path claims require a distribution-specific review. |
| Headless HTTP, agent, iframe, and self-hosted service boundaries | headless HTTP and agent routes are `not shipped`; iframe and self-hosted service claims are `reserved` | Do not expose service routes to untrusted users without a separately reviewed authentication and authorization boundary. |
| AI/provider data boundary | enterprise provider boundary is `not shipped`; enterprise AI handling is `Not claimed` | Standalone workbook computation does not require an AI provider; any provider, agent, or code-execution integration needs opt-in deployment controls and updated security review. |
| Generated security-document artifacts | `not shipped` in this repository | The source manifest exists, but generated HTML, PDFs, artifact hashes, signatures, and trust manifests are not verified artifacts here. |

## Claim Classes

| Class | Meaning | Evidence requirement |
|-------|---------|----------------------|
| Verified | Implemented and tested or directly configured in the reviewed Mog artifacts. | Link to implementation evidence, test evidence, configuration, or generated release artifact. |
| Deployment-controlled | Enforced by the customer, administrator, host application, operating system, firewall, or packaging policy. | Link to config surface, policy surface, or deployment guidance. |
| Roadmap | Intended or reserved, but not shipped as a reliable control today. | Explicit roadmap label and no customer-facing guarantee. |
| Not claimed | Outside the current trust boundary or unsafe to claim. | Clear limitation and mitigation guidance where possible. |

Claim classes are assurance labels, not package-disposition labels. When these pages describe implementation availability, use exact status words such as `shipped`, `public`, `public-experimental`, `workspace-internal`, `reserved`, or `not shipped`.

## Documents

| Document | Purpose |
|----------|---------|
| [Trust Model](TRUST-MODEL.md) | Deployment modes, trust boundaries, data authority, and non-goals. |
| [Data Flow and Network Egress](DATA-FLOW-AND-EGRESS.md) | Processes, local storage, network paths, logs, crash reporting, update checks, and AI calls. |
| [Enterprise Deployment](ENTERPRISE-DEPLOYMENT.md) | Managed install, offline operation, egress controls, update policy, and config lockdown. |
| [Supply Chain](SUPPLY-CHAIN.md) | Release artifacts, signatures, checksums, SBOM status, provenance, and vulnerability response. |
| [Threat Model](THREAT-MODEL.md) | Malicious files, parsers, formulas, imports, exports, clipboard, local compromise, and optional integrations. |
| [Access Control for Enterprise Review](ACCESS-CONTROL-ENTERPRISE.md) | Principals, policies, enforcement point, redaction, coverage audits, and limits. |
| [AI Data Boundary](AI-DATA-BOUNDARY.md) | Current AI/provider boundary and the conditions required before AI claims are made. |
| [Security FAQ](SECURITY-FAQ.md) | Short security-review and questionnaire answers. |
| [Known Limitations](KNOWN-LIMITATIONS.md) | Unsupported claims and security follow-up areas identified during review. |

## Source Set and Artifact Status

Markdown files listed in the `documents` array of `docs/security/manifest.json` are the reviewed public security documentation set. The manifest declares `docs/security` as `sourceRoot`, `dist/trust` as `outputRoot`, and the reviewed document order.

`docs/security/ACCESS-CONTROL.md` is a source-visible lower-level reference used by some pages as implementation evidence. It is not part of the manifest's reviewed document order; use [Access Control for Enterprise Review](ACCESS-CONTROL-ENTERPRISE.md) for customer-facing access-control claim language.

The root `build:public-artifacts` script builds public package artifacts through `tools/build-public-artifacts.mjs`; it does not generate `dist/trust`. The public repository does not currently include a security-doc publishing command or generator for `dist/trust`, and no generated security-doc HTML, PDFs, artifact hashes, signatures, or trust manifest are claimed as verified artifacts in this repository.
