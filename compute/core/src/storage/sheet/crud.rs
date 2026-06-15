//! Sheet CRUD — create, delete, copy, add, remove, sheet_order.
//!
//! Single `impl YrsStorage` block holding all mutating sheet-lifecycle
//! operations that need `&mut self` (both `doc` + `mirror`). Collapses the
//! dual-block sandwich that existed in the pre-split `meta.rs`.

use std::collections::HashMap;
use std::sync::Arc;

use yrs::{
    Any, Array, ArrayPrelim, ArrayRef, Map, MapPrelim, MapRef, Origin, Out, ReadTxn, Transact,
};

use cell_types::{IdAllocator, SheetId};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::schema::{
    KEY_BINDINGS, KEY_CELL_PROPERTIES, KEY_CELLS, KEY_CF_RULES, KEY_COL_FORMAT_RANGES,
    KEY_COL_FORMATS, KEY_COL_ORDER, KEY_COL_WIDTHS, KEY_COMMENTS, KEY_CONDITIONAL_FORMAT,
    KEY_FILTER_HIDDEN_ROWS, KEY_FILTER_METADATA_BINDINGS, KEY_FILTERS, KEY_FLOATING_OBJECT_GROUPS,
    KEY_FLOATING_OBJECT_ORDER, KEY_FLOATING_OBJECTS, KEY_FORMULA_REFS, KEY_GRID_ID_TO_POS,
    KEY_GRID_INDEX, KEY_GRID_POS_TO_ID, KEY_GROUPING, KEY_HIDDEN_COLS, KEY_HIDDEN_ROWS,
    KEY_MANUAL_HIDDEN_ROWS, KEY_MERGES, KEY_NAME, KEY_PIVOT_TABLES, KEY_PROPERTIES,
    KEY_RANGE_BINDINGS, KEY_RANGE_FORMATS, KEY_RANGE_PAYLOADS, KEY_RANGES, KEY_ROW_FORMATS,
    KEY_ROW_HEIGHTS, KEY_ROW_ORDER, KEY_SCHEMAS, KEY_SORTING, KEY_SPARKLINES, KEY_VALIDATION_RULES,
    write_schema_version,
};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::yrs_schema::comment as comment_schema;
// Note: ORIGIN_BOOTSTRAP is supplied by callers via `*_with_origin` and never
// referenced directly here — this file only needs to know it can accept any
// caller-supplied origin.
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::storage::YrsStorage;

use super::yrs_helpers::{
    KEY_COLS, KEY_DEFAULT_COL_WIDTH, KEY_DEFAULT_ROW_HEIGHT, KEY_HIDDEN, KEY_ROWS, meta_number,
};

// =============================================================================
// Generic Y-value clone helpers
// =============================================================================
//
// `copy_sheet` needs to recursively clone arbitrary Y.Map / Y.Array / Any
// structures. These helpers walk a source via a read txn, materialise a
// self-contained `YValue` tree, and write that tree into a destination parent
// on a write txn. Other `Out` variants (text, xml, etc.) are not used by sheet
// storage and are skipped.
//
// Context-specific remapping (CellId hexes in the `cells` and `gridIndex`
// sub-maps, CellId refs inside `formula_refs` JSON) is still handled inline by
// `copy_sheet` — these helpers provide the structural plumbing, not policy.

#[derive(Clone)]
enum YValue {
    Any(Any),
    Map(Vec<(String, YValue)>),
    Array(Vec<YValue>),
}

fn read_y_out<T: ReadTxn>(out: Out, txn: &T) -> Option<YValue> {
    match out {
        Out::Any(a) => Some(YValue::Any(a)),
        Out::YMap(m) => {
            let entries: Vec<(String, YValue)> = m
                .iter(txn)
                .filter_map(|(k, v)| read_y_out(v, txn).map(|y| (k.to_string(), y)))
                .collect();
            Some(YValue::Map(entries))
        }
        Out::YArray(a) => {
            let items: Vec<YValue> = a.iter(txn).filter_map(|v| read_y_out(v, txn)).collect();
            Some(YValue::Array(items))
        }
        _ => None,
    }
}

