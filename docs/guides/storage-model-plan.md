# Storage model plan

Work list that follows [storage model review](storage-model-review.md).
The items below were evaluated and implemented together. Item 11 was declined
after checking the identity representation; its rationale is recorded below.
The engine remains the public Office.js / Rust workbook surface, with compact
axes and the Excel dense-grid contract.

---

## Do now (low-hanging fruit)

These are obvious, locally scoped, and pay for themselves. No identity-model
redesign. Do them first, in this order.

### 1. Rename the “mirror”

The store is the source of truth. “Mirror” still means “copy of Yrs” and
sends people looking for a second document.

| Today | Rename to |
|---|---|
| `CellMirror` | `CellStore` |
| `SheetMirror` | `SheetStore` |
| `compute/core/src/mirror/` | `compute/core/src/cells/` (or `cell_store/`) |
| `MirrorContext` | `EvalContext` (or `StoreContext`) |
| `MirrorPositionLookup` | `StorePositionLookup` |
| `ensure_cell_id_mirrored` / `find_cell_id_at_mirrored` | drop `_mirrored` |
| docs / comments “cell mirror”, “mirrors Yrs” | “cell store”, “native store” |

Keep `GridIndex` (it *is* an index). Do not rename `WorkbookStorage` in this
pass.

Mechanical: `pub use` aliases for one release if anything leaks, then delete
the old names. Same PR as comment cleanup in `architecture-overview.md` and
`compute/core/README.md`.

### 2. Delete dead dimension copies on the cell store

`SheetStore.row_heights` / `col_widths` (today `SheetMirror.*`) are unused in
production writes. Engine dimension APIs go to `DimensionState` + optional
`LayoutIndex`. Remove the fields, the setters, and the tests that only exist
to populate them.

Canonical sizes stay in `DimensionState`.

### 3. Stop densifying compact axes

`install_sheet_row_col_indexes(Vec<RowId>)` rebuilds `AxisIdentityStore::Explicit`
and fills `row_to_sheet` with one entry per row. That undoes compact runs.

- Grep and delete callers; only `install_sheet_axes` (shared `Arc`) remains.
- Treat `row_ids_ordered()` / `col_ids_ordered()` as debug/export only, never
  as an install path.

### 4. Drop viewport bytes from the Office.js / `Workbook` path

Every mutation still returns `(Vec<u8>, MutationResult)`. `compute-api`
throws the `Vec<u8>` away. Stop producing it on that path. Leave screenshot
and pixel helpers for a later extract; this item is “stop paying for a
discarded protocol on every edit.”

### 5. Lazy `FontDb`

`EngineStores` copies 16 TTFs into memory at every engine construction.
Load on first autofit or screenshot. Formula eval does not need fonts.

---

## Then: make the model match the names

After the store is named honestly, remove the duplicate indexes the old
Yrs split left behind.

### 6. One cell-identity index

`GridIndex.{cell_at_pos, cell_to_pos}` and `SheetStore.{pos_to_id, id_to_pos}`
are the same bijection, updated on every first write and every insert/delete.

Pick **one** owner (recommendation: keep maps on `SheetStore`, make
`GridIndex` axis-only, or the reverse — not both). Route comments,
hyperlinks, and eval through it.

This is the largest RAM/CPU win that does not change identity semantics.

### 7. Derive compact-range offsets from the id

`RangeView.row_offset_by_id` / `col_offset_by_id` are per-row HashMaps on
imported ranges. Compact ids already encode `offset`. Use arithmetic when
the anchor is a store-run; keep a HashMap only for scrambled explicit axes
(sort).

### 8. Name indexes that are not indexes

While touching those types:

| Today | Reality | Action |
|---|---|---|
| `RangeSpatialIndex` (merges) | `Vec` scan | Either wire the existing `IntervalTree`, or rename to `MergeList` |
| `LayoutIndex` | pixel cache over dense Fenwick | Rename to `PixelLayout` / `PixelCache` when item 10 lands |
| `row_to_sheet` | Explicit-axis only; compact uses `row_run_sheets` | Do not document as a dense `RowId → SheetId` map |

---

## Then: identity-shaped sparse edits

### 9. Key sparse edits by `(RowId, ColId)`, not `(row, col)`

Same shape as Cells’ existence map and as compact `RangeView` already.
Insert/delete then moves axes, not every cell-map key.

