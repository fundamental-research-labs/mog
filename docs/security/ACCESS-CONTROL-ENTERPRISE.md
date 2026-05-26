---
title: Access Control for Enterprise Review
audience: enterprise-security
status: draft
visibility: public
pdf: true
owner: security
reviewers: [architecture, compute]
---

# Access Control for Enterprise Review

Mog's workbook access control is an application-level policy engine for workbook read, write, and redaction decisions. It is designed so supported application surfaces use the same policy decisions. It is not an encryption layer and does not make an untrusted client process safe. For hostile-client or multi-tenant deployments, identity must be assigned by a trusted host or service before calls reach the workbook engine.

## Guarantees

| Guarantee | Classification | Validation basis |
|-----------|----------------|------------------|
| Principals are expressed as canonicalized tag sets. | Verified | Access-control design and implementation tests. |
| Policies grant ordered access levels: none, structure, read, write, admin. | Verified | Access-control design and implementation tests. |
| Empty-policy documents do not enforce access decisions; once policies exist, anonymous callers are denied rather than treated as owner. | Verified | End-to-end security tests. |
| Writes below required access fail with `SecurityDenied` and emit diagnostic events. | Verified | End-to-end security tests. |
| Denied reads return redacted typed placeholders so application and formula consumers can handle them consistently. | Verified | Read-filter implementation and security tests. |
| Bridged read surfaces are covered by tests that require each read to declare a security scope. | Verified | Bridge coverage tests. |
| Policy ambiguity resolves to the safer lower access level. | Verified | Access-control design and implementation tests. |
| Host-backed workbook construction can project a verified principal, reject invalid tenant/workspace or reserved-tag claims, and lock the active principal against later public API mutation. | Verified | Principal-projection and host-principal-lock tests. |

## Limits

| Limit | Classification | Customer interpretation |
|-------|----------------|-------------------------|
| Same-process application code and engine calls are not an out-of-process hostile-client boundary. | Not claimed | Host-backed construction can lock a verified principal for cooperative callers, but a compromised or untrusted process can still attack the process boundary itself; put a trusted service in front of the engine for multi-tenant deployments. |
| Access control is not encryption at rest. | Not claimed | Denied users should not receive raw file/database access to protected workbook data. |
| Diagnostic events are in-memory and bounded, not durable audit logs. | Not claimed | The engine uses a bounded event buffer; desktop audit logging is separate and should not be treated as complete workbook-policy audit retention. |
| Formula evaluation may access denied cells internally; redaction happens at read time. | Not claimed | This preserves calculation behavior and is not per-principal formula sandboxing. |
| Row-level and range-level policy targets are not currently available. | Not claimed | Current targets are workbook, sheet, and column. |
| Some sheet-scoped non-byte vector read paths are outside the current enforcement guarantee. | Not claimed | Enterprise deployments should exclude those read surfaces or validate a distribution that has remediated them. |
| Python security session APIs intentionally differ from TypeScript APIs. | Verified | Python exposes principal setters and security operations but does not mirror every TypeScript convenience method. |

## Enterprise Deployment Rule

Use Mog access control to enforce workbook-level, sheet-level, and column-level application decisions for trusted clients and trusted host-backed sessions. For untrusted users or multi-tenant service deployments, terminate identity and authorization in a trusted server process and expose only narrowed operations to clients.