fn write_y_value_into_map(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    value: &YValue,
) {
    match value {
        YValue::Any(a) => {
            parent.insert(txn, key, a.clone());
        }
        YValue::Map(entries) => {
            let new_map: MapRef = parent.insert(txn, key, MapPrelim::default());
            for (k, v) in entries {
                write_y_value_into_map(&new_map, txn, k, v);
            }
        }
        YValue::Array(items) => {
            let new_arr: ArrayRef = parent.insert(txn, key, ArrayPrelim::default());
            for item in items {
                push_y_value_to_array(&new_arr, txn, item);
            }
        }
    }
}

fn push_y_value_to_array(arr: &ArrayRef, txn: &mut yrs::TransactionMut, value: &YValue) {
    match value {
        YValue::Any(a) => {
            arr.push_back(txn, a.clone());
        }
        YValue::Map(entries) => {
            let new_map: MapRef = arr.push_back(txn, MapPrelim::default());
            for (k, v) in entries {
                write_y_value_into_map(&new_map, txn, k, v);
            }
        }
        YValue::Array(items) => {
            let new_arr: ArrayRef = arr.push_back(txn, ArrayPrelim::default());
            for item in items {
                push_y_value_to_array(&new_arr, txn, item);
            }
        }
    }
}

/// Write the `cells` sub-map with CellId-hex remapping. The source is a
/// `Y.Map<cell_hex, Y.Map<field, Any>>`. The new map uses freshly allocated
/// cell-hex keys (from `remap`), and the `formula_refs` JSON inside each cell
/// has any referenced cell-hex strings rewritten as well.
fn write_cells_remapped(
    new_sheet: &MapRef,
    txn: &mut yrs::TransactionMut,
    value: &YValue,
    remap: &HashMap<String, String>,
) {
    let new_cells: MapRef = new_sheet.insert(txn, KEY_CELLS, MapPrelim::default());
    let YValue::Map(entries) = value else {
        return;
    };
    for (old_hex, cell_val) in entries {
        let Some(new_hex) = remap.get(old_hex) else {
            continue;
        };
        match cell_val {
            YValue::Any(a) => {
                new_cells.insert(txn, new_hex.as_str(), a.clone());
            }
            YValue::Map(cell_entries) => {
                let new_cell: MapRef =
                    new_cells.insert(txn, new_hex.as_str(), MapPrelim::default());
                for (k, v) in cell_entries {
                    if k == KEY_FORMULA_REFS
                        && let YValue::Any(Any::String(s)) = v
                    {
                        let remapped = remap_formula_refs(s, remap);
                        new_cell.insert(txn, k.as_str(), Any::String(Arc::from(remapped.as_str())));
                        continue;
                    }
                    write_y_value_into_map(&new_cell, txn, k, v);
                }
            }
            YValue::Array(_) => {
                write_y_value_into_map(&new_cells, txn, new_hex, cell_val);
            }
        }
    }
}

/// Write the `gridIndex` sub-map with CellId-hex remapping.
///
/// Shape: `{ posToId: Y.Map<"row:col", cell_hex>, idToPos: Y.Map<cell_hex, "row:col"> }`.
/// `posToId` keeps its keys and remaps values; `idToPos` remaps its keys.
fn write_grid_index_remapped(
    new_sheet: &MapRef,
    txn: &mut yrs::TransactionMut,
    value: &YValue,
    remap: &HashMap<String, String>,
) {
    let new_gi: MapRef = new_sheet.insert(txn, KEY_GRID_INDEX, MapPrelim::default());
    let YValue::Map(entries) = value else {
        return;
    };
    for (sub_key, sub_val) in entries {
        match (sub_key.as_str(), sub_val) {
            (KEY_GRID_POS_TO_ID, YValue::Map(pos_entries)) => {
                let new_pos: MapRef = new_gi.insert(txn, KEY_GRID_POS_TO_ID, MapPrelim::default());
                for (pos, v) in pos_entries {
                    if let YValue::Any(Any::String(old_hex)) = v {
                        let new_val = remap
                            .get(old_hex.as_ref())
                            .cloned()
                            .unwrap_or_else(|| old_hex.to_string());
                        new_pos.insert(txn, pos.as_str(), Any::String(Arc::from(new_val.as_str())));
                    } else {
                        write_y_value_into_map(&new_pos, txn, pos, v);
                    }
                }
            }
            (KEY_GRID_ID_TO_POS, YValue::Map(id_entries)) => {
                let new_id: MapRef = new_gi.insert(txn, KEY_GRID_ID_TO_POS, MapPrelim::default());
                for (old_hex, v) in id_entries {
                    let new_key = remap
                        .get(old_hex)
                        .cloned()
                        .unwrap_or_else(|| old_hex.clone());
                    write_y_value_into_map(&new_id, txn, &new_key, v);
                }
            }
            _ => write_y_value_into_map(&new_gi, txn, sub_key, sub_val),
        }
    }
}

