---
title: Enterprise Deployment
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime, release]
---

# Enterprise Deployment

Enterprise deployments should keep a clear customer-controlled boundary: run Mog within the customer's environment, make network egress explicit, and do not rely on hosted-service controls unless they are included in the selected deployment.

Status words in this page use the following meanings:

- `shipped`: implemented in the current public repository.
- `public`: exported from a public package or SDK surface.
- `public-experimental`: exported publicly, but not claimed as a stable enterprise security boundary.
- `workspace-internal`: present in workspace-private packages or trusted adapters, not a public SDK contract.
- `reserved`: source or type shapes exist for future use, but are not a supported public deployment surface.
- `not shipped`: not implemented or not available as a public contract.

## Deployment Surface Status

| Surface | Status | Enterprise interpretation |
|---------|--------|---------------------------|
| Node/headless SDK | public, shipped | `@mog-sdk/node` is same-process trusted automation. It does not start or document an HTTP service and is not a hostile-client boundary. |
| Same-page sheet embed | public-experimental, shipped | `@mog-sdk/embed`, `./react`, `./web-component`, and `./config` run in the host page origin. Use them only with a trusted host-owned `MogEmbedHostPolicy`; do not treat them as isolation for hostile content. |
| Full spreadsheet app embed | public, shipped | `@mog-sdk/spreadsheet-app` is a trusted same-origin React package. The host owns authentication, persistence, save/export callbacks, asset hosting, and authorization policy. |
| iframe embed | reserved | Source-internal iframe and `postMessage` code exists, but `@mog-sdk/embed/iframe` is not a package export and no public iframe child bundle or host page is documented. |
| Desktop/Tauri distribution | workspace-internal adapters shipped; packaged controls not shipped in this repository | Tauri transport/platform helpers are reviewable, but final Tauri capability configuration, CSP, installer, updater, OS entitlements, and storage paths require a distribution review. |
| HTTP/self-hosted service | not shipped | The public workspace does not include a supported `runtime/server` package, service binary, container image, OpenAPI contract, or enterprise auth/authz boundary. |
| Collaboration service | workspace-internal plumbing; service boundary not claimed | Collaboration sync and awareness code is not tenant authentication, durable ACL, or persistence policy by itself. |

## Recommended Controls

| Control | Enforcement point | Claim class | Guidance |
|---------|-------------------|-------------|----------|
| Offline mode | Customer firewall/proxy, host configuration, distribution packaging | Deployment-controlled | Block outbound network except approved customer endpoints. Remove or disable collaboration, thesaurus lookup, remote picture/content fetches, REST/provider integrations, scoped app network grants, telemetry endpoints, AI/agent routes, and updater checks for offline deployments. |
| Managed install | MDM, package manager, signed installer policy | Deployment-controlled | Install only approved Mog artifacts and pin versions for regulated environments. Product artifact signing, durable checksums, SBOMs, and provenance are not documented here as shipped unless a specific release provides that evidence. |
| Update policy | Customer software distribution channel | Deployment-controlled | Automatic updater artifacts are not currently part of the documented enterprise distribution; distribute updates through customer-approved channels until an enterprise updater is documented. |
| Filesystem scope | Desktop capability policy and OS permissions | Deployment-controlled | Review the shipping desktop package's capability policy and OS entitlements. User-opened files, shell-open behavior, deep links, app data paths, and enabled runtime commands are not claimed without distribution review. |
| Network allowlist | CSP or webview policy, firewall, proxy, DNS, endpoint protection | Deployment-controlled | Define and review the shipping package's CSP, webview policy, and network allowlist. The public repo contains network-capable code paths, but no repo-wide enterprise CSP or packaged webview allowlist is claimed. |
| Browser embed isolation | Host app architecture | Deployment-controlled | Same-page public and public-experimental embeds share the host origin and are not hostile-content isolation. The public iframe entrypoint is reserved, so do not claim iframe isolation until a reviewed iframe host/child distribution is released. |
| Principal assignment | Trusted service or host adapter | Deployment-controlled | Do not expose same-process SDK access to untrusted users when workbook policy decisions matter. |
| Headless server exposure | Network policy and service architecture | Not claimed | Mog does not currently publish a supported HTTP service API. If a distribution includes headless HTTP or service routes, bind them to trusted loopback or place them behind real authentication and authorization before enterprise exposure. |
| Collaboration server exposure | Network policy and service architecture | Not claimed | Treat collaboration WebSocket code as sync and awareness plumbing, not as a supported collaboration service distribution. Origin allowlists, room grants, tenant authentication, authorization, and durable policy enforcement must come from a reviewed service deployment. |

