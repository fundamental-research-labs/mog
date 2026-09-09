# Storage model review: Mog vs Cells

This review describes the model before the changes in [the storage model plan](storage-model-plan.md). The plan records the implementation decisions.

Review of Mog’s in-memory model after native sparse storage replaced Yrs
([#365](https://github.com/aduermael/mog/pull/365)), compared with
[Cells](https://github.com/aduermael/cells). Goal: simpler *and* faster
storage, without copying Cells’ collab-first shortcuts that break Excel-scale
workbooks.

Consensus from three independent reviews (storage/identity, Cells architecture,
headless layout). They agree on every structural recommendation below.

Related: [architecture](architecture-overview.md),
[native storage benchmarks](remove-yrs-bench.md),
[undo/redo](undo-redo.md),
[storage model plan](storage-model-plan.md) (what to do next).

---

## Answers to the questions

### Why do we still carry `layout_indexes`?

They are **not** the store of row/column sizes. They are a **derived pixel
cache**.

Canonical sizes live in `WorkbookStorage.sheet_metadata.dimensions`
(`DimensionState`):

- keyed by stable `RowId` / `ColId`
- rows in **points**, columns in **char-width**
- hidden, outline, `bestFit`, OOXML hints

`LayoutIndex` (Fenwick over dimension deltas) answers:

- “pixel Y of row 12?” / “which row contains pixel 480?”
- viewport row/col position strips
- floating-object / chart CSS boxes
- screenshot overlays
- hide/unhide sync after filter/outline

Formula evaluation never reads it. Office.js today does not call pixel APIs.
`compute-api` `Sheet::layout()` reads **native metadata**, not the Fenwick.

There is a **third, dead copy**: `SheetMirror.row_heights` / `col_widths`.
Engine mutations never write them.

So: keep **dimension metadata**. The Fenwick is leftover from a canvas that
hit-tests every frame. Headless still needs *some* cell→pixel conversion
(drawings, autofit wrap-height, PNG), but not an always-on dense tree of
`n` zeros.

### Is CellMirror necessary? Why not update authored values directly?

**CellMirror already *is* the authored value store.** The name is leftover from
when it mirrored Yrs. Writes go straight into `SheetMirror.cells` /
compact `range_views`. There is no second value document.

`WorkbookStorage` owns **metadata only** (formats, dimensions, comments,
merges, CF, tables). Values and identity formulas live on the mirror so the
two can be borrowed independently during mutation vs eval.

You still need *a* cell store that:

1. keys formulas by stable `CellId` (insert/delete must not rewrite ASTs)
2. keeps compact imported ranges as shared `Arc<[CellValue]>` buffers
3. overlays spills / CSE / generated pivot values

Merging the mirror into `WorkbookStorage` recreates the borrow split they
already documented. The waste is the **second identity grid**, not the
mirror itself.

### Is there a bitmask to skip undefined cells (like Cells)?

**Neither engine has a grid occupancy bitmap.**

Cells “flags” (`HAS_FORMAT`, `HAS_STYLE`, `SPILL_MASTER`, …) are bits on
**existing** cell objects, not “is this A1 slot defined?”. Existence is a
hash miss on `_cellIndex`. Viewport still nested-loops visible axes and
probes the map — including empty slots.

Mog’s bitsets (`ColumnBitset`, `DenseBoolMask`) are **eval** masks
(COUNTIFS / SIMD), not occupancy. Presence is:

1. `pos_to_id` / `cell_at_pos` hash miss
2. compact range IntervalTree coverage
3. column-level `column_lengths` / `columns_with_overlays` (skip layered
   reads when a column is still a single imported range)

Missing map entry **is** the occupancy test. A 1,048,576-row bitset is
128 KiB **per column** and duplicates the sparse maps. Do not add one
unless a profile shows hash-miss cost on `SUM(A:A)`-style scans. Compact
`ColumnView` already skips empty columns.

### Do IDs need to be `u128`? Are Cells IDs shorter / pre-generated?

| | Mog | Cells |
|---|---|---|
| Stored type | `u128` newtype | 8-char base62 (`char[8]`) |
| Entropy | 128-bit space; runtime uses monotonic `u64` + optional client partition in the high half | \(62^8 \approx 47.6\) bits |
| Generation | `IdAllocator` `AtomicU64` (no `getrandom`) | `mt19937` per entity, on demand |
| Per empty row | **0 bytes** (compact run encodes offset) | no row entity until allocated; XLSX import densifies the used range |
| Collision | unique by construction | birthday bound ~15M IDs for 50% |

Cells IDs **are shorter** (8 bytes vs 16). They are **not** pre-generated
with exponential growth. That is [nanoid’s string pool](https://github.com/ai/nanoid),
not Cells. Cells calls `generate_id()` per insert.

Mog already left `Uuid::new_v4()` because it cost ~15% CPU on large
imports. Compact axis runs allocate **one run of length N**, not N UUIDs.
A compact `RowId` is *derived*:

```
tag 8 | version 4 | axis 1 | sheet/seed fingerprint 32 | run_id 48 | offset 32
```

That packing is why the type is still `u128`. You do **not** need 128 bits
of randomness. You need enough bits to hold compact axis encoding + a
client partition + a sentinel for virtual cell IDs.

Shrinking to `u64` is possible later if you redesign that layout. It is
not a first cut: every `CellId` is an FxHashMap key, a wire UUID string,
and a formula ref. Collision-safe 8-char IDs are **unsafe at Excel scale**
(1M cells ≈ 0.2% collision; 10M ≈ 23%; collab peers mint independently).

### Could lookup be Sheet → row/col IDs → global `(ColId, RowId)` map?

That is the Cells model:

```
position → colId / rowId     (sheet index)
(colId, rowId) → cellId      (hash; existence)
cellId → Cell                (workbook-owned)
axis.sheetId                 (parent sheet from the row or col)
```

It is a good *shape*. Two caveats for Mog:

1. **Excel requires a dense logical grid.** `C:C` and `A1:A1048576` must
   address empty rows. Cells stores only allocated axes; empty C/D holes
   are missing entities. Mog compact runs give every position an identity
   **without storing it**. A global hashmap of all `(RowId, ColId)` pairs
   would undo that.

2. Today Mog keys sparse edits by **physical `(row, col)`**, not
   `(RowId, ColId)`. Insert/delete rewrites those maps. Cells’ identity
   key survives moves. Compact `RangeView` already keys payload by
   `(RowId, ColId)`. Sparse edits should too.

A **workbook-global** map is optional: compact IDs already fingerprint the
sheet, and `Axis.sheetId` in Cells is O(1) parent recovery. Per-sheet maps
are simpler and match how eval actually runs.

Do **not** copy Cells’ `makeCellKey` (`col.toString() + ":" + row.toString()`).
Pack two `u128`s or two compact axis ids.

---

## How the two engines actually look

```
CELLS (sparse collab document)
────────────────────────────────
Workbook owns:
  _cells[id] → Cell { colId, rowId, value, formula }
  _columns[id] → Axis { sheetId, position, size_px }
  _rows[id]    → Axis { sheetId, position, size_px }

Sheet indexes:
  position → axisId          std::map
  "colId:rowId" → cellId     unordered_map   ← existence
  OSTree (augmented RB-tree) pixel ↔ axis    ← the red-black tree
  R-tree                     ranges / spills

Empty A1 slots: not stored.
Empty rows/cols: not stored (ZCD). XLSX import densifies used range.


MOG (Excel-scale headless engine)
────────────────────────────────
ComputeEngine
  CellMirror ............... authored values + compact ranges   SOURCE OF TRUTH
    SheetMirror
      cells[CellId]          sparse edits + formulas
      pos_to_id / id_to_pos  ★ duplicate of GridIndex
      range_views            Arc<[CellValue]> shared payloads
      row_axis / col_axis    Arc-shared compact runs
  WorkbookStorage .......... metadata only
    DimensionState           canonical sizes (points / char-width)
    comments, merges, CF, tables, …
  GridIndex ................ identity ↔ position
    cell_at_pos / cell_to_pos ★ duplicate of SheetMirror
    shared Arc axes
  LayoutIndex .............. Fenwick pixels (derived)
  ComputeCore .............. graph, AST, eval caches
```

The identity layer is already there. Complexity is **duplicate indexes and
derived caches sitting on the hot path**, not missing hashmaps.

---

## What Cells uses a red-black tree for

**Layout only.** `core/cells/ostree.h` is an order-statistic tree
(augmented RB-tree): each node is one allocated row or column, with pixel
`size`, `subtree_total`, `subtree_count`. It answers “column at pixel X?”
in O(log n).

It is **not** cell storage, not occupancy, not sorted values, not the
formula graph. Ranges/spills use a separate R-tree.

Cells documents ~56 bytes per axis node → **~56 MiB for 1M rows**. Mog’s
Fenwick is denser in a different way (`Vec<f64>` of n, ~8 MiB at Excel max
rows) but the same *kind* of leftover: a pixel index over a full axis.
Neither is what formula eval needs.

Mog already has the Excel-shaped analog: sparse custom/hidden maps +
prefix of deltas. Keep that idea; drop the dense `n` array.

---

## What Mog should borrow from Cells

Narrow. The valuable pattern is already adopted: **identities are truth;
coordinates and pixels are derived**.

| Borrow | Why |
|---|---|
| `(RowId, ColId) → CellId` as the existence index for **sparse edits** | Survives insert/delete; compact ranges already work this way |
| Parent sheet on the axis (or encoded in compact id, which Mog already does) | `WorkbookLookup` without scanning sheets |
| Range corners keyed by axis IDs | Merges / named ranges expand when rows are inserted |
| Shared-formula master/subscriber if Excel `si=` fill is still duplicated ASTs | Storage win Cells already has |
| Persist per-sheet layout; do not rebuild on sheet switch | Both already do this |

## What not to borrow

| Cells thing | Why it fails here |
|---|---|
| 8-char random IDs | Collision at Excel scale; slower than `AtomicU64` |
| Imaginary exponential ID pool | Cells does not have one |
| OSTree of every row | Worse than Fenwick-over-deltas; 1M default rows |
| Sparse position holes (A, B, E without C, D) | Breaks Excel letters, used-range, Office.js, XLSX |
| XLSX densify-to-max-row Axis objects | Opposite of compact runs |
| String `"col:row"` keys | Extra allocs |
| Viewport col×row hash probes as “O(log n + k)” | Docs disagree with code |
| Occupancy bitmask | Cells does not have one |
| CRDT / HLC / OpLog / Luau-only writes | Mog removed Yrs; public surface is Office.js |
| Pixel size as source of truth | Keep Excel units; convert at the render/autofit boundary |
| Formula refs as **cell UUID** | Excel copy/fill is position-relative against **axes**. Mog’s row/col identity + relative flags is the right Excel model |

---

## Consensus recommendations (priority order)

### 1. One cell-identity index (biggest simple win)

Delete either `GridIndex.{cell_at_pos, cell_to_pos}` **or**
`SheetMirror.{pos_to_id, id_to_pos}`. They store the same bijection.
Every first write and every insert/delete updates both.

Keep:

- `SheetMirror.cells[CellId]` as values
- shared `Arc<AxisIndex>` for row/col identity
- compact range virtual IDs (`CellId::virtual_at`)

Eval `value_at` becomes: axis identity → sparse edit map **or** range
payload. Metadata (comments, hyperlinks) uses the same index.

### 2. Key sparse edits by `(RowId, ColId)`, not `(row, col)`

Matches Cells’ existence map and Mog’s compact `RangeView`. Structural
edits then move axes, not cell-map keys.

Do not put every empty grid slot in that map. Compact runs already
*are* the empty-grid identity.

### 3. Derive `RangeView` offsets from compact ids

`row_offset_by_id: FxHashMap<RowId, u32>` is the leftover dense map on
the import path. Compact ids already encode `offset`. Use arithmetic
when the range anchor is a store-run; keep the HashMap only after sort
scrambles explicit axes.

### 4. Treat LayoutIndex as optional / sparse / lazy

Keep `DimensionState`. For pixel queries:

- `position(i) = i * default + sum(deltas < i)` over **k custom/hidden**
  entries (`O(k)` memory, `O(log k)` with an ordered map or compressed
  Fenwick)
- build on first screenshot / drawing / wrap-height, not at engine init
- stop dual-writing Fenwick on every hide/resize/filter

Delete `SheetMirror.row_heights` / `col_widths` (dead). Make `FontDb`
lazy (16 TTFs copied at every `ComputeEngine` construction today).

Viewport binary protocol (`Vec<u8>` on every mutation) is already
discarded by `compute-api`. Drop it from the Office.js path; keep
screenshot as an optional export crate.

### 5. Occupancy bitmap vs property-presence mask

Two different ideas got conflated.

**Grid occupancy** (“is A1 defined?”) — still no. Compact range coverage plus
a hash miss on the sparse edit map is the skip. A bit per Excel slot is
128 KiB per column at max rows and forces a cell entity to exist.

**Property-presence mask** (Cells `HAS_FORMAT` / `HAS_STYLE`) — the right
instinct: each entity holds a small mask; undefined properties live in
sidecar HashMaps so you do not pay an `Option`/`Box` (8-byte null pointer)
on every cell for format, comment, hyperlink, …

Mog already does this at a coarser grain:

| Property | Where it lives today |
|---|---|
| Value | `CellEntry` or compact `RangeView` payload — no empty-grid entity |
| Formula | `Option<Box<IdentityFormula>>` **on** `CellEntry` (8 B even when `None`) |
| Cell format | Format **rectangles** + `cell_properties: HashMap<CellId, _>` only when a cell has extras |
| Comments / hyperlinks | Sidecar lists/maps, not fields on `CellEntry` |
| Row/col size, hidden | `DimensionState` maps, only custom axes |

Imported style-only cells already keep a palette index without allocating a
full format DTO (`StoredCellProperties::ImportedStyle`). Formatting
rectangles do **not** create blank cell entities — putting `HAS_FORMAT` on
every grid slot would undo that.

Where a mask (or a sidecar split) would still save bytes:

1. **`CellEntry.formula`** — the remaining null pointer on every data cell.
   Boxing already cut 80→32 bytes (~32 MiB on 670K cells). Moving formulas
   to `HashMap<CellId, IdentityFormula>` saves another 8 B × non-formula
   cells. Eval already uses `ast_cache`, not this field.
2. **`StoredDetailedProperties`** — many `Option` fields on cells that
   already have *some* extra property. A `u16` mask + per-field maps (or
   a packed struct) would shrink that sidecar. Only paid by cells in
   `cell_properties`, so smaller than (1).

Do **not** add a mask that requires a cell/row/col object to exist. The
cheap entity is “no entity.” Compact runs and range rectangles already
beat per-entity flags for the empty grid.

See plan item 12 (optional, after the store rename and identity-map
unify).

### 6. Do not shrink IDs to 8-char base62

Keep `u128` until compact encoding is redesigned. If anything shrinks,
it is the **number of stored IDs** (compact runs, virtual cells), not
the width of the type. Runtime allocation is already a counter, not
UUID v4.

### 7. Keep CellMirror as the value store; stop calling it a mirror

Rename in docs/code when touching the module (`CellStore` / `SheetStore`).
Do not fold it into `WorkbookStorage`.

### 8. Kill densifying install paths

`install_sheet_row_col_indexes(Vec<RowId>)` rebuilds `Explicit` axes and
fills `row_to_sheet` with one entry per row. Only `install_sheet_axes`
(shared compact `Arc`) should run. `row_ids_ordered()` is a compatibility
trap.

---

## Target shape (after cleanup)

```
Sheet
  row_axis, col_axis          compact runs (Arc)
  edits[(RowId, ColId)]       sparse authored cells + formulas
  ranges[RangeId]             shared Arc payload + run anchor
  DimensionState              sizes/hidden by RowId/ColId

Workbook
  cells by CellId             optional: CellId = hash/pack(RowId,ColId)
                              or keep allocated ids only for formulas
  metadata                    comments, CF, tables, named ranges
  ComputeCore                 graph + caches (derived)

Pixel layout                  lazy, sparse, not resident
Eval                          ColumnView over payload or edits
```

Same identity layer, fewer maps, same Excel grid contract.

---

Work items, rename map, and PR stack: [storage model plan](storage-model-plan.md).
