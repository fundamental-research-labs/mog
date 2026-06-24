use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, MutationResult, PivotTableChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::pivots;
use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use compute_pivot::PivotTableDefExt;
use domain_types::CellFormat;
use domain_types::domain::pivot::PivotTableConfig;
use ooxml_types::styles::PatternType;
use value_types::ComputeError;
use yrs::{Origin, Transact};

pub(in crate::storage::engine) fn pivot_create_with_sheet_inner(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: PivotTableConfig,
) -> Result<PivotTableConfig, ComputeError> {
    pivots::create_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )
}

// -------------------------------------------------------------------
// Comments (self-contained — no viewport patch calls)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn pivot_create(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: PivotTableConfig,
) -> Result<MutationResult, ComputeError> {
    let pivot_config = pivots::create_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )?;
    let mut result = MutationResult::empty();
    result.pivot_changes.push(PivotTableChange {
        sheet_id: sheet_id.to_uuid_string(),
        pivot_id: pivot_config.id.clone(),
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&pivot_config)?)
}

pub(in crate::storage::engine) fn pivot_update(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
    config: PivotTableConfig,
) -> Result<MutationResult, ComputeError> {
    let updated = pivots::update_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
        config,
    );
    let mut result = MutationResult::empty();
    if updated.is_some() {
        result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot_id.to_string(),
            kind: ChangeKind::Set,
        });
    }
    Ok(result.with_data(&updated)?)
}

pub(in crate::storage::engine) fn pivot_delete(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Result<MutationResult, ComputeError> {
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let deleted =
        pivots::delete_pivot_in_txn(&mut txn, stores.storage.sheets(), sheet_id, pivot_id);
    let mut result = MutationResult::empty();
    if deleted {
        crate::storage::workbook::imported_pivots::mark_native_pivot_deleted_in_txn(
            &mut txn,
            stores.storage.workbook_map(),
            pivot_id,
        );
        result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot_id.to_string(),
            kind: ChangeKind::Removed,
        });
    }
    Ok(result.with_data(&deleted)?)
}

pub(in crate::storage::engine) fn pivot_get(
    stores: &EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Option<PivotTableConfig> {
    pivots::get_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    )
}