## Offline Egress Lockdown

For an offline or air-gapped customer-controlled deployment, review these source-visible egress classes before shipment:

| Egress class | Current source evidence | Required deployment action |
|--------------|-------------------------|----------------------------|
| Collaboration WebSocket | `shell/src/services/collab-room.ts`, `kernel/src/document/collab/ws-sidecar.ts` | Do not configure a collaboration URL or deploy a collaboration service; block WebSocket egress. |
| Thesaurus lookup | `apps/spreadsheet/src/dialogs/tools/ThesaurusDialog.tsx` calls `api.dictionaryapi.dev` when used | Hide, remove, or disable the thesaurus feature; block the domain. |
| Remote picture/content fetches | Picture copy/export paths can `fetch(src)` for `data:`, `blob:`, or remote `http(s)` picture sources | Disable remote content workflows or restrict them through CSP/proxy policy. |
| REST/provider and scoped app network APIs | `infra/platform/drivers/rest/rest-driver.ts`, `kernel/src/api/app/capability-gated/scoped-network-api.ts` | Do not register external table drivers/providers; deny network capabilities or constrain them to reviewed domains. |
| Database/query execution | `kernel/src/services/query-executor/query-executor.ts`, provider configuration types | Native database execution is removed in this build, but host-supplied executors/providers still require review before use. |
| Telemetry/metrics | Shell telemetry is no-op; `apps/spreadsheet/src/infra/observability/metrics.ts` can send to a configured endpoint | Keep telemetry no-op/unconfigured, or document endpoint, payload, retention, and opt-out controls. |
| AI/agent routes | Public service implementation not shipped; reserved service config types include agent policy fields | Keep AI and agent routes disabled unless a reviewed provider and service boundary is included. |

## Configuration Lockdown Checklist

- Confirm whether the distribution is desktop, SDK/headless, same-page sheet embed, full spreadsheet app embed, iframe embed, or self-hosted service.
- Use public shipped surfaces where they exist: `@mog-sdk/node`, `@mog-sdk/spreadsheet-app`, and the public-experimental `@mog-sdk/embed` entrypoints. Treat iframe, HTTP service, and self-hosting surfaces as reserved or not shipped.
- Disable collaboration, thesaurus lookup, external content fetching, REST/provider integrations, scoped app network grants, AI/agent routes, telemetry endpoints, and update checks unless explicitly approved.
- Define and review CSP, webview, and network allowlists for the exact browser or desktop distribution.
- Route updates through a customer-approved channel.
- Define local storage directories, browser IndexedDB behavior, logs, caches, credentials, temporary files, and retention policy for the exact distribution.
- Decide whether workbook files remain local only or may be synced through customer infrastructure.
- Put a trusted service boundary in front of SDK calls for multi-user or hostile-client deployments.
- Do not expose headless HTTP or service routes, database proxy, agent, code-execution, upload/download, automation, or collaboration routes as an enterprise service without a separate service-security design.

## Unsupported Enterprise Claims Today

Mog does not currently claim SOC 2, ISO 27001, SSO, SCIM, hosted tenant isolation, durable audit-log retention, encryption at rest, packaged desktop controls, product artifact signing, durable release checksums, SBOMs, provenance, or a supported self-hosted service for the standalone customer-controlled distribution. Those controls may be offered in separate products or future releases, but they are not part of the current offline/customer-controlled deployment claim.
