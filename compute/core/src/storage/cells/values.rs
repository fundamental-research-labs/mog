//! Cell Values Module — higher-level cell value operations on YrsStorage.
//!
//! Port of `spreadsheet-model/src/cells/cell-values.ts` (1,312 LOC).
//!
//! # Responsibilities
//!
//! - **Pure parsing functions**: `parse_input_value`, `parse_formatted_number`,
//!   `parse_date_string` — no Yrs access needed, highly testable.
//!   (The `is_formula` shadow check was retired in typed formula boundary — every
//!   user-typed cell input is now classified at the scheduler boundary via
//!   [`crate::scheduler::input::CellWrite::from_user_string`].)
//! - **Cell write dispatcher**: [`set_cell_value`] and [`set_cell_values`]
//!   are the sole entry points for cell writes. Both take a typed
//!   [`CellInput`] expressing caller intent (Clear / Literal / Parse) and
//!   dispatch into narrow leaf helpers (`yrs_remove_cell`, `yrs_store_text`,
//!   `yrs_store_formula`, `yrs_store_typed`) whose signatures cannot be
//!   handed the wrong shape of data.
//! - **Read operations** (free functions): `import_values`, `get_cell_data`,
//!   `get_display_value`, `get_raw_value`, `get_effective_value`, `get_cell_count`.
//!
//! # Design
//!
//! Parsing functions are **pure** — they take string input and return parsed values
//! without touching the Yrs document. This makes them easy to test in isolation.
//!
//! The free functions build on top of the low-level `set_cell()`,
//! `get_cell_value_at()`, `read_cell_from_yrs()` from `storage/mod.rs`, adding
//! input parsing, grid index management, and display formatting.

use std::sync::Arc;

use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::mirror::{CellMirror, SheetMirror};
use crate::scheduler::input::CellWrite;
use crate::storage::engine::mutation::CellInput;
use cell_types::{CellId, SheetId};
use compute_document::cell_serde::{cell_value_to_any, yrs_any_to_cell_value};
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_CELLS, KEY_FORMULA, KEY_GRID_INDEX, KEY_VALUE};
use compute_formats::FormatType;
use compute_parser::FormulaSource;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// yrs-side identity sub-map writes (gridIndex/{posToId, idToPos})
// ---------------------------------------------------------------------------
//
// GridIndex migration designated `gridIndex/{posToId, idToPos}` as the authoritative
// yrs-side identity store, but the value-write paths
// (`set_cell_value`, `set_cell_values`, `import_values`, `set_cell`) were
// only writing identity into the in-memory `GridIndex`. Undo/redo (and
// structural-rebuild via `build_sheet_snapshot_from_yrs`) need to recover
// a cell's (row, col) from yrs after the in-memory GridIndex has been
// cleared — the read-side fallback `read_cell_position_from_yrs` returns
// `None` unless the yrs sub-maps were populated at write time.
//
// These helpers mirror the writes performed by the hydration paths in
// `storage/infra/hydration/{snapshot,sheet}.rs` so every cell write into
// yrs also carries its position mapping.

/// Write `(cell_hex → "rowHex:colHex")` into `gridIndex/idToPos` and the
/// reverse mapping into `gridIndex/posToId` for a single cell.
///
/// No-op if the sheet map or the gridIndex sub-map is missing (the schema
/// guarantees they exist on every well-formed doc, but defensive callers
/// tolerate partial state).
pub(crate) fn write_cell_position_to_yrs(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_hex: &str,
    row_hex: &str,
    col_hex: &str,
) {
    let Some(Out::YMap(sheet_map)) = sheets.get(txn, sheet_hex) else {
        return;
    };
    let Some(Out::YMap(gi_map)) = sheet_map.get(txn, KEY_GRID_INDEX) else {
        return;
    };
    let pos_key = format!("{}:{}", row_hex, col_hex);
    if let Some(Out::YMap(pos_to_id)) = gi_map.get(txn, "posToId") {
        pos_to_id.insert(txn, pos_key.as_str(), Any::String(Arc::from(cell_hex)));
    }
    if let Some(Out::YMap(id_to_pos)) = gi_map.get(txn, "idToPos") {
        id_to_pos.insert(txn, cell_hex, Any::String(Arc::from(pos_key.as_str())));
    }
}