Still **do not** insert empty Excel slots into that map. Compact runs are
the empty-grid identity.

### 10. Lazy sparse pixel layout

Keep `DimensionState` as truth.

Replace always-on dense Fenwick (`Vec<f64>` of axis length) with:

`position(i) = i * default + sum(deltas < i)` over the **k** custom/hidden
entries.

Build on first drawing / screenshot / wrap-height. Dual-write on every
hide/filter/resize goes away.

Screenshot / `get_row_at_pixel` can stay behind that lazy cache. They are
not Office.js hot path.

### 11. Optional: derived `CellId` for range-resident and first-write cells

Once maps are unified and sparse edits are identity-keyed, `CellId` can be
packed/hashed from `(RowId, ColId)` (injective layout, not 64-bit SipHash
alone). Then `pos_to_id` can disappear.

Separate PR. Measure. Do not shrink `u128` in the same change.

### 12. Optional: property-presence sidecars (not a grid bitmask)

Cells-style flags: the entity does not reserve an `Option`/`Box` for every
possible property. If `HAS_FORMULA` is set, look up `formulas[id]`.

Already true for format/comment/hyperlink/dimensions (sidecar maps or
rectangles). Remaining:

- Split `CellEntry.formula: Option<Box<_>>` into `formulas: HashMap<CellId, _>`
  so data cells drop the 8-byte null pointer. Eval reads `ast_cache`.
- If `StoredDetailedProperties` still shows up in RSS, replace its pile of
  `Option`s with a `u16` mask + sparse fields.

Do not put a mask on empty grid slots. No entity is cheaper than a 1-byte
mask.

---

## Out of scope (do not do)

- Occupancy bitmaps for the Excel grid (property-presence flags are item 12)
- Cells 8-char random IDs, or shrinking `u128` “because 16 bytes”
- Exponential ID pre-generation (neither engine needs it; Mog already uses
  a monotonic counter + compact runs)
- Order-statistic / red-black tree of every row (Cells layout tree)
- Sparse position holes (A, B, E without C, D)
- Folding `CellStore` into `WorkbookStorage`
- CRDT / Yrs-shaped collaboration
- Putting pixel sizes back as source of truth

---

## Naming map (full)

Apply in the rename PR unless noted.

**Store (source of truth for values)**

- `CellMirror` → `CellStore`
- `SheetMirror` → `SheetStore`
- module `mirror` → `cells` or `cell_store`
- `MirrorContext` → `EvalContext`
- `MirrorPositionLookup` → `StorePositionLookup`

**Indexes (derived)**

- `GridIndex` — keep (axis + optional cell identity index until item 6)
- `LayoutIndex` → `PixelLayout` (with item 10)
- `RangeSpatialIndex` for merges → real interval tree or `MergeList` (item 8)

**Keep**

- `WorkbookStorage` — metadata
- `DimensionState` — canonical sizes
- `AxisIndex` / `AxisIdentityStore` — compact/explicit axes
- `ComputeEngine` / `ComputeCore` / `EngineStores`

**Comments to kill**

- “unified reference model”
- “mirrors Yrs”
- “spatial index” on a `Vec`
- “O(log k)” on a Fenwick that is `O(n)` memory

---

## Suggested PR stack

| PR | Items | Why this size |
|---|---|---|
| 1 | Rename store types + docs | Mechanical; unblocks honest review |
| 2 | Delete dead `row_heights` / `col_widths` | Tiny, independent |
| 3 | Compact-axis install only; no Explicit rebuild | Prevents space regression |
| 4 | Stop viewport `Vec<u8>` on `Workbook`/`Sheet` | CPU on every mutation |
| 5 | Lazy `FontDb` | RSS at engine init |
| 6 | Unify cell identity maps | Core model; needs tests |
| 7 | Compact range offsets from ids | Import RAM + column views |
| 8 | Honest merge/layout names, or real merge IntervalTree | Clarity / small time win |
| 9 | Sparse edits keyed by `(RowId, ColId)` | Structural-edit cost |
| 10 | Lazy sparse pixel layout | Resident Fenwick |
| 11 | Derived `CellId` (optional) | Only after 6+9 |
| 12 | Formula sidecar / detailed-property mask | Measure; after rename + identity unify |

