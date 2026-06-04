# 038 - Compute Security Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-security/src`

Queue item: 38

Scope: compute-side policy enforcement primitives in the public `compute-security` crate. This includes access levels, principals and tag matching, persisted policy types, policy templates, the pure policy resolver, sheet access matrices, redaction filters, bridge-facing security errors, and event payload types.

Files inspected:

- `compute/core/crates/compute-security/src/lib.rs`
- `compute/core/crates/compute-security/src/engine.rs`
- `compute/core/crates/compute-security/src/error.rs`
- `compute/core/crates/compute-security/src/events.rs`
- `compute/core/crates/compute-security/src/filters.rs`
- `compute/core/crates/compute-security/src/level.rs`
- `compute/core/crates/compute-security/src/matrix.rs`
- `compute/core/crates/compute-security/src/policy.rs`
- `compute/core/crates/compute-security/src/principal.rs`
- `compute/core/crates/compute-security/src/tag_match.rs`
- `compute/core/crates/compute-security/src/templates.rs`
- `compute/core/crates/compute-security/tests/*`
- Adjacent production consumers in `compute/core/src/storage/security_state.rs`, `compute/core/src/storage/engine/security.rs`, `compute/core/src/storage/engine/security_ops.rs`, `compute/api/src/bridge_service.rs`, `compute/api/tests/coverage_audit.rs`, and `infra/rust-bridge/bridge-delegate/macros/src/expand/gated.rs`.

This plan is internal. Implementation belongs in the public `mog` repo, with no dependency on `mog-internal`.

## Current role of this folder in Mog

`compute-security/src` is the pure policy and redaction core for compute-side access control. It intentionally does not know about Yrs, compute-core storage, bridge dispatch, SDK transport, or the principal session slot. Those production integrations wrap this crate through `SecurityState`, `YrsComputeEngine` security primitives, and `bridge_delegate` gated codegen.

The folder currently owns these contracts:

- `AccessLevel`: five ordered levels, serialized as snake-case names and represented by stable `u8` discriminants.
- `Principal`, `PrincipalPool`, and `PrincipalTag`: explicit caller tags, derived `mog:non-owner`, owner detection, and pointer-identity interning for matrix-cache keys.
- `TagMatcher`: exact, prefix-glob, and wildcard tag matching with specificity ordering.
- `AccessPolicy`, `AccessTarget`, `PolicyId`, `PolicyMetadata`, and `AccessPolicyPatch`: the persisted policy wire shape used by `compute-document`'s Yrs `SecurityStore`.
- `PolicyEngine`: deterministic access resolution for workbook, sheet, and column targets, including target specificity, tag specificity, priority, ambiguity warnings, default owner/default deny, and owner-lockout floor.
- `SheetAccessMatrix`: immutable per-sheet column-level access matrix consumed by gated cell/range reads and writes.
- `RedactMaybe`, `redact_scalar`, and `filter_range_values`: post-dispatch read redaction helpers used by generated bridge delegates.
- `Template`: built-in policy bundles such as protect-sheet, protect-workbook, and agent-structure.
- `SecurityError` and `SecurityEvent`: bridge-facing denial, attenuation, policy-change, ambiguity, and policy-reload diagnostics.

The crate already has meaningful direct tests for engine resolution, matrices, tags, principals, templates, wire keys, and legacy TypeScript parity. Production-path E2E coverage lives mostly in `compute/api/tests/security_e2e/*` and bridge coverage audits. The next improvement should therefore strengthen contracts that affect real gated compute calls, not just add isolated unit tests.

## Improvement objectives

1. Make policy enforcement an explicit validated contract, not just a collection of permissive serde structs.
2. Make all principal tag lists canonical and reserved-tag-safe at every entrypoint, including identity-agnostic `Principal::from_tags`.
3. Replace generic range redaction with shape-aware payload redaction so flat ranges, 2D ranges, byte buffers, screenshots, viewport buffers, metadata, and aggregate payloads cannot be accidentally treated as the same shape.
4. Build a complete data-classification contract for every bridged read return type: value payload, formula payload, user-authored annotation, object payload, layout-only shape, binary render output, security metadata, or public workbook metadata.
5. Make `PolicyEngine` resolution deterministic, indexed, and validated without changing the public semantics that tests already pin down.
6. Close binary and rendered-output leakage paths on the production bridge path, especially range-scoped byte outputs and screenshot rendering.
7. Remove ambient time and entropy from hosted template generation paths; production callers should provide provenance timestamps and IDs.
8. Make ambiguity, stale policy references, owner-lockout, and denial diagnostics complete, deduplicated, safe, and visible through all production access paths.
9. Strengthen cross-crate audit gates so a new engine read/write cannot join the bridge without an intentional security scope and redaction classification.

