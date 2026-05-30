# Self-Hosting

> **Status: reserved** — Mog does not currently publish a supported self-hosted service distribution or deployment guide.

Self-hosting is a planned deployment context for organizations that want Mog to run inside their own security boundary. This guide is reserved until the service implementation and runtime service contracts are complete.

## Prerequisites

No supported self-hosting prerequisite set is published yet. The public repository currently exposes runtime service configuration contracts, but not a Docker Compose stack, service binary, or production deployment manifest.

## Planned Shape

The following sections describe the intended self-hosting documentation shape. Implementation details are subject to change as the runtime service contracts and service implementation stabilize.

### Docker Compose Deployment

Single-node deployment topology and service discovery. The public repository does not currently include Docker Compose files for a supported self-hosted distribution.

### Configuration Schema

Runtime service configuration for endpoints, auth, storage, collaboration, assets, limits, observability, and security.

### Authentication Adapters

Configured service-boundary auth adapters such as OIDC, SAML, local-dev, or single-user modes as supported by the runtime contracts. Production identity and authorization behavior are not documented as shipped.

### Storage Adapters

Object storage and metadata storage configuration, including local/object-store providers and database-backed metadata where supported by runtime contracts. Production backup, retention, encryption, and restore procedures are not documented as shipped.

### Health Checks

Service health and readiness contracts for liveness/load-balancer probes, plus observability sinks as supported by runtime configuration.

### Backup and Restore

Backup, retention, compaction, and restore procedures for workbook data once service storage lifecycle behavior is documented as supported.

### Scaling

Single-node and horizontal deployment profiles, collaboration scaling configuration, and load-balancer requirements once production service behavior is documented.

## Related Docs

- [Architecture Overview](architecture-overview.md) — platform layers
- [Security and Governance](security-and-governance.md) — trust boundaries
- [HTTP Service](http-service.md) — HTTP API guide (reserved)