PRs 1–5 are the obvious now. 6–8 are the next model cleanup. 9–11 change
lookup shape and should not start until 6 is in.

---

## Done when

- There is one value store, named as a store, not a mirror.
- There is one `(identity ↔ position)` map for authored cells.
- Compact axes never go through a dense `Vec<RowId>` install.
- Imported ranges do not keep a HashMap per row when the id already
  encodes the offset.
- Pixel layout is not allocated for formula-only workbooks.
- `DimensionState` remains the only size authority.
- No occupancy bitmap, no 8-char IDs, no OSTree of all rows.

## Implementation decision for item 11

Authored cells retain monotonic allocated `CellId`s. Sparse identity lookup now
uses `(RowId, ColId)` on the cell store, so axis insertion and deletion no longer
rewrite surviving cell keys. The optional derived first-write ID is deliberately
not adopted:

- Public snapshots accept arbitrary 128-bit row and column identities. Their
  256-bit pair cannot be injectively packed into 128 bits.
- Compact axes reserve 48 bits for each run ID. Even restricting offsets to the
  Excel limits needs another 20 row bits and 14 column bits: **130 bits before
  a sheet identity or namespace marker**. The general 32-bit compact offsets
  require 160 bits before that metadata.
- A dictionary that assigns smaller run or pair tokens, or a collision registry
  around a hash, would retain identity state and add another allocation and
  persistence contract. It would not eliminate the sparse existence index.

These field-width bounds reject the proposed representation before a benchmark
can establish an advantage. The existing range-resident `CellId::virtual_at`
remains a deterministic 64-bit hash in its reserved namespace; it is
probabilistic, not an injective encoding, and is not extended to authored first
writes. This change does not claim to remove that existing range-ID limitation.

## Implemented model

The twelve items were considered as one change, with no compatibility aliases:

| Item | Outcome |
|---|---|
| 1 | `CellStore`, `SheetStore`, `EvalContext`, and `StorePositionLookup`; native storage lives under `cells`. |
| 2 | Removed cell-store size copies. `DimensionState` owns sizes. |
| 3 | Axis installation shares `Arc<AxisIndex>`; compact runs stay compact. |
| 4 | Mutation APIs return `MutationResult` directly. Explicit viewport snapshots and screenshots remain available. Structural moves report changed cells without a registered viewport. |
| 5 | `FontDb` loads on first autofit or screenshot. |
| 6 | `SheetStore` owns the cell identity bijection; `GridIndex` owns only shared axes. Metadata and evaluation use the same cell identities. |
| 7 | Range offsets use run arithmetic and sparse deletions, with an explicit fallback for scrambled axes. Copying compact ranges remaps runs without building per-row maps. |
| 8 | Merge rectangles use `MergeList`; geometry uses `PixelLayout`. Explicit row ownership and compact run ownership are documented separately. |
| 9 | Sparse identities use `(RowId, ColId)` keys. Axis insertion/deletion does not rekey surviving cells. |
| 10 | Pixel geometry is a lazy cache over sparse custom/hidden dimension deltas. Axis changes and dimension writes invalidate it. |
| 11 | Retained allocated authored IDs; see the representation limits above. |
| 12 | Formula ASTs live in a sparse sidecar. Detailed properties use a presence mask and typed sparse fields. |

Overlapping moves capture all sources before rebinding targets. Copy, import,
metadata-only anchors, undo/redo, and formula initialization all share the
workbook allocator; adopting an allocator preserves deleted-ID high-water marks.

Detailed-property storage has a 24-byte header plus 32 bytes per present payload
field, compared with the former 176-byte header (excluding nested allocations).
Two payload fields take 88 bytes; three take 120 bytes. Boolean properties need
no payload field. The tradeoff is higher overhead when five or more payload
fields coexist: all twelve take 408 bytes. Style-only cells retain their compact
enum representation. No presence mask is allocated for empty grid slots.

## Verification

`cargo test --workspace --locked --no-fail-fast` passed with 19,473 tests and
no failures; 89 tests remained ignored by their existing default configuration.
Coverage includes native history, imported range edits and copies, structural
mutations, identity collisions, geometry, Office.js, and XLSX roundtrips.

The [memory and speed comparison](storage-model-bench.md) measures the original
revision against this implementation using fresh release processes, validated
outputs, and separate timings for hydration, reads, and recalculation.
