# Access Control

Data access control for Mog workbooks. Principals carry tags, policies grant
access levels to targets, and the Rust security engine evaluates those policies
for covered generated `ComputeService` bridge calls.

**Current status:** TypeScript/Node and Python session and policy APIs are
public-experimental. The Rust `compute-security` engine, security store, and
generated bridge delegate are workspace-internal implementation details. REST,
Go, wildcard target IDs, and row/range policy targets are reserved/not shipped.

This is not a hostile-client or process-isolation boundary. Public SDK callers
inherit enforcement only when they call through the shipped `ComputeService`
bridge surface and its gated descriptors.

**Audience:** SDK consumers wiring a principal into a session, and contributors
extending gated bridge surfaces.

---

## Model

### Principal

A caller's identity is a set of string tags:

```ts
{ tags: ['mog:owner'] }                 // workbook owner
{ tags: ['agent:copilot'] }             // an agent
{ tags: ['agent:copilot', 'team:ops'] } // multi-role caller
```

Tags are arbitrary strings; the engine only matches them against policy
patterns. Principals are canonicalized through an intern pool by sorting and
deduping tags. Two pool-interned principals with the same tag set share an
allocation, so pointer identity is a cache key inside the engine.

`mog:owner` is reserved. If no policy matches, an owner defaults to `admin` and
any non-owner defaults to `none`. The engine also derives `mog:non-owner` for
every principal that does not include `mog:owner`, including the anonymous empty
principal.

Owner lockout has a floor: if a matching owner policy resolves below `read`, the
engine clamps the resolved level to `read` and reports the clamp as an
ambiguity-style diagnostic.

### AccessLevel

Five levels, ordered from least to most permissive:

| Level | Means |
|-------|-------|
| `none` | No data access. Covered value reads redact; covered writes deny. |
| `structure` | Shape, types, formatting, and selected metadata are visible; values and computed formula results redact. |
| `read` | Values are visible. Covered writes deny. |
| `write` | Read plus data mutation. Current policy CRUD is also workbook-write gated and attenuation-limited. |
| `admin` | Highest grant. Required for structural bridge mutations and for granting `admin` access. |

Higher levels are strictly more permissive; Rust `AccessLevel` ordering is used
directly for comparisons.

### AccessPolicy

A policy maps a principal tag pattern to a level at a target:

```ts
await wb.security.addPolicy({
  principalTag: 'agent:*', // exact > prefix glob > wildcard
  target: { kind: 'sheet', sheetId },
  level: 'read',
  priority: 0,
  enabled: true,
  metadata: { createdBy: 'mog:owner', createdAt: Date.now() },
});
```

`enabled: false` policies are ignored. Within the same target and tag
specificity, higher `priority` wins.

The TypeScript contract type currently allows `TargetMatcher` wildcard IDs such
as `{ kind: 'sheet', sheetId: '*' }`, but the shipped Rust bridge stores concrete
targets only. Do not send wildcard target IDs to public SDKs until bridge
support lands.

### AccessTarget

Shipped policy targets:

```ts
{ kind: 'workbook' }
{ kind: 'sheet', sheetId }
{ kind: 'column', sheetId, colId }
```

Reserved/not shipped: row targets, range targets, and wildcard target IDs.

---

## Session API

Set the active principal once per session; subsequent bridge calls read it from
the `ComputeService` session state.

### TypeScript

```ts
import type { AccessPrincipal, Workbook } from '@mog-sdk/node';

await wb.setActivePrincipal(['agent:copilot']);           // flat tag list
await wb.setActivePrincipal({ tags: ['agent:copilot'] }); // envelope form
await wb.setActivePrincipal(null);                        // anonymous

const current: AccessPrincipal | null = await wb.activePrincipal();
const enforcing: boolean = await wb.securityActive();     // false when policy set is empty
const canonical = await wb.makePrincipal(['b', 'a']);     // { tags: ['a', 'b'] }
```

On host-backed TypeScript workbooks, `setActivePrincipal` and `makePrincipal`
throw `OperationDeniedError('HOST_PRINCIPAL_IMMUTABLE')`; the trusted host owns
the session principal.

### Python

```py
wb.set_active_principal(['agent:copilot'])  # list[str]-only; envelope form is TS-only
wb.set_active_principal(None)
wb.security_active()
wb.make_principal(['b', 'a'])
```

`securityActive` / `security_active()` returns `false` while the policy set is
empty. Setting a principal on an empty-policy document does not affect access
decisions because the gated delegate fast path skips policy evaluation. Once any
policy exists, `null` / `None` / an unset principal means anonymous, not owner.

**Cross-language divergence:** TypeScript accepts
`string[] | AccessPrincipal | null` and exposes `activePrincipal()`. Python
accepts `list[str] | None` and does not expose an `active_principal()` getter
today.

