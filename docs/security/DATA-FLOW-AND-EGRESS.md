---
title: Data Flow and Network Egress
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime, release]
---

# Data Flow and Network Egress

This document records the default data-flow and network-egress claims for Mog enterprise security review. Any customer distribution that includes an installer, updater, telemetry service, crash reporter, hosted service, or AI integration needs a distribution-specific review before those components are represented as covered by this document.

## Process and Storage Inventory

| Surface | Data handled | Local storage or file access | Default state | Claim class | Validation basis |
|---------|--------------|------------------------------|---------------|-------------|------------------|
| Compute/document engine | Workbook cells, formulas, formats, collaboration document state, security policies | In-memory unless called by a host/runtime that persists files | Available | Verified | Architecture review and implementation configuration. |
| Browser app and same-page embed | Workbook data supplied by a trusted host policy or public workbook factory | IndexedDB snapshots, update log, and metadata for standalone browser storage unless a host-backed ephemeral path is selected | Host-controlled | Deployment-controlled | Browser host adapter, embed config, and provider lifecycle review. |
| iframe embed | Workbook data supplied by host policy and exchanged through postMessage | Browser storage only if host/frame implementation enables it | Reserved; not a public embed entrypoint | Not claimed | Embed exposure and iframe guide review. |
| Node/headless SDK | Workbook data in customer Node process; optional XLSX import/export bytes and file paths | Ephemeral by default; Node filesystem reads/writes only when the caller passes paths or saves exports | Customer-controlled | Deployment-controlled | SDK and headless host adapter review. |
| Desktop/Tauri adapter code | User-opened workbook files, recent files/projects, preferences, credentials, autosave, and security command wrappers | TypeScript IPC wrappers are present; packaged Rust/Tauri backend capability configuration is not present in the current workspace | Distribution-specific | Not claimed | Package inventory and Tauri adapter review. |
| Headless HTTP server | Service requests, uploads, code execution, agent/database payloads if supplied by a separate distribution | No `runtime/server` package or built-in headless HTTP route implementation in the current workspace | Not present by default | Not claimed | Package inventory and route search. |

## Network Egress Inventory

| Destination or class | Trigger | Payload class | Default state | Disablement / control | Claim class | Validation basis |
|----------------------|---------|---------------|---------------|-----------------------|-------------|------------------|
| Collaboration WebSocket server | Collaboration runtime or customer-hosted server use | Sync updates and awareness metadata | Separate collaboration runtime; not inherent to offline desktop use | Do not deploy collaboration server; block egress; disable collaboration feature | Deployment-controlled | Collaboration runtime design. |
| Thesaurus lookup | Review-tab thesaurus search | Search term | Calls `api.dictionaryapi.dev` when the feature is used | Remove/disable the feature or block the domain for offline deployments | Deployment-controlled | Thesaurus dialog review. |
| External content and host-configured network APIs | Remote picture copy/save, REST table driver, scoped app network API, extension/host integration | Requested URL, configured request payloads, or fetched picture bytes | Triggered only by workbook content, host configuration, or granted app/network capability | Deny network capabilities, do not register external drivers/extensions, or block destinations | Deployment-controlled | Object handlers, REST driver, scoped network API, and extension review. |
| Database/query execution | Query executor or database-backed provider configuration | Connection config, SQL, parameters, result rows if a host supplies an executor/provider | Native database query execution is removed from the current query executor; typed provider configs and stubs do not create default database egress | Do not register external database executors/providers; block destination networks | Deployment-controlled | Query executor and provider-config review. |
| Headless service routes | Separately supplied headless HTTP, agent, callback, database proxy, code-execution, upload/download, or automation service | Service-specific requests, files, code, credentials, generated code, logs, and results | No built-in headless HTTP service routes identified in the current workspace | Add only behind service authentication, route allowlists, and updated security documentation | Not claimed | Package inventory and exact route search. |
| Update checks | Automatic updater | Release metadata | No packaged updater configuration or updater dependency identified in the current workspace | Keep updater disabled or route through customer-managed distribution | Verified | Package and dependency search. |
| Telemetry / analytics | Product telemetry or observability metrics | Usage or metric metadata | Shell telemetry is no-op; metrics can egress only if a distribution initializes an endpoint or handler | Keep telemetry no-op/uninitialized or review endpoint, payload, retention, and opt-out controls | Deployment-controlled | Shell host-services and metrics collector review. |
| Crash reports | Crash reporter | Crash dumps, logs, device metadata | No crash-report service identified in this review | Customer crash collection only if configured by distribution | Not claimed | Documentation and implementation review. |
| AI/provider calls | AI/copilot feature or host integration | Workbook excerpts, prompts, derived metadata | No provider boundary is claimed for enterprise use | Disable by default until provider, retention, and payload controls are documented | Not claimed | AI data-boundary review. |

## Offline Operation

Standalone workbook computation and local editing do not require a hosted Mog service by architectural design. Offline enterprise use still depends on distribution choices: disable or remove collaboration endpoints, external lookup/API/provider integrations, automatic update checks, and any host-supplied network callbacks.

Classification: **Deployment-controlled**.

## Logs, Caches, and Temporary Files

Reviewed implementation evidence shows browser IndexedDB storage for snapshots, update logs, and document metadata. Shell telemetry is currently no-op, and observability metrics only leave the process if a distribution initializes an endpoint or handler. TypeScript Tauri adapters define wrappers for preferences, autosave, recent files/projects, credentials, file operations, and secured invocations, but the packaged Rust/Tauri backend and final OS paths are not present in the current workspace. A distribution-specific file-path audit is required before logs, caches, and temporary files are claimed as completely inventoried.

Classification: **Not claimed** until the exact distribution and OS paths are reviewed.
