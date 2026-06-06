# Plan 038 — Harden `mog/compute/core/crates/compute-security/src` (compute-side policy enforcement)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-security/src`
- **Crate:** `compute-security` (`version 0.1.0`, `publish = false`), described in `Cargo.toml` as *"Privacy policy types and access-control engine for compute-core"*.
- **Files in scope (11):**
  - `lib.rs` — module wiring + the crate's public re-export surface.
  - `level.rs` — `AccessLevel` linear lattice (`None=0 … Admin=4`, `#[repr(u8)]`).
  - `policy.rs` — `AccessTarget`, `PolicyId`, `PolicyMetadata`, `AccessPolicy`, `AccessPolicyPatch` (Yrs wire shapes + serde).
  - `principal.rs` — `PrincipalTag`, `SortedTagList`, `PrincipalIdentity`, `Principal`, `EffectiveTags`, `PrincipalPool` (intern pool keyed by canonical tag set).
  - `tag_match.rs` — `TagSpecificity`, `TagMatcher` (the glob matcher).
  - `engine.rs` — `PolicyEngine` (the resolution core: `evaluate`, `evaluate_sheet`, `explain`) plus `EvalResult`, `AccessExplanation`, `ExplainReason`.
  - `matrix.rs` — `SheetAccessMatrix` (per-column access snapshot) + the `ColumnIndex` adapter trait.
  - `filters.rs` — `RedactMaybe` trait + per-type impls; `redact_scalar`, `filter_range_values`.
  - `events.rs` — `AmbiguityWarning`, `SecurityEvent` shapes (consumed downstream).
  - `error.rs` — `SecurityError` + lowering to `value_types::ComputeError`.
  - `templates.rs` — `Template` bundles (`ProtectSheet` / `ProtectWorkbook` / `AgentStructure`), priority-band constants, `PolicyTemplateContext`.
- **This crate is the pure policy core.** Per the `lib.rs` header it has *no* knowledge of Yrs or `compute-core`; the stateful wiring (`SecurityState`, the `ArcSwap<PolicyEngine>`, the `AccessMatrixCache`) lives in `compute-core` (`storage/security_state.rs`, `storage/security_cache.rs`, `storage/engine/security_*.rs`). The crate's only persistent neighbours are `cell-types`, `value-types`, `domain-types`, `snapshot-types`.
- **Verified downstream consumers (via `rg`):** `compute-core` storage layer (`security_state.rs`, `security_cache.rs`, `security_ops.rs`, `security_events.rs`, `cell_semantics.rs`), `compute-document/src/security_store.rs`, `compute-wire/src/security_filter.rs`, the bridge surfaces (`compute/{napi,pyo3,wasm}/src/lib.rs`, `compute/api/src/bridge_service.rs`), and the `compute/api/tests/security_e2e/*` adversarial suite.
- **Existing test/bench assets (out of edit scope, but the verification target):** `crates/compute-security/tests/{engine,legacy_ports,level,matrix,principal,tag,templates}.rs` and `benches/engine.rs` (which pins the §12 latency budgets).

## Current role of this folder in Mog

`compute-security` is **Layer 2** of Mog's documented three-layer access-control stack — the data-policy / value-filter layer that sits between the API capability gate (Layer 3) and spreadsheet cell-protection (Layer 1). It owns three responsibilities:

1. **Policy vocabulary & wire shapes.** `AccessPolicy` and friends are the exact byte-shapes persisted into the Yrs `security.policies` map. `policy.rs` deliberately pins camelCase wire keys (`principalTag`, `createdBy`, `createdAt`, `sheetId`/`colId`, snake_case target discriminants) to the legacy TS kernel format so existing documents round-trip without migration — this is asserted by the in-file `access_policy_wire_keys_are_camel_case` test.
2. **Resolution.** `PolicyEngine` is a *pure, stateless* resolver. Given a `Principal` (tag set) and an `AccessTarget`, it filters enabled+applicable+tag-matching policies, sorts by `(target specificity, tag specificity, priority)`, applies the SG-3 tie-break (*pick the safest/lowest level among the top tie group*), applies the §4.1 step-5 owner-lockout floor (clamp owners up to `Read`), and emits an `AmbiguityWarning` when a tie spans distinct levels. `evaluate_sheet` builds a per-column `SheetAccessMatrix`; `explain` returns the full derivation trace.
3. **Redaction.** `filters.rs` is the post-filter applied to gated engine read results. `RedactMaybe` deliberately has **no blanket impl** (a documented R4 decision): a missing impl is a *compile error at delegate-macro expansion*, so a new engine return type cannot ship as a silent passthrough. `None` → typed null/empty; `Structure` → type placeholder (`[Number]`, `[Text]`, …) matching legacy `viewport-filter.ts`; `Read`+ → identity.

