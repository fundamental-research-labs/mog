# Version Control Rust Boundary

This document records the public Mog contract between TypeScript version-control
orchestration and Rust/compute workbook semantics. Version graph admission,
public diagnostics, capability gates, artifact lookup, and operation-context
wrapping may stay in TypeScript. Workbook state transitions and semantic
interpretation that Rust already owns must stay in Rust-backed mutation paths.

## Active-checkout persistence contract

An attached active checkout is a materialized branch session, not just a selected
ref. Its public session identity is:

- `checkedOutCommitId`: the commit currently loaded in the workbook context;
- `branchName`: the attached branch, without requiring callers to spell
  `refs/heads/`;
- `refHeadAtMaterialization`: the branch head that was loaded when the checkout
  materialized;
- `detached`: `false` for branch sessions and `true` for detached commit
  checkouts.

Implicit branch writes are allowed only from an attached, non-stale checkout
session. Direct commit, revert, and non-materializing `applyMerge` calls may
omit `targetRef`; the facade resolves the attached branch ref and, when the
caller omitted a compare-and-swap proof, fills `expectedTargetHead` from the
active checkout head. Detached checkout sessions have no implicit target ref and
stale checkout sessions fail closed before provider writes. For implicit
`applyMerge`, `input.ours` must match the active checkout branch head.

Non-materializing `applyMerge` is a graph write. It may create a merge commit and
move the target branch ref, but it does not reload the live workbook. After such
a write the active session remains loaded at the old `checkedOutCommitId`, while
`refHeadAtMaterialization` records the new branch head. Surface status must then
report the checkout as stale, normally with `staleReason: "activeSessionBehind"`.
This is intentional: callers asked to move the branch without mutating the live
workbook context.

`materializeActiveCheckout: true` converts a successful merge graph write into a
live active-checkout update. It is valid only in apply mode and requires all of:

- explicit `targetRef`;
- explicit `expectedTargetHead`;
- an attached checkout transaction guard;
- an attached checkout materialization service;
- `targetRef`, `expectedTargetHead.commitId`,
  `expectedTargetHead.revision`, and `input.ours` matching the current attached
  checkout head.

The materialization proof is checked before the merge write runs. If the merge
write succeeds, the facade checks out the target ref through the normal checkout
snapshot materializer. Only an applied checkout success updates the live session
to the new merge commit and writes the durable active-checkout materialization
record. If the graph write succeeds but post-write checkout materialization
fails, the facade records the branch ref move so the live workbook is visibly
stale instead of pretending it loaded the new head.

Durable active-checkout persistence is opportunistic. The persisted record stores
document scope, checked-out commit, branch name, materialized ref head, and
`updatedAt`. Detached sessions are not persisted. Restore attempts are best
effort: they require the normal checkout path and a restorable attached branch
session, recompute status against the current ref head, and treat persistence
failures as non-fatal because the source of truth is still the version graph plus
the live workbook context.

## Materialized merge contract

Merge preview and apply are split into graph semantics and workbook
materialization:

- preview asks the attached merge service for public `VersionMergeChange` and
  conflict records and does not mutate the workbook;
- apply validates capability/domain gates, target-ref CAS, and conflict
  resolutions, then asks the attached apply-merge write service to create the
  merge commit or fast-forward the ref;
- production merge-commit capture hydrates the expected target head into a fresh
  workbook lifecycle, replays the accepted merge changes through production
  mutation APIs, captures a snapshot root plus semantic change set and mutation
  segment records, and lets the provider publish the merge commit/ref update;
- optional active-checkout materialization then checks out the merged target ref
  into the live workbook, as described above.

The first-slice Rust policy manifest is the authoritative supported-domain
contract for semantic merge admission:

- `sheets` accepting `sheet` and `sheets`;
- `cells.values` accepting `cell` and `cells.values`;
- `cells.formulas` accepting `cell`, `cells.values`, and `cells.formulas`;
- `cells.formats.direct` accepting `cells.formats` and
  `cells.formats.direct`;
- `rows-columns` accepting `rows-columns`.

The public TypeScript support manifest mirrors that Rust policy and adds the
public materializer identifier
`semantic-cell-merge-commit-materializer.v1`. The Rust fixture test that compares
`first_slice_semantic_merge_policy_manifest()` with the public TypeScript JSON
fixture is part of the boundary contract: domain admission must not drift between
Rust and TypeScript.

Rust/compute remains the source of truth for workbook state transitions. The
current materializer may build a TypeScript replay plan, but the writes go
through existing production mutation entrypoints:

- cell scalar/formula/clear writes through cell operations;
- direct cell formats through format operations;
- row/column insertion and deletion through `computeBridge.structureChange`;
- sheet names through sheet CRUD operations;
- tab colors and frozen panes through `computeBridge` sheet metadata methods.

In particular, TypeScript may validate that a frozen-pane merge record contains
safe non-negative integer `rows` and `cols`, but Rust still writes the sheet
metadata, derives pane config, and emits mutation results.

## Boundary rule

Keep TypeScript limited to orchestration:

- resolving version graph artifacts, persisted merge attempts, and saved
  resolutions;
- enforcing public capability gates, domain support gates, target-ref CAS, and
  active-checkout proof requirements;
- mapping public merge records to existing production mutation entrypoints;
- attaching version operation context and capture metadata;
- returning public unsupported-materialization diagnostics.

Move logic to Rust/compute when it determines workbook semantics that Rust
already owns, including:

- row/column index shifting and formula/reference updates;
- cell identity allocation or structural reindexing;
- formula parsing, recalculation, and value interpretation beyond scalar/formula
  dispatch;
- sheet view metadata normalization, including pane config derived from frozen
  rows/columns;
- format cascade, effective-format resolution, and format-value canonicalization;
- merge support for tables, filters, charts, floating objects, named ranges,
  validations, protection, or any domain outside the first-slice manifest.

## TS semantic drift that must not grow

There is still TypeScript semantic duplication in the materializer support
inspector and replay-plan parser. The allowed duplicated checks are currently:

- structural records must be metadata records in the first-slice domains, with
  only these property paths: cell value/formula paths, direct format `format`,
  row/column `order`, and sheet `name`, `tabColor`, or `frozen`;
- entity IDs use TypeScript parsing for `sheetId!A1`,
  `sheetId!row:<index>`, `sheetId!column:<index>`, and bare sheet IDs;
- cell values accept clear/blank, scalar primitives, and formula objects, while
  `cells.formulas` accepts only clear/blank or formula objects;
- direct formats are decoded from semantic JSON into a non-empty cell-format
  object and reject the removed-format sentinel;
- row/column materialization supports only no-op, single insert, and single
  delete transitions for the parsed target;
- sheet metadata accepts non-empty names, string-or-null tab colors, and
  non-negative integer frozen row/column counts;
- row/column replay ordering deletes descending indexes before inserts ascending
  indexes within each sheet and axis;
- unsupported-domain diagnostics and no-op detection are computed in TypeScript
  before hydration.

Do not expand this list for additional domains, value grammars, property paths,
or normalization rules. The next materialized merge domain must first add a
Rust-owned bridge contract that accepts normalized merge-change records and
returns either a typed materialization plan or a typed unsupported-domain
diagnostic. TypeScript should then keep only graph/artifact lookup,
active-checkout proofing, operation-context/capture wrapping, and public result
mapping.
