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

These limitations are explicit so enterprise customers can evaluate the current deployment without relying on ambiguous security language.

| Limitation | Classification | Required action or mitigation |
|------------|----------------|-------------------------------|
| Encryption at rest is not part of the current workbook access-control claim. | Not claimed | Use customer storage encryption or wait for a documented encryption-at-rest capability. |
| Workbook security diagnostic events are bounded and in-memory, not durable audit logs. | Not claimed | Treat current engine events as diagnostics; add persistent audit logging before claiming workbook-policy audit retention. |
| Same-process SDK access is not a hostile-client boundary. | Not claimed | Use a trusted server boundary for multi-tenant or untrusted-user deployments. |
| Known access-control redaction gap for sheet-scope non-byte vector-style returns. | Roadmap | Remediate or exclude affected surfaces before relying on this protection in an enterprise review. |
| Self-hosted service contracts are not complete. | Roadmap | Do not claim self-hosted authentication, SSO, SCIM, tenant isolation, or backup controls as shipped. |
| Product artifact signing, SBOM, checksums, and provenance are not documented here as shipped. | Roadmap | Provide release-integrity artifacts before customer distribution. |
| Temporary build checksums are not durable customer verification evidence. | Roadmap | Attach release checksums and signatures beside published artifacts. |
| Final distribution file-path inventory for logs, caches, preferences, credentials, and temp files is incomplete. | Roadmap | Run a distribution-specific OS storage audit before marking the deployment ready. |
| AI/provider data boundary is not claimed. | Not claimed | Keep AI disabled for enterprise deployments until opt-in, payload, retention, and provider controls are documented. |
| Parser fuzzing/corpus evidence is not attached to this distribution yet. | Roadmap | Attach malicious-file and import/export verification evidence before marking the deployment ready. |
| Headless HTTP, agent, optional database proxy, code-execution, upload/download, and collaboration server surfaces are not enterprise service-security boundaries today. | Not claimed | Bind them to trusted loopback, keep them on trusted networks, or design a real service authentication and authorization boundary before exposure. |
