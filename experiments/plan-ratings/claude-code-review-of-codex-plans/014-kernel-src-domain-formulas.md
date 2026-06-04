Rating: 8/10

# Review of `014-kernel-src-domain-formulas.md`

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about the current code checks out against the actual source: `named-ranges.ts` really does hand-map Rust wire data with `any` and duplicates identity-ref conversion (lines 55–147, 445–504); `create` does call the upsert-style `setNamedRange` and then issues a second `updateNamedRange` purely to attach a comment (lines 520–537); `importNames` does fire-and-forget `void ctx.computeBridge.setNamedRange(...)` in a loop and returns an optimistic count (lines 642–660); `removeByScope` resolves names in TS and calls the by-name `removeNamedRange(name.name)` (line 616); `evaluateValue` is a literal stub returning `undefined` (lines 327–334); and the reads (`getByName`, `getById`, `getByScope`, `resolve`, `validate`) all scan `getAll()` despite direct scoped bridge queries existing.

Critically, the plan's proposed targets are real. I confirmed `createNamedRange`, `updateNamedRange`, `removeNamedRangesByScope`, `importNamedRanges`, `getNamedRangeByName`, `getNamedRangeById`, `getNamedRangesByScope`, `validateNamedRangeName`, `resolveNamedRange`, `getNamedRangeTypedValue/Type/ArrayValues/DisplayValue`, plus the table mutations (`renameTable`, `renameTableColumn`, `removeTableColumn`, `convertTableToRange`, `deleteTable`) all exist in `compute-bridge.gen.ts`. The `structured-ref-updater.ts` no-ops are genuinely consumed by `tables/core.ts` and `tables/operations.ts`, alongside `void ctx.computeBridge` table mutations. Even the verification-gate test files are real: `sheet_scoped_named_range.rs`, `stress_tables_named.rs`, `range_dependency_tracking.rs`, and the `structured_ref_updater/` source module all exist. This is a rare plan where the gates are not invented.

It loses points for scope sprawl and one deferred architectural fork, detailed below.

## Major strengths

- **Diagnosis is accurate and specific.** It names files, functions, and the exact anti-patterns, and the proposed replacement APIs already exist — this is a consolidation/wiring plan, not speculative greenfield work, which materially lowers execution risk.
- **The contracts/invariants section (lines 56–68) is the best part.** Identity-based storage for CRDT safety, A1 derived from identity, sheet-scope precedence, case-insensitive scoped namespaces, atomic rename+formula-rewrite in Rust, metadata preservation on update, scope-precise deletion, awaited bulk import. These are the correct invariants and they are stated as testable assertions.
- **The rename-atomicity insight is correct and important.** The plan reinforces what the code comment at `named-ranges.ts:563–569` already warns: rename must not be split into remove+set or dependents orphan into `#NAME?`. Keeping this in one Rust mutation is the right call and the plan defends it explicitly.
- **"No `void` bridge writes in formula-domain paths" (line 94)** is a genuine correctness fix, not cosmetic — fire-and-forget writes let callers observe completion before Rust has persisted, which is a real source of import/count bugs.
- **Non-goals are disciplined** (no parser work, no formula-function accuracy, no UI redesign, no compatibility aliases for the no-op behavior), which keeps the blast radius defensible.
- **The string-literal / escaped-bracket regression test (line 140, 164)** shows the author understands that the Rust structured-ref rewriters are string rewriters with real false-positive hazards.

## Major gaps or risks