pub(in crate::storage::engine) fn pivot_get_all(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<PivotTableConfig> {
    pivots::get_all_pivots(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn resolve_pivot_format_at_cell(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellFormat> {
    let pivot = mirror.find_pivot_table_at(sheet_id, row, col)?;
    if !is_supported_light_pivot_style(pivot.style.as_ref()?.style_name.as_deref()) {
        return None;
    }

    let row_offset = row.checked_sub(pivot.start_row)?;
    let col_offset = col.checked_sub(pivot.start_col)?;
    let style = pivot.style.as_ref()?;
    let show_header_style =
        style.show_row_headers.unwrap_or(true) || style.show_column_headers.unwrap_or(true);
    let is_header_row = show_header_style && row_offset < pivot.first_data_row;
    let is_row_grand_total = pivot.show_row_grand_totals.unwrap_or(true) && row == pivot.end_row;

    if !is_header_row && !is_row_grand_total {
        return None;
    }

    let mut format = CellFormat {
        bold: Some(true),
        background_color: Some("#d9e1f2".to_string()),
        pattern_type: Some(PatternType::Solid),
        ..CellFormat::default()
    };

    if is_row_grand_total && col_offset >= pivot.first_data_col {
        format.number_format = Some("General".to_string());
    }

    Some(format)
}

fn is_supported_light_pivot_style(style_name: Option<&str>) -> bool {
    matches!(style_name, Some(name) if name.eq_ignore_ascii_case("PivotStyleLight16"))
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn pivot_register_def(
    stores: &EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    pivot_id: &str,
    total_rows: u32,
    total_cols: u32,
    first_data_row: u32,
    first_data_col: u32,
) -> Result<MutationResult, ComputeError> {
    let config = pivots::get_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    )
    .ok_or_else(|| ComputeError::Eval {
        message: format!("pivot_register_def: pivot {pivot_id} not found on sheet {sheet_id}"),
    })?;

    let bounds = compute_pivot::PivotRenderedBounds {
        total_rows,
        total_cols,
        first_data_row,
        first_data_col,
        num_data_cols: 0,
    };
    let output_sheet_id = config
        .output_sheet_id
        .as_deref()
        .and_then(|sheet_id| SheetId::from_uuid_str(sheet_id).ok())
        .or_else(|| mirror.sheet_by_name(&config.output_sheet_name))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: config
                .output_sheet_id
                .clone()
                .unwrap_or_else(|| config.output_sheet_name.clone()),
        })?;

    let engine_config =
        compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| ComputeError::Eval {
            message: format!("Pivot config conversion error: {e}"),
        })?;
    let def = engine_config.to_pivot_table_def(&bounds, &output_sheet_id);
    mirror.upsert_pivot_table_def(def);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn pivot_unregister_def(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    pivot_name: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_uuid = sheet_id.to_uuid_string();
    mirror.remove_pivot_table_def(pivot_name, &sheet_uuid);
    Ok(MutationResult::empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::domain::pivot::PivotTableStyle;
    use snapshot_types::PivotTableDef;

    fn mirror_with_light16_pivot(
        sheet_id: &SheetId,
        show_row_grand_totals: Option<bool>,
    ) -> CellMirror {
        let mut mirror = CellMirror::new();
        mirror.upsert_pivot_table_def(PivotTableDef {
            id: "pivot-1".to_string(),
            name: "Pivot1".to_string(),
            sheet: sheet_id.to_uuid_string(),
            start_row: 16,
            start_col: 2,
            end_row: 35,
            end_col: 6,
            rendered_rows: Some(20),
            rendered_cols: Some(5),
            first_data_row: 2,
            first_data_col: 1,
            data_field_names: vec![],
            cache_field_names: vec![],
            row_field_indices: vec![],
            col_field_indices: vec![],
            data_on_rows: false,
            style: Some(PivotTableStyle {
                style_name: Some("PivotStyleLight16".to_string()),
                show_row_headers: Some(true),
                show_column_headers: Some(true),
                show_row_stripes: Some(false),
                show_column_stripes: Some(false),
                show_last_column: Some(true),
            }),
            show_row_grand_totals,
            show_column_grand_totals: Some(true),
        });
        mirror
    }

    #[test]
    fn pivot_light16_styles_headers_and_grand_total_data_cells() {
        let sheet_id = SheetId::from_raw(40);
        let mirror = mirror_with_light16_pivot(&sheet_id, Some(true));

        let header = resolve_pivot_format_at_cell(&mirror, &sheet_id, 17, 5).expect("header");
        assert_eq!(header.bold, Some(true));
        assert_eq!(header.background_color.as_deref(), Some("#d9e1f2"));
        assert_eq!(header.pattern_type, Some(PatternType::Solid));
        assert_eq!(header.number_format, None);

        assert!(resolve_pivot_format_at_cell(&mirror, &sheet_id, 18, 5).is_none());

        let grand_total_label =
            resolve_pivot_format_at_cell(&mirror, &sheet_id, 35, 2).expect("grand total label");
        assert_eq!(grand_total_label.bold, Some(true));
        assert_eq!(
            grand_total_label.background_color.as_deref(),
            Some("#d9e1f2")
        );
        assert_eq!(grand_total_label.number_format, None);

        let grand_total_value =
            resolve_pivot_format_at_cell(&mirror, &sheet_id, 35, 3).expect("grand total value");
        assert_eq!(grand_total_value.bold, Some(true));
        assert_eq!(
            grand_total_value.background_color.as_deref(),
            Some("#d9e1f2")
        );
        assert_eq!(grand_total_value.pattern_type, Some(PatternType::Solid));
        assert_eq!(grand_total_value.number_format.as_deref(), Some("General"));
    }

    #[test]
    fn pivot_light16_respects_disabled_row_grand_totals() {
        let sheet_id = SheetId::from_raw(41);
        let mirror = mirror_with_light16_pivot(&sheet_id, Some(false));

        assert!(resolve_pivot_format_at_cell(&mirror, &sheet_id, 35, 3).is_none());
    }
}
