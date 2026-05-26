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

## Recommended Controls

| Control | Enforcement point | Claim class | Guidance |
|---------|-------------------|-------------|----------|
| Offline mode | Customer firewall/proxy, deployment configuration, feature flags | Deployment-controlled | Block outbound network except approved customer endpoints. Do not enable collaboration or provider integrations for offline deployments. |
| Managed install | MDM, package manager, signed installer policy | Deployment-controlled | Install only approved Mog artifacts and pin versions for regulated environments. |
| Update policy | Customer software distribution channel | Deployment-controlled | Automatic updater artifacts are not currently part of the documented enterprise distribution; distribute updates through customer-approved channels until an enterprise updater is documented. |
| Filesystem scope | Desktop capability policy and OS permissions | Verified; Deployment-controlled | The reviewed desktop capability scope allows app-specific directories; user-opened files, shell-open behavior, deep links, and enabled runtime commands still require distribution review. |
| Network allowlist | CSP, firewall, proxy, DNS, endpoint protection | Deployment-controlled | Review the desktop content-security policy and remove non-required destinations, including unused integration domains, from enterprise distributions. |
| Browser embed isolation | Host app architecture | Deployment-controlled | Use cross-origin iframe isolation for untrusted workbook content; same-page embeds share the host origin. |
| Principal assignment | Trusted service or host adapter | Deployment-controlled | Do not expose same-process SDK access to untrusted users when workbook policy decisions matter. |
| Headless server exposure | Network policy and service architecture | Not claimed | Bind headless HTTP to trusted loopback or place it behind a real authentication and authorization service before enterprise exposure. Routes can include session control, file upload/download, code execution, agent egress, and optional database proxy behavior depending on the distribution. |
| Collaboration server exposure | Network policy and service architecture | Not claimed | Treat the WebSocket coordinator as a sync component with origin checks, not as tenant authentication, authorization, or durable policy enforcement. |

## Configuration Lockdown Checklist

- Confirm whether the distribution is desktop, SDK/headless, same-page embed, iframe embed, or self-hosted service.
- Disable collaboration and provider integrations unless explicitly approved.
- Remove unneeded CSP destinations from the desktop distribution.
- Route updates through a customer-approved channel.
- Define the local storage directory and retention policy.
- Decide whether workbook files remain local only or may be synced through customer infrastructure.
- Put a trusted service boundary in front of SDK calls for multi-user or hostile-client deployments.
- Do not expose headless HTTP, optional database proxy, agent, code-execution, upload/download, or automation routes as an enterprise service without a separate service-security design.

## Unsupported Enterprise Claims Today

Mog does not currently claim SOC 2, ISO 27001, SSO, SCIM, hosted tenant isolation, durable audit-log retention, or encryption at rest for the standalone customer-controlled distribution. Those controls may be offered in separate products or future releases, but they are not part of the current offline/customer-controlled deployment claim.