fn write_cell_properties_remapped(
    new_sheet: &MapRef,
    txn: &mut yrs::TransactionMut,
    value: &YValue,
    remap: &HashMap<String, String>,
) {
    let new_props: MapRef = new_sheet.insert(txn, KEY_CELL_PROPERTIES, MapPrelim::default());
    let YValue::Map(entries) = value else {
        return;
    };
    for (old_hex, prop_val) in entries {
        let new_key = remap
            .get(old_hex)
            .cloned()
            .unwrap_or_else(|| old_hex.clone());
        write_y_value_into_map(&new_props, txn, &new_key, prop_val);
    }
}

fn write_comments_remapped(
    new_sheet: &MapRef,
    txn: &mut yrs::TransactionMut,
    value: &YValue,
    remap: &HashMap<String, String>,
) {
    let new_comments: MapRef = new_sheet.insert(txn, KEY_COMMENTS, MapPrelim::default());
    let YValue::Map(entries) = value else {
        return;
    };
    for (comment_id, comment_val) in entries {
        match comment_val {
            YValue::Map(comment_entries) => {
                let new_comment: MapRef =
                    new_comments.insert(txn, comment_id.as_str(), MapPrelim::default());
                for (key, field_val) in comment_entries {
                    if key == comment_schema::KEY_CELL_REF
                        && let YValue::Any(Any::String(old_ref)) = field_val
                    {
                        let new_ref = remap
                            .get(old_ref.as_ref())
                            .cloned()
                            .unwrap_or_else(|| old_ref.to_string());
                        new_comment.insert(
                            txn,
                            key.as_str(),
                            Any::String(Arc::from(new_ref.as_str())),
                        );
                        continue;
                    }
                    write_y_value_into_map(&new_comment, txn, key, field_val);
                }
            }
            _ => write_y_value_into_map(&new_comments, txn, comment_id, comment_val),
        }
    }
}

/// Remap CellId-hex strings inside a `formula_refs` JSON blob. Preserves the
/// original JSON shape (array of objects with `id`, or array of bare id
/// strings) and only rewrites hex values present in `remap`.
fn remap_formula_refs(refs_json: &str, remap: &HashMap<String, String>) -> String {
    let Ok(mut arr) = serde_json::from_str::<Vec<serde_json::Value>>(refs_json) else {
        return refs_json.to_string();
    };
    for item in arr.iter_mut() {
        if let Some(id_val) = item.get_mut("id")
            && let Some(old_id) = id_val.as_str()
            && let Some(new_id) = remap.get(old_id)
        {
            *id_val = serde_json::Value::String(new_id.clone());
        }
        if let serde_json::Value::String(old_id) = item.clone()
            && let Some(new_id) = remap.get(&old_id)
        {
            *item = serde_json::Value::String(new_id.clone());
        }
    }
    serde_json::to_string(&arr).unwrap_or_else(|_| refs_json.to_string())
}

fn looks_like_hex_cell_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn ensure_cell_id_remap(
    remap: &mut HashMap<String, String>,
    old_hex: &str,
    id_alloc: &cell_types::IdAllocator,
) {
    if !looks_like_hex_cell_id(old_hex) || remap.contains_key(old_hex) {
        return;
    }
    let new_cell_id = id_alloc.next_cell_id();
    let new_cell_hex = id_to_hex(new_cell_id.as_u128());
    remap.insert(old_hex.to_string(), new_cell_hex.to_string());
}

impl YrsStorage {
    fn sheet_exists(&self, sheet_id: &SheetId) -> bool {
        let txn = self.doc.transact();
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        self.sheets.get(&txn, &sheet_hex).is_some()
    }

    fn next_unused_sheet_id(&self, id_alloc: &cell_types::IdAllocator) -> SheetId {
        loop {
            let sheet_id = id_alloc.next_sheet_id();
            if !self.sheet_exists(&sheet_id) {
                return sheet_id;
            }
        }
    }

    // -----------------------------------------------------------------
    // High-level CRUD wrappers (used by TS bridge path + direct callers)
    // -----------------------------------------------------------------

