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

Mog is a spreadsheet for humans and agents. For enterprise review, the current
trust claim is about standalone or customer-controlled deployments, not a
hosted SaaS tenant boundary.

Status words in this page use the public package and security vocabulary:
`shipped`, `public`, `public-experimental`, `workspace-internal`, `reserved`,
and `not shipped`. Source-visible code does not become an enterprise control or
customer-facing boundary unless the row below says that control is shipped.

> Mog can run inside the customer's security boundary. Current controls include
> local data-flow documentation, reviewable package and runtime configuration, a
> source manifest for the public security-document set, and a Rust-owned
> workbook policy engine for application-level decisions on covered bridge
> surfaces. Product artifact signing, generated security-doc artifacts,
> hosted compliance controls, packaged desktop controls, and hostile-client
> service isolation are separate release or deployment responsibilities unless
> explicitly documented.

## Deployment Modes

| Mode | Current status | Trust boundary | Claim class | Notes |
|------|----------------|----------------|-------------|-------|
| Node SDK | `@mog-sdk/node` is shipped public | Customer process and runtime environment | Verified for package/API surface; Deployment-controlled for process security | The SDK is same-process trusted automation. It does not isolate hostile users, agents, plugins, or code running in the same process. |
| Same-page sheet embed | `@mog-sdk/embed` is shipped public; root, `./react`, `./web-component`, and `./config` are public-experimental | Host web application origin and trusted `MogEmbedHostPolicy` | Deployment-controlled | The host resolves opaque source refs, authorized bytes, effective mode/capability/save state, and callbacks. Same-page embeds run in the host page's JavaScript context and are not isolation for hostile workbook content. |
| Full spreadsheet app embed | `@mog-sdk/spreadsheet-app` is shipped public | Trusted same-origin host page and host authority callbacks | Deployment-controlled | The package is a public bundle-composition facade over private app/shell/kernel code. The host owns authentication, storage, page chrome, lifecycle policy, and browser hardening. |
| Desktop/Tauri host integration | Workspace-internal adapter, transport, and provider code are present; packaged desktop distribution is not shipped here | Shipping host app, local OS user account, Tauri/webview configuration, customer OS policy | Deployment-controlled; Not claimed for packaged controls | Tauri transport/platform helpers and shell adapters are reviewable, but backend capabilities, CSP, installer, updater, entitlements, crash collection, and final OS storage paths are distribution-specific. |
| Headless HTTP service | Not shipped | Any separate service deployment and whoever can reach it | Not claimed | The current workspace does not include a supported `runtime/server` package, service binary, OpenAPI document, or headless HTTP route contract. `contracts/runtime-services` is workspace-internal type-only service-contract material, not a shipped server. |
| Collaboration runtime/server | Rust collaboration primitives and WebSocket sidecar/client code exist; supported service distribution is not shipped | Customer service boundary, room-grant design, and network perimeter | Deployment-controlled for deployments that add a service; Not claimed as a shipped enterprise boundary | The code coordinates CRDT rooms and awareness when a service is supplied. Origin checks, room URLs, and snapshot tokens are not tenant authentication, durable ACLs, persistence policy, or audit retention by themselves. |
| iframe embed | Reserved source-internal plumbing; no public `@mog-sdk/embed/iframe` export or emitted iframe bundle | Future browser origin isolation and `postMessage` contract if shipped | Not claimed | Iframe host/child code and tests exist for protocol evaluation, including origin validation, but there is no customer-facing iframe isolation guarantee today. |
| Self-hosted service | Reserved / not shipped | Customer network perimeter and service authentication | Roadmap; Not claimed today | Existing docs describe a planned self-hosting shape. Customer-facing claims require approved runtime service contracts, authentication/authorization, persistence, observability, and deployment artifacts. |
| Hosted Mog SaaS | Not in scope for this document | Mog-operated cloud tenant boundary | Not claimed | SOC 2, tenant isolation, SSO/SCIM, managed audit controls, and hosted authorization are separate from this standalone/customer-controlled deployment model. |

## Data Authority