## Production-path contracts and invariants to preserve or strengthen

- `compute-security` remains a pure domain crate. It must not depend on `compute-core`, Yrs, `compute-api`, bridge macros, private repos, or runtime host state.
- `AccessLevel` ordering is security-relevant: `None < Structure < Read < Write < Admin`. Denial, redaction, write checks, attenuation, and owner-lockout must all use the same ordering.
- Default behavior stays fail-closed for non-owners: no matching policy means `AccessLevel::None`. Owner default remains `Admin` unless a matching policy resolves otherwise, subject to the owner-lockout floor.
- The owner-lockout floor must remain explicit and tested. If the intended owner invariant is stronger than "minimum Read", encode that as a deliberate policy contract, not an accidental behavior change.
- `mog:non-owner` is derived for every principal that lacks `mog:owner`, including anonymous callers. It must not be user-spoofable in a way that bypasses owner/non-owner semantics.
- Policy resolution order remains target specificity, tag specificity, priority, then safest level within exact tie groups, with ambiguity surfaced when levels conflict.
- Disabled policies must never match.
- Workbook policies apply to workbook, sheet, and column targets; sheet policies apply to the sheet and its columns; column policies apply only to the exact sheet/column pair.
- Column policy evaluation must be keyed by stable column identity and current column position. Deleted or stale column references must not grant access by accident.
- `PrincipalIdentity` remains valid only for pool-interned principals and matrix cache keys must keep tag slabs pinned to prevent pointer-reuse aliasing.
- Bridge-facing redaction must be compile-time enforced for every gated return type. There should be no blanket pass-through for data-bearing values.
- `Structure` means shape/type visibility without raw payload. User-authored content such as values, formulas, comments, hyperlinks, object text, chart labels, and rendered images must be classified deliberately.
- Workbook/sheet/cell/range/binary read outputs must either be redacted through the correct payload shape or denied before dispatch when no correct redaction model exists.
- Template-generated policies in hosted production paths must use caller-supplied timestamps and IDs; lower layers should not read platform clocks or random sources when the host boundary owns provenance.
- Security errors and events must not expose raw protected cell values, formulas, private host details, or misleading principal identities.

## Concrete implementation plan

1. Define a validation layer for policies, principals, tags, and templates.

   Add explicit validated constructors and validation errors for `PrincipalTag`, `TagMatcher`, `AccessPolicy`, `PolicyMetadata`, `AccessPolicyPatch`, and `Template`. Keep serde compatibility, but ensure deserialized or bridge-supplied values can be normalized and rejected before becoming live policy engine input. Validate tag grammar, empty tags, reserved tags, wildcard placement, priority band ownership, metadata timestamp bounds, template IDs, duplicate policy IDs, and target-specific fields.

   Introduce a `PolicySet` or `ValidatedPolicySet` owned by `PolicyEngine::new_validated`, then make the existing `PolicyEngine::new` delegate through it for trusted test/simple paths. Production rebuilds in `SecurityState` should use the validated path and convert invalid persisted policies into safe skip-plus-diagnostic behavior rather than silently accepting malformed enforcement data.

2. Canonicalize principals across every construction path.

   Make `Principal::from_tags` sort and deduplicate tags exactly like `PrincipalPool::intern`, while retaining its identity-agnostic behavior. If preserving non-canonical order is needed for wire echoing, add a separate explicit type for raw input tags and keep `Principal` canonical.

   Add a `PrincipalKind` or equivalent internal distinction for `Interned` versus `Ephemeral` principals so cache-taking APIs can require interned principals by type where possible. Keep bridge diagnostic APIs able to evaluate arbitrary tag lists without using the cache.

   Move reserved-tag handling into a single contract: callers may either use host-authenticated owner tags or fail closed. Add production tests that prove anonymous, empty, duplicate, reordered, owner, non-owner, and forged-reserved-tag cases resolve identically across `evaluate`, `explain`, `active_matrix`, and bridge `set_active_principal`.

