---
title: AI Data Boundary
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime]
---

# AI Data Boundary

Mog does not currently claim an AI or copilot provider boundary for enterprise use. Customers should not infer that standalone workbook computation sends data to an AI provider by default, and should not treat AI or agent features as approved for regulated data unless the controls below are included in the reviewed deployment and documented for that customer.

## Current Claim

| Claim | Classification | Notes |
|-------|----------------|-------|
| Standalone workbook computation requires no AI provider. | Verified | Formula parsing, evaluation, rendering, and policy enforcement run without an AI provider. |
| Headless agent routes are absent, disabled, or constrained in a given enterprise deployment. | Not claimed | The current headless server includes agent-query routes that can call a configured LangGraph-compatible agent URL and exchange query, workbook summary, upload metadata, API spec, code, and execution results. Enterprise distributions must explicitly disable or constrain these routes before claiming no AI/agent egress. |
| Direct AI provider calls are disabled or absent in a given enterprise deployment. | Not claimed | This must be verified for the exact distribution, host integrations, and provider configuration under review. |
| Provider retention, training use, regional processing, and deletion controls are documented. | Not claimed | Requires provider-specific terms and implemented controls before any enterprise AI claim is made. |

## Required Before AI Is Enabled

- AI features must be opt-in for enterprise deployments.
- Payload classes must be documented: workbook cells, formulas, metadata, screenshots, prompts, logs, and derived summaries.
- Admin controls must disable AI globally.
- Provider, region, retention, training-use, and subprocessors must be identified.
- Redaction and access-control interactions must be tested: AI should not receive data a principal cannot read.
- Logs must not persist prompts or workbook excerpts unless the customer explicitly enables that behavior.

Until those conditions are met, AI/provider handling remains **Not claimed** for enterprise security review.
