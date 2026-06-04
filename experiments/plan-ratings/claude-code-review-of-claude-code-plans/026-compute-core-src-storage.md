Rating: 8/10

# Review — 026 Harden the Yrs-Backed Storage Layer's Workbook/Sheet/Cell Invariants


## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every concrete claim it
makes about the production code was verifiable against the source on inspection:
the `set_cell` drift path, the `let _ = mirror.apply_structure_change(...)` sites,
the `.ok()`/`.ok()?` property-degradation points, the text-to-columns byte/char
confusion, the locale-number `rfind(...).unwrap()`, the still-reachable global
`STORAGE_ID_ALLOC`, and the per-sheet-pivot TODOs all exist at (or within a line
or two of) the cited locations. The plan correctly identifies the folder's true
central risk — yrs↔mirror divergence under a five-store dispatch — and orders the
work so the coherence fixes that protect everything else land first. The
invariant catalog (I1–I9) is the best part: it converts "intended" properties
into named, enforceable contracts with a single `debug_assert`-gated verifier.

The reason this is an 8 and not a 9–10 is a material analytical error at the
center of Phase 1 (I3), some over-scoping for a single unit of work, and
verification gates that are necessarily deferred. None of these are fatal, but
the I3 premise would mislead an implementer on day one.

## Major strengths

- **Evidence quality.** Citations are precise and checkable, not hand-waved.
  `cells/values/storage_methods.rs:215-242` does gate the yrs write behind
  `if let Some(... YMap ...)` (lines 219–231) while `mirror.apply_edit` runs
  unconditionally (235–241); the `write_identity_formula_to_yrs` failure path is
  a bare `tracing::error!` (229). I1/I2 are accurate verbatim.
- **Right diagnosis of the load-bearing invariants.** The yrs-first ordering,
  the gridIndex bijection, the lazy workbook-child bootstrap (issue #112 LWW
  shadow), and collaborative ID partitioning are exactly the things that make
  the hybrid design correct. Promoting them to a single auditable verifier
  (`verify_storage_invariants`, debug-only) is the correct lever.
- **Schema-compat discipline.** The "read-if-present, never-write" migration
  window for legacy `rows`/`cols`/`rowIndex`/`colIndex` and the explicit framing
  of it as a migration boundary rather than a banned shim is the right call, and
  it is backed by named old-doc round-trip gates.
- **Honors stated non-goals.** "No test-only patch / silent-`None` workaround"
  is restated and the plan keeps to it — it fixes production read/write paths,
  not the symptoms.
- **Sequencing and parallelism are real.** Phase 1→2 sequential (verifier guards
  the migrations), Phase 3's three migrations independent, Phase 4 fully
  independent. This matches the actual coupling in the code.
- **Cross-folder coordination is named.** The `set_cell` fallibility and
  `AxisIdentityMissing` variant crossing the wasm/`@mog-sdk/contracts` boundary,
  and the `compute-collab` provider-replay gate, are both flagged.

## Major gaps or risks

