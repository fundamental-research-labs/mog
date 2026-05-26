# Self-Hosting

> **Status: skeleton — reserved until runtime service contracts are approved (Plan 07)**

Self-host Mog for your organization. This guide will cover deploying Mog as a service with persistent storage, authentication, and collaboration.

## Prerequisites

- Docker and Docker Compose (planned deployment target)
- A PostgreSQL-compatible database (planned)
- An object storage backend (S3-compatible, planned)

## Planned Shape

The following sections describe the intended self-hosting architecture. Implementation details are subject to change as runtime service contracts (Plan 07) are finalized.

### Docker Compose Deployment

Single-command deployment using Docker Compose. Service topology: API server, compute workers, web frontend, reverse proxy.

### Configuration Schema

Environment variables and config file format for: database connection, storage backend, auth provider, feature flags, resource limits.

### Authentication Adapters

Pluggable auth: built-in email/password, OIDC/OAuth2 provider, SAML (enterprise). How to configure each.

### Storage Adapters

Where workbooks are stored: local filesystem, S3-compatible object storage, database BLOBs. Trade-offs and configuration.

### Health Checks

Liveness and readiness endpoints. Monitoring integration points (Prometheus metrics, structured logging).

### Backup and Restore

Workbook export, database backup, point-in-time recovery considerations.

### Scaling

Horizontal scaling model for compute workers. Sticky sessions for collaboration. Load balancer configuration.

## Related Docs

- [Architecture Overview](architecture-overview.md) — platform layers
- [Security and Governance](security-and-governance.md) — trust boundaries
- [HTTP Service](http-service.md) — HTTP API guide (reserved)