The matrix cache and `SecurityState` key on `Principal::identity()` (a raw interned-slab pointer) plus policy/structure version counters, which is why `Principal` is intentionally non-`Serialize` and why `PrincipalPool` exists.

### Evidence-backed problems found

1. **`TagMatcher::parse` silently misclassifies non-trailing globs as exact patterns — a policy-authoring footgun that fails open.** `tag_match.rs:29` classifies a pattern as `Wildcard` only for exactly `"*"`, `PrefixGlob` only when it `ends_with('*')`, else `Exact`. A pattern like `agent:*:reader`, `*:admin`, or `a*b` is therefore treated as a *literal* exact string and will never match any real tag. There is no validation surface and no error path — a misauthored matcher silently matches nothing, so a policy intended to *restrict* a class of principals simply never fires, and resolution falls through to the default path (owner→`Admin`, else `None`). For a *deny*-style policy this is a silent security regression, not a loud failure. `PrefixGlob` also only strips a single trailing `*`; `**` collapses to "prefix = one trailing star kept", and an empty pattern `""` becomes `Exact` matching only the empty tag.

2. **`filter_range_values` fails open on a length mismatch.** `filters.rs:386` computes `expected = rows*cols` and iterates `values.len().min(expected)`. If a caller passes `values.len() > expected` (a row/col-bounds bug upstream, or a range whose buffer was built with stale dimensions), the **trailing `values.len() - expected` elements are never visited and pass through un-redacted** — raw cell payload for a principal who may have `None` access. This is the one place in the crate where a coordinate/buffer mismatch leaks data instead of denying it. The fast `is_uniform()` path is safe (it redacts the whole slice), but the per-cell slow path is not.

3. **`PolicyEngine::evaluate_sheet` is O(P²) in the number of column policies and re-sorts the full candidate list per column.** `engine.rs:143` loops over *every* policy; for each column-targeted policy it calls `filter_candidates` (a full O(P) scan of `self.policies`) and `resolve` (which `to_vec`s and `sort_by`s the candidates). For a sheet with *k* distinct column policies this is `O(k·P·log P)`. The `benches/engine.rs` budget is `evaluate_sheet` with 100 policies `< 50 µs`; a workbook with hundreds of column-scoped policies (a realistic enterprise "lock these 40 PII columns for these 6 agent classes" configuration) can blow that budget, and the matrix is rebuilt on every policy-version bump and every cold cache miss.

4. **`PrincipalIdentity` is a raw slab pointer with a documented, caller-dependent aliasing window.** `principal.rs:183` derives identity from `Arc::as_ptr(&self.tags) as usize`. The `PrincipalPool` holds only `Weak` references, so a dropped principal's slab can be freed and a *different* tag set can be allocated at the same address, yielding a `PrincipalIdentity` that compares equal to an unrelated principal. The crate documents that the cross-crate `AccessMatrixCache` must pin the slab via `tags_arc()` to keep the window closed — i.e. **soundness depends on every caller remembering to pin.** The `__test_from_raw` back-door exists precisely to simulate address reuse. This is a correctness invariant enforced by prose, not by the type system.

5. **The priority bands (`PRIORITY_APP_*` / `PRIORITY_TEMPLATE_*` / `PRIORITY_SYSTEM_MIN`) are documented but unenforced.** `templates.rs:20-27` defines the bands and asserts the invariant *"every policy emitted by a template falls in `[100,199]`; app policies live below; system above"* — but nothing in `policy.rs` or `engine.rs` validates that an `AccessPolicy.priority` actually respects its provenance. An app-authored policy can be constructed with `priority = 10_000`, landing it above the system band, where it can *outrank an owner hard-lock or a template protection*. Because resolution sorts on `priority` as the final tie-break, this silently inverts the intended precedence.