/// Remove the identity mapping for a cell from `gridIndex/{posToId, idToPos}`.
pub(crate) fn remove_cell_position_from_yrs(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_hex: &str,
) {
    let Some(Out::YMap(sheet_map)) = sheets.get(txn, sheet_hex) else {
        return;
    };
    let Some(Out::YMap(gi_map)) = sheet_map.get(txn, KEY_GRID_INDEX) else {
        return;
    };
    // Read the existing pos_key before removing so we can also drop the
    // reverse posToId entry.
    let pos_key = match gi_map.get(txn, "idToPos") {
        Some(Out::YMap(id_to_pos)) => match id_to_pos.get(txn, cell_hex) {
            Some(Out::Any(Any::String(s))) => {
                let k = s.to_string();
                id_to_pos.remove(txn, cell_hex);
                Some(k)
            }
            _ => None,
        },
        _ => None,
    };
    if let Some(pos_key) = pos_key
        && let Some(Out::YMap(pos_to_id)) = gi_map.get(txn, "posToId")
    {
        pos_to_id.remove(txn, pos_key.as_str());
    }
}

mod parsing;

pub(crate) use parsing::{
    InputParseContext, ParsedValue, parse_input_value, parse_input_value_with_context,
    parse_time_string,
};
#[cfg(test)]
use parsing::{is_plain_number, parse_date_string, parse_formatted_number};

// ---------------------------------------------------------------------------
// CellData struct
// ---------------------------------------------------------------------------

/// Full cell data as returned by `get_cell_data` / `get_cell_data_by_id`.
#[derive(Debug, Clone)]
pub struct CellData {
    /// Stable cell identity.
    pub cell_id: CellId,
    /// Zero-based row.
    pub row: u32,
    /// Zero-based column.
    pub col: u32,
    /// Raw value stored in the cell (before formula evaluation).
    pub raw: Option<CellValue>,
    /// Computed value (from formula evaluation), if this is a formula cell.
    pub computed: Option<CellValue>,
    /// Formula string (without leading '='), if this is a formula cell.
    pub formula: Option<String>,
    /// Hyperlink URL, if set.
    pub hyperlink: Option<String>,
    /// Cell note/comment, if set.
    pub note: Option<String>,
}

// ===========================================================================
// Grid Index Helpers
// ===========================================================================

/// Read full cell data from a Yrs cell map, given a cells map and position info.
fn read_cell_data_from_yrs<T: yrs::ReadTxn>(
    cells_map: &MapRef,
    txn: &T,
    cell_id: CellId,
    row: u32,
    col: u32,
) -> Option<CellData> {
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cell_map = match cells_map.get(txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let raw_value = yrs_any_to_cell_value(&cell_map, txn);
    let raw = if matches!(raw_value, CellValue::Null) {
        None
    } else {
        Some(raw_value)
    };

    let formula = match cell_map.get(txn, KEY_FORMULA) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };

    // Read hyperlink and note from properties sub-map (if available)
    // For now these come from the cell map itself if stored there
    let hyperlink = match cell_map.get(txn, "h") {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };
    let note = match cell_map.get(txn, "n") {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };

    Some(CellData {
        cell_id,
        row,
        col,
        raw,
        computed: None, // Computed values come from the compute engine
        formula,
        hyperlink,
        note,
    })
}

// ===========================================================================
// Higher-Level Cell Operations (free functions)
// ===========================================================================

// -----------------------------------------------------------------------
// Set Cell Value (with parsing)
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Narrow write leaves
// ---------------------------------------------------------------------------
//
// Each leaf takes only the data it needs. Un-classified strings cannot reach
// them; the caller has already dispatched on `CellInput` (intent) and —
// for `Parse` — run the classifier in `CellWrite::from_user_string`. Leaves
// operate on an open transaction; the caller owns mirror updates because the
// mirror API needs the transaction dropped.

/// Remove a cell. Returns the `CellId` that was removed, or `None` if the
/// cell did not exist at (row, col). Caller is responsible for the matching
/// `mirror.remove_cell(...)` after dropping the transaction.
fn yrs_remove_cell(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
) -> Option<CellId> {
    let cell_id = grid_index.cell_id_at(row, col)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    cells_map.remove(txn, &cell_hex);
    remove_cell_position_from_yrs(txn, sheets, sheet_hex, &cell_hex);
    grid_index.remove_cell(&cell_id);
    Some(cell_id)
}

