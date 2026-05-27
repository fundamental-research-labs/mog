use super::*;

pub(in crate::storage::engine) fn build_grid_indexes_from_yrs(
    storage: &crate::storage::YrsStorage,
    snapshot: &WorkbookSnapshot,
    grid_id_alloc: Arc<IdAllocator>,
) -> Result<FxHashMap<SheetId, GridIndex>, ComputeError> {
    use crate::storage::infra::grid_helpers;

    let mut grid_indexes = FxHashMap::default();
    for sheet_snap in &snapshot.sheets {
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

        // Try reading compact axis stores, legacy rowOrder/colOrder, and the
        // authoritative position index from Yrs.
        let (row_axis, col_axis, row_hexes, col_hexes, pos_to_id_entries) = {
            let txn = storage.doc().transact();
            let sheet_map = match storage.sheets().get(&txn, &sheet_hex) {
                Some(yrs::Out::YMap(m)) => Some(m),
                _ => None,
            };
            if let Some(sm) = sheet_map {
                let grid_index_map = sm
                    .get(&txn, compute_document::schema::KEY_GRID_INDEX)
                    .and_then(|out| match out {
                        yrs::Out::YMap(grid_index_map) => Some(grid_index_map),
                        _ => None,
                    });
                let row_axis = grid_index_map.as_ref().and_then(|grid_index_map| {
                    compute_document::schema::read_grid_row_axis(&txn, grid_index_map)
                });
                let col_axis = grid_index_map.as_ref().and_then(|grid_index_map| {
                    compute_document::schema::read_grid_col_axis(&txn, grid_index_map)
                });
                let rh = grid_helpers::get_row_order_array(&sm, &txn)
                    .map(|a| grid_helpers::read_row_order(&a, &txn))
                    .unwrap_or_default();
                let ch = grid_helpers::get_col_order_array(&sm, &txn)
                    .map(|a| grid_helpers::read_col_order(&a, &txn))
                    .unwrap_or_default();
                let pos_to_id_entries = grid_index_map
                    .and_then(|grid_index_map| {
                        grid_index_map.get(&txn, compute_document::schema::KEY_GRID_POS_TO_ID)
                    })
                    .and_then(|out| match out {
                        yrs::Out::YMap(pos_to_id) => Some(
                            pos_to_id
                                .iter(&txn)
                                .filter_map(|(pos_key, value)| match value {
                                    yrs::Out::Any(Any::String(cell_hex)) => {
                                        Some((pos_key.to_string(), cell_hex.to_string()))
                                    }
                                    _ => None,
                                })
                                .collect::<Vec<_>>(),
                        ),
                        _ => None,
                    })
                    .unwrap_or_default();
                (row_axis, col_axis, rh, ch, pos_to_id_entries)
            } else {
                (None, None, vec![], vec![], vec![])
            }
        };

        let mut grid = if let (Some(row_axis), Some(col_axis)) = (row_axis, col_axis) {
            GridIndex::from_axis_stores(sheet_id, row_axis, col_axis, grid_id_alloc.clone())
        } else if !row_hexes.is_empty() || !col_hexes.is_empty() {
            GridIndex::from_yrs_arrays(sheet_id, &row_hexes, &col_hexes, grid_id_alloc.clone())
        } else {
            GridIndex::new(
                sheet_id,
                sheet_snap.rows,
                sheet_snap.cols,
                grid_id_alloc.clone(),
            )
        };

        for (pos_key, cell_hex) in pos_to_id_entries {
            let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                continue;
            };
            let (Some(row), Some(col)) = (
                grid.row_index_from_hex(row_hex),
                grid.col_index_from_hex(col_hex),
            ) else {
                continue;
            };
            if let Some(cell_raw) = hex_to_id(&cell_hex) {
                grid.register_cell(CellId::from_raw(cell_raw), row, col);
            }
        }

        for cell_data in &sheet_snap.cells {
            let cell_id = CellId::from_uuid_str(&cell_data.cell_id)?;
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
        grid_indexes.insert(sheet_id, grid);
    }
    Ok(grid_indexes)
}

