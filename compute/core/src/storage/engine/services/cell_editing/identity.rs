use cell_types::{CellId, SheetId, SheetPos};
use yrs::{Array, Map, Origin, Out, Transact};

use crate::mirror::CellMirror;
use crate::storage::cells::values as cell_values;
use crate::storage::engine::stores::EngineStores;
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;

pub(in crate::storage::engine) fn find_cell_id_at(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    stores.grid_indexes.get(sheet_id)?.cell_id_at(row, col)
}

pub(in crate::storage::engine) fn cell_id_for_region_guard(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellId {
    if let Some(cell_id) = find_cell_id_at(stores, sheet_id, row, col) {
        return cell_id;
    }

    if let Some((source, _, _)) = mirror.projection_registry.resolve(sheet_id, row, col)
        && let Some(pos) = mirror.resolve_position(&source)
        && pos.row() == row
        && pos.col() == col
    {
        return source;
    }

    CellId::from_raw(0)
}

/// Mirror-aware variant of [`find_cell_id_at`].
///
/// When the GridIndex has no CellId at `(row, col)`, checks the mirror's
/// Range spatial index. If the position falls inside a Range, derives and
/// pre-registers the virtual CellId so that the caller (and any subsequent
/// `ensure_cell_id`) returns the deterministic virtual ID instead of
/// minting a fresh random one.
pub(in crate::storage::engine) fn find_cell_id_at_mirrored(
    stores: &mut EngineStores,
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    // Fast path: already registered.
    if let Some(cid) = stores.grid_indexes.get(sheet_id)?.cell_id_at(row, col) {
        return Some(cid);
    }

    // Formula parsing can create a ghost identity in the mirror before any
    // value has been written at that position. Reuse that identity for later
    // position-based writes so existing dependencies keep pointing at the
    // written cell instead of an orphaned ghost.
    if let Some(cid) = mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col)) {
        let grid = stores.grid_indexes.get_mut(sheet_id)?;
        grid.register_cell(cid, row, col);
        return Some(cid);
    }

    // Check the mirror for Range coverage and pre-register if found.
    let grid = stores.grid_indexes.get_mut(sheet_id)?;
    crate::storage::cells::values::maybe_register_virtual_cell_id(mirror, sheet_id, grid, row, col);

    // Re-check — will succeed if a virtual CellId was just registered.
    stores.grid_indexes.get(sheet_id)?.cell_id_at(row, col)
}

// ---------------------------------------------------------------------------
pub(in crate::storage::engine) fn ensure_cell_id_mirrored(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    let already_registered = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col));

    // For Range-resident positions, pre-register the virtual CellId so
    // ensure_cell_id returns it instead of minting a fresh random one.
    let grid = stores.grid_indexes.get_mut(sheet_id)?;
    if already_registered.is_none() {
        if let Some(cid) = mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col)) {
            grid.register_cell(cid, row, col);
        }
        cell_values::maybe_register_virtual_cell_id(mirror, sheet_id, grid, row, col);
    }

    let cell_id = mirror_cell_position_to_yrs(
        stores.storage.doc(),
        stores.storage.sheets(),
        grid,
        sheet_id,
        row,
        col,
    );
    Some(cell_id)
}

fn mirror_cell_position_to_yrs(
    doc: &yrs::Doc,
    sheets: &yrs::MapRef,
    grid: &mut crate::identity::GridIndex,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellId {
    // Metadata-only writes can be the first operation on an empty sheet. Expand
    // row/col axes before reading row_id_hex/col_id_hex, otherwise the in-memory
    // CellId is not persisted to gridIndex and the next value undo can orphan
    // comments or properties that refer to it.
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    {
        let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
            doc, sheets, grid,
        );
        let _ = dims.ensure_capacity(&mut txn, *sheet_id, row, col);
        if !yrs_axes_cover_position(&txn, sheets, sheet_id, row, col) {
            let _ = dims.materialize_dense_axes_and_remove_compact_keys(&mut txn, *sheet_id);
        }
    }

    let cell_id = grid
        .cell_id_at(row, col)
        .unwrap_or_else(|| grid.ensure_cell_id(row, col));
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid.row_id_hex(row);
    let col_hex = grid.col_id_hex(col);

    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        crate::storage::cells::values::write_cell_position_to_yrs(
            &mut txn,
            sheets,
            &sheet_hex,
            &cell_hex,
            rh.as_str(),
            ch.as_str(),
        );
    }
    cell_id
}

fn yrs_axes_cover_position(
    txn: &yrs::TransactionMut<'_>,
    sheets: &yrs::MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let Some(Out::YMap(sheet_map)) = sheets.get(txn, sheet_hex.as_str()) else {
        return false;
    };
    let row_ok = crate::storage::infra::grid_helpers::get_row_order_array(&sheet_map, txn)
        .is_some_and(|row_order| row < row_order.len(txn));
    let col_ok = crate::storage::infra::grid_helpers::get_col_order_array(&sheet_map, txn)
        .is_some_and(|col_order| col < col_order.len(txn));
    row_ok && col_ok
}