/// Store verbatim text. Empty `text` stores `Text("")` — structurally
/// distinct from [`yrs_remove_cell`]. Returns (`CellId`, `CellValue`) for
/// the caller's mirror update.
fn yrs_store_text(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    text: &str,
) -> (CellId, CellValue) {
    let cell_id = grid_index.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid_index.row_id_hex(row);
    let col_hex = grid_index.col_id_hex(col);
    let stored: Arc<str> = Arc::from(text);
    let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::String(Arc::clone(&stored)))]);
    cells_map.insert(txn, &*cell_hex, cell_prelim);
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_position_to_yrs(txn, sheets, sheet_hex, &cell_hex, rh.as_str(), ch.as_str());
    }
    (cell_id, CellValue::Text(stored))
}

/// Store a parsed formula. Takes `FormulaSource` — an un-parsed string
/// cannot reach this leaf. Mirror gets `Null` (compute fills it after
/// recalc). Returns the `CellId` for the caller's mirror update.
fn yrs_store_formula(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    fs: FormulaSource,
) -> CellId {
    let cell_id = grid_index.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid_index.row_id_hex(row);
    let col_hex = grid_index.col_id_hex(col);
    let body = fs.original.strip_prefix('=').unwrap_or(&fs.original);
    let cell_prelim = MapPrelim::from([
        (KEY_VALUE, Any::Null),
        (KEY_FORMULA, Any::String(Arc::from(body))),
    ]);
    cells_map.insert(txn, &*cell_hex, cell_prelim);
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_position_to_yrs(txn, sheets, sheet_hex, &cell_hex, rh.as_str(), ch.as_str());
    }
    cell_id
}

/// Store a coerced scalar (Number, Boolean, Date-as-number, Control). Text
/// must route to [`yrs_store_text`]; Null must route to [`yrs_remove_cell`].
fn yrs_store_typed(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    value: CellValue,
) -> (CellId, CellValue) {
    debug_assert!(
        !matches!(value, CellValue::Null | CellValue::Text(_)),
        "yrs_store_typed: Null and Text must route to remove/store_text"
    );
    let cell_id = grid_index.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid_index.row_id_hex(row);
    let col_hex = grid_index.col_id_hex(col);
    let any_val = cell_value_to_any(&value);
    let cell_prelim = MapPrelim::from([(KEY_VALUE, any_val)]);
    cells_map.insert(txn, &*cell_hex, cell_prelim);
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_position_to_yrs(txn, sheets, sheet_hex, &cell_hex, rh.as_str(), ch.as_str());
    }
    (cell_id, value)
}

/// What the caller should do with the mirror after dropping the txn.
enum MirrorAction {
    Remove(CellId),
    Apply(CellId, CellValue),
    None,
}

/// Dispatch one `CellInput` onto the narrow leaves, returning the mirror
/// action the caller must apply after dropping the transaction. The
/// classifier in `CellWrite::from_user_string` is reachable only from the
/// `Parse` arm — parse-site locality is structurally enforced.
///
/// `target` is the cell's effective number-format category, pre-computed
/// by the caller *before* opening the write transaction (so the cascade
/// helpers — which open their own read txn — don't conflict with the
/// active write txn). `Literal` and `Clear` arms ignore the hint by
/// construction.
#[allow(clippy::too_many_arguments)]
fn dispatch_cell_input(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: &MapRef,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
    input: CellInput,
    target: Option<FormatType>,
) -> MirrorAction {
    match input {
        CellInput::Clear => {
            yrs_remove_cell(txn, sheets, sheet_hex, cells_map, grid_index, row, col)
                .map_or(MirrorAction::None, MirrorAction::Remove)
        }
        CellInput::Literal { text } => {
            let (cid, cv) = yrs_store_text(
                txn, sheets, sheet_hex, cells_map, grid_index, row, col, &text,
            );
            MirrorAction::Apply(cid, cv)
        }
        CellInput::Parse { text } => match CellWrite::from_user_string(&text, target) {
            CellWrite::Empty => {
                yrs_remove_cell(txn, sheets, sheet_hex, cells_map, grid_index, row, col)
                    .map_or(MirrorAction::None, MirrorAction::Remove)
            }
            // Defensive: `from_user_string` never produces Value(Null)
            // (whitespace-only classifies to Empty). Preserved to carry the
            // pre-W6 behaviour of routing a null scalar to cell-remove.
            CellWrite::Value(CellValue::Null) => {
                yrs_remove_cell(txn, sheets, sheet_hex, cells_map, grid_index, row, col)
                    .map_or(MirrorAction::None, MirrorAction::Remove)
            }
            // Classifier-produced text preserves the original bytes (trailing
            // whitespace round-trips). Route to the text leaf so the stored
            // shape is identical to the `Literal` path.
            CellWrite::Value(CellValue::Text(t)) => {
                let (cid, cv) =
                    yrs_store_text(txn, sheets, sheet_hex, cells_map, grid_index, row, col, &t);
                MirrorAction::Apply(cid, cv)
            }
            CellWrite::Formula(fs) => {
                let cid =
                    yrs_store_formula(txn, sheets, sheet_hex, cells_map, grid_index, row, col, fs);
                MirrorAction::Apply(cid, CellValue::Null)
            }
            CellWrite::Value(v) => {
                let (cid, cv) =
                    yrs_store_typed(txn, sheets, sheet_hex, cells_map, grid_index, row, col, v);
                MirrorAction::Apply(cid, cv)
            }
        },
    }
}