---

## Managing policies

`wb.security` is the policy sub-API:

```ts
interface WorkbookSecurity {
  addPolicy(policy: Omit<AccessPolicy, 'id'>): Promise<PolicyId>;
  removePolicy(id: PolicyId): Promise<void>;
  updatePolicy(id: PolicyId, updates: Partial<Omit<AccessPolicy, 'id'>>): Promise<void>;
  getPolicies(): Promise<AccessPolicy[]>;

  getEffectiveAccess(principal: AccessPrincipal, target: AccessTarget): Promise<AccessLevel>;
  explainAccess(principal: AccessPrincipal, target: AccessTarget): Promise<AccessExplanation>;

  applyTemplate(templateId: string, options: Record<string, unknown>): Promise<PolicyId[]>;
  removeTemplate(templateId: string): Promise<void>;
}
```

Policy mutations are workbook-write gated and then attenuation-limited. A caller
with workbook `write` can mutate policy state only up to their own ceiling; a
`write` caller cannot grant `admin`.

`explainAccess` / `explain_access` is diagnostic. The Rust payload includes
effective tags, candidate policies, sorted policies, the matched policy, final
level, reason, optional `ambiguity`, and `clamp_fired`. Python also exposes
camelCase aliases for the common fields. Treat `ambiguity` as the current
bridge signal; do not depend on an older `warnings: string[]` shape.

Template apply payloads use Rust tagged-enum names:
`protect_workbook`, `protect_sheet`, and `agent_structure`. Template removal
uses stored template IDs: `protect-workbook`, `protect-sheet`, and
`agent-structure`.

---

## Enforcement model

### Covered bridge surface

Current enforcement is attached to generated delegate methods on
`compute-api::ComputeService` with `gated = true`. Covered methods are Rust
engine methods annotated with `#[bridge::read(...)]`, `#[bridge::write(...)]`,
or `#[bridge::structural(...)]` in descriptor groups consumed by
`compute/api/src/bridge_service.rs`.

```text
TS / Python SDK
      |  principal forwarding, host checks, error/event adaptation
ComputeService
      |  active_principal + generated gated delegate
YrsComputeEngine
      |  PolicyEngine, AccessMatrixCache, redaction filters
Yrs document storage
```

SDKs do not decide access levels or perform cell redaction. They forward calls,
normalize principal inputs, surface errors, and, in the TypeScript kernel, relay
diagnostic events. A future SDK inherits these checks only if it uses the same
generated `ComputeService` descriptors. REST and Go SDKs are not shipped.

Direct same-process calls that bypass `ComputeService`, new descriptor groups
not added to its delegate list, and non-fallible bridge methods that cannot
return a security error need separate review. In-tree range writes are required
to be fallible; fallible gated writes and structural mutations return
`ComputeError::SecurityDenied` when denied.

### Resolution order

When multiple enabled policies match a query target and the principal's
effective tags, the engine resolves in this order:

1. Target specificity: column > sheet > workbook.
2. Tag specificity: exact tag > prefix glob (`agent:*`) > wildcard (`*`).
3. Priority: higher `priority` wins.
4. Safer tie-break: if the top candidates tie on target, tag, and priority, the
   lower access level wins and an `AmbiguityDetected` diagnostic is emitted.
5. Owner floor: a resolved owner level below `read` is clamped to `read` and
   reported as a clamp diagnostic.

If no policy matches, `mog:owner` defaults to `admin`; all other principals
default to `none`.

---

## Redaction Semantics

Cell and range value reads below `read` generally do not throw. They return typed
redaction values so formula, chart, and UI code can keep running:

| Level on a cell | `get_cell_value` returns |
|-----------------|--------------------------|
| `none` | `CellValue::Null` |
| `structure` | `Text("[Number]")`, `Text("[Text]")`, `Text("[Boolean]")`, `Text("[Error]")`, ... |
| `read` or above | the real value |

Under `structure`, a formula's computed result redacts. Formula shape and some
metadata remain visible; the engine does not claim complete derived-data
non-interference.

Viewport byte buffers use `filter_viewport_buffer`, which writes compact byte
placeholders rather than the `CellValue` strings above. Workbook-scope reads do
a workbook-level access check when the bridge signature can return an error, but
they do not perform per-cell redaction.

---

## Diagnostic Events

Raw engine events are drained through `wb_security_drain_events` with
snake_case `kind` values. The TypeScript kernel relay emits `security:*` events
on its event bus; Python exposes `wb.security.drain_events()`.