- **I3's core premise is wrong as written.** `mirror.apply_structure_change`
  returns `Vec<RangeId>` (mog/compute/core/src/mirror/structure.rs:24-28), not a
  `Result`. The `let _ =` at `sheet/structural/mod.rs:89,182` and
  `structure_change.rs:129` is discarding the *removed-ranges vector* on the
  insert/no-removal paths — there is no `Err` to "check and propagate." So step 3
  as phrased ("on `Err`, abort the structural transaction") cannot be implemented
  against the current signature. To make I3 enforceable the mirror method itself
  would have to become fallible (a cross-module signature change), or coherence
  would have to be enforced some other way (post-op verifier comparing yrs
  `rowOrder`/`colOrder` to mirror state). The plan only hedges this in the
  parallelization notes ("unless `apply_structure_change` needs a richer error —
  coordinate if so"), which contradicts the confident "must be checked and
  propagated" framing in Phase 1/I3. This is the one place the plan would
  actively misdirect the implementer.
- **Scope is large for one unit.** Four phases spanning ~138k LOC, a fallibility
  signature change threaded through dispatch, two schema migrations, a verifier,
  a new error variant, plus four latent-bug fixes. Phase 1 alone (signature
  change + caller threading + abort semantics) is a sizable change set. The plan
  acknowledges "one change set, no half-migration" for `set_cell` but does not
  estimate effort or propose a landing order *within* Phase 1 beyond the single
  paragraph. A reviewer signing off would want Phase 1 split from Phases 3–4 as
  separately shippable.
- **`apply_edit` fallibility not examined.** Phase 1 makes `set_cell` yrs-first
  and abortable, but `mirror.apply_edit` (mirror/write/cells.rs:158) is invoked
  *after* the txn block closes. To truly guarantee "mirror not updated when yrs
  unreachable," the control flow must move the mirror edit inside the success
  branch and return early on the missing-map case — the plan says this, but does
  not address whether `apply_edit` can itself fail and what happens then. Same
  latent question as I3.
- **`STORAGE_ID_ALLOC` "production caller" set is real but under-characterized.**
  Non-test reachable callers exist (`infra/hydration/styles.rs:448`,
  `sheet/schemas/range_store.rs:95`), and several `sheet/crud.rs` hits are test
  helpers. The plan's "route every non-test, non-import caller through
  `EngineStores`" is right, but it leans on the import pipeline being allowed to
  use a doc-less allocator without resolving whether hydration (styles.rs) counts
  as "import" — that ambiguity decides whether styles.rs:448 is in scope or not.
- **No rollback / feature-gate story.** The schema migrations (Phase 3) change
  what fresh docs write; there is no mention of how to stage or revert if an
  old-doc fixture is missed in the wild. The read-tolerance window mitigates
  forward compat but not "we shipped the writer change and need to back it out."

## Contract and verification assessment

The invariant catalog is the plan's spine and is mostly excellent. I1, I2, I5,
I7, I8, I9 are precisely stated and map to real code. I4 (bijection verifier) is
the right abstraction and correctly scoped to debug builds so it costs no hot-path
time. The verification gates are concrete and falsifiable: the three Phase-1
coherence tests (missing-map → error + untouched mirror; forced
identity-formula failure → absent in both; forced structure-change failure → no
shift) are exactly the regression pins the folder lacks today, and routing
`verify_storage_invariants` into every existing structural/cell test as a
debug-assert gate is a clean way to get broad coverage cheaply.

Weaknesses: (1) the forced-failure tests in Phase 1(b)/(c) presuppose the
failures are *injectable* and *returnable* — but per the I3 finding, structural
mirror failure is not currently representable, so test (c) can't be written
without the prerequisite signature change the plan hasn't committed to. (2) The
"no production path mints from the global allocator" gate is proposed as a
grep-style source assertion or `#[cfg(test)]` poisoning — the latter is good and
enforceable; the former is brittle. Prefer the poisoning approach as the primary
gate. (3) The plan defers all build/test execution (correctly, per its
constraints) but the integration claim ("a clean full app-eval run is the
integration gate") inherits the known deterministic state-leak gotcha it cites —
fine, but it means the gate is only meaningful on a full clean run, which should
be stated as a hard requirement, not an aside.

## Concrete changes that would raise the rating

1. **Fix I3 to match reality.** State that `apply_structure_change` returns
   `Vec<RangeId>` today, and choose one explicit path: (a) change the mirror
   method to return `Result<Vec<RangeId>, _>` (cross-module, list it as a real
   API change with `compute-collab`/`mirror` coordination), or (b) enforce
   structural coherence via the post-op `verify_storage_invariants` comparing
   yrs order to mirror order rather than via an error return. Remove the
   "on `Err`, abort" language until the signature supports it.
2. **Split shippable units.** Make Phase 1 (coherence + signature) its own
   landable change with its own gate, Phase 3 migrations each their own, Phase 4
   bug-fixes each their own. Add a one-line "smallest correct first PR" so the
   work isn't an all-or-nothing 138k-LOC change.
3. **Resolve the import/hydration allocator boundary.** Decide explicitly whether
   `infra/hydration/styles.rs:448` and `range_store.rs:95` are "import" (allowed a
   passed-in partitioned allocator) or "production" (must use `EngineStores`), so
   step 8 is unambiguous.
4. **Address `apply_edit` fallibility** in Phase 1 the same way I3 is resolved, so
   the "mirror untouched on yrs failure" guarantee is end-to-end, not just for
   the navigation-missing case.
5. **Add a migration rollback/staging note** for Phase 3 (e.g. gate the writer
   change behind a flag, or land read-tolerance one release ahead of the
   writer-side removal), and name the specific old-doc fixtures to test against.
6. **Promote the allocator gate** to the `#[cfg(test)]` global-poisoning approach
   as primary, demoting the grep assertion to a secondary lint.
