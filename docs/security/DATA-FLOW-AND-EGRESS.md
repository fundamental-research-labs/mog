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

This document records the default data-flow and network-egress claims for the current public Mog repository. Any customer distribution that includes an installer, updater, telemetry service, crash reporter, hosted service, extension catalog, or AI integration needs a distribution-specific review before those components are represented as covered by this document.

Status terms used below:

- **Shipped**: implemented in the current public workspace.
- **Public**: exported as a supported package/API surface.
- **Public-experimental**: exported publicly but still explicitly marked experimental.
- **Workspace-internal**: present in source, but not a public package/API contract.
- **Reserved**: documented or scaffolded for a future surface, but not a current public entrypoint.
- **Not shipped**: no implementation or packaged distribution surface was identified in the current public workspace.

## Process and Storage Inventory

| Surface | Data handled | Local storage or file access | Default state | Claim class | Validation basis |
|---------|--------------|------------------------------|---------------|-------------|------------------|
| Compute/document engine | Workbook cells, formulas, formats, collaboration document state, security policies | In-memory unless called by a host/runtime that persists files | Shipped through current engine and host APIs | Verified | `compute/core`, `kernel/src/api/document/document-factory.ts`, and document provider registry review. |
| Browser app and same-page embed | Workbook data supplied by a trusted host policy, public workbook factory, or public-experimental same-page embed host policy | Standalone browser storage uses IndexedDB snapshots, update log, and metadata unless `skipLocalPersistence` selects an ephemeral path. Public-experimental embed config rejects raw URL/path/provider credentials and materializes only through host policy. | Public-experimental for `@mog-sdk/embed`; host-controlled for persistence | Deployment-controlled | `shell/src/host-adapters/standalone-browser-host.ts`, `kernel/src/document/providers/indexeddb-provider.ts`, `runtime/embed/src/config.ts`, and `runtime/embed/EXPOSURE.md`. |
| iframe embed | Workbook data supplied by host policy and exchanged through postMessage | Browser storage only if a future host/frame implementation enables it | Reserved; no public `@mog-sdk/embed/iframe` export or emitted iframe bundle | Not claimed | `docs/guides/iframe-embed.md`, `runtime/embed/package.json`, and iframe placeholder review. |
| Node/headless SDK | Workbook data in the customer Node process; optional XLSX import/export bytes and caller-supplied file paths | Ephemeral by default. Public `createWorkbook` can read a caller-supplied path or bytes; public document factory imports bytes. Exports are bytes unless the caller writes them to disk. | Public SDK; customer-controlled process and filesystem use | Deployment-controlled | `runtime/sdk/src/boot.ts`, `runtime/sdk/src/host-adapters/node-headless-host.ts`, and `kernel/src/api/document/mog-document-factory.ts`. |
| Desktop/Tauri adapter code | User-opened workbook files, recent files/projects, preferences, credentials, autosave, and security command wrappers | TypeScript IPC wrappers are present; no packaged `runtime/src-tauri`, `tauri.conf.*`, or Rust/Tauri backend capability configuration is present in the current public workspace | Workspace-internal adapter code; distribution-specific packaging | Not claimed | `infra/platform/tauri`, `shell/src/services/project/tauri-ipc.ts`, package inventory, and Tauri config search. |
| Headless HTTP server | Service requests, uploads, code execution, agent/database payloads if supplied by a separate distribution | No `runtime/server` package or built-in headless HTTP route implementation in the current public workspace. Runtime service contracts are private/type-only contracts, not a shipped server. | Not shipped | Not claimed | `pnpm-workspace.yaml`, `runtime/`, `contracts/runtime-services/package.json`, `contracts/src/runtime/service-config.ts`, and route search. |

## Network Egress Inventory