/// Build `GridIndex` maps from the same row/column identities used to create
/// snapshot ranges during XLSX import.
///
/// Range payloads store RowId/ColId, not physical row/column numbers. Deferred
/// first-paint import cannot allocate fresh axes here or the mirror cannot map
/// range identities back to sheet positions when it materializes `col_data`.
pub(in crate::storage::engine) fn build_grid_indexes_from_allocations_range(
    snapshot: &WorkbookSnapshot,
    allocations: &[crate::storage::infra::hydration::SheetIdAllocation],
    range: std::ops::Range<usize>,
    grid_id_alloc: Arc<IdAllocator>,
) -> Result<FxHashMap<SheetId, GridIndex>, ComputeError> {
    let mut grid_indexes = FxHashMap::default();
    for i in range {
        let sheet_snap = &snapshot.sheets[i];
        let allocation = allocations
            .get(i)
            .ok_or_else(|| ComputeError::Deserialize {
                message: format!("missing sheet ID allocation for sheet index {i}"),
            })?;
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let mut grid = GridIndex::from_axis_stores(
            sheet_id,
            AxisIdentityStore::Explicit(allocation.row_ids.clone()),
            AxisIdentityStore::Explicit(allocation.col_ids.clone()),
            grid_id_alloc.clone(),
        );
        for cell_data in &sheet_snap.cells {
            let cell_id = CellId::from_uuid_str(&cell_data.cell_id)?;
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
        for identity in &allocation.identity_only_cells {
            grid.register_cell(identity.cell_id, identity.row, identity.col);
        }
        grid_indexes.insert(sheet_id, grid);
    }
    Ok(grid_indexes)
}

/// Build merge spatial indexes from ParseOutput for a range of sheets.
pub(in crate::storage::engine) fn build_merge_indexes_from_parse_output_range(
    parse_output: &domain_types::ParseOutput,
    snapshot: &WorkbookSnapshot,
    range: std::ops::Range<usize>,
) -> Result<FxHashMap<SheetId, RangeSpatialIndex<MergeSpatialItem>>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for i in range {
        let sheet_snap = &snapshot.sheets[i];
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let sheet_data = &parse_output.sheets[i];
        let items: Vec<MergeSpatialItem> = sheet_data
            .merges
            .iter()
            .enumerate()
            .map(|(idx, m)| {
                let id = format!("merge_{}", idx);
                MergeSpatialItem {
                    id,
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                    range_ref: MergeRangeRef {
                        start_row: m.start_row,
                        start_col: m.start_col,
                        end_row: m.end_row,
                        end_col: m.end_col,
                    },
                }
            })
            .collect();
        indexes.insert(sheet_id, RangeSpatialIndex::with_items(items));
    }
    Ok(indexes)
}

/// Build `LayoutIndex` from ParseOutput for a range of sheets.
pub(in crate::storage::engine) fn build_layout_indexes_from_parse_output_range(
    parse_output: &domain_types::ParseOutput,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
    range: std::ops::Range<usize>,
) -> Result<FxHashMap<SheetId, LayoutIndex>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for i in range {
        let sheet_snap = &snapshot.sheets[i];
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let sheet_data = &parse_output.sheets[i];
        let dims = &sheet_data.dimensions;

        let mdw = domain_types::units::platform_mdw();
        let default_row_height_pt = domain_types::units::Points(
            dims.default_row_height
                .unwrap_or(dimensions::DEFAULT_ROW_HEIGHT.0),
        );
        let default_col_width_cw = domain_types::units::CharWidth(
            dims.default_col_width
                .unwrap_or(dimensions::DEFAULT_COL_WIDTH.0),
        );
        let default_row_height_px = domain_types::units::points_to_pixels(default_row_height_pt);
        let default_col_width_px =
            domain_types::units::char_width_to_pixels(default_col_width_cw, mdw);

        let custom_row_heights: Vec<(usize, domain_types::units::Pixels)> = dims
            .row_heights
            .iter()
            .filter(|r| r.custom_height)
            .map(|r| {
                (
                    r.row as usize,
                    domain_types::units::points_to_pixels(domain_types::units::Points(r.height)),
                )
            })
            .collect();
        let custom_col_widths: Vec<(usize, domain_types::units::Pixels)> = dims
            .col_widths
            .iter()
            .filter(|c| c.custom_width)
            .map(|c| {
                (
                    c.col as usize,
                    domain_types::units::char_width_to_pixels(
                        domain_types::units::CharWidth(c.width),
                        mdw,
                    ),
                )
            })
            .collect();

        let hidden_rows: Vec<usize> = dims
            .row_heights
            .iter()
            .filter(|r| r.hidden)
            .map(|r| r.row as usize)
            .collect();
        let hidden_cols: Vec<usize> = dims
            .col_widths
            .iter()
            .filter(|c| c.hidden)
            .map(|c| c.col as usize)
            .collect();

        let _gi = grid_indexes.get(&sheet_id);
        let li = LayoutIndex::from_sparse(
            sheet_snap.rows as usize,
            sheet_snap.cols as usize,
            default_row_height_px,
            default_col_width_px,
            custom_row_heights,
            custom_col_widths,
            hidden_rows.into_iter(),
            hidden_cols.into_iter(),
        );
        indexes.insert(sheet_id, li);
    }
    Ok(indexes)
}

