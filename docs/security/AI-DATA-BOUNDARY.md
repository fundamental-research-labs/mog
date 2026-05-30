---
title: AI Data Boundary
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, runtime]
---

# AI Data Boundary

Mog does not currently claim an enterprise AI/provider data boundary. Standalone
workbook computation can run without a model provider, and public "agent" or
"LLM-friendly" APIs are local helper surfaces unless a host, workflow, or
separate service sends their output to an external provider.

Do not treat AI, copilot, agent, or code-execution features as approved for
regulated data unless the exact deployment includes the controls below and those
controls are documented for that customer.

## Boundary Terms

- **AI provider call** means network egress to a model or copilot provider, such
  as a prompt, workbook excerpt, screenshot, derived summary, or tool result sent
  outside the customer-controlled deployment.
- **Agent-friendly SDK helper** means a local API that formats workbook or API
  metadata for automation. Examples include worksheet `describe()`,
  `describeRange()`, `summarize()`, and SDK API introspection. These helpers
  produce text; they do not call a provider by themselves.
- **Agent actor or principal** means identity and authorization vocabulary, such
  as `agent` actor kinds or `agent:*` principal tags. Those tags do not create
  network egress by themselves.
- **Reserved service config** means source-visible configuration vocabulary for a
  possible future service, not a shipped service implementation or security
  boundary.

## Current Claims

| Claim | Surface status | Classification | Notes |
|-------|----------------|----------------|-------|
| Standalone workbook computation requires no AI provider. | shipped public SDK/runtime over workspace-internal compute and kernel | Verified | Formula parsing, evaluation, workbook storage, local rendering data, and workbook-policy enforcement run through Mog compute/kernel code without initializing an AI provider. |
| LLM/agent presentation helpers make no provider calls by themselves. | shipped public SDK helpers | Verified | `describe()`, `describeRange()`, `summarize()`, and SDK API introspection format local workbook/spec data. A caller may pass those strings to an AI provider, but the helpers do not do that. |
| Agent actor and principal vocabulary is identity and authorization vocabulary, not an AI provider integration. | shipped public and public-experimental host vocabulary | Verified for provider absence; Deployment-controlled for host policy | `agent` actor kinds and `agent:*` policy tags are identity/authorization labels. Host authority and workbook access policy still determine what those actors may read or write. |
| No direct AI provider client is included by default. | not shipped in reviewed public package manifests | Verified | Public package manifests do not include built-in OpenAI, Anthropic, Gemini, LangChain, Vercel AI SDK, or similar provider clients, and package policy forbids those dependencies in public SDK packages. Source-visible workflow helper examples show generic HTTP/secrets calls to provider URLs, so host code, workflow code, scoped network APIs, or customer integrations can still call providers and each distribution must be reviewed. |
| No supported headless HTTP or agent service route is shipped. | not shipped | Verified for the public workspace; Not claimed for separate distributions | The repository does not publish a supported `runtime/server` package, HTTP service API, OpenAPI contract, or agent route boundary. `contracts/runtime-services` is workspace-internal. The source-visible reserved self-host config type `AgentPolicy` includes `agentUrl` and `bypassToken`, but it is not a shipped service implementation. |
| `workbook.executeCode()` is an AI boundary or safe hostile-client surface. | public same-process automation API, optional executor wiring | Not claimed | `executeCode()` delegates to an executor supplied by a trusted host path. The public spreadsheet-app facade denies raw code execution. Do not expose code execution to untrusted users or treat it as an AI isolation boundary. |
| Provider retention, training use, regional processing, and deletion controls are documented. | not shipped | Not claimed | Requires provider-specific terms, endpoint inventory, retention controls, and implemented deletion/audit behavior before any enterprise AI claim is made. |

## Required Before AI Is Enabled

- AI or copilot behavior must be opt-in and disabled by default for enterprise
  deployments.
- The deployment owner must identify every provider, endpoint, package,
  host callback, workflow, service route, and network capability that can send
  workbook-derived data outside the customer boundary.
- Payload classes must be documented: workbook cells, formulas, metadata,
  comments, charts, screenshots, prompts, tool results, logs, and derived
  summaries.
- Admin controls must disable AI globally and, when applicable, per workspace or
  tenant.
- Provider, region, retention, training-use, subprocessors, deletion behavior,
  and audit evidence must be identified.
- Redaction and access-control interactions must be tested. AI should not
  receive data a principal cannot read, including derived summaries and
  screenshots.
- Logs must not persist prompts, provider responses, workbook excerpts, or
  generated code unless the customer explicitly enables that behavior and the
  retention policy covers it.
- Agent routes, code-execution routes, callback routes, and provider proxy
  routes must be disabled, bound to trusted loopback, or placed behind a reviewed
  service authentication and authorization boundary.

Until those conditions are met, AI/provider handling remains **Not claimed** for
enterprise security review.
