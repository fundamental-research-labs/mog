# Self-Hosting

> **Status: reserved / not shipped** - Mog does not currently publish a
> supported self-hosted service distribution, service binary, container image,
> Docker Compose stack, Helm chart, or production deployment guide.

Mog can be used inside a customer's security boundary through shipped public
packages, but that is different from a supported self-hosted Mog service. Today,
server-side workbook automation is same-process trusted automation through the
public [SDK](sdk.md), and browser integration is host-owned through
the public embed packages. Authentication, persistence, tenant boundaries, and
network exposure remain responsibilities of the host application or customer
deployment.

## What Exists Today

- `@mog-sdk/sdk` is a shipped public package for headless workbook creation,
  compute, and XLSX file I/O inside your own Node.js process. It does not start
  or document an HTTP service.
- `@mog-sdk/embed` and `@mog-sdk/spreadsheet-app` are shipped public browser
  integration packages for trusted same-origin hosts. Their public contracts
  expect the host to resolve authorized workbook bytes, save/export behavior,
  and any persistence policy.
- `contracts/runtime-services` (`@mog-sdk/runtime-service-contracts`) is
  workspace-internal and `private: true`. It contains TypeScript-only service
  boundary types such as error envelopes, audit events, protocol handshakes,
  room grants, raw-byte handoff records, and health/readiness response shapes.
  It is not a published configuration schema or deployment API.
- Collaboration primitives exist in the compute layer. For example,
  `compute-coordinator` is a pure Rust coordinator with no async runtime or
  network server; any HTTP or WebSocket transport would be deployment-specific
  and is not shipped as a public service contract here.

## Not Shipped

Do not build production integrations against assumed self-hosted service
behavior yet. The public repository does not currently define:

- A `runtime/server` workspace package, service binary, or service entrypoint
- Docker Compose, Kubernetes, Helm, Terraform, or other production deployment
  manifests
- Published container images or durable release checksums for a headless service
- REST, WebSocket, webhook, or OpenAPI route contracts for workbook service
  operations
- Shipped OIDC, SAML, SCIM, API-key, local-dev, or single-user authentication
  adapters for a Mog service
- Tenant isolation, rate-limit, quota, audit-retention, or hosted authorization
  behavior
- Storage adapter setup for object stores, databases, local disks, backups,
  restore, retention, encryption-at-rest, or disaster recovery
- Health, readiness, metrics, tracing, or diagnostics endpoints backed by a
  running service implementation
- Documented single-node or horizontal scaling behavior for collaboration or
  workbook service workloads

## Future Guide Checklist

When a self-hosted distribution ships, this guide should become a runnable
deployment path. Until then, these topics are reserved:

- Copy-paste local deployment
- Supported production topology
- Versioned configuration schema
- Authentication and authorization adapters
- Storage, backup, and restore procedures
- Health checks, readiness checks, observability, and audit retention
- Network, firewall, and TLS requirements
- Scaling, failover, and collaboration deployment behavior

## Related Docs

- [SDK](sdk.md) - shipped public same-process server-side package
- [Embed: React](embed-react.md) and [Embed: Web Component](embed-web-component.md) - shipped public same-page embeds
- [HTTP Service](http-service.md) - reserved service API status
- [Security and Governance](security-and-governance.md) - trust boundaries
- [Architecture Overview](architecture-overview.md) - package and platform layers