/// If `(row, col)` falls inside a Range, derive the virtual CellId and
/// pre-register it in the GridIndex so that `ensure_cell_id` returns it
/// instead of minting a fresh random CellId.
pub(crate) fn maybe_register_virtual_cell_id(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
) {
    if grid_index.cell_id_at(row, col).is_some() {
        return;
    }
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return;
    };
    if sheet.range_views_is_empty() {
        return;
    }
    let Some(row_id) = sheet.row_id_at(row) else {
        return;
    };
    let Some(col_id) = sheet.col_id_at(col) else {
        return;
    };
    // Check if any RangeView covers this (row_id, col_id)
    for rv in sheet.iter_ranges().map(|(_, rv)| rv) {
        if rv.row_offset_by_id.contains_key(&row_id) && rv.col_offset_by_id.contains_key(&col_id) {
            let virtual_id = CellId::virtual_at(*sheet_id, row_id, col_id);
            grid_index.register_cell(virtual_id, row, col);
            return;
        }
    }
}

/// Resolve the effective format category for a single cell *before* the
/// write transaction opens. Used by `set_cell_value` / `set_cell_values`
/// so the read-side cascade (which opens its own `transact()`) never
/// runs concurrent with our `transact_mut`.
///
/// Returns `None` for the `Clear` and `Literal` arms (the format hint is
/// only relevant to `Parse`); also returns `None` when no number_format
/// is set anywhere up the cascade.
fn resolve_format_hint(
    storage: &crate::storage::YrsStorage,
    sheet_id: &SheetId,
    grid_index: &crate::identity::GridIndex,
    sheet_mirror: Option<&SheetMirror>,
    row: u32,
    col: u32,
    input: &CellInput,
) -> Option<FormatType> {
    if !matches!(input, CellInput::Parse { .. }) {
        return None;
    }
    use crate::storage::properties;
    let format = match grid_index.cell_id_at(row, col) {
        Some(cid) => {
            let cell_hex = id_to_hex(cid.as_u128());
            properties::get_effective_format(
                storage,
                sheet_id,
                &cell_hex,
                row,
                col,
                None,
                Some(grid_index),
                sheet_mirror,
            )
        }
        None => properties::get_positional_format(
            storage,
            sheet_id,
            row,
            col,
            Some(grid_index),
            sheet_mirror,
        ),
    };
    format
        .number_format
        .as_deref()
        .map(compute_formats::detect_format_type)
}

fn apply_mirror_action(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    action: MirrorAction,
) {
    match action {
        MirrorAction::Remove(cell_id) => mirror.remove_cell(&cell_id),
        MirrorAction::Apply(cell_id, value) => mirror.apply_edit(
            sheet_id,
            cell_id,
            cell_types::SheetPos::new(row, col),
            value,
            None,
        ),
        MirrorAction::None => {}
    }
}

