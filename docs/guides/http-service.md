# HTTP Service

> **Reserved** — Mog does not currently publish a supported HTTP service API. The repository includes runtime service type/config contracts, but they are not a REST route contract, webhook surface, or OpenAPI specification.

When approved, this guide will document:

- HTTP endpoint contracts for workbook and session operations
- Collaboration room handoff and WebSocket upgrade requirements
- Authentication, authorization, rate limit, and quota configuration
- Import/export and raw-byte materialization boundaries
- Webhook registration for workbook change events, if supported
- OpenAPI specification and client SDK generation, if published

For server-side workbook automation today, use the [Node SDK](node-sdk.md). See [Self-Hosting](self-hosting.md) for deployment context.