3. Replace `filter_range_values<T>` with shape-aware redaction traits.

   The current generic range filter accepts any `&mut [T]` and assumes one element equals one cell in row-major order. The bridge macro wires every `Vec<...>` range read through this function, which is not a valid contract for `Vec<Vec<CellValue>>`, byte buffers, screenshots, or other non-flat payloads.

   Introduce a trait such as `RedactRangePayload` with implementations for:

   - flat row-major vectors: `Vec<CellValue>`, `Vec<RawCellData>`, `Vec<CellInfo>`, and similar one-element-per-cell payloads;
   - 2D vectors: `Vec<Vec<CellValue>>` and other nested row-major range shapes;
   - optional or result-wrapped range payloads where redaction applies only to successful values;
   - binary viewport buffers through `compute-wire`'s dedicated filter, not through generic `u8` redaction;
   - screenshot/render outputs through a dedicated policy: render from redacted viewport data, return an empty/denied output, or require a fallible API that denies when the selected range is not fully readable.

   Update `bridge_delegate` to call the range-payload trait instead of checking only `return_ty_str.starts_with("Vec<")`. Add compile-fail tests for range reads whose return type lacks a range-redaction implementation.

4. Build a complete bridged-read data classification registry.

   Replace scattered `RedactMaybe` noop impl decisions with an auditable classification table. Each return type surfaced by a gated read should be categorized as one of:

   - cell payload;
   - formula payload;
   - user-authored annotation or object payload;
   - formatting/layout shape;
   - workbook/security metadata;
   - binary viewport/render output;
   - purely structural identifier.

   Revisit current noop classifications. Comments, hyperlinks, object metadata, chart labels, validation messages, table names, slicer labels, and arbitrary JSON metadata are user-authored content unless a product contract explicitly treats them as public structure. For `AccessLevel::None`, data-bearing types should be blank/empty/denied. For `Structure`, they should expose only shape/type placeholders.

   Keep shape-only items visible at `Structure`, but encode the reason in tests and type-level classifications instead of relying on comments near individual impls.

5. Harden binary and rendered-output enforcement.

   Treat binary outputs as their own enforcement category. `Vec<u8>` must not mean "generic vector of scalar bytes" in the security model.

   Concrete targets:

   - sheet-scoped viewport buffers continue through `compute_wire::filter_viewport_buffer`;
   - range-scoped screenshot output should either render from already-redacted `ViewportRenderData`, become a fallible API that denies unless every cell in the range is readable, or return an intentionally blank render for insufficient access;
   - sync/Yrs byte blobs remain workbook-scoped and should be denied before dispatch for insufficient workbook Read through fallible signatures or an explicit safe-public contract;
   - mutation and viewport patch byte outputs must not carry newly hidden cell payloads after a write, undo, import, paste, or recalc.

   Add E2E tests that use the same public bridge calls as SDKs, not direct engine calls.

6. Index and validate policy engine evaluation.

   Keep `PolicyEngine` pure, but store a normalized internal policy index alongside the `Arc<[AccessPolicy]>`:

   - enabled policies by target scope;
   - workbook, sheet, and column buckets;
   - precomputed tag specificity and target specificity;
   - deterministic order keys for explain output and stable ambiguity diagnostics.

   `evaluate`, `evaluate_sheet`, and `explain` should share one resolver path. Avoid repeated full-policy scans per column in `evaluate_sheet`; build candidate groups by current column position once, then resolve each group through the same sort/tie/clamp code.

   Preserve output semantics for all currently tested cases. Add differential tests comparing old scalar evaluation expectations with matrix output for all target/tag/priority/tie combinations.

7. Add stale-target and policy-anomaly diagnostics.

   Today column policies whose `ColId` no longer resolves are silently skipped. Preserve fail-closed access behavior, but expose diagnostics through a safe warning channel so policy authors can find dead rules.

   Add warning types for:

   - stale column targets;
   - duplicate policy IDs or equivalent duplicate policies;
   - malformed skipped policies;
   - reserved-tag policy attempts;
   - owner-lockout clamp;
   - tie ambiguity.

   Keep `AmbiguityWarning` backward-compatible if SDKs depend on it; add new event variants only where the bridge and SDK event relays can carry them.

8. Make template expansion host-owned.

   Replace production use of `Template::generate()` with `generate_with_context` from `security_ops`. The host or security API boundary should supply `created_at_millis` and policy IDs. Keep `generate()` only as a convenience for standalone Rust use and tests, or mark it clearly non-production.

   Add tests proving browser/WASM template expansion never stores `createdAt = 0` because the lower crate lacked a clock. Register every emitted policy in the template priority band and prevent direct app policies from colliding with template/system bands.