/// Set a single cell. Sole entry point on the single-cell write path.
///
/// Takes a typed [`CellInput`] expressing caller intent:
/// - [`CellInput::Clear`] → remove the cell (no-op if absent).
/// - [`CellInput::Literal`] → store the text verbatim. Empty text stores
///   `Text("")`, which is structurally distinct from `Clear`.
/// - [`CellInput::Parse`] → classify via
///   [`CellWrite::from_user_string`] (with the cell's effective number
///   format as a hint) and dispatch to the matching leaf.
///
/// `storage` is required so the format-hint cascade can resolve the
/// cell's effective number format *before* the write transaction opens
/// — see `resolve_format_hint` for the rationale.
#[allow(clippy::too_many_arguments)]
pub(crate) fn set_cell_value(
    storage: &crate::storage::YrsStorage,
    doc: &Doc,
    sheets: &MapRef,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    input: CellInput,
    _id_alloc: &cell_types::IdAllocator,
    grid_index: &mut crate::identity::GridIndex,
) {
    // For Range-resident positions, pre-register the virtual CellId so
    // ensure_cell_id returns it instead of minting a new one.
    maybe_register_virtual_cell_id(mirror, sheet_id, grid_index, row, col);

    // Resolve the format hint BEFORE opening the write txn so the read-side
    // cascade in `properties::get_effective_format` doesn't try to open a
    // concurrent read txn on the same Doc.
    let target = resolve_format_hint(
        storage,
        sheet_id,
        grid_index,
        mirror.get_sheet(sheet_id),
        row,
        col,
        &input,
    );

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Auto-expand sheet dimensions through SheetDimensionsMut. Keeps
    // GridIndex and yrs rowOrder/colOrder in lock-step.
    {
        let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
            doc, sheets, grid_index,
        );
        let _ = dims.ensure_capacity(&mut txn, *sheet_id, row, col);
    }

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    let action = dispatch_cell_input(
        &mut txn, sheets, &sheet_hex, &cells_map, grid_index, row, col, input, target,
    );

    drop(txn);
    apply_mirror_action(mirror, sheet_id, row, col, action);
}

/// Batch variant of [`set_cell_value`]. All writes share a single yrs
/// transaction for atomicity; mirror updates run after the txn is dropped.
#[allow(clippy::too_many_arguments)]
pub(crate) fn set_cell_values(
    storage: &crate::storage::YrsStorage,
    doc: &Doc,
    sheets: &MapRef,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    updates: Vec<(u32, u32, CellInput)>,
    _id_alloc: &cell_types::IdAllocator,
    grid_index: &mut crate::identity::GridIndex,
) {
    for &(r, c, _) in &updates {
        maybe_register_virtual_cell_id(mirror, sheet_id, grid_index, r, c);
    }

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut deferred: Vec<(u32, u32, MirrorAction)> = Vec::with_capacity(updates.len());

    // Resolve format hints for every Parse-arm update BEFORE opening the
    // write txn so the read-side cascade doesn't conflict.
    let targets: Vec<Option<FormatType>> = updates
        .iter()
        .map(|(r, c, inp)| {
            resolve_format_hint(
                storage,
                sheet_id,
                grid_index,
                mirror.get_sheet(sheet_id),
                *r,
                *c,
                inp,
            )
        })
        .collect();

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        // Auto-expand sheet dimensions to cover the max (row, col) in this
        // batch BEFORE we look up rowOrder/colOrder. Keeps GridIndex and
        // yrs in lock-step.
        if let Some((max_row, max_col)) =
            updates
                .iter()
                .fold(None, |acc: Option<(u32, u32)>, (r, c, _)| match acc {
                    Some((mr, mc)) => Some((mr.max(*r), mc.max(*c))),
                    None => Some((*r, *c)),
                })
        {
            let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
                doc, sheets, grid_index,
            );
            let _ = dims.ensure_capacity(&mut txn, *sheet_id, max_row, max_col);
        }

        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };
        let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };

        for ((row, col, input), target) in updates.into_iter().zip(targets.into_iter()) {
            let action = dispatch_cell_input(
                &mut txn, sheets, &sheet_hex, &cells_map, grid_index, row, col, input, target,
            );
            deferred.push((row, col, action));
        }
    }

    for (row, col, action) in deferred {
        apply_mirror_action(mirror, sheet_id, row, col, action);
    }
}