| Rust variant | Wire `kind` | Emitted when |
|--------------|-------------|--------------|
| `PolicyAdded` | `policy_added` | `addPolicy` / `add_policy` succeeds |
| `PolicyRemoved` | `policy_removed` | `removePolicy` / `remove_policy` succeeds |
| `PolicyUpdated` | `policy_updated` | `updatePolicy` / `update_policy` succeeds |
| `PoliciesReloaded` | `policies_reloaded` | Policy engine reloads from snapshot or remote Yrs update |
| `AccessDenied` | `access_denied` | A covered fallible write or structural mutation is denied |
| `AmbiguityDetected` | `ambiguity_detected` | Resolution hits a true policy tie or owner clamp diagnostic |

The event stream is diagnostic and bounded. The engine keeps the most recent 256
pending events and drops the oldest if callers do not drain fast enough.

---

## Scope Coverage

Bridge coverage is audited by `compute/api/tests/coverage_audit.rs`: public
bridge methods are expected to declare an access scope, and cell-data surfaces
are checked for explicit scope annotations. This is a regression harness, not a
proof that every derived artifact is non-leaking.

| Scope | Mechanism |
|-------|-----------|
| `cell` | Per-cell matrix lookup; `redact_scalar` over the returned value. |
| `range` | `filter_range_values` over range-shaped `Vec<T>` returns; per-cell matrix walk for value vectors. |
| `sheet` | Sheet matrix lookup; viewport `Vec<u8>` buffers are filtered, while other sheet-scoped reads may be coarse checks or passthroughs. |
| `workbook` | Workbook-level access check for fallible reads; no per-cell redaction. |

### Known gaps and limits

- **Sheet-scope non-byte `Vec<T>` passthrough.** The delegate macro filters
  sheet-scoped viewport byte buffers, but non-byte `Vec<T>` sheet reads fall
  through the passthrough arm. Current examples include `get_unique_column_values`
  and id-based comment APIs such as `get_comments_for_cell`; the position-based
  comment API is cell-scoped and redacts/clears under denied access.
- **Artifact bytes are not fine-grained redacted outputs.** XLSX export methods
  are workbook-scoped and return workbook bytes after workbook read access.
  `capture_screenshot` is range-scoped, but its PNG bytes are not a cell-aware
  redaction format.
- **Derived data is not a hard non-interference guarantee.** Formula read
  results redact at the API boundary, but the evaluator can see source cells
  internally. Aggregate helpers such as pivot computation can reveal derived
  facts from protected source data.
- **Validation/schema reads are shipped.** Schema and validation surfaces are
  bridged and annotated as sheet/cell reads, for example
  `get_range_schemas_for_sheet` and `validate_cell_value`. Treat them as
  structure/metadata surfaces, not as absent APIs.
- **Non-fallible bridge reads cannot deny through an error channel.** New
  workbook-scope reads that need hard denial should use fallible signatures.

---

## Out of Scope by Design

These are deferred deliberately, not by oversight:

- **Encryption at rest.** Separate workstream; orthogonal to access control.
- **Complete derived-data non-interference.** Current redaction is boundary
  redaction, not formula-evaluator isolation.
- **Fine-grained redacted artifacts.** XLSX export, screenshots, and similar
  byte artifacts are not guaranteed to preserve cell-level policy redaction.
- **Row/range targets and wildcard target IDs.** Reserved/not shipped.
- **Audit log persistence.** Diagnostic events are in-memory only.
- **Out-of-process trust boundary.** Today the engine and SDK share a process. A
  compromised SDK process can lie about its principal. Multi-tenant deployments
  need a trusted service between untrusted callers and the engine.

---

## Deeper Reading

| Topic | Source |
|-------|--------|
| Public TS contract types | `types/document/src/security/types.ts`, `types/api/src/api/workbook.ts`, `types/api/src/api/workbook/security.ts` |
| Public SDK exports | `runtime/sdk/src/index.ts`, `runtime/sdk/package.json`, `contracts/package.json` |
| Python surface | `compute/pyo3/python/mog/workbook.py`, `compute/pyo3/python/mog/sub_apis/security.py`, `compute/pyo3/tests/test_security_session.py` |
| Rust policy engine | `compute/core/crates/compute-security/src/` |
| Generated gated delegate | `compute/api/src/bridge_service.rs`, `infra/rust-bridge/bridge-delegate/macros/src/expand/gated.rs` |
| Redaction filters | `compute/core/crates/compute-security/src/filters.rs`, `compute/core/crates/compute-wire/src/security_filter.rs` |
| Coverage and adversarial tests | `compute/api/tests/coverage_audit.rs`, `compute/api/tests/security_e2e.rs`, `compute/api/tests/security_e2e/enforcement.rs`, `compute/api/tests/security_e2e/adversarial_bypass_runtime.rs` |
