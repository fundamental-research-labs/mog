use std::sync::Arc;

use yrs::{Any, Array, ArrayPrelim, ArrayRef, Map, MapPrelim, MapRef, Transact};

use crate::snapshot::WorkbookSnapshot;
use compute_document::cell_serde::{build_cell_prelim, write_identity_formula_to_yrs};
use compute_document::hex::{cell_id_str_to_hex, id_to_hex};
use compute_document::schema::*;

use cell_types::SheetId;
use value_types::ComputeError;

use crate::storage::YrsStorage;

// ===========================================================================
// Hydration: populate yrs document from snapshot
// ===========================================================================

impl YrsStorage {
    /// Populate only the yrs document from a snapshot (no mirror creation).
    /// Used when the caller creates the CellMirror externally.
    #[tracing::instrument(name = "populate_yrs_only", skip_all)]
    pub fn populate_yrs_only(&mut self, snapshot: WorkbookSnapshot) -> Result<(), ComputeError> {
        self.populate_yrs_doc(&snapshot)
    }

    /// Internal: populate the yrs document from a snapshot.
    fn populate_yrs_doc(&mut self, snapshot: &WorkbookSnapshot) -> Result<(), ComputeError> {
        let _span = tracing::info_span!("populate_yrs_doc").entered();

        // Provider Protocol fix (issue #112, refresh-after-edit):
        // for an EMPTY snapshot (no sheets) we must not eagerly insert any
        // workbook-level child — including `sheetOrder`. The post-reload
        // session boots from `from_snapshot(WorkbookSnapshot::default())`
        // before `apply_sync_update` replays persisted bytes; if THIS
        // session inserts an empty `sheetOrder` array under `workbook`
        // first, both sessions independently inserted the same key under
        // the workbook root map and yrs Map LWW silently shadows one
        // side's struct (see `YrsStorage::new` doc-comment). The
        // post-reload session ends up with its own (empty) `sheetOrder`
        // hiding session A's populated one.
        //
        // Skip the array creation when there are zero sheets to enroll;
        // `ensure_sheet_order_array` on the FIRST `add_sheet_with_origin`
        // (called only for genuinely fresh, no-replay docs) creates it
        // lazily under that single client_id. For snapshots WITH sheets
        // (XLSX import / collaboration fork), we still pre-create the
        // array because we're about to push every sheet id into it
        // inside the same transaction — those writes need a target.
        if snapshot.sheets.is_empty() {
            return Ok(());
        }

        let mut txn = self.doc.transact_mut();

        // Sheet order array — Provider Protocol lifecycle: lazy-create rather than rely
        // on the (now-removed) eager bootstrap from `YrsStorage::new`. See
        // [`YrsStorage::new`] doc-comment for why eager workbook-child
        // creation was removed.
        let order_arr = self.ensure_sheet_order_array(&mut txn);
        let id_alloc = cell_types::IdAllocator::new();

        for sheet_snap in &snapshot.sheets {
            let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
            let sheet_hex = id_to_hex(sheet_id.as_u128());

            // Append sheet id to order array
            order_arr.push_back(&mut txn, Any::String(Arc::from(sheet_hex.as_str())));

            // Create per-sheet map
            let sheet_map_prelim = MapPrelim::from([] as [(&str, Any); 0]);
            let sheet_map: MapRef = self.sheets.insert(&mut txn, &*sheet_hex, sheet_map_prelim);

            // Meta (name only — row/col counts derived from YArray lengths)
            let meta_prelim =
                MapPrelim::from([(KEY_NAME, Any::String(Arc::from(sheet_snap.name.as_str())))]);
            sheet_map.insert(&mut txn, KEY_PROPERTIES, meta_prelim);

            // YArray-based row/column ordering (insert_range for O(n) bulk insert)
            let row_order: ArrayRef =
                sheet_map.insert(&mut txn, KEY_ROW_ORDER, ArrayPrelim::default());
            let mut row_id_hexes = Vec::with_capacity(sheet_snap.rows as usize);
            for _ in 0..sheet_snap.rows {
                let rid = id_alloc.next_row_id();
                row_id_hexes.push(id_to_hex(rid.as_u128()));
            }
            row_order.insert_range(
                &mut txn,
                0,
                row_id_hexes
                    .iter()
                    .map(|h| Any::String(Arc::from(h.as_str()))),
            );

            let col_order: ArrayRef =
                sheet_map.insert(&mut txn, KEY_COL_ORDER, ArrayPrelim::default());
            let mut col_id_hexes = Vec::with_capacity(sheet_snap.cols as usize);
            for _ in 0..sheet_snap.cols {
                let cid = id_alloc.next_col_id();
                col_id_hexes.push(id_to_hex(cid.as_u128()));
            }
            col_order.insert_range(
                &mut txn,
                0,
                col_id_hexes
                    .iter()
                    .map(|h| Any::String(Arc::from(h.as_str()))),
            );

            // Grid index (posToId / idToPos) — authoritative yrs-side identity
            // store post-R51. Populated below as each cell is written so that
            // the yrs doc carries position info for CRDT sync and for
            // `build_sheet_snapshot_from_yrs` bootstrap (e.g. `from_yrs_state`).
            let gi_map: MapRef = sheet_map.insert(
                &mut txn,
                KEY_GRID_INDEX,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
            let pos_to_id: MapRef =
                gi_map.insert(&mut txn, "posToId", MapPrelim::from([] as [(&str, Any); 0]));
            let id_to_pos: MapRef =
                gi_map.insert(&mut txn, "idToPos", MapPrelim::from([] as [(&str, Any); 0]));

            // Cells
            let cells_prelim = MapPrelim::from([] as [(&str, Any); 0]);
            let cells_map: MapRef = sheet_map.insert(&mut txn, KEY_CELLS, cells_prelim);

            for cell_data in &sheet_snap.cells {
                let cell_hex = cell_id_str_to_hex(&cell_data.cell_id)?;
                let cell_prelim = build_cell_prelim(
                    &cell_data.value,
                    cell_data.formula.as_deref(),
                    cell_data.identity_formula.as_ref(),
                );
                let cell_map: MapRef = cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
                if let Some(idf) = &cell_data.identity_formula {
                    write_identity_formula_to_yrs(&cell_map, &mut txn, idf).map_err(|e| {
                        ComputeError::InternalPanic {
                            message: e.to_string(),
                        }
                    })?;
                }

                // Write position into gridIndex/{posToId,idToPos}. Key format:
                //   posToId: "rowHex:colHex" -> cell hex
                //   idToPos: cell hex        -> "rowHex:colHex"
                // Row/col ids are stable across structural ops; position
                // indices are derived via rowOrder/colOrder at read time.
                if let (Some(rh), Some(ch)) = (
                    row_id_hexes.get(cell_data.row as usize),
                    col_id_hexes.get(cell_data.col as usize),
                ) {
                    let pos_key = format!("{}:{}", rh, ch);
                    pos_to_id.insert(
                        &mut txn,
                        &*pos_key,
                        Any::String(Arc::from(cell_hex.as_str())),
                    );
                    id_to_pos.insert(
                        &mut txn,
                        &*cell_hex,
                        Any::String(Arc::from(pos_key.as_str())),
                    );
                }
            }

            // All per-sheet sub-maps
            for key in [
                KEY_CELL_PROPERTIES,
                KEY_ROW_HEIGHTS,
                KEY_COL_WIDTHS,
                KEY_SCHEMAS,
                KEY_PIVOT_TABLES,
                KEY_MERGES,
                KEY_MERGE_BACKUPS,
                KEY_MANUAL_HIDDEN_ROWS,
                KEY_FILTER_HIDDEN_ROWS,
                KEY_HIDDEN_ROWS,
                KEY_HIDDEN_COLS,
                KEY_ROW_FORMATS,
                KEY_COL_FORMATS,
                KEY_COL_FORMAT_RANGES,
                KEY_COMMENTS,
                KEY_FILTERS,
                KEY_SPARKLINES,
                KEY_CONDITIONAL_FORMAT,
                KEY_BINDINGS,
                KEY_GROUPING,
                KEY_SORTING,
                KEY_FLOATING_OBJECTS,
                KEY_FLOATING_OBJECT_GROUPS,
                KEY_RANGES,
                KEY_RANGE_PAYLOADS,
                KEY_RANGE_FORMATS,
                KEY_RANGE_BINDINGS,
                KEY_CF_RULES,
                KEY_VALIDATION_RULES,
            ] {
                let empty = MapPrelim::from([] as [(&str, Any); 0]);
                sheet_map.insert(&mut txn, key, empty);
            }
            sheet_map.insert(&mut txn, KEY_FLOATING_OBJECT_ORDER, ArrayPrelim::default());

            // Populate Range data into the sub-maps we just created.
            if !sheet_snap.ranges.is_empty()
                && let Some(yrs::Out::YMap(ranges_map)) = sheet_map.get(&txn, KEY_RANGES)
                && let Some(yrs::Out::YMap(payloads_map)) = sheet_map.get(&txn, KEY_RANGE_PAYLOADS)
            {
                for range_data in &sheet_snap.ranges {
                    let metadata = compute_document::range::RangeMetadata {
                        range_id: range_data.range_id,
                        kind: range_data.kind,
                        anchor: range_data.anchor.clone(),
                        encoding: range_data.encoding,
                        row_axis: range_data.row_axis.clone(),
                        col_axis: range_data.col_axis.clone(),
                        row_ids: range_data.row_ids.clone(),
                        col_ids: range_data.col_ids.clone(),
                    };
                    compute_document::range::write_range_to_yrs(
                        &mut txn,
                        &ranges_map,
                        &payloads_map,
                        &metadata,
                        &range_data.payload,
                    );
                }
            }
        }

        // Provider Protocol lifecycle (Provider Protocol): workbook-level domain maps
        // (`workbookSettings`, `namedRanges`, `tables`, …) are NOT eagerly
        // pre-created here. Eager bulk-inserts under the workbook root map
        // cause a yrs Map LWW clash on independent-session replay (issue
        // #112) — the same root cause that motivated removing the eager
        // bootstrap from `YrsStorage::new`. Each domain's writer ensures
        // its own sub-map via the per-domain `ensure_*` helpers (e.g.
        // `ensure_named_ranges_map`, `settings::ensure_settings_map`,
        // …) which call `crate::storage::ensure_workbook_child_map` with
        // the right `KEY_*`.
        //
        // For the snapshot-with-sheets case (XLSX import / collaboration
        // fork): when actual workbook-level data is being hydrated (named
        // ranges, tables, settings), the corresponding writer creates the
        // sub-map on first write. When there's no data, the sub-map stays
        // absent — readers handle `None` gracefully via existing match
        // patterns.

        // Stamp schema version on every snapshot hydration so the document
        // carries the sentinel for future readers.
        crate::storage::workbook::data_tables::hydrate_data_table_regions(
            &self.workbook,
            &snapshot.data_table_regions,
            &mut txn,
        );
        write_schema_version(&mut txn, &self.workbook);

        Ok(())
    }
}
