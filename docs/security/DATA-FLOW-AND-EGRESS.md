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
| Desktop app | User-opened workbook files, recent files/projects, preferences, credentials, logs, autosave, security commands | Filesystem scope allows `$HOME/.spreadsheet-os/**`, `$APPDATA/spreadsheet-os/**`, `$APPLOCAL/spreadsheet-os/**` | Available in desktop target | Verified | Desktop capability and command configuration. |
| Browser same-page embed | Workbook data supplied by trusted host policy | Browser origin storage if the host chooses to persist | Host-controlled | Deployment-controlled | Embed integration guidance. |
| iframe embed | Workbook data supplied by host policy and exchanged through postMessage | Browser storage only if host/frame implementation enables it | Not generally available for enterprise use | Not claimed | Embed design and security scenarios. |
| Node/headless SDK | Workbook data in customer Node process | Customer-selected filesystem, database, object store, or memory | Customer-controlled | Deployment-controlled | SDK and headless runtime design. |
| Headless HTTP server | Uploaded workbook files, attachment bytes, code strings, query state, optional agent/database payloads | Temporary attachments under `os.tmpdir()`; in-memory sessions unless host persistence is added | Developer and automation surface; unauthenticated by default | Not claimed | Server and path-safety implementation review. |

## Network Egress Inventory

| Destination or class | Trigger | Payload class | Default state | Disablement / control | Claim class | Validation basis |
|----------------------|---------|---------------|---------------|-----------------------|-------------|------------------|
| Collaboration WebSocket server | Collaboration runtime or customer-hosted server use | Sync updates and awareness metadata | Separate collaboration runtime; not inherent to offline desktop use | Do not deploy collaboration server; block egress; disable collaboration feature | Deployment-controlled | Collaboration runtime design. |
| Desktop database connections | Database driver or command surfaces included in a customer distribution | Credentials, SQL, query parameters, result rows | No PostgreSQL or ClickHouse Tauri command handler is registered in the reviewed desktop workspace; any database-capable distribution needs a separate review | Disable database drivers/commands, remove credentials, or block destination networks | Deployment-controlled | Desktop command registry and platform-driver review. |
| Headless agent URL | `/run_agent_query` in headless server | Query, user info/JWT or bypass token, workbook summary, upload metadata, API spec, generated code, execution logs, dirty-cell summaries, and execution results | Default local URL; requests can supply an agent URL | Do not expose headless server beyond trusted loopback; disable route or add authentication plus an agent URL allowlist before enterprise deployment | Not claimed | Headless server and agent-client implementation review. |
| Headless callback URL | Agent-query `callback_url` request field | Stored in query state; no callback egress observed in the reviewed implementation | Accepted but not used for outbound callback in reviewed code | Treat as reserved/unclaimed until callback behavior is designed and reviewed | Not claimed | Headless server and session-state implementation review. |
| Headless database proxy | `/database/*` in headless server when optional database addon loads | Connection config, credentials JSON, SQL, parameters | Available if native database addon loads | Disable route/addon or put behind trusted service authentication | Not claimed | Headless database route implementation review. |
| Update checks | Automatic updater | Release metadata | Automatic updater is not enabled in the reviewed desktop configuration | Keep updater disabled or route through customer-managed distribution | Verified | Desktop release configuration. |
| Telemetry / analytics | Product analytics | Usage metadata | No general telemetry service identified in this review | Do not enable without customer review and updated security documentation | Not claimed | Documentation and implementation review. |
| Crash reports | Crash reporter | Crash dumps, logs, device metadata | No crash-report service identified in this review | Customer crash collection only if configured by distribution | Not claimed | Documentation and implementation review. |
| AI/provider calls | AI/copilot feature or host integration | Workbook excerpts, prompts, derived metadata | No provider boundary is claimed for enterprise use | Disable by default until provider, retention, and payload controls are documented | Not claimed | AI data-boundary review. |

## Offline Operation

Standalone workbook computation and local editing do not require a hosted Mog service by architectural design. Offline enterprise use still depends on distribution choices: disable or remove collaboration endpoints, external provider integrations, automatic update checks, and any host-supplied network callbacks.

Classification: **Deployment-controlled**.

## Logs, Caches, and Temporary Files

Reviewed implementation evidence shows desktop commands and storage for preferences, autosave files, frontend logs, HMAC-signed desktop security audit logs, OS keychain credentials, recent files/projects, and project/file operations. Browser document providers may use IndexedDB for snapshots and update logs. A distribution-specific file-path audit is required before logs, caches, and temporary files are claimed as completely inventoried.

Classification: **Not claimed** until the exact distribution and OS paths are reviewed.