9. Unify denial and ambiguity event emission paths.

   Route `wb_security_explain_access`, `wb_security_effective_access`, matrix builds, workbook/sheet/cell/range reads, and writes through a single event-aware evaluation layer where possible. Avoid direct `policy_engine().explain(...)` calls that bypass event handling unless explain is deliberately non-emitting.

   Make denial diagnostics include principal tags, target, operation, required level, actual level, and policy/explanation references when safe. Do not include raw protected values. Deduplicate ambiguity events by policy version, principal tag set, target, and conflicting policies, as `SecurityState` already does for some paths.

10. Strengthen cross-crate security audits.

   Extend `compute/api/tests/coverage_audit.rs` or move it into a reusable contract test so it verifies:

   - every bridged read/write/structural method has an explicit scope;
   - every cell/range/sheet/workbook read return type has a redaction or denial classification;
   - every range read return type implements `RedactRangePayload` or has an explicit deny-before-dispatch policy;
   - non-fallible workbook reads are limited to safe-public metadata or converted to fallible signatures;
   - every write with a cell/range/sheet/workbook scope can emit `AccessDenied` through the user-visible event path;
   - every generated binding target consumes the same security operation descriptors or documents a first-class unsupported disposition.

   The audit should fail on unclassified new surface area, not merely print "manual review" lists.

11. Add security-focused fuzz and property tests.

   Add property tests for tag matcher parsing, principal canonicalization, policy-set normalization, resolver ordering, matrix equivalence, and redaction shape alignment. Generate random policy sets with workbook/sheet/column targets, tag patterns, priorities, disabled flags, and principals, then assert scalar and matrix paths agree for every queried cell.

   Add serde fixture tests for legacy policy JSON, invalid policy JSON, malformed tag matchers, nil/duplicate IDs, missing metadata, extra fields, and reserved tags. Invalid live policies should not produce privilege grants.

12. Add production performance gates after semantic hardening.

   Keep performance work on the real `PolicyEngine::evaluate`, `evaluate_sheet`, matrix lookup, bridge redaction, and viewport/screenshot filters. Do not optimize benchmark-only helpers. Once the indexed resolver and shape-aware redaction are in place, update the existing Criterion bench to include realistic mixed policies, 2D range payloads, large binary viewport redaction, and denied screenshot/render paths.

## Tests and verification gates

Required Rust gates for implementation touching this folder:

- `cargo test -p compute-security`
- `cargo clippy -p compute-security`
- `cargo test -p compute-api` for bridge delegate production-path enforcement, principal state, security E2E, and coverage audits.
- `cargo clippy -p compute-api` when bridge-facing security APIs or generated delegate assumptions change.
- `cargo test -p compute-core` for `SecurityState`, active matrix cache, security events, screenshot/read/write gates, and engine read/write behavior.
- `cargo clippy -p compute-core` for compute-core integration changes.
- `cargo test -p bridge-delegate` if `bridge_delegate` range/read/write codegen changes.
- `cargo clippy -p bridge-delegate` for delegate macro changes.
- `cargo test -p compute-wire` if viewport binary filtering or payload redaction changes.

Focused tests to add or strengthen:

- Policy validation tests for tag grammar, wildcard grammar, reserved tags, duplicate IDs, priority bands, metadata timestamps, template IDs, and malformed persisted policy JSON.
- Principal tests proving `from_tags`, `PrincipalPool::intern`, `anonymous`, active bridge principals, and explanation principals all canonicalize duplicates/order the same way.
- Resolver property tests comparing `evaluate` and `evaluate_sheet` across randomized policies, targets, columns, and principals.
- Matrix tests for stale columns, duplicate `ColId` mappings, out-of-range positions, zero-column sheets, deleted columns, and structure-version invalidation.
- Redaction tests for every `RedactMaybe` and `RedactRangePayload` impl at `None`, `Structure`, `Read`, `Write`, and `Admin`.
- Bridge E2E tests for flat ranges, 2D ranges, mixed-column policies, screenshot output, viewport output, sync byte output, metadata reads, comments, hyperlinks, formulas, charts/objects, and JSON metadata.
- Security event tests that exercise denial and ambiguity through `get_cell_value`, `get_range_values_2d`, workbook reads, writes, explain/effective access, matrix cache hits, and policy reloads.
- Template tests proving `security_ops::wb_security_apply_template` uses host-supplied context and never ambient WASM `0` timestamps on production paths.
- Compile-fail or contract tests proving new bridged range reads cannot compile or pass audits without a range-redaction classification.

Performance gates after correctness:

- Existing `compute-security` Criterion bench updated for indexed resolver and range payload shapes.
- Production-path bridge E2E or benchmark that calls real `ComputeService` methods with security active, not only pure helper functions.
- No perf claim should be based on direct test-only mocks when the production app uses generated delegate calls.

