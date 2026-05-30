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

## Claim Classes

| Class | Meaning | Evidence requirement |
|-------|---------|----------------------|
| Verified | Implemented and tested or directly configured in the reviewed Mog artifacts. | Link to implementation evidence, test evidence, configuration, or generated release artifact. |
| Deployment-controlled | Enforced by the customer, administrator, host application, operating system, firewall, or packaging policy. | Link to config surface, policy surface, or deployment guidance. |
| Roadmap | Intended or reserved, but not shipped as a reliable control today. | Explicit roadmap label and no customer-facing guarantee. |
| Not claimed | Outside the current trust boundary or unsafe to claim. | Clear limitation and mitigation guidance where possible. |

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

## Published Artifacts

Markdown files listed in `docs/security/manifest.json` are the public security documentation set. The manifest declares `docs/security` as `sourceRoot`, `dist/trust` as `outputRoot`, and the reviewed document order.

The public repository does not currently include a docs publishing command or generator for `dist/trust`; generated HTML, PDFs, and a generated trust manifest are therefore not claimed as verified artifacts in this repository.