/// Build merge spatial indexes for every sheet.
pub(in crate::storage::engine) fn build_merge_indexes(
    storage: &YrsStorage,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, compute_document::identity::GridIndex>,
) -> Result<FxHashMap<SheetId, RangeSpatialIndex<MergeSpatialItem>>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for sheet_snap in &snapshot.sheets {
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let resolved = match grid_indexes.get(&sheet_id) {
            Some(grid) => merges::get_all_merges(storage.doc(), storage.sheets(), sheet_id, grid),
            None => Vec::new(),
        };
        let items: Vec<MergeSpatialItem> = resolved
            .iter()
            .map(|m| MergeSpatialItem {
                id: m.merge.top_left_id.clone(),
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
                range_ref: MergeRangeRef {
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                },
            })
            .collect();
        indexes.insert(sheet_id, RangeSpatialIndex::with_items(items));
    }
    Ok(indexes)
}

/// Build `LayoutIndex` for every sheet from dimension data.
pub(in crate::storage::engine) fn build_layout_indexes(
    storage: &YrsStorage,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
) -> Result<FxHashMap<SheetId, LayoutIndex>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for sheet_snap in &snapshot.sheets {
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let gi = grid_indexes.get(&sheet_id);
        let li =
            build_layout_index_for_sheet(storage, &sheet_id, sheet_snap.rows, sheet_snap.cols, gi);
        indexes.insert(sheet_id, li);
    }
    Ok(indexes)
}

/// Build a `LayoutIndex` for a single sheet.
pub(in crate::storage::engine) fn build_layout_index_for_sheet(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    rows: u32,
    cols: u32,
    grid_index: Option<&GridIndex>,
) -> LayoutIndex {
    use crate::storage::sheet::properties;

    // Read canonical units (points / char-width) from Yrs metadata
    let meta = properties::get_sheet_meta(storage.doc(), storage.sheets(), sheet_id);
    let default_row_height_pt = meta
        .as_ref()
        .map(|m| domain_types::units::Points(m.default_row_height))
        .unwrap_or(dimensions::DEFAULT_ROW_HEIGHT);
    let default_col_width_cw = meta
        .as_ref()
        .map(|m| domain_types::units::CharWidth(m.default_col_width))
        .unwrap_or(dimensions::DEFAULT_COL_WIDTH);

    // Convert canonical → pixels for the LayoutIndex (rendering concern)
    let mdw = domain_types::units::platform_mdw();
    let default_row_height_px = domain_types::units::points_to_pixels(default_row_height_pt);
    let default_col_width_px = domain_types::units::char_width_to_pixels(default_col_width_cw, mdw);

    // Read custom dimensions (canonical units from Yrs) and convert to pixels
    let custom_row_heights: Vec<(usize, domain_types::units::Pixels)> =
        dimensions::get_all_custom_row_heights(
            storage.doc(),
            storage.sheets(),
            sheet_id,
            grid_index,
        )
        .into_iter()
        .map(|(row, pt)| (row, domain_types::units::points_to_pixels(pt)))
        .collect();
    let custom_col_widths: Vec<(usize, domain_types::units::Pixels)> =
        dimensions::get_all_custom_col_widths(
            storage.doc(),
            storage.sheets(),
            sheet_id,
            grid_index,
        )
        .into_iter()
        .map(|(col, cw)| (col, domain_types::units::char_width_to_pixels(cw, mdw)))
        .collect();

    let mut hidden_rows = dimensions::get_hidden_rows(storage.doc(), storage.sheets(), sheet_id);
    hidden_rows.extend(grouping::get_rows_hidden_by_collapsed_groups(
        storage.doc(),
        storage.sheets(),
        sheet_id,
    ));
    hidden_rows.sort_unstable();
    hidden_rows.dedup();

    let mut hidden_cols = dimensions::get_hidden_columns(storage.doc(), storage.sheets(), sheet_id);
    hidden_cols.extend(grouping::get_columns_hidden_by_collapsed_groups(
        storage.doc(),
        storage.sheets(),
        sheet_id,
    ));
    hidden_cols.sort_unstable();
    hidden_cols.dedup();
    LayoutIndex::from_sparse(
        rows as usize,
        cols as usize,
        default_row_height_px,
        default_col_width_px,
        custom_row_heights,
        custom_col_widths,
        hidden_rows.into_iter().map(|r| r as usize),
        hidden_cols.into_iter().map(|c| c as usize),
    )
}