## Risks, edge cases, and non-goals

Risks:

- Tightening validation can expose legacy persisted policies that were previously accepted. The production path should skip invalid policies fail-closed and emit diagnostics before any migration rewrites data.
- Canonicalizing `Principal::from_tags` can change explanation ordering. That is acceptable if the contract states effective tags are canonical, but SDK snapshots must be updated intentionally.
- Reclassifying comments, hyperlinks, object metadata, or screenshots as payload can change visible `Structure` behavior. Product/security should decide the intended visibility category once, then tests should lock it down.
- Replacing generic range filtering requires bridge macro changes and may touch many crates. This is still the right fix because the existing shape assumption is not a security contract.
- Making non-fallible workbook reads deny correctly may require public signature changes or explicit safe-public classifications. Avoid silent default returns as a compatibility shortcut.
- Indexed policy evaluation must preserve ambiguity order, explanation output, and owner clamp behavior. Differential tests should cover this before replacing the current scan-based path.
- More diagnostics can leak policy structure if exposed too broadly. Keep event payloads useful but safe for the principal receiving them.

Edge cases to cover:

- Empty principal tags, duplicate tags, reordered tags, owner plus other tags, explicit `mog:non-owner`, reserved tags in user input, and forged owner attempts.
- Empty tag matcher pattern, `"*"`, prefix globs with empty suffix, internal `*`, multiple `*`, trailing whitespace, non-ASCII tags if allowed, and case sensitivity.
- Policies that target deleted sheets/columns, duplicate policies with same ID, duplicate policies with different ID but identical dimensions, disabled policies, extreme priorities, and overlapping template/app/system priority bands.
- Owner policies that resolve to `None`, `Structure`, `Read`, `Write`, or `Admin`.
- Mixed sheet and column policies where a range spans readable and unreadable columns.
- 2D ranges, jagged 2D ranges, empty ranges, reversed range bounds, and ranges whose return payload length does not match requested bounds.
- Binary payloads where one byte is not one cell: PNG screenshots, viewport buffers, mutation patches, sync state bytes, and arbitrary export bytes.
- Errors returned by read paths that may contain formula/value text.
- Template generation on native, WASM, N-API, and hosted server paths.

Non-goals:

- Do not move Yrs storage or compute-core engine state into `compute-security`.
- Do not create a second policy resolver in `compute-core` or SDK code.
- Do not keep generic redaction pass-throughs for convenience.
- Do not optimize benchmark-only paths as the primary performance outcome.
- Do not add compatibility shims that preserve known leakage behavior.
- Do not expose internal planning content or private repo details through public docs, examples, or code.

## Parallelization notes and dependencies on other folders, if any

This work splits cleanly after the validation and redaction contracts are written down.

- Agent A: implement policy/principal/tag/template validation in `compute-security/src` and add direct crate tests.
- Agent B: implement shape-aware redaction traits in `compute-security/src/filters.rs`, classify all current return types, and add direct redaction tests.
- Agent C: update `infra/rust-bridge/bridge-delegate` to require range-payload classification and to stop treating every `Vec<...>` range read as a flat cell slice.
- Agent D: update `compute-core` production read paths for screenshots, viewport buffers, comments, hyperlinks, formulas, objects, and security events.
- Agent E: update `compute-api` coverage audits and security E2E tests so every bridge method has a hard security classification.
- Agent F: implement indexed policy resolution and matrix equivalence property tests after Agent A's normalized policy contract is available.

Dependencies:

- `compute/core/src/storage/security_state.rs` owns live policy reloads, active flags, matrix caching, ambiguity event deduplication, and policy-version invalidation.
- `compute/core/src/storage/engine/security.rs` owns engine-side `active_matrix`, `effective_access`, `check_write`, and denial event emission.
- `compute/core/src/storage/engine/security_ops.rs` owns bridged policy CRUD, attenuation, templates, effective access, explain access, and event draining.
- `compute/api/src/bridge_service.rs` owns active principal session state and generated bridge delegation for FFI consumers.
- `infra/rust-bridge/bridge-delegate` owns generated gated read/write behavior and must change for shape-aware range redaction.
- `compute/core/crates/compute-wire` owns binary viewport filtering and should remain the binary viewport redaction authority.
- `compute/core/crates/compute-document/src/security_store.rs` owns persisted policy storage and must cooperate with validation and invalid-policy diagnostics.
- SDK/kernel/runtime bridge callers may need updates if workbook security reads become fallible or if data-bearing metadata receives stricter redaction.