6. **`RedactMaybe for Result<T, E>` ignores the error arm.** `filters.rs:196` redacts only the `Ok` value and passes `Err(E)` through untouched. If any gated engine read returns `Result<_, E>` where `E` carries cell-derived context (an error message embedding a value, a not-found payload echoing a key), that content reaches a denied principal unredacted. The current corpus may not exercise this, but the blanket-removal design philosophy ("a missing/weak impl must be impossible to ship silently") is undercut by an impl that is present but incomplete.

7. **`explain` re-derives the resolution independently from `evaluate`, risking drift.** `engine.rs:191` rebuilds candidates, sorts a second copy (`sorted_refs`), and calls `resolve` again, then post-processes `reason`. `evaluate` and `evaluate_sheet` each call `resolve` through their own paths. The three entry points share `resolve`, but `explain` *additionally* re-sorts for display and re-implements the `NoTags` reason adjustment that `evaluate` never applies — so `explain`'s `reason` can diverge from what `evaluate` would "mean" if it surfaced one. There is no single function that returns *both* the `EvalResult` and the `AccessExplanation` from one derivation, so the diagnostic trace and the enforced decision are computed twice and only kept in sync by convention.

8. **`arc-swap` is declared as a dependency but unused in this crate's `src`.** `rg arc_swap src/` finds only doc-comment mentions (describing `SecurityState` *in `compute-core`*). The `arc-swap = "1"` line in `Cargo.toml` is dead weight that bloats the dependency graph and misleads readers into thinking the `ArcSwap` lives here.

9. **`SheetAccessMatrix` carries an unused `row` dimension and an un-bitpacked layout.** `matrix.rs:65` `get(_row, col)` ignores `row`; the doc comments at `level.rs:6` and `matrix.rs:6` both advertise a 3-bit/cell bitpacking and reserved row/cell slots that are not implemented. This is acceptable as *reserved future scope*, but the dead `row` parameter is threaded through `filter_range_values` and invites callers to believe row-level enforcement exists when it does not.

## Improvement objectives

1. **Make tag-pattern authoring fail loud, not silent.** Give `TagMatcher` a validating constructor that rejects (or explicitly classifies) interior/multi-`*` patterns, so a misauthored matcher surfaces an error at policy-creation time instead of silently matching nothing.
2. **Close the range-filter fail-open.** `filter_range_values` must never pass a value through on a length/coordinate mismatch; on mismatch it must fail safe (redact the remainder at the most restrictive applicable level) and assert in debug.
3. **Bring `evaluate_sheet` to a single-pass, near-linear build** that respects the §12 budget for large column-policy sets without changing resolution semantics.
4. **Strengthen `PrincipalIdentity` soundness** so a correct cache key does not depend on every caller remembering to pin the slab.
5. **Enforce the priority-band ⇄ provenance invariant** at construction so an app policy cannot silently outrank a system/owner hard-lock.
6. **Complete redaction coverage** for `Result`'s error arm and audit every `RedactMaybe` impl against a "no payload reaches a sub-`Read` principal" property.
7. **Unify the decision and the explanation** so `explain` and `evaluate` provably derive from one resolution pass.
8. **Remove the dead `arc-swap` dependency** and tighten the `matrix.rs` row-dimension story.
9. Throughout: **preserve every wire shape and resolution semantic** the downstream cache, `SecurityStore`, and `security_e2e` adversarial suite depend on.

## Production-path contracts and invariants to preserve or strengthen

