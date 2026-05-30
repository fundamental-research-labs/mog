---
title: Trust Model
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime, release]
---

# Trust Model

Mog is a spreadsheet for humans and agents. For enterprise review, the current trust claim is about standalone or customer-controlled deployments, not a hosted SaaS tenant boundary.

> Mog can run inside the customer's security boundary. Current controls include local data-flow documentation, reviewable network configuration, a desktop target with Tauri capability configuration, generated trust-document artifacts, and a Rust-owned workbook policy engine for application-level access decisions. Product artifact signing, hosted compliance controls, and hostile-client service isolation are separate release or deployment responsibilities unless explicitly documented.

## Deployment Modes

| Mode | Current status | Trust boundary | Claim class | Notes |
|------|----------------|----------------|-------------|-------|
| Desktop deployment | Available desktop target | Local OS user account, Tauri capability model, configured CSP, Rust engine running inside the packaged app boundary | Verified; Deployment-controlled | Desktop architecture and capability configuration are reviewable in the repo; installer trust, OS management policy, and egress hardening remain customer-controlled. |
| Node SDK | Available SDK surface | Customer process and runtime environment | Verified; Deployment-controlled | The SDK is same-process trusted automation; it is not a hostile-client boundary. |
| Headless HTTP server | Developer and automation surface | Whoever can reach the HTTP server | Not claimed | Current routes expose sessions, upload/download, execution, agent, and optional database surfaces without a documented enterprise authentication contract. |
| Collaboration server | Coordination process | WebSocket origin allowlist and customer network perimeter | Not claimed | Coordinates CRDT rooms and awareness; origin allowlist is not tenant authentication, durable ACL, or persistence policy. |
| Same-page embed | Shipped SDK surface | Host web application origin | Deployment-controlled | Same-page embeds trust the host page and should not be used as isolation for hostile workbook content. |
| iframe embed | Reserved/evaluated host-controlled boundary | Browser origin isolation and `postMessage` contract | Roadmap | Iframe host/child code exists for evaluation, but it is not a customer-facing isolation guarantee yet. |
| Self-hosted service | Reserved | Customer network perimeter and service authentication | Roadmap | Existing docs describe a planned self-hosting shape; customer-facing claims require approved runtime service contracts. |
| Hosted Mog SaaS | Not in scope for this document | Mog-operated cloud tenant boundary | Not claimed | SOC 2, tenant isolation, SSO/SCIM, and hosted audit controls are separate from this standalone/customer-controlled deployment model. |

## Data Authority

| Layer | Authority | Evidence |
|-------|-----------|----------|
| Rust compute/document engine | Persistent workbook state, formulas, calculation, access-control policy evaluation, redaction filtering for covered bridge surfaces | `docs/architecture/README.md`, `docs/security/ACCESS-CONTROL.md`, `compute/core/crates/compute-security/` |
| TypeScript SDK and app shell | UI state, command routing, host integration, principal selection for a session; not a security boundary against malicious same-process callers | `docs/architecture/README.md`, `kernel/src/api/workbook/security.ts`, `runtime/spreadsheet-app/src/public-types.ts` |
| Host application or customer environment | Identity, install policy, firewall/proxy policy, persistence location, update policy, browser isolation shape, embed source authorization | `docs/guides/embed-react.md`, `docs/guides/embed-web-component.md`, `runtime/src-tauri/capabilities/default.json`, `runtime/spreadsheet-app/src/public-types.ts` |
| Future hosted services | Authentication, multi-tenant isolation, durable audit logs, cloud storage | Not claimed |

## Boundary Diagram

```text
Customer security boundary
  |
  +-- Desktop app / host app / Node process
      |
      +-- TypeScript app, SDK, or embed adapter
      |     - owns UI, host callbacks, principal selection
      |     - does not enforce workbook security by itself
      |
      +-- Bridge transport
      |     - generated/typed control-plane calls
      |     - binary data-plane viewport payloads
      |
      +-- Rust compute/document engine
            - workbook state and calculation
            - policy evaluation and redaction on covered bridge surfaces
            - access-denied diagnostic events
```

## Non-Goals

| Claim | Classification | Reason |
|-------|----------------|--------|
| The SDK process is secure against a malicious in-process caller. | Not claimed | Same-process clients can lie about their principal; a trusted service boundary is required for multi-tenant hostile clients. |
| Workbook access control is encryption at rest. | Not claimed | Encryption at rest is separate from application-level policy enforcement. |
| Workbook access control covers every possible data path today. | Not claimed | The engine has a policy and redaction system, but current access-control documentation lists known read-surface gaps and limits. |
| Self-hosted or hosted SaaS compliance controls are available today. | Roadmap | Self-hosting is reserved and not included in current enterprise security claims. |