    /// Test helper that creates a new sheet with a generated UUID.
    #[cfg(test)]
    pub(crate) fn create_sheet(
        &mut self,
        mirror: &mut CellMirror,
        name: &str,
        id_alloc: &cell_types::IdAllocator,
    ) -> Result<SheetId, ComputeError> {
        self.create_sheet_with_origin(mirror, name, id_alloc, Origin::from(ORIGIN_USER_EDIT))
    }

    /// Create a new sheet, recording the Yrs transaction under `origin`.
    ///
    /// Bootstrap callers (e.g. the default-sheet creation triggered when a
    /// blank workbook starts up) pass `Origin::from(ORIGIN_BOOTSTRAP)` so the
    /// transaction never enters the undo stack — see
    /// `compute_document::undo` for the canonical origin set.
    pub(crate) fn create_sheet_with_origin(
        &mut self,
        mirror: &mut CellMirror,
        name: &str,
        id_alloc: &cell_types::IdAllocator,
        origin: Origin,
    ) -> Result<SheetId, ComputeError> {
        let sheet_id = self.next_unused_sheet_id(id_alloc);
        // Default: 100 rows x 26 cols
        self.add_sheet_with_origin(mirror, sheet_id, name, 100, 26, origin)?;
        Ok(sheet_id)
    }