**Preserve exactly (wire-breaking if changed):**
- The serde shapes of `AccessPolicy`, `PolicyMetadata`, `AccessTarget`, `AccessPolicyPatch`, `Template`, `AmbiguityWarning`, `SecurityEvent`, `AccessExplanation`, `ExplainReason`, `EvalResult`. The camelCase keys, snake_case target/level discriminants, `PolicyId` transparent-UUID form, and `created_at`→`created_at_millis` rename are pinned by `policy.rs` tests and by every persisted document. Additive only.
- The `AccessLevel` `#[repr(u8)]` discriminants (`None=0 … Admin=4`) and the linear ordering they encode — load-bearing for the lattice comparisons (`< AccessLevel::Read`), the safest-wins tie-break, and the documented 3-bit packing.
- Resolution semantics: SG-1 (`mog:non-owner` derivation), SG-2 (specificity ordering exact > prefix > wildcard), SG-3 (safest-level tie-break + ambiguity emission), and §4.1 step-5 (owner clamp to `Read`, with its accompanying ambiguity warning). The `compute/api/tests/security_e2e/adversarial_*` suite pins these.
- `Principal` remaining **non-`Serialize`/`Deserialize`** (the identity-foreign-slab hazard documented at `principal.rs:96`). Any identity strengthening must not re-introduce serde on `Principal`.
- The "no blanket `RedactMaybe`" guarantee — fixing `Result` must not weaken the compile-time "missing impl = build error" property.
- Template priority band `[100,199]` and `created_by = "mog:system"` stamping; `generate_with_context` keeping clock/entropy at the host boundary (no platform-clock read in the hosted path).
- The `ColumnIndex` trait boundary: the engine stays Yrs-agnostic; column-id→position resolution is injected.

**Strengthen (new invariants to add, behind tests):**
- A `TagMatcher` either parses to one of the three known specificities *or* is rejected — no "silently matches nothing" third state.
- `filter_range_values` is fail-safe under length mismatch.
- `PrincipalIdentity` equality implies tag-set equality (no pointer aliasing).
- `priority` is bounded by provenance for system/template policies.

## Concrete implementation plan

> All edits are within `compute-security/src` unless explicitly noted. Steps are ordered so each is independently reviewable and lands without breaking the wire contract. Production-path fixes only — no shims, no test-only patches.

**Step 1 — `tag_match.rs`: validating matcher.**
- Add `TagMatcher::try_parse(&str) -> Result<Self, TagPatternError>` that classifies `"*"` → `Wildcard`, a pattern with exactly one trailing `*` and no other `*` → `PrefixGlob`, a pattern with no `*` → `Exact`, and **rejects** any pattern with an interior or multiple `*` (or an empty string) with a typed `TagPatternError`.
- Keep `parse(&str) -> Self` as the infallible constructor but redefine its behaviour for currently-misclassified inputs: it should call `try_parse` and, on error, fall back to a **definitively non-matching but loud** classification is *not* acceptable (that is the current silent failure); instead make the *policy mutation path* (`SecurityStore::add_policy`/`update_policy` in `compute-document`, see Step 9 coordination) call `try_parse` and reject. Internally `parse` can keep `Exact` for back-compat of already-persisted docs, but emit a one-time structured warning (via a returned diagnostic, not a log in this pure crate) when an interior `*` is seen so existing bad policies are observable rather than invisible.
- Add `TagPatternError` to a new `tag_match` error or fold into `SecurityError` (see Step 7). Document the grammar in the module header.

**Step 2 — `filters.rs`: close the range fail-open.**
- In `filter_range_values`, when `values.len() != expected`, do not silently truncate. Add `debug_assert_eq!(values.len(), expected, ...)`. For the release path, redact **every** element beyond `expected` at the most restrictive level present in the matrix (`matrix.most_restrictive()` — a new cheap helper that returns `min(sheet_default, min(col_overrides))`), so a buffer longer than the coordinate space can never leak. Elements within `expected` keep per-cell resolution.
- Add `SheetAccessMatrix::most_restrictive()` to `matrix.rs`.

**Step 3 — `filters.rs`: complete `Result` redaction.**
- Change `impl<T: RedactMaybe, E: RedactMaybe> RedactMaybe for Result<T, E>` to redact both arms (require `E: RedactMaybe`). Audit existing engine return types that are `Result<_, E>` to confirm `E` already has (or now needs) a `RedactMaybe` impl; for error types that are pure metadata, add an explicit documented `redact_noop!` impl so the compile-time completeness guarantee is preserved rather than bypassed. If a concrete `E` is found to carry cell payload, give it a real redacting impl.