/// Persist identity mappings for every cell referenced by an [`IdentityFormula`]
/// into the in-memory `GridIndex` and the Yrs `gridIndex/{posToId, idToPos}`
/// sub-maps.
///
/// ## Why this exists
///
/// Named-range writes serialize `IdentityFormula` as JSON into the Yrs
/// document (typed formula boundary): the identity form — not the A1 text — is the
/// on-disk format for `DefinedName.refers_to`. For a remote peer to render
/// the reference back to A1 after CRDT sync, every `CellId` embedded in the
/// JSON must resolve to a `(sheet, row, col)` on that peer. That resolution
/// goes through the in-memory `GridIndex` / `CellMirror`, both of which are
/// hydrated from Yrs `gridIndex/posToId`. If the identity mapping isn't in
/// Yrs, the remote side renders `#REF!`.
///
/// Formula *cells* don't have this problem because each peer re-parses the
/// formula text through its own `IdentityResolver`, minting its own local
/// `CellId`s. But the named-range write path allocates `CellId`s only into
/// the local `CellMirror` (via `CoreIdentityResolver` → `ensure_cell_id`),
/// never into `GridIndex` or Yrs — so remote peers inherit orphan CellIds.
/// This helper closes that gap.
pub(in crate::storage::engine) fn persist_identity_formula_cell_identities(
    stores: &mut EngineStores,
    mirror: &crate::mirror::CellMirror,
    identity: &formula_types::IdentityFormula,
) {
    use formula_types::IdentityFormulaRef;

    // 1. Collect every CellId the IdentityFormula references. Row/Col refs
    //    use RowId/ColId, not CellId, so they don't participate here.
    let mut cell_ids: Vec<CellId> = Vec::with_capacity(identity.refs.len() * 2);
    for r in &identity.refs {
        match r {
            IdentityFormulaRef::Cell(c) => cell_ids.push(c.id),
            IdentityFormulaRef::Range(r) => {
                cell_ids.push(r.start_id);
                cell_ids.push(r.end_id);
            }
            IdentityFormulaRef::RectRange(_)
            | IdentityFormulaRef::FullRow(_)
            | IdentityFormulaRef::RowRange(_)
            | IdentityFormulaRef::FullCol(_)
            | IdentityFormulaRef::ColRange(_)
            | IdentityFormulaRef::ExternalCell(_)
            | IdentityFormulaRef::ExternalRange(_)
            | IdentityFormulaRef::ExternalName(_) => {}
        }
    }
    if cell_ids.is_empty() {
        return;
    }

    // 2. Resolve each CellId's (sheet, row, col) from the mirror. The mirror
    //    was just populated by `to_identity_formula` via `ensure_cell_id`,
    //    so every CellId should have a position; any that don't are silently
    //    skipped (treated as `#REF!` on render, matching existing contract).
    let mut to_register: Vec<(SheetId, CellId, u32, u32)> = Vec::with_capacity(cell_ids.len());
    for cell_id in cell_ids {
        let Some(sheet_id) = mirror.sheet_for_cell(&cell_id) else {
            continue;
        };
        let Some(pos) = mirror.resolve_position(&cell_id) else {
            continue;
        };
        to_register.push((sheet_id, cell_id, pos.row(), pos.col()));
    }
    if to_register.is_empty() {
        return;
    }

    // 3. Register in the in-memory GridIndex and collect the row/col hex IDs
    //    for the Yrs write. `register_cell` accepts a pre-allocated CellId
    //    (unlike `ensure_cell_id` which mints a new one), which is what we
    //    need here since the CellId was already minted by the IdentityResolver.
    //
    //    Collect the hex data in a separate vec so the Yrs transaction below
    //    doesn't have to hold a borrow on `stores.grid_indexes`.
    let mut yrs_writes: Vec<(
        SheetId,
        CellId,
        compute_document::hex::SmallHex,
        compute_document::hex::SmallHex,
    )> = Vec::with_capacity(to_register.len());
    for (sheet_id, cell_id, row, col) in to_register {
        let Some(grid) = stores.grid_indexes.get_mut(&sheet_id) else {
            continue;
        };
        grid.register_cell(cell_id, row, col);
        if let (Some(rh), Some(ch)) = (grid.row_id_hex(row), grid.col_id_hex(col)) {
            yrs_writes.push((sheet_id, cell_id, rh, ch));
        }
    }
    if yrs_writes.is_empty() {
        return;
    }

    // 4. Batch all posToId/idToPos writes into a single Yrs transaction so
    //    remote peers receive them as one update, ordered before the named-
    //    range JSON write the caller is about to perform.
    let sheets_map = stores.storage.doc().get_or_insert_map("sheets");
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    for (sheet_id, cell_id, rh, ch) in yrs_writes {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());
        crate::storage::cells::values::write_cell_position_to_yrs(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            &cell_hex,
            rh.as_str(),
            ch.as_str(),
        );
    }
}
