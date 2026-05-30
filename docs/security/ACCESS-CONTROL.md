# Access Control

Data access control for Mog workbooks. Principals carry tags; policies grant access levels to targets; the Rust engine is the single place that enforces — every SDK inherits enforcement for free.

**Audience:** SDK consumers (TS, Python) wiring a principal into a session, and contributors extending the gated surface.

---

## Model

Four concepts. Everything else composes out of these.

### Principal

A caller's identity, expressed as a set of string tags:

```ts
{ tags: ['mog:owner'] }                 // workbook owner
{ tags: ['agent:copilot'] }             // an agent
{ tags: ['agent:copilot', 'team:ops'] } // multi-role caller
```

Tags are arbitrary strings — the engine only matches them against policy patterns. Principals are **canonicalized** through an intern pool: two principals with the same tag set share an allocation, and pointer equality is a sound cache key. `mog:owner` is reserved — it grants default `Admin` on an empty-policy document.

### AccessLevel

Five levels, ordered:

| Level       | Means                                              |
|-------------|----------------------------------------------------|
| `none`      | No access. Reads redact; writes deny.              |
| `structure` | Shape visible, values redacted. Formulas preserved.|
| `read`      | Values visible. Writes denied.                     |
| `write`     | Read + mutate data.                                |
| `admin`     | Read + write + manage policies.                    |

Higher is strictly more permissive. `level >= Read` is a valid and cheap comparison.

### AccessPolicy

A policy maps a tag pattern to a level at a target:

```ts
{
  principalTag: 'agent:*',     // glob — exact > prefix > wildcard
  target: { kind: 'sheet', sheetId },
  level: 'read',
  priority: 0,
}
```

### AccessTarget

What the policy applies to:

```ts
{ kind: 'workbook' }
{ kind: 'sheet',  sheetId }
{ kind: 'column', sheetId, colId }
// Future: row, range
```

---

## Session API

Four methods on the `Workbook` surface. Set the active principal once per session; every subsequent call inherits it.

### TypeScript

```ts
import type { Workbook, AccessPrincipal } from '@mog-sdk/contracts';

await wb.setActivePrincipal(['agent:copilot']);           // flat tag list
await wb.setActivePrincipal({ tags: ['agent:copilot'] }); // envelope form (symmetric with explainAccess)
await wb.setActivePrincipal(null);                        // clear (anonymous)

const current: AccessPrincipal | null = await wb.activePrincipal();
const enforcing: boolean = await wb.securityActive();     // false when policy set is empty
const canonical = await wb.makePrincipal(['b', 'a']);     // → { tags: ['a', 'b'] }
```

### Python

```py
wb.set_active_principal(['agent:copilot'])  # list[str]-only; envelope form is TS-only
wb.set_active_principal(None)
wb.active_principal()
wb.security_active()
wb.make_principal(['b', 'a'])
```