| Destination or class | Trigger | Payload class | Default state | Disablement / control | Claim class | Validation basis |
|----------------------|---------|---------------|---------------|-----------------------|-------------|------------------|
| Collaboration WebSocket server | Collaboration runtime or customer-hosted collaboration use | Sync updates, room snapshot requests, and awareness/presence metadata | Implemented sidecar/client code exists, but collaboration service deployment is separate and not inherent to offline or ephemeral use | Do not deploy collaboration server; block egress; disable collaboration feature | Deployment-controlled | `kernel/src/document/collab/ws-sidecar.ts` and collaboration factory review. |
| Thesaurus lookup | Review-tab thesaurus search | Search term | Calls `api.dictionaryapi.dev` only when the feature is used | Remove/disable the feature or block the domain for offline deployments | Deployment-controlled | `apps/spreadsheet/src/dialogs/tools/ThesaurusDialog.tsx`. |
| External content and host-configured network APIs | Remote picture copy/save, capability-gated scoped app fetch, distribution-loaded extension iframe origins, or host-registered table/network drivers | Requested URL, configured request payloads, fetched picture bytes, extension messages, or driver-specific payloads | Triggered by user action, workbook content, host configuration, loaded extension manifests, or granted app/network capability; not a default offline engine dependency | Deny scoped network capabilities, do not register external drivers/extensions, remove remote-content actions where required, or block destinations | Deployment-controlled | Object handlers, `kernel/src/api/app/capability-gated/scoped-network-api.ts`, table driver interfaces, and workspace-internal extension host review. |
| Database/query execution | Query executor, table driver, or database-backed provider configuration | Connection config, SQL, parameters, result rows if a host supplies an executor/provider | Native database query execution is removed from the current query executor; typed configs and in-memory stubs do not create default database egress | Do not register external database executors/providers; block destination networks | Deployment-controlled | `kernel/src/services/query-executor/query-executor.ts`, `kernel/src/services/table-registry`, and `kernel/src/document/providers/database-log-provider.ts`. |
| Headless service routes | Separately supplied headless HTTP, agent, callback, database proxy, code-execution, upload/download, or automation service | Service-specific requests, files, code, credentials, generated code, logs, and results | No built-in headless HTTP service routes identified in the current public workspace; service config/contracts are not a shipped service | Add only behind service authentication, route allowlists, and updated security documentation | Not claimed | Package inventory, `runtime/` search, `contracts/runtime-services`, and exact route search. |
| Update checks | Automatic updater | Release metadata | No packaged updater configuration or updater dependency identified in the current public workspace | Keep updater disabled or route through customer-managed distribution | Verified | Root package and dependency search. |
| Telemetry / analytics | Product telemetry, observability metrics, or distribution-provided metric handlers | Usage or metric metadata | Shell telemetry is no-op. Metrics egress only if a distribution initializes an endpoint or handler. | Keep telemetry no-op/uninitialized or review endpoint, payload, retention, and opt-out controls | Deployment-controlled | `shell/src/platform/host-services.ts`, `shell/src/platform/types.ts`, and `apps/spreadsheet/src/infra/observability/metrics.ts`. |
| Crash reports | Crash reporter | Crash dumps, logs, device metadata | No crash-report service identified in the current public workspace | Customer crash collection only if configured by distribution | Not claimed | Documentation, package, and dependency search. |
| AI/provider calls | Natural-language formula UI, AI/copilot feature, agent endpoint, or host integration | Workbook excerpts, prompts, derived metadata | Natural-language formula UI is present but reports unavailable when no provider is configured. No enterprise AI/provider boundary is claimed by default. | Disable or omit provider-backed AI features until provider, retention, payload, and opt-out controls are documented | Not claimed | `docs/security/AI-DATA-BOUNDARY.md`, `apps/spreadsheet/src/chrome/nl-formula-bar/NLFormulaBarContainer.tsx`, and runtime service config review. |

## Offline Operation

Standalone workbook computation and local editing do not require a hosted Mog service by architectural design. Offline enterprise use still depends on distribution choices: disable or remove collaboration endpoints, thesaurus lookup, remote picture/content fetches, scoped network API grants, external table/database providers, distribution-loaded extension origins, observability endpoints/handlers, update checks, crash collection, AI/provider endpoints, agent callbacks, and any separately supplied headless service routes.

Classification: **Deployment-controlled**.

## Logs, Caches, and Temporary Files

Reviewed implementation evidence shows browser IndexedDB storage for snapshots, update logs, and document metadata in the standalone browser host path. The SDK host is ephemeral by default, and its logger is silent unless debug logging is explicitly enabled. Shell telemetry is currently no-op, and observability metrics only leave the process if a distribution initializes an endpoint or handler. TypeScript Tauri adapters define wrappers for preferences, autosave, recent files/projects, credentials, file operations, and secured invocations, but the packaged Rust/Tauri backend and final OS paths are not present in the current public workspace. A distribution-specific file-path audit is required before logs, caches, and temporary files are claimed as completely inventoried.

Classification: **Not claimed** until the exact distribution and OS paths are reviewed.
