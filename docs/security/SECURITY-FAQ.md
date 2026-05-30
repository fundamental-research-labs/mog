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

## Does Mog send workbook data to Mog-operated servers?

For the standalone customer-controlled deployment, that is not the product claim. Local computation and workbook policy enforcement are designed to run inside the customer's boundary. Network egress depends on the selected deployment mode and enabled integrations.

Classification: **Deployment-controlled**.

## Can Mog run fully offline?

Standalone editing and computation can run without a hosted Mog service. A fully offline enterprise deployment must disable collaboration, provider integrations, update checks, and any host callbacks that make network calls.

Classification: **Deployment-controlled**.

## Is there telemetry or crash reporting?

No telemetry or external crash-reporting service is claimed for the current standalone distribution. Desktop-local logs and audit-style diagnostic events exist; deployment owners should audit log contents, retention, and crash collection before enabling enterprise distribution.

Classification: **Not claimed**.

## Are updates automatic?

Automatic updater artifacts are not currently part of the documented enterprise distribution. Enterprise updates should be distributed through a customer-approved software channel until an enterprise updater is documented.

Classification: **Deployment-controlled**.

## Are binaries signed?

Product artifact signing is not documented here as shipped. Release-integrity artifacts should be provided before external distribution.

Classification: **Roadmap**.

## Is the headless HTTP server safe to expose to enterprise users?

No. Mog does not currently publish a supported HTTP service API or enterprise authentication and authorization contract. Server-side workbook automation today is same-process trusted automation through SDK/runtime surfaces; any distribution that adds headless HTTP, service routes, upload/download, code execution, agent egress, or database proxy behavior needs a separate service-security boundary before exposure.

Classification: **Not claimed**.

## Does workbook access control protect against a malicious SDK client?

No. The workbook policy engine enforces application-level decisions inside the engine, but same-process SDK callers are trusted by the process owner. Hostile-client deployments need a trusted service boundary.

Classification: **Not claimed**.

## Is data encrypted at rest?

Not as part of the current workbook access-control claim. Encryption at rest requires a separately documented capability.

Classification: **Not claimed**.

## Are macros or arbitrary scripts executed from workbook files?

The current product claim is that workbook formula evaluation is handled by Mog's engine, not by running embedded workbook scripts. Imported VBA and active-content parts are detected or preserved as opaque, disabled, or quarantined content rather than interpreted or executed. Separately, explicit code-execution APIs such as `workbook.executeCode()` are trusted automation surfaces and are not executed from workbook files; do not expose them to untrusted users. Import paths still need malicious-file and import/export verification evidence before this claim is ready for enterprise reliance.

Classification: **Verified; Roadmap for malicious-file evidence**.