/// Import cell values with pre-parsed CellValue and optional formula.
///
/// Used by XLSX import where values are already parsed. Does NOT trigger
/// formula evaluation — the caller handles recalculation.
pub fn import_values(
    doc: &Doc,
    sheets: &MapRef,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    updates: &[(u32, u32, CellValue, Option<String>)],
    _id_alloc: &cell_types::IdAllocator,
    grid_index: &mut crate::identity::GridIndex,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut mirror_edits: Vec<(CellId, u32, u32, CellValue)> = Vec::new();

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        // Auto-expand sheet dimensions to accommodate all (row, col) positions
        // in this batch BEFORE we read rowOrder/colOrder. Keeps GridIndex and
        // yrs rowOrder/colOrder in lock-step.
        if let Some((max_row, max_col)) =
            updates
                .iter()
                .fold(None, |acc: Option<(u32, u32)>, (r, c, _, _)| match acc {
                    Some((mr, mc)) => Some((mr.max(*r), mc.max(*c))),
                    None => Some((*r, *c)),
                })
        {
            let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
                doc, sheets, grid_index,
            );
            let _ = dims.ensure_capacity(&mut txn, *sheet_id, max_row, max_col);
        }

        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };

        let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };

        for (row, col, value, formula) in updates {
            // For Range-resident positions, pre-register the virtual CellId so
            // ensure_cell_id returns it instead of minting a new one.
            maybe_register_virtual_cell_id(mirror, sheet_id, grid_index, *row, *col);

            let cell_id = grid_index.ensure_cell_id(*row, *col);
            let cell_hex = id_to_hex(cell_id.as_u128());
            let row_hex = grid_index.row_id_hex(*row);
            let col_hex = grid_index.col_id_hex(*col);

            let v = cell_value_to_any(value);
            let cell_prelim = match formula {
                Some(f) => MapPrelim::from([
                    (KEY_VALUE, v),
                    (KEY_FORMULA, Any::String(Arc::from(f.as_str()))),
                ]),
                None => MapPrelim::from([(KEY_VALUE, v)]),
            };
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
            if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
                write_cell_position_to_yrs(
                    &mut txn,
                    sheets,
                    &sheet_hex,
                    &cell_hex,
                    rh.as_str(),
                    ch.as_str(),
                );
            }

            mirror_edits.push((cell_id, *row, *col, value.clone()));
        }
    }

    // Apply mirror edits
    for (cell_id, row, col, value) in mirror_edits {
        mirror.apply_edit(
            sheet_id,
            cell_id,
            cell_types::SheetPos::new(row, col),
            value,
            None,
        );
    }
}

// -----------------------------------------------------------------------
// Get Cell Data
// -----------------------------------------------------------------------

/// Get full cell data by position.
///
/// Uses the in-memory `GridIndex` for O(1) position-to-CellId lookup,
/// then reads the cell data from the Yrs cells map.
pub fn get_cell_data(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    grid_index: &crate::identity::GridIndex,
) -> Option<CellData> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let cell_id = grid_index.cell_id_at(row, col)?;

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    read_cell_data_from_yrs(&cells_map, &txn, cell_id, row, col)
}

/// Get full cell data by CellId.
///
/// Looks up the position via the in-memory `GridIndex` (O(1) reverse lookup),
/// then reads the cell data from the Yrs cells map.
pub fn get_cell_data_by_id(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: CellId,
    grid_index: &compute_document::identity::GridIndex,
) -> Option<CellData> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let (row, col) = grid_index.cell_position(&cell_id)?;

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    read_cell_data_from_yrs(&cells_map, &txn, cell_id, row, col)
}

/// Get the raw value for formula bar display.
///
/// For formula cells, returns the formula prefixed with '='.
/// For value cells, returns the string representation of the raw value.
/// Returns empty string for empty cells.
pub fn get_raw_value(
    mirror: &CellMirror,
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    grid_index: &crate::identity::GridIndex,
) -> String {
    // Try via Yrs doc to get formula info
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return String::new(),
    };

    let cell_id = match grid_index.cell_id_at(row, col) {
        Some(id) => id,
        None => return mirror_display_value(mirror, sheet_id, row, col),
    };

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return String::new(),
    };

    let cell_hex = id_to_hex(cell_id.as_u128());
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return String::new(),
    };

    // If has formula, return "=formula"
    if let Some(Out::Any(Any::String(formula))) = cell_map.get(&txn, KEY_FORMULA) {
        return format!("={}", &*formula);
    }

    // Otherwise return string rep of value
    let value = yrs_any_to_cell_value(&cell_map, &txn);
    match value {
        CellValue::Null => String::new(),
        other => format!("{}", other),
    }
}

/// Helper: get display value from mirror.
fn mirror_display_value(mirror: &CellMirror, sheet_id: &SheetId, row: u32, col: u32) -> String {
    match mirror.get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col)) {
        Some(cv) => format!("{}", cv),
        None => String::new(),
    }
}

/// Get the effective value of a cell.
///
/// For formula cells, returns the computed value (from the mirror/compute engine).
/// For value cells, returns the raw value.
/// Returns `None` for empty cells.
pub fn get_effective_value(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    mirror
        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col))
        .cloned()
}

/// Get the count of non-empty cells in a sheet.
///
/// Reads from the Yrs cells map to get an accurate count.
pub fn get_cell_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return 0,
    };

    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => return 0,
    };

    cells_map.len(&txn) as usize
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests;

// ---------------------------------------------------------------------------
// Cell read/write methods on YrsStorage
// ---------------------------------------------------------------------------

mod storage_methods;
