# HTTP Service

> **Status: reserved / not shipped** — Mog does not currently publish a
> supported HTTP service, REST API, hosted workbook service, webhook API, or
> OpenAPI specification.

The current public setup paths are package APIs, not an HTTP boundary. For
server-side workbook automation, use the shipped public [Node SDK](node-sdk.md).
For browser integration, use the public embed guides and keep any file loading,
saving, authentication, and tenant policy in your own trusted host service.

## What Exists Today

- `@mog-sdk/node` is the shipped public headless Node package. It exposes
  same-process workbook APIs such as `createWorkbook`; it does not start or
  document an HTTP server.
- `contracts/runtime-services` (`@mog-sdk/runtime-service-contracts`) is
  workspace-internal and `private: true`. It defines TypeScript-only envelopes
  for prospective service boundaries, such as runtime errors, audit events,
  protocol handshakes, health/readiness diagnostics, room grants, and
  import/export/raw-byte handoff records.
- `runtime/sdk/src/generated/api-spec.json` is generated SDK API metadata used
  by `@mog-sdk/node` API introspection. It is not an OpenAPI document.
- Collaboration code includes in-process and WebSocket-sidecar pieces, but this
  repository does not publish a supported collaboration service distribution or
  HTTP/WebSocket route contract.

## Not Shipped

Do not build external integrations against any assumed Mog HTTP surface yet.
The public repository does not currently define:

- REST endpoints for workbook, worksheet, session, import, export, or
  collaboration operations
- Authentication, authorization, rate-limit, quota, tenant-isolation, or audit
  retention behavior for a hosted Mog service
- Webhook registration or workbook change delivery contracts
- OpenAPI schemas or generated HTTP client SDKs
- Docker Compose files, service binaries, or production deployment manifests
  for a supported self-hosted service

See [Self-Hosting](self-hosting.md) for deployment status and [Security and
Governance](security-and-governance.md) for current trust-boundary language.