**Step 4 — `engine.rs`: single-pass `evaluate_sheet`.**
- Replace the per-column `filter_candidates`+`resolve` loop with one pass: (a) compute the sheet default once (unchanged); (b) partition `self.policies` into a single filtered+sorted candidate list per *applicable column position* by grouping column-targeted, tag-matching, enabled policies by resolved `position`, building each position's candidate vector in one walk; (c) run `resolve` once per touched position over its pre-built group. This removes the repeated full-list scan/sort. Net complexity `O(P log P + touched·g log g)` where `g` is the per-column group size. Resolution output must be **identical** — guard with a property test comparing old vs new on random policy sets.
- Pre-size `col_overrides`/`touched` (already done) and reuse the `effective` tag vector (already hoisted).

**Step 5 — `principal.rs`: sound identity.**
- Make `PrincipalIdentity` carry a content discriminator in addition to (or instead of) the raw pointer — e.g. a 64-bit hash of the canonical `SortedTagList` computed once at intern time and stored alongside the slab, so identity equality implies tag-set equality even across address reuse. The pool already canonicalises; store the hash in the interned record and expose it through `identity()`. Keep `identity()` `Copy`/`Eq`/`Hash` and keep `tags_arc()` for the cache's lifetime pin (defence in depth), but the cache key correctness should no longer *depend* on the pin.
- Retain `__test_from_raw` for the existing cross-crate aliasing regression test, adapting it to also accept/forge the discriminator.
- Confirm `Principal` stays non-serde.

**Step 6 — `policy.rs` + `templates.rs`: enforce priority bands.**
- Add a `PolicyProvenance` notion (App / Template / System) or a validating `AccessPolicy::validate_priority(provenance) -> Result<(), SecurityError>` and call it on the mutation path (Step 9). Templates already emit in-band; add a debug assertion / unit test that `Template::generate*` output is always within `[PRIORITY_TEMPLATE_MIN, PRIORITY_TEMPLATE_MAX]`. Reject app-authored policies whose `priority >= PRIORITY_SYSTEM_MIN` at the store boundary unless an explicit system flag is set.

**Step 7 — `error.rs`: extend the error surface coherently.**
- Add `SecurityError::InvalidTagPattern { pattern, reason }` (and/or `InvalidPriority { priority, band }`) and lower them to `ComputeError::SecurityDenied`/a suitable variant via the existing `From` impl, keeping the flat-string bridge shape. Ensure SDK error re-hydration (`compute/api/src/error.rs`) maps the new variants.

**Step 8 — housekeeping.**
- Remove `arc-swap = "1"` from `compute-security/Cargo.toml` (it is unused in `src`; the `ArcSwap` lives in `compute-core`). *Note: editing `Cargo.toml` is a production change to be made by the implementing engineer, not in this planning pass.*
- In `matrix.rs`/`filters.rs`, either implement nothing new for rows (keep reserved) but rename the parameter to `_row` consistently and tighten the doc to state plainly "row/cell overrides are not yet enforced; `row` is reserved", so no caller assumes row-level protection is active.

**Step 9 — cross-crate coordination (read-only awareness; edits land in neighbour crates by their owners).**
- The validating constructors from Steps 1 & 6 must be invoked at the mutation boundary in `compute-document/src/security_store.rs` (`add_policy`/`update_policy`) and surfaced through `compute-core/src/storage/engine/security_ops.rs` and the bridge (`compute/api/src/bridge_service.rs`). This plan defines the crate-local API; the wiring change is a coordinated follow-up in those crates.

## Tests and verification gates

