Rating: 8/10

# Review of Plan 026 — compute/core/src/storage


## Summary judgment

This is a strong, unusually well-grounded plan. The author clearly read the actual
source rather than narrating from folder names: the lazy workbook-child creation
contract (the issue-#112 Map-LWW shadowing hazard), the `gridIndex/{posToId,idToPos}`
authoritative identity store, the `ensure_workbook_child_map` helper, the
`write_cell_to_yrs_in_txn` / `remove_cell_position_from_yrs` cell-position helpers, and
the broad surface of direct `transact_mut` writers (104 files under `storage`) are all
described correctly and match what is in the tree today. The objectives — an executable
invariant contract, a typed write boundary, a workbook-child registry, a sheet-schema
builder, atomic cell-write plans, unified rebuild/export/hydration projections, complete
observer/MutationResult coverage, structural deltas, diagnostics, and a production-path
contract test suite — are the right list for this folder and are sequenced sensibly
around an invariant matrix that lands first.

It does not earn a 9–10 because it is scoped as a multi-quarter program rather than an
executable unit of work: there is no MVP slice or first-PR boundary, no per-item
definition-of-done or acceptance threshold, it leaves a genuine gating decision
(row/column identity policy) unresolved, and its verification gates omit the
product-fidelity eval suites that actually catch storage regressions in this repo.

## Major strengths

- **Evidence-based, not speculative.** The "current role" and "contracts to preserve"
  sections restate real invariants from the code (root-maps-only `new()`, posToId as the
  concurrent-write winner, idToPos as a non-resurrecting inverse, per-sheet maps created
  eagerly in the sheet transaction vs. workbook children created lazily). A reviewer can
  trust the premises.
- **Invariant-matrix-first sequencing.** Landing the read-only validator and the
  mutation-family ownership table before any refactor gives every parallel agent a shared
  acceptance contract and makes equivalence failures diagnosable. This is the correct
  dependency root, and the plan states it explicitly.
- **Right architectural pressure points.** Centralizing the write boundary, formalizing
  the already-half-existing `ensure_workbook_child_map` into a typed `WorkbookChild`
  registry with a code-search gate, and a `CellWritePlan` that forbids physical cells
  without position mappings all attack the actual divergence classes (blank viewports,
  stale formulas, lost metadata, export drift) named in objective 9.
- **Strong contract discipline.** It distinguishes physical / virtual / metadata-only
  cells, insists on one canonical identity-formula format, and refuses compatibility
  shims that preserve broken state — the correct stance for a CRDT source-of-truth layer.
- **Realistic risk and edge-case sections.** Blank-doc provider replay, two peers
  bootstrapping the same default sheet ID with different nested maps, concurrent
  same-position writes through full-state/diff/undo/export, and `idToPos`-without-winning-
  `posToId` are exactly the failure modes this layer actually hits.

## Major gaps or risks

- **Scope is a program, not a plan.** Each of the ten "concrete" items is itself a major
  refactor touching dozens of files; migrating ~100 `transact_mut` sites to a write
  context alone is large. There is no MVP boundary, no "first landable PR," and no
  ordering by value/risk beyond the parallel-agent split. As written, an implementer
  cannot tell where to stop for a reviewable increment.
- **No per-item definition of done.** "Make the consistency contract executable" and
  "complete the observer matrix" lack pass criteria. What does the `StorageInvariantReport`
  assert at minimum to be considered landed? Which families are mandatory vs. follow-up?
  Without thresholds these items can be declared done at any depth.
- **Row/column identity policy is left unresolved while gating two agents.** The plan
  correctly flags that sheet-scoped vs. document-unique RowId/ColId is ambiguous and that
  Agents D and F depend on it — but it defers the decision rather than proposing the
  answer or a spike to settle it. This is the single highest-leverage unknown and it sits
  on the critical path; a plan should at least name the investigation that resolves it
  and who blocks on it.
- **Verification gates miss product-fidelity suites.** The gates list `cargo test/clippy`
  for `compute-core`, `compute-collab`, `compute-document` and a generic "XLSX/file-IO
  focused tests." For this repo, hydration/export/metadata changes are the ones most
  likely to silently regress round-trip fidelity and app behavior, yet the
  roundtrip/XLSX corpus and the api/app-eval suites are not named. "Focused tests if
  mappings change" is too soft for the blast radius described.
- **Performance is hand-waved.** It correctly says production hot paths must use targeted
  or sampled checks, but there is no baseline, no budget, and no measurement plan for the
  added scanners on import/sync/rebuild/export. Agent G is told to "measure cost" with no
  target to measure against.
- **Migration of existing persisted docs is under-addressed.** Corrupt-state tests are
  listed, but tightening cell-identity and sheet-schema invariants could reject
  previously-written-but-valid docs (legacy axis arrays, compact axis stores, missing
  optional maps are even named as edge cases). There is no explicit statement that
  existing real documents must continue to load, nor a quarantine/repair strategy.

## Contract and verification assessment

The contract section is the plan's best part: it is specific about source-of-truth per
store, the non-resurrection rule for idToPos losers, atomicity of structural mutations
from the caller's perspective, and the requirement that observer replay/undo/redo/rebuild
converge to the same visible state as the local path. The proposal to expose the invariant
checker as a normal internal API (not test-only) is the right call and makes the contract
durable.

Verification is directionally correct — behavior must be proven through production
entrypoints (`from_snapshot`, `from_yrs_state`, bridge mutation methods, sync/undo APIs),
not by poking private maps — and the round-trip equivalence fixtures (snapshot↔Yrs↔engine,
local-vs-synced, diff-replay-vs-rebuild) are the right shape. The weaknesses are (a) no
quantitative acceptance bar on the invariant report, (b) omission of the corpus/eval gates
that are the real safety net for hydration/export in this codebase, and (c) no performance
budget. Tighten those three and the verification story becomes complete.

## Concrete changes that would raise the rating

1. **Carve an MVP / first-PR slice.** Define the smallest landable increment — e.g.
   item 1 (read-only invariant module + report) plus the workbook-child registry
   (item 3) and its provider-replay tests — and mark items 5–8 as follow-ups gated on it.
   State an explicit "stop here for review" boundary.
2. **Resolve, or schedule a spike to resolve, the row/column identity policy** before
   Agents D and F start. Propose the likely answer (sheet-scoped vs. document-unique),
   list the call sites that would change under each, and make this the second thing to
   land after the invariant matrix.
3. **Add per-item acceptance criteria.** For the invariant report, enumerate the minimum
   mandatory checks; for the observer matrix, list which families must emit on each path
   to call item 7 done.
4. **Name the real gates.** Add the XLSX round-trip corpus and the api/app-eval suites to
   the required gates whenever hydration/export/metadata or MutationResult shapes change,
   not just `cargo test`.
5. **Set a performance budget** for any production-path scanner (e.g. invariant sampling
   adds < X% to import/sync/export), with a baseline-capture step for Agent G.
6. **State a backward-compat guarantee** that all currently-loadable real documents must
   still load after invariant tightening, and define the behavior for docs that newly
   fail (reject vs. repair vs. quarantine), referencing the legacy-axis/compact-store edge
   cases already listed.