**Important:** `securityActive` returns `false` when the policy set is empty. Setting a principal on an empty-policy document is a no-op for access decisions (the gated delegate's fast path skips the principal entirely). Once any policy exists, `null` means **anonymous** — a caller that never set a principal is denied, not owner.

**Cross-language divergence (intentional):** TS accepts `string[] | AccessPrincipal | null`; Python accepts `list[str] | None` only. Python callers can always pass `principal['tags']` explicitly.

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

`explainAccess` returns the winning policy, the reason string, all candidate policies considered, and any ambiguity warnings — use it when a user asks *why* a call was denied.

Templates are named policy generators (`protect_workbook`, `protect_sheet`, `agent_structure`, …). Prefer templates over hand-rolled policies for common scenarios.

---

## Enforcement model

### Single-gate principle

Every read and every write passes through exactly one place: the auto-generated delegate layer on `compute-api::ComputeService`. The delegate reads the active principal, calls the engine primitive, and post-filters the result.

```
TS / Python SDK
      ↓  forward method calls only; no security logic
ComputeService   ← active_principal: ArcSwap<Option<Principal>>
      ↓  delegate threads principal + post-filters
YrsComputeEngine ← PolicyEngine, AccessMatrixCache, cell data
```

**The SDKs do nothing security-related.** They forward calls, convert types, surface errors. The SDK's only responsibility is to tell the service *which principal is calling* — via `setActivePrincipal`. This is what makes a new SDK (REST, Go, …) free to add.

### Attenuation

A caller cannot grant more than they have. `addPolicy` with `level: admin` by a `write`-level caller fails with `AttenuationViolation`.

### Resolution order

When multiple policies match, the engine picks in this order:

1. **Specificity** — exact tag > prefix glob (`agent:*`) > wildcard (`*`). Target specificity: column > sheet > workbook.
2. **Priority** — higher `priority` wins.
3. **Safer wins** — on a true tie, the *lower* (more restrictive) level wins, and the engine emits an `AmbiguityDetected` event so the author can fix the policy set.

---

## Redaction semantics

A denied read doesn't throw. It returns a typed placeholder so formulas, charts, and UI code keep working without special-casing:

| Level on a cell | `get_cell_value` returns                           |
|-----------------|----------------------------------------------------|
| `none`          | `""` (empty string)                                |
| `structure`     | `Text("[Number]")`, `Text("[Date]")`, …            |
| `read` or above | the real value                                     |

Under `structure`, a formula's *computed* result also redacts — `B1 = =A1` returns `[Number]` when `A1` is protected. Formula shape is preserved (structure-preserving by design); values are not.

Writes, unlike reads, *do* deny loudly: they return `ComputeError::SecurityDenied` and emit an `AccessDenied` event.

---

## Diagnostic events

Five event variants flow through `wb_security_drain_events`:

| Event                | Emitted when                                      |
|----------------------|---------------------------------------------------|
| `PolicyAdded`        | `addPolicy` succeeds                              |
| `PolicyRemoved`      | `removePolicy` succeeds                           |
| `PolicyUpdated`      | `updatePolicy` succeeds                           |
| `PoliciesReloaded`   | Matrix rebuild on snapshot load or version bump   |
| `AccessDenied`       | Every write denied by the gate, with `operation` = caller's method name (`"set_cell_value_parsed"`, `"clear_range"`, …) |
| `AmbiguityDetected`  | Matrix-publish or evaluate resolves a true tie. Fingerprint-deduped per `policy_version` so a noisy UI doesn't drown the stream. |

Drain the stream periodically to drive diagnostic UIs ("this call was denied because …"). The drain is lossless — events buffer until you pull them.

---

## Scope coverage

Every bridged method returning cell data is gated. This is enforced **statically** by `coverage_audit.rs` — if a new bridge read annotation forgets to declare its scope, the audit fails the build.

| Scope      | Mechanism                                                 |
|------------|-----------------------------------------------------------|
| `cell`     | Per-cell matrix lookup; `redact_scalar` over the result. |
| `range`    | Viewport filter: `filter_viewport_buffer` on byte-vec returns; per-cell matrix walk. |
| `sheet`    | Matrix lookup at sheet granularity. |
| `workbook` | Matrix lookup at workbook granularity. |

### Known gaps

- **Sheet-scope `Vec<T>` non-byte passthrough.** The delegate macro at `infra/rust-bridge/bridge-delegate/macros/src/expand.rs:926-939` only redacts byte-vec returns at sheet scope. Non-byte `Vec<T>` returns (e.g., `Vec<Comment>`, `Vec<CellValue>`) pass through. Affects `get_comments_for_cell` and `get_unique_column_values`. The adversarial test `adversarial_comment_redacts_under_none_id_form` pins the current passthrough shape so a future macro fix flips the signal.
- **`data_validation` family has no bridged read today.** When such a surface is added, it must carry `#[bridge::read(scope = …)]` like every other read — otherwise `coverage_audit` will fail.

---

## Out of scope by design

These are deferred deliberately, not by oversight:

- **Encryption at rest.** Separate workstream; orthogonal to access control.
- **Rust compute-path enforcement.** The formula evaluator currently sees through denied cells internally; redaction happens at read time. Rejected because evaluator-side per-cell-per-formula access checks would kill recalc performance.
- **Row-level targets.** No user ask yet; matrix extension is straightforward when needed.
- **Audit log persistence.** The diagnostic event stream is in-memory only. Persistence is future work.
- **Out-of-process trust boundary.** Today the engine and SDK share a process. A compromised SDK process can lie about its principal. Multi-tenant server-side deployments need a trusted service between untrusted SDKs and the engine — reserved, not shipped.

---

## Deeper reading

| Topic | Document |
|-------|----------|
| Contract types (TS) | `contracts/src/security/` + `contracts/src/api/workbook/security.ts` |
| Python surface | `compute/pyo3/python/mog/workbook.py:1404-1431` |
| Coverage audit test | `compute/api/tests/coverage_audit.rs` |
| End-to-end scenarios | `compute/api/tests/security_e2e.rs` |