- **In-crate unit tests** (`tests/tag.rs`, `tests/engine.rs`, `tests/matrix.rs`, `tests/principal.rs`, `tests/templates.rs`): add cases for interior-`*` rejection, empty-pattern rejection, `filter_range_values` over-length fail-safe, `Result` error-arm redaction, priority-band validation, and identity-without-aliasing.
- **Differential property test** for Step 4: random policy sets × random `(principal, sheet, ColumnIndex)` — assert the new single-pass `evaluate_sheet` produces byte-identical `SheetAccessMatrix` (default, overrides, warnings ordering) to the current implementation. Include the SG-3 tie + clamp + ambiguity ordering.
- **Resolution-equivalence test** for Step 7: `explain(p,t).level == evaluate(p,t).level` and `explain` `matched`/`ambiguity` agree with `evaluate` for a generated policy corpus.
- **Wire-shape regression:** the existing `access_policy_wire_keys_are_camel_case` / `*_serde_round_trip` tests must stay green unchanged; add a serde round-trip for any new error variant that crosses the bridge.
- **Benchmarks** (`benches/engine.rs`): re-run the `evaluate_sheet`/matrix/viewport budgets; the Step-4 change must keep the 100-policy `evaluate_sheet` under the §12 50 µs target and demonstrably improve the high-column-count case (add a 500-column-policy bench point).
- **End-to-end adversarial suite:** `compute/api/tests/security_e2e/{adversarial_core,adversarial_bypass_runtime,enforcement,events_ambiguity,principal_identity,composition}.rs` must all pass unchanged — these are the real regression net for the wire/semantic contracts.
- **Verification commands** (run by the implementing engineer, *not* in this planning pass): `cargo test -p compute-security`, `cargo test -p compute-core security`, the `security_e2e` suite, `cargo bench -p compute-security`, and `cargo clippy -p compute-security`.

## Risks, edge cases, and non-goals

- **Wire compatibility is the dominant risk.** Already-persisted documents may contain policies with interior-`*` matchers or out-of-band priorities. The validating constructors must apply to *new* mutations only; loading an existing doc must not hard-fail. Step 1 explicitly keeps `parse` infallible for the load path and only rejects at the mutation boundary — verify against a fixture corpus before enabling rejection.
- **Identity change ripple (Step 5):** the `AccessMatrixCache` and any consumer that stores `PrincipalIdentity` must be re-checked; changing identity's derivation could invalidate cache entries on upgrade (acceptable — cache is rebuildable) but must not change *equality semantics* for live principals. Coordinate with `compute-core/src/storage/security_cache.rs`.
- **`evaluate_sheet` rewrite must be semantics-preserving** — the differential test is the gate; do not ship without it. The `touched`-position dedupe and the ambiguity-warning ordering (sheet warning first, then column warnings in policy-iteration order) are observable and pinned by `events_ambiguity`.
- **Performance regressions in the common (few-policy) case:** the single-pass rewrite must not pessimise the dominant zero/one-policy workbook path; keep the early-out when no column policies exist.
- **Non-goals:** implementing row-/cell-level overrides (reserved future phase — only the doc/`_row` tightening is in scope); bitpacking the matrix (a separate, profile-driven optimisation explicitly deferred by `matrix.rs`); changing the lattice or adding new `AccessLevel` variants; moving any enforcement into TS; introducing a regex dependency for tag matching (the O(len) matcher is a deliberate design choice).

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this crate:** Step 1 (tag matcher), Step 2/3 (filters), Step 4 (engine perf), Step 5 (identity), Step 6 (priority bands), Step 8 (housekeeping) touch largely disjoint files and can proceed concurrently; Step 7 (error surface) should land first or alongside Steps 1 & 6 since they add variants it must carry.
- **Downstream dependencies (must be sequenced after the crate-local API exists):**
  - `compute-document/src/security_store.rs` — invoke the validating constructors (Steps 1, 6).
  - `compute-core/src/storage/{security_cache.rs, engine/security_ops.rs}` — adopt the new `PrincipalIdentity` (Step 5) and surface validation errors (Step 7).
  - `compute/api/src/{error.rs, bridge_service.rs}` and `compute/{napi,pyo3,wasm}/src/lib.rs` — map any new `SecurityError`/`ComputeError` variants to the SDK surface.
- **Upstream (no changes required):** `cell-types`, `value-types`, `domain-types`, `snapshot-types` sit below this crate and are untouched; the `From<SecurityError> for ComputeError` lowering already bridges the layering correctly.
- **Plan 003 alignment:** the TS-side `@mog-sdk/contracts/security` plan (003) proposes pinning the TS↔Rust `AccessLevel` discriminant alignment; the `level.rs` work here is the source-of-truth side of that invariant — coordinate so neither side drifts.
