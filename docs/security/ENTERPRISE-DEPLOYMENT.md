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
| Filesystem scope | Desktop capability policy and OS permissions | Deployment-controlled | Review the shipping desktop package's capability policy and OS entitlements. User-opened files, shell-open behavior, deep links, app data paths, and enabled runtime commands are not claimed without distribution review. |
| Network allowlist | CSP or webview policy, firewall, proxy, DNS, endpoint protection | Deployment-controlled | Define and review the shipping package's CSP, webview policy, and network allowlist; remove non-required destinations, including unused integration domains, from enterprise distributions. |
| Browser embed isolation | Host app architecture | Deployment-controlled | Same-page public embeds share the host origin and are not hostile-content isolation. The public iframe entrypoint is reserved, so do not claim iframe isolation until a reviewed iframe host/child distribution is released. |
| Principal assignment | Trusted service or host adapter | Deployment-controlled | Do not expose same-process SDK access to untrusted users when workbook policy decisions matter. |
| Headless server exposure | Network policy and service architecture | Not claimed | Mog does not currently publish a supported HTTP service API. If a distribution includes headless HTTP or service routes, bind them to trusted loopback or place them behind real authentication and authorization before enterprise exposure. |
| Collaboration server exposure | Network policy and service architecture | Not claimed | Treat collaboration WebSocket code as sync and awareness plumbing. Origin allowlists, room grants, tenant authentication, authorization, and durable policy enforcement must come from a reviewed service deployment. |

## Configuration Lockdown Checklist

- Confirm whether the distribution is desktop, SDK/headless, same-page embed, iframe embed, or self-hosted service.
- Disable collaboration and provider integrations unless explicitly approved.
- Define and review CSP, webview, and network allowlists for the desktop distribution.
- Route updates through a customer-approved channel.
- Define the local storage directory and retention policy.
- Decide whether workbook files remain local only or may be synced through customer infrastructure.
- Put a trusted service boundary in front of SDK calls for multi-user or hostile-client deployments.
- Do not expose headless HTTP or service routes, database proxy, agent, code-execution, upload/download, automation, or collaboration routes as an enterprise service without a separate service-security design.

## Unsupported Enterprise Claims Today

Mog does not currently claim SOC 2, ISO 27001, SSO, SCIM, hosted tenant isolation, durable audit-log retention, or encryption at rest for the standalone customer-controlled distribution. Those controls may be offered in separate products or future releases, but they are not part of the current offline/customer-controlled deployment claim.
