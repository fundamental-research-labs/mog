use std::collections::BTreeSet;

use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions, get_meta_for_export};
use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::yrs_schema;
use yrs::{Origin, Transact};

pub(super) fn unhide_expanded_row_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
) {
    let zero_height_rows = (start..=end)
        .filter(|row| {
            dimensions::get_row_height_stored(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                *row,
                stores.grid_indexes.get(sheet_id),
            )
            .0
            .abs()
                < f64::EPSILON
        })
        .collect::<BTreeSet<_>>();

    clear_expanded_row_group_metadata(stores, sheet_id, start, end, &zero_height_rows);

    for row in &zero_height_rows {
        let _ = dimensions::set_row_height(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            *row,
            dimensions::DEFAULT_ROW_HEIGHT,
            stores.grid_indexes.get(sheet_id),
        );
    }

    let default_height_px = domain_types::units::points_to_pixels(dimensions::DEFAULT_ROW_HEIGHT);
    if let Some(layout) = stores.layout_indexes.get_mut(sheet_id) {
        for row in zero_height_rows {
            layout.set_row_height(row as usize, default_height_px);
        }
    }
}

fn clear_expanded_row_group_metadata(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
    zero_height_rows: &BTreeSet<u32>,
) {
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(meta) = get_meta_for_export(&txn, stores.storage.sheets(), sheet_id) else {
        return;
    };

    let marker_end = end.saturating_add(1);
    let mut collapsed_rows =
        yrs_schema::helpers::read_json_vec::<_, (u32, bool)>(&meta, &txn, "rowCollapsed");
    let original_len = collapsed_rows.len();
    collapsed_rows.retain(|(row, _)| *row < start || *row > marker_end);
    if collapsed_rows.len() != original_len {
        yrs_schema::helpers::write_json_vec(&meta, &mut txn, "rowCollapsed", &collapsed_rows);
    }

    let mut explicit_hidden_rows =
        yrs_schema::helpers::read_json_vec::<_, u32>(&meta, &txn, "rowExplicitHidden");
    let original_len = explicit_hidden_rows.len();
    explicit_hidden_rows.retain(|row| *row < start || *row > end);
    if explicit_hidden_rows.len() != original_len {
        yrs_schema::helpers::write_json_vec(
            &meta,
            &mut txn,
            "rowExplicitHidden",
            &explicit_hidden_rows,
        );
    }

    if zero_height_rows.is_empty() {
        return;
    }
    let mut custom_height_rows =
        yrs_schema::helpers::read_json_vec::<_, u32>(&meta, &txn, "rowCustomHeight");
    let original_len = custom_height_rows.len();
    custom_height_rows.retain(|row| !zero_height_rows.contains(row));
    if custom_height_rows.len() != original_len {
        yrs_schema::helpers::write_json_vec(
            &meta,
            &mut txn,
            "rowCustomHeight",
            &custom_height_rows,
        );
    }
}

pub(super) fn unhide_expanded_column_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
) {
    clear_expanded_column_group_collapsed_markers(stores, sheet_id, start, end);

    let cols: Vec<u32> = (start..=end).collect();
    dimensions::unhide_columns(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cols,
    );
}

fn clear_expanded_column_group_collapsed_markers(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
) {
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(meta) = get_meta_for_export(&txn, stores.storage.sheets(), sheet_id) else {
        return;
    };

    let mut collapsed_cols =
        yrs_schema::helpers::read_json_vec::<_, u32>(&meta, &txn, "colCollapsed");
    let marker_end = end.saturating_add(1);
    let original_len = collapsed_cols.len();
    collapsed_cols.retain(|col| *col < start || *col > marker_end);
    if collapsed_cols.len() != original_len {
        yrs_schema::helpers::write_json_vec(&meta, &mut txn, "colCollapsed", &collapsed_cols);
    }
}