    /// Delete a sheet. Cannot delete the last remaining sheet.
    ///
    /// Production callers reach delete via the `DeleteSheet` mutation handler
    /// in `engine::services::mutation_handlers::sheet_mutations`, which
    /// duplicates the last-sheet check before calling `remove_sheet` directly.
    /// This method is retained for tests that exercise the storage-layer
    /// validation directly.
    #[allow(dead_code)]
    pub(crate) fn delete_sheet(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
    ) -> Result<(), ComputeError> {
        let order = self.sheet_order();
        if order.len() <= 1 {
            return Err(ComputeError::Eval {
                message: "Cannot delete the last sheet".to_string(),
            });
        }
        if !order.contains(sheet_id) {
            return Err(ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
            });
        }
        self.remove_sheet(mirror, sheet_id);
        Ok(())
    }

    /// Copy a sheet with a deep clone of all sub-maps. Returns the new SheetId.
    pub(crate) fn copy_sheet(
        &mut self,
        mirror: &mut CellMirror,
        source_id: &SheetId,
        new_name: &str,
        id_alloc: &cell_types::IdAllocator,
    ) -> Result<SheetId, ComputeError> {
        let source_hex = id_to_hex(source_id.as_u128());
        let new_id = self.next_unused_sheet_id(id_alloc);
        let new_hex = id_to_hex(new_id.as_u128());

        // Pass 1: Read source sheet into a recursive YValue tree, plus build
        // the CellId remap table from every source keyed by CellId.
        let rows;
        let cols;
        let mut top_entries: Vec<(String, YValue)> = Vec::new();
        let mut cell_id_remap: HashMap<String, String> = HashMap::new();

        {
            let txn = self.doc.transact();

            let source_map = match self.sheets.get(&txn, &source_hex) {
                Some(Out::YMap(m)) => m,
                _ => {
                    return Err(ComputeError::SheetNotFound {
                        sheet_id: source_hex.to_string(),
                    });
                }
            };

            match source_map.get(&txn, KEY_PROPERTIES) {
                Some(Out::YMap(meta)) => {
                    rows = meta_number(&txn, &meta, KEY_ROWS, 100.0) as u32;
                    cols = meta_number(&txn, &meta, KEY_COLS, 26.0) as u32;
                }
                _ => {
                    rows = 100;
                    cols = 26;
                }
            };

            if let Some(Out::YMap(cells_map)) = source_map.get(&txn, KEY_CELLS) {
                for (old_hex, _) in cells_map.iter(&txn) {
                    ensure_cell_id_remap(&mut cell_id_remap, &old_hex, id_alloc);
                }
            }

            if let Some(Out::YMap(grid_index)) = source_map.get(&txn, KEY_GRID_INDEX) {
                if let Some(Out::YMap(pos_to_id)) = grid_index.get(&txn, KEY_GRID_POS_TO_ID) {
                    for (_, value) in pos_to_id.iter(&txn) {
                        if let Out::Any(Any::String(old_hex)) = value {
                            ensure_cell_id_remap(&mut cell_id_remap, old_hex.as_ref(), id_alloc);
                        }
                    }
                }
                if let Some(Out::YMap(id_to_pos)) = grid_index.get(&txn, KEY_GRID_ID_TO_POS) {
                    for (old_hex, _) in id_to_pos.iter(&txn) {
                        ensure_cell_id_remap(&mut cell_id_remap, &old_hex, id_alloc);
                    }
                }
            }

            if let Some(Out::YMap(cell_properties)) = source_map.get(&txn, KEY_CELL_PROPERTIES) {
                for (old_hex, _) in cell_properties.iter(&txn) {
                    ensure_cell_id_remap(&mut cell_id_remap, &old_hex, id_alloc);
                }
            }

            if let Some(Out::YMap(comments_map)) = source_map.get(&txn, KEY_COMMENTS) {
                for (_, value) in comments_map.iter(&txn) {
                    if let Out::YMap(comment_map) = value
                        && let Some(Out::Any(Any::String(old_ref))) =
                            comment_map.get(&txn, comment_schema::KEY_CELL_REF)
                    {
                        ensure_cell_id_remap(&mut cell_id_remap, old_ref.as_ref(), id_alloc);
                    }
                }
            }

            for (key, value) in source_map.iter(&txn) {
                if let Some(y) = read_y_out(value, &txn) {
                    top_entries.push((key.to_string(), y));
                }
            }
        }

        // Pass 2: Write the tree into the new sheet. `cells` and `gridIndex`
        // get bespoke handling for CellId-hex remapping; everything else uses
        // the generic recursive writer, which correctly preserves structured
        // Yrs subtrees (e.g. CF rules) that the previous flat-representation
        // path silently dropped.
        {
            let mut txn = self.doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

            let new_sheet: MapRef = self
                .sheets
                .insert(&mut txn, &*new_hex, MapPrelim::default());

            for (key, value) in &top_entries {
                match key.as_str() {
                    KEY_CELLS => write_cells_remapped(&new_sheet, &mut txn, value, &cell_id_remap),
                    KEY_GRID_INDEX => {
                        write_grid_index_remapped(&new_sheet, &mut txn, value, &cell_id_remap)
                    }
                    KEY_CELL_PROPERTIES => {
                        write_cell_properties_remapped(&new_sheet, &mut txn, value, &cell_id_remap)
                    }
                    KEY_COMMENTS => {
                        write_comments_remapped(&new_sheet, &mut txn, value, &cell_id_remap)
                    }
                    _ => write_y_value_into_map(&new_sheet, &mut txn, key, value),
                }
            }

            // Override meta fields for new sheet
            if let Some(Out::YMap(new_meta)) = new_sheet.get(&txn, KEY_PROPERTIES) {
                new_meta.insert(&mut txn, KEY_NAME, Any::String(Arc::from(new_name)));
                new_meta.insert(&mut txn, KEY_HIDDEN, Any::Bool(false));
            }

            // Insert into sheetOrder after the source sheet — lazy
            // ensure replaces the prior eager-bootstrap dependency.
            let order_arr = self.ensure_sheet_order_array(&mut txn);
            let len = order_arr.len(&txn);
            let mut insert_pos = len;
            for i in 0..len {
                if let Some(Out::Any(Any::String(s))) = order_arr.get(&txn, i)
                    && *s == *source_hex
                {
                    insert_pos = i + 1;
                    break;
                }
            }
            order_arr.insert(
                &mut txn,
                insert_pos,
                Any::String(Arc::from(new_hex.as_str())),
            );
        }

        // Pass 3: Update mirror. Cells are left empty (mutation_copy_sheet
        // rebuilds the full mirror from Yrs), but ranges are populated here so
        // that the mirror entry is correct even before the caller rebuilds.
        let ranges = {
            let txn = self.doc.transact();
            let mut range_data_vec = Vec::new();
            if let Some(Out::YMap(sheet_map)) = self.sheets.get(&txn, &new_hex)
                && let Some(Out::YMap(ranges_map)) = sheet_map.get(&txn, KEY_RANGES)
                && let Some(Out::YMap(payloads_map)) = sheet_map.get(&txn, KEY_RANGE_PAYLOADS)
            {
                for entry in
                    compute_document::range::read_ranges_from_yrs(&txn, &ranges_map, &payloads_map)
                {
                    range_data_vec.push(crate::snapshot::RangeData {
                        range_id: entry.metadata.range_id,
                        kind: entry.metadata.kind,
                        anchor: entry.metadata.anchor,
                        encoding: entry.metadata.encoding,
                        payload: entry.payload,
                        row_axis: entry.metadata.row_axis,
                        col_axis: entry.metadata.col_axis,
                        row_ids: entry.metadata.row_ids,
                        col_ids: entry.metadata.col_ids,
                    });
                }
            }
            range_data_vec
        };
        let snap = crate::snapshot::SheetSnapshot {
            id: new_id.to_uuid_string(),
            name: new_name.to_string(),
            rows,
            cols,
            cells: vec![],
            ranges,
        };
        mirror.add_sheet(snap)?;

        Ok(new_id)
    }

    // -----------------------------------------------------------------
    // Low-level sheet-map + mirror lifecycle
    // -----------------------------------------------------------------

    /// Test helper that adds a sheet with `ORIGIN_USER_EDIT`.
    #[cfg(test)]
    pub(crate) fn add_sheet(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: SheetId,
        name: &str,
        rows: u32,
        cols: u32,
    ) -> Result<(), ComputeError> {
        self.add_sheet_with_origin(
            mirror,
            sheet_id,
            name,
            rows,
            cols,
            Origin::from(ORIGIN_USER_EDIT),
        )
    }

    /// Add a new sheet with a caller-supplied Yrs `origin`.
    ///
    /// Used by engine-bootstrap callers that need to bypass the undo stack
    /// (see `ORIGIN_BOOTSTRAP` in `compute_document::undo`).
    pub(crate) fn add_sheet_with_origin(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: SheetId,
        name: &str,
        rows: u32,
        cols: u32,
        origin: Origin,
    ) -> Result<(), ComputeError> {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        if self.sheet_exists(&sheet_id) {
            return Err(ComputeError::InvalidInput {
                message: format!("Sheet already exists: {}", sheet_hex),
            });
        }

        {
            let mut txn = self.doc.transact_mut_with(origin);
            write_schema_version(&mut txn, &self.workbook);

            // Append to sheet order — Provider Protocol lifecycle: lazy-create rather
            // than rely on the (now-removed) eager bootstrap from
            // `YrsStorage::new`. See [`YrsStorage::new`] doc-comment for why
            // eager workbook-child creation was removed.
            let order_arr = self.ensure_sheet_order_array(&mut txn);
            order_arr.push_back(&mut txn, Any::String(Arc::from(sheet_hex.as_str())));

            // Create sheet map
            let sheet_map_prelim = MapPrelim::from([] as [(&str, Any); 0]);
            let sheet_map: MapRef = self.sheets.insert(&mut txn, &*sheet_hex, sheet_map_prelim);

            // Meta — store name + platform-appropriate defaults.
            // Row/col counts are derived from YArray lengths (no rows/cols keys).
            let meta = MapPrelim::from([
                (KEY_NAME, Any::String(Arc::from(name))),
                (
                    KEY_DEFAULT_ROW_HEIGHT,
                    Any::Number(domain_types::units::DEFAULT_ROW_HEIGHT.0),
                ),
                (
                    KEY_DEFAULT_COL_WIDTH,
                    Any::Number(
                        domain_types::units::pixels_to_char_width(
                            compute_layout_index::platform_default_col_width(),
                            domain_types::units::platform_mdw(),
                        )
                        .0,
                    ),
                ),
            ]);
            sheet_map.insert(&mut txn, KEY_PROPERTIES, meta);

            // YArray-based row/column ordering (CRDT-safe, insert_range for O(n) bulk insert)
            let id_alloc = IdAllocator::new();
            let row_order = sheet_map.insert(&mut txn, KEY_ROW_ORDER, ArrayPrelim::default());
            let row_hexes: Vec<Any> = (0..rows)
                .map(|_| {
                    let rid = id_alloc.next_row_id();
                    Any::String(Arc::from(id_to_hex(rid.as_u128()).as_str()))
                })
                .collect();
            row_order.insert_range(&mut txn, 0, row_hexes);

            let col_order = sheet_map.insert(&mut txn, KEY_COL_ORDER, ArrayPrelim::default());
            let col_hexes: Vec<Any> = (0..cols)
                .map(|_| {
                    let cid = id_alloc.next_col_id();
                    Any::String(Arc::from(id_to_hex(cid.as_u128()).as_str()))
                })
                .collect();
            col_order.insert_range(&mut txn, 0, col_hexes);

            // Grid index (posToId / idToPos) — authoritative yrs-side identity
            // store post-R51. `cellGrid` / `cellPos` retired.
            let empty_map = || MapPrelim::from([] as [(&str, Any); 0]);
            let gi_map: MapRef = sheet_map.insert(&mut txn, KEY_GRID_INDEX, empty_map());
            gi_map.insert(&mut txn, "posToId", empty_map());
            gi_map.insert(&mut txn, "idToPos", empty_map());

            // All per-sheet sub-maps
            for key in [
                KEY_CELLS,
                KEY_CELL_PROPERTIES,
                KEY_ROW_HEIGHTS,
                KEY_COL_WIDTHS,
                KEY_SCHEMAS,
                KEY_PIVOT_TABLES,
                KEY_MERGES,
                KEY_MANUAL_HIDDEN_ROWS,
                KEY_FILTER_HIDDEN_ROWS,
                KEY_HIDDEN_ROWS,
                KEY_HIDDEN_COLS,
                KEY_ROW_FORMATS,
                KEY_COL_FORMATS,
                KEY_COL_FORMAT_RANGES,
                KEY_COMMENTS,
                KEY_FILTERS,
                KEY_FILTER_METADATA_BINDINGS,
                KEY_SPARKLINES,
                KEY_CONDITIONAL_FORMAT,
                KEY_CF_RULES,
                KEY_BINDINGS,
                KEY_GROUPING,
                KEY_SORTING,
                KEY_FLOATING_OBJECTS,
                KEY_FLOATING_OBJECT_GROUPS,
                KEY_RANGES,
                KEY_RANGE_PAYLOADS,
                KEY_RANGE_FORMATS,
                KEY_RANGE_BINDINGS,
                KEY_VALIDATION_RULES,
            ] {
                let empty = MapPrelim::from([] as [(&str, Any); 0]);
                sheet_map.insert(&mut txn, key, empty);
            }
            sheet_map.insert(&mut txn, KEY_FLOATING_OBJECT_ORDER, ArrayPrelim::default());
        }

        // Update mirror
        let snap = crate::snapshot::SheetSnapshot {
            id: sheet_id.to_uuid_string(),
            name: name.to_string(),
            rows,
            cols,
            cells: vec![],
            ranges: vec![],
        };
        mirror.add_sheet(snap)?;

        Ok(())
    }

    /// Remove a sheet by SheetId. Updates both yrs doc and mirror.
    pub(crate) fn remove_sheet(&mut self, mirror: &mut CellMirror, sheet_id: &SheetId) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());

        {
            let mut txn = self.doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

            // Remove from sheets map
            self.sheets.remove(&mut txn, &sheet_hex);

            // Remove from sheet order array
            if let Some(order_arr) = self.get_sheet_order_array(&txn) {
                let len = order_arr.len(&txn);
                for i in 0..len {
                    if let Some(Out::Any(Any::String(s))) = order_arr.get(&txn, i)
                        && *s == *sheet_hex
                    {
                        order_arr.remove(&mut txn, i);
                        break;
                    }
                }
            }
        }

        // Update mirror
        mirror.remove_sheet(sheet_id);
    }

    /// Get the ordered list of sheet IDs.
    ///
    /// Temporarily `pub` because integration tests reach past the engine into
    /// storage for typed `Vec<SheetId>` enumeration — the engine has no typed
    /// sibling to `get_sheet_order()` yet. Once a typed `engine.sheet_ids()` API
    /// lands and those tests migrate, this should return to `pub(crate)`.
    #[doc(hidden)]
    pub fn sheet_order(&self) -> Vec<SheetId> {
        let txn = self.doc.transact();
        let Some(order_arr) = self.get_sheet_order_array(&txn) else {
            return Vec::new();
        };
        let len = order_arr.len(&txn);
        let mut result = Vec::with_capacity(len as usize);
        for i in 0..len {
            if let Some(Out::Any(Any::String(s))) = order_arr.get(&txn, i)
                && let Some(id) = hex_to_id(&s)
            {
                result.push(SheetId::from_raw(id));
            }
        }
        result
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::super::order::get_sheet_order;
    use super::super::properties::get_sheet_name;
    use super::super::test_support::{make_sheet_id, setup};
    use crate::mirror::CellMirror;
    use crate::storage::YrsStorage;
    use cell_types::IdAllocator;
    use value_types::ComputeError;

    #[test]
    fn test_create_sheet() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let sid = storage
            .create_sheet(&mut mirror, "My Sheet", &*crate::storage::STORAGE_ID_ALLOC)
            .unwrap();
        let order = get_sheet_order(storage.doc(), storage.workbook_map());
        assert_eq!(order.len(), 1);
        assert_eq!(order[0], sid);
        assert_eq!(
            get_sheet_name(storage.doc(), storage.sheets(), &sid),
            Some("My Sheet".to_string())
        );
    }

    #[test]
    fn test_delete_sheet() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = storage
            .create_sheet(&mut mirror, "Sheet1", &*crate::storage::STORAGE_ID_ALLOC)
            .unwrap();
        let s2 = storage
            .create_sheet(&mut mirror, "Sheet2", &*crate::storage::STORAGE_ID_ALLOC)
            .unwrap();
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()).len(),
            2
        );

        storage.delete_sheet(&mut mirror, &s1).unwrap();
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()).len(),
            1
        );
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map())[0],
            s2
        );
    }

    #[test]
    fn test_delete_last_sheet_fails() {
        let (mut storage, mut mirror, sid) = setup();
        let result = storage.delete_sheet(&mut mirror, &sid);
        assert!(result.is_err());
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()).len(),
            1
        );
    }

    #[test]
    fn test_copy_sheet() {
        let (mut storage, mut mirror, sid) = setup();
        let copy_id = storage
            .copy_sheet(
                &mut mirror,
                &sid,
                "Sheet1 (2)",
                &*crate::storage::STORAGE_ID_ALLOC,
            )
            .unwrap();
        assert_ne!(copy_id, sid);

        let order = get_sheet_order(storage.doc(), storage.workbook_map());
        assert_eq!(order.len(), 2);
        // Copy should be inserted after source
        assert_eq!(order[0], sid);
        assert_eq!(order[1], copy_id);

        assert_eq!(
            get_sheet_name(storage.doc(), storage.sheets(), &copy_id),
            Some("Sheet1 (2)".to_string())
        );
    }

    #[test]
    fn test_copy_sheet_skips_existing_allocated_id() {
        let (mut storage, mut mirror, sid) = setup();
        let alloc = IdAllocator::with_seed(1);

        let copy_id = storage
            .copy_sheet(&mut mirror, &sid, "Sheet1 (2)", &alloc)
            .unwrap();

        assert_eq!(copy_id, make_sheet_id(2));
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()),
            vec![sid, copy_id]
        );
        assert_eq!(
            get_sheet_name(storage.doc(), storage.sheets(), &sid),
            Some("Sheet1".to_string())
        );
        assert_eq!(
            get_sheet_name(storage.doc(), storage.sheets(), &copy_id),
            Some("Sheet1 (2)".to_string())
        );
    }

    #[test]
    fn test_create_sheet_skips_existing_allocated_id() {
        let (mut storage, mut mirror, sid) = setup();
        let alloc = IdAllocator::with_seed(1);

        let created_id = storage.create_sheet(&mut mirror, "Sheet2", &alloc).unwrap();

        assert_eq!(created_id, make_sheet_id(2));
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()),
            vec![sid, created_id]
        );
    }

    #[test]
    fn test_add_sheet_rejects_duplicate_id() {
        let (mut storage, mut mirror, sid) = setup();

        let result = storage.add_sheet(&mut mirror, sid, "Duplicate", 10, 5);

        assert!(matches!(result, Err(ComputeError::InvalidInput { .. })));
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()),
            vec![sid]
        );
        assert_eq!(
            get_sheet_name(storage.doc(), storage.sheets(), &sid),
            Some("Sheet1".to_string())
        );
    }

    #[test]
    fn test_delete_nonexistent_sheet() {
        let (mut storage, mut mirror, _sid) = setup();
        // Create a second sheet so deletion is allowed in principle
        storage
            .add_sheet(&mut mirror, make_sheet_id(2), "Sheet2", 10, 5)
            .unwrap();

        let result = storage.delete_sheet(&mut mirror, &make_sheet_id(999));
        assert!(result.is_err());
    }

    #[test]
    fn test_copy_nonexistent_sheet() {
        let (mut storage, mut mirror, _sid) = setup();
        let result = storage.copy_sheet(
            &mut mirror,
            &make_sheet_id(999),
            "Copy",
            &*crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err());
    }
}