| Layer | Authority | Evidence |
|-------|-----------|----------|
| Rust compute/document engine | Persistent workbook state, formulas, calculation, access-control policy evaluation, diagnostic events, and redaction filtering for covered generated `ComputeService` bridge surfaces | `docs/security/ACCESS-CONTROL-ENTERPRISE.md`, `docs/security/ACCESS-CONTROL.md`, `compute/core/crates/compute-security/`, `compute/api/src/bridge_service.rs`, `infra/rust-bridge/bridge-delegate/macros/src/expand/gated.rs`, `compute/core/crates/compute-wire/src/security_filter.rs` |
| TypeScript SDK, kernel, and app facades | Public SDK and embed APIs, UI state, command routing, host integration, and session-principal forwarding; not a security boundary against malicious same-process callers | `docs/architecture/os/packages.md`, `runtime/sdk/src/boot.ts`, `runtime/embed/src/config.ts`, `runtime/spreadsheet-app/src/public-types.ts`, `kernel/src/api/workbook/security.ts`, `kernel/src/api/workbook/workbook-impl.ts` |
| Host-backed adapters and customer environment | Identity, trusted host principal projection, install policy, firewall/proxy policy, persistence location, update policy, browser isolation shape, embed source authorization, desktop/browser hardening | `kernel/host-internal/src/validate.ts`, `kernel/host-internal/src/create.ts`, `docs/guides/embed-react.md`, `docs/guides/embed-web-component.md`, `docs/guides/spreadsheet-app-embed.md`, `docs/security/DATA-FLOW-AND-EGRESS.md` |
| Future hosted or self-hosted services | Authentication, multi-tenant isolation, durable audit logs, cloud storage, service routing, rate limits, backups, observability | Not claimed; `contracts/runtime-services/` is workspace-internal and type-only |

## Boundary Diagram

```text
Customer security boundary
  |
  +-- Trusted desktop app / host page / Node process
      |
      +-- Public facade or trusted adapter
      |     - Node SDK, same-page embed, full app embed, or host-backed adapter
      |     - owns UI, host callbacks, source materialization, and principal forwarding
      |     - does not create a hostile-client or tenant boundary by itself
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

No shipped boundary in this repository turns arbitrary untrusted clients into
trusted workbook callers. Multi-tenant or hostile-client deployments need a
separate trusted service boundary that authenticates users, assigns principals,
narrows operations, and prevents direct access to raw workbook files, memory,
process internals, and engine APIs.

## Non-Goals

| Claim | Classification | Reason |
|-------|----------------|--------|
| The SDK, embed, app shell, or direct engine process is secure against a malicious in-process caller. | Not claimed | Same-process clients can lie about their principal, call internal APIs, read memory/files available to the process, or bypass host policy. A trusted service boundary is required for multi-tenant hostile clients. |
| Workbook access control is encryption at rest. | Not claimed | Encryption at rest is separate from application-level policy enforcement. |
| Workbook access control covers every possible data path today. | Not claimed | The engine has a policy and redaction system for covered bridge surfaces, but current access-control documentation lists known read-surface gaps, derived-data limits, artifact-byte limits, and direct-bypass limits. |
| Same-page or full-app embeds isolate hostile workbook, host, plugin, or browser content. | Not claimed | Public browser embeds run in a trusted same-origin page. CSP, Trusted Types, clickjacking defenses, rich content handling, postMessage validation, and external-content policy are distribution-specific unless separately documented. |
| `contracts/runtime-services` or generated SDK metadata is a shipped HTTP/OpenAPI service contract. | Not claimed | Runtime service contracts are workspace-internal type-only material, and `runtime/sdk/src/generated/api-spec.json` is SDK introspection metadata, not an HTTP API specification. |
| Self-hosted or hosted SaaS compliance controls are available today. | Roadmap; Not claimed today | Self-hosting is reserved/not shipped, and hosted SaaS controls are outside the current standalone/customer-controlled enterprise security claims. |
| Generated security-document HTML, PDFs, signatures, hashes, or trust manifests are verified artifacts in this repository. | Not claimed | `docs/security/manifest.json` lists the reviewed Markdown source set, but this repository does not ship a `dist/trust` publishing pipeline or generated security artifact bundle. |
