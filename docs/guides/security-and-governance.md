# Security and Governance

> **Status: skeleton — content pending package stabilization**

Security model overview for Mog integrators and contributors. Covers trust boundaries, capability model, and governance structure.

## Prerequisites

- Familiarity with [Architecture Overview](architecture-overview.md)
- Understanding of your deployment context (embedded vs. self-hosted vs. desktop)

## Trust Boundaries

### Same-Page Embed

When `<mog-sheet>` or `MogSheet` runs in the same page as your application. The spreadsheet has full access to the host page's origin. Suitable when you trust the workbook content (your own data, user-uploaded but sanitized).

### iframe Embed

When the spreadsheet is loaded in a cross-origin iframe. The iframe boundary enforces origin isolation. Communication happens via postMessage. Strongest isolation for untrusted content. See [iframe Embed](iframe-embed.md) (reserved) for configuration.

### Server (Self-Hosted)

When Mog runs as a service. Trust boundary is the network perimeter. Authentication, authorization, and rate limiting apply. See [Self-Hosting](self-hosting.md).

### Desktop (Tauri)

When Mog runs as a native desktop app. Tauri's capability-based permission model governs access to filesystem, network, and OS APIs.

## Capability Model

How Mog restricts what a workbook can do. Capabilities are granted per context:

- **Compute** — formula evaluation (always available)
- **Network** — fetch external data (configurable, off by default in embeds)
- **Filesystem** — read/write local files (desktop and server only)
- **Clipboard** — system clipboard access (requires user gesture in browsers)
- **Collaboration** — sync with remote peers (requires server or signaling)

## Principal and Policy

How identity (principal) maps to permissions (policy). Relevant for self-hosted and collaborative deployments.

- Workbook owner, editor, viewer roles
- Sheet-level and range-level protection
- API key scoping for programmatic access

## Formula Safety

How the formula engine handles potentially dangerous constructs. No arbitrary code execution. External data functions are capability-gated.

## Supply Chain

npm package provenance. Signed releases. Reproducible builds. How to verify package integrity.

## Vulnerability Reporting

Link to SECURITY.md for responsible disclosure process.

## Related Docs

- [SECURITY.md](../../SECURITY.md) — vulnerability disclosure policy
- [ACCESS-CONTROL.md](../security/ACCESS-CONTROL.md) — access control design
- [Architecture Overview](architecture-overview.md) — platform layers
