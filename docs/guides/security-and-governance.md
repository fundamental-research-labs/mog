# Security and Governance

> **Status: high-level orientation - use the security docs and public package surfaces as the source of truth**

Security model overview for Mog integrators and contributors. Covers trust boundaries, workbook policy, app/embed capability gates, formula safety, release-integrity status, and vulnerability reporting.

## Prerequisites

- Familiarity with [Architecture Overview](architecture-overview.md)
- Understanding of your deployment context (embedded vs. self-hosted vs. desktop)

## Trust Boundaries

### Same-Page Embed

`<mog-sheet>` and `MogSheet` run in the host page's origin. Public embed configuration uses an opaque source ref and a trusted same-origin `hostPolicy` to resolve authorized bytes and effective state. Same-page embeds are not an isolation boundary for hostile workbook content.

### iframe Embed

Reserved. The repository contains internal iframe/postMessage plumbing, but Mog does not currently publish a public iframe embed entrypoint or documented iframe host page. Do not treat iframe embed as a customer-facing isolation guarantee until that surface is released.

### Server and Self-Hosted

Reserved. The current self-hosting and HTTP service guides describe intended service shapes, not shipped authentication, authorization, rate-limit, tenant-isolation, or OpenAPI contracts. Server-side SDK use is same-process trusted automation unless a deployment adds its own service boundary.

### Desktop and Tauri Hosts

Mog includes Tauri transport and platform helpers for desktop hosts. Desktop filesystem, network, credential, and OS access must be reviewed against the shipping Tauri application configuration and customer OS policy for that distribution.

## Capability Model

Mog uses separate gates for separate trust questions:

- **Public embeds** - callers request mode, capabilities, save policy, and collaboration mode; the trusted host policy resolves the effective state. Save and export requests are allowed only when the effective state grants them.
- **App/runtime capabilities** - the kernel capability registry models typed grants such as cells, sheets, clipboard, filesystem, network, credentials, and table access. Grants can be scoped, expanded through dependencies, revoked, and audited by the host.
- **Workbook access control** - the Rust security engine maps principals to workbook data access levels and enforces covered bridge reads/writes.

## Principal and Policy

Workbook data policy is tag-based. A principal is a set of string tags, and an access policy maps a tag matcher to an access level on a workbook, sheet, or column target.

Access levels are `none`, `structure`, `read`, `write`, and `admin`. Policy resolution uses tag specificity, target specificity, priority, and a safer tie-break. `mog:owner` has default admin access only when a workbook has no policy set. Range targets, API-key scoping, and hosted tenant isolation are not claimed by this guide.

## Formula Safety

Formulas are parsed and evaluated by the Rust engine as spreadsheet expressions, not as arbitrary user script. Parser and evaluator paths include nesting, operation, scope, deadline, and recalculation-timeout limits. External workbook/provider-backed values are separate host-controlled surfaces; this guide does not claim a general released network capability gate for external data functions.

## Supply Chain

Release-integrity claims are limited to what the release artifacts document. Signed product binaries, durable published checksums for every artifact, SBOMs, npm/PyPI provenance, and reproducible builds are not claimed here unless a specific release documents them. See [Supply Chain and Release Integrity](../security/SUPPLY-CHAIN.md).

## Vulnerability Reporting

Use [SECURITY.md](../../SECURITY.md) for supported versions, responsible disclosure, the security contact, and advisory process.

## Related Docs

- [SECURITY.md](../../SECURITY.md) - vulnerability disclosure policy
- [Trust Model](../security/TRUST-MODEL.md) - current deployment claims and non-goals
- [Threat Model](../security/THREAT-MODEL.md) - reviewed attack surfaces and residual risks
- [Access Control](../security/ACCESS-CONTROL.md) - workbook principal and policy design
- [Supply Chain and Release Integrity](../security/SUPPLY-CHAIN.md) - artifact verification status
- [Embed: React](embed-react.md) and [Embed: Web Component](embed-web-component.md) - supported public embeds
- [iframe Embed](iframe-embed.md) and [Self-Hosting](self-hosting.md) - reserved surfaces