- **The single most important decision is deferred.** Step 1 (lines 74–76) leaves "either extend `createNamedRange`/`updateNamedRange`/`importNamedRanges` to preserve identity-backed storage, or add explicit identity-backed commands and retire `setNamedRange`" as an open either/or. This is the architectural fork the whole plan pivots on — whether the existing `createNamedRange` already round-trips identity refs + raw_expression + comment, or whether the kernel must keep using `setNamedRange`. A reviewer cannot tell from the plan whether `createNamedRange` is fit for purpose. The plan should have inspected the existing `createNamedRange`/`DefinedNameInput` shape and committed to one path. As written, the riskiest design question is handed to the implementer.
- **Scope sprawl vs. the "folder" framing.** Although nominally scoped to `kernel/src/domain/formulas`, the plan actually coordinates kernel TS, `bridges/compute`, `domain-types` Rust, `compute/core` storage + mutation handlers, `domain/tables`, and `file-io/xlsx`. That is correct given the folder is a thin facade, but it makes this a 5-agent multi-subsystem effort. The "source folder" lens undersells the true surface area and the coordination cost.
- **Cross-agent contract coupling.** The parallelization (lines 172–179) has Agent B (TS facade) and Agent E (API tests) both blocked on Agent A's bridge-contract decision, and Agent D's count metadata depends on Agent C's `MutationResult.data` shape. The plan acknowledges dependencies but does not define the freeze point — i.e., the concrete TS/Rust type signatures all agents code against — so parallel work risks churn until Agent A lands.
- **No explicit definition of done beyond "gates pass."** There are no before/after API signatures, no acceptance criteria for "facade is now thin" (e.g. `any` count → 0, `getAll()`-scan callers → 0), and no statement of what observable behavior must be unchanged for existing consumers. "Run these gates" is necessary but not sufficient.
- **`raw_expression` vs `raw_refers_to` (lines 161–162) is flagged as a risk but not resolved.** Given import/export round-trip fidelity for constants and external references hinges on this, the plan should have specified which field carries which text, rather than leaving it as a caution.

## Contract and verification assessment

Verification is unusually credible. Eleven gates spanning kernel TS tests, kernel typecheck, targeted `cargo test` against named-range and structured-ref suites, clippy, and repo-wide typecheck, plus a manual browser pass for Name Manager and table workflows. I verified the referenced Rust integration tests are real files, so these gates will actually run rather than fail to resolve. The "focused tests before broad gates" ordering (line 130) is good practice, and the test matrix covers the full identity-ref variant family (including `RectRange`, the one variant the current `create` path silently drops), scope precedence, same-name workbook-vs-sheet deletion, and the structured-ref-in-string-literal regression.

Weaknesses: the gates assert "tests pass" but the plan doesn't tie specific invariants from lines 56–68 to specific gate numbers, so it's possible to pass all gates while leaving, say, raw-expression round-trip untested in a meaningful way. There is also no performance/regression gate for the `getAll()`-scan → direct-query change (the stated motivation is fewer IPC round-trips, but nothing measures it). And `cargo test -p compute-core structured_ref_updater` (gate 6) will pick up the src-module unit tests rather than a dedicated integration file — fine, but the plan should say so to avoid the implementer expecting a `tests/structured_ref_updater.rs` that doesn't exist.

## Concrete changes that would raise the rating

1. **Resolve Step 1's fork.** Inspect the existing `createNamedRange`/`updateNamedRange`/`importNamedRanges` input shapes and state definitively whether they already carry identity refs + `raw_expression` + comment + visible + scope. Pick one path (extend vs. add identity-backed commands) and write the canonical bridge input type signature into the plan. This is the change that would most increase confidence.
2. **Pin the cross-agent contract.** Add a short "frozen interfaces" subsection with the exact TS and Rust type signatures (mutation input, `MutationResult.data` shape for named-range and table mutations) that all five agents code against, and mark Agent A's output as the gating deliverable.
3. **Add a definition of done.** E.g. zero `any` in `named-ranges.ts`, zero `getAll()`-based single-lookups, zero `void` bridge writes in the formula domain, `structured-ref-updater.ts` deleted (or reduced to a tested thin wrapper), and `RectRange` round-trips through create.
4. **Specify `raw_expression` vs `raw_refers_to` semantics** explicitly, with the import/export round-trip behavior for constants and external references called out as an assertion, and map it to a named gate.
5. **Map each invariant (lines 56–68) to a specific test/gate** so coverage is auditable, and add a note that the IPC-reduction motivation is observed (or explicitly state it is not measured).
6. **Clarify gate 6** (`structured_ref_updater` runs src-module unit tests, not a separate integration file) to prevent a false "missing test" signal during execution.

---

Verification note: the only file created by this review is
`mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/014-kernel-src-domain-formulas.md`.
