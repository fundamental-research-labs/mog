use std::collections::BTreeMap;

use cell_types::{SheetId, SheetPos};
use compute_document::hex::{SmallHex, id_to_hex};
use compute_document::undo::ORIGIN_FORMULA_RESULT;
use domain_types::CellFormat;
use domain_types::domain::pivot::{PivotTableConfig, ShowValuesAs, ShowValuesAsConfig};
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::storage::properties;

use super::{YrsComputeEngine, services, stores::EngineStores};

fn is_percent_show_values_as(show_values_as: Option<&ShowValuesAsConfig>) -> bool {
    matches!(
        show_values_as.map(|config| &config.calculation_type),
        Some(
            ShowValuesAs::PercentOfGrandTotal
                | ShowValuesAs::PercentOfColumnTotal
                | ShowValuesAs::PercentOfRowTotal
                | ShowValuesAs::PercentOfParentRowTotal
                | ShowValuesAs::PercentOfParentColumnTotal
                | ShowValuesAs::PercentDifference
                | ShowValuesAs::PercentRunningTotal
        )
    )
}

fn pivot_value_number_formats(config: &PivotTableConfig) -> Vec<Option<String>> {
    config
        .value_placements()
        .into_iter()
        .map(|placement| {
            placement.number_format.clone().or_else(|| {
                if is_percent_show_values_as(placement.show_values_as.as_ref()) {
                    Some("0%".to_string())
                } else {
                    None
                }
            })
        })
        .collect()
}

pub(in crate::storage::engine) fn apply_pivot_value_number_formats(
    stores: &EngineStores,
    mirror: &CellMirror,
    output_sheet_id: &SheetId,
    anchor_row: u32,
    anchor_col: u32,
    config: &PivotTableConfig,
    result: &compute_pivot::PivotTableResult,
) {
    let value_formats = pivot_value_number_formats(config);
    if value_formats.is_empty() {
        return;
    }

    let bounds = &result.rendered_bounds;
    if bounds.total_rows == 0 || bounds.total_cols == 0 {
        return;
    }

    let mut cells_by_format: BTreeMap<String, Vec<SmallHex>> = BTreeMap::new();
    let mut record_cell = |row: u32, col: u32, value_index: usize| {
        let Some(format) = value_formats
            .get(value_index % value_formats.len())
            .and_then(|format| format.as_ref())
        else {
            return;
        };
        let Some(cell_id) = mirror.resolve_cell_id(output_sheet_id, SheetPos::new(row, col)) else {
            return;
        };
        cells_by_format
            .entry(format.clone())
            .or_default()
            .push(id_to_hex(cell_id.as_u128()));
    };

    let first_data_row = anchor_row + bounds.first_data_row;
    let first_data_col = anchor_col + bounds.first_data_col;

    for (row_index, pivot_row) in result.rows.iter().enumerate() {
        let row = first_data_row + row_index as u32;
        for (value_index, _value) in pivot_row.values.iter().enumerate() {
            record_cell(row, first_data_col + value_index as u32, value_index);
        }
    }

    if let Some(row_totals) = result.grand_totals.row.as_ref() {
        let row = anchor_row + bounds.total_rows - 1;
        for (value_index, _value) in row_totals.iter().enumerate() {
            record_cell(row, first_data_col + value_index as u32, value_index);
        }
    }

    let value_field_count = value_formats.len() as u32;
    let grand_total_start_col = bounds
        .total_cols
        .checked_sub(value_field_count)
        .map(|offset| anchor_col + offset);

    if let (Some(column_totals), Some(start_col)) =
        (result.grand_totals.column.as_ref(), grand_total_start_col)
    {
        for (row_index, row_totals) in column_totals.iter().enumerate() {
            let row = first_data_row + row_index as u32;
            for (value_index, _value) in row_totals.iter().enumerate() {
                record_cell(row, start_col + value_index as u32, value_index);
            }
        }
    }

    if let (Some(grand_totals), Some(start_col)) =
        (result.grand_totals.grand.as_ref(), grand_total_start_col)
    {
        let row = anchor_row + bounds.total_rows - 1;
        for (value_index, _value) in grand_totals.iter().enumerate() {
            record_cell(row, start_col + value_index as u32, value_index);
        }
    }

    for (number_format, cell_hexes) in cells_by_format {
        let cell_hex_refs: Vec<&str> = cell_hexes.iter().map(|hex| hex.as_str()).collect();
        let format = CellFormat {
            number_format: Some(number_format),
            ..Default::default()
        };
        properties::set_cell_formats_with_origin(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            output_sheet_id,
            &cell_hex_refs,
            &format,
            ORIGIN_FORMULA_RESULT,
        );
    }
}

impl YrsComputeEngine {
    /// Materialize all pivot tables across all sheets after recalc.
    pub(in crate::storage::engine) fn materialize_all_pivots_for_import_open(
        stores: &mut EngineStores,
        mirror: &mut CellMirror,
    ) {
        use compute_pivot::{PivotEngineConfig, PivotTableDefExt};

        fn source_sheet_id(
            mirror: &CellMirror,
            config: &domain_types::domain::pivot::PivotTableConfig,
        ) -> Result<SheetId, ComputeError> {
            if let Some(source_sheet_id) = config.source_sheet_id.as_deref() {
                let source_id = SheetId::from_uuid_str(source_sheet_id).map_err(|e| {
                    ComputeError::InvalidInput {
                        message: format!("Invalid pivot sourceSheetId '{source_sheet_id}': {e}"),
                    }
                })?;
                if mirror.get_sheet(&source_id).is_some() {
                    return Ok(source_id);
                }
                return Err(ComputeError::SheetNotFound {
                    sheet_id: source_sheet_id.to_string(),
                });
            }

            mirror
                .sheet_by_name(&config.source_sheet_name)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: config.source_sheet_name.clone(),
                })
        }

        fn compute_from_source(
            stores: &EngineStores,
            mirror: &CellMirror,
            sheet_id: &SheetId,
            pivot_id: &str,
        ) -> Result<compute_pivot::PivotTableResult, ComputeError> {
            let config =
                services::objects::pivot_get(stores, sheet_id, pivot_id).ok_or_else(|| {
                    ComputeError::Eval {
                        message: format!("Pivot table '{pivot_id}' not found"),
                    }
                })?;

            let range = &config.source_range;
            let total_cells = (range.end_row() as u64 - range.start_row() as u64 + 1)
                * (range.end_col() as u64 - range.start_col() as u64 + 1);
            if total_cells > 10_000_000 {
                return Err(ComputeError::Eval {
                    message: "Pivot source range exceeds 10M cells".to_string(),
                });
            }

            let source_sid = source_sheet_id(mirror, &config)?;
            let mut data = Vec::with_capacity((range.end_row() - range.start_row() + 1) as usize);
            for row in range.start_row()..=range.end_row() {
                let mut row_values =
                    Vec::with_capacity((range.end_col() - range.start_col() + 1) as usize);
                for col in range.start_col()..=range.end_col() {
                    let value = crate::storage::cells::values::get_effective_value(
                        mirror,
                        &source_sid,
                        row,
                        col,
                    )
                    .unwrap_or_default();
                    row_values.push(value);
                }
                data.push(row_values);
            }

            if data.is_empty() {
                return Err(ComputeError::Eval {
                    message: "Pivot source range is empty".to_string(),
                });
            }

            let mut config = config;
            if config.fields.is_empty() && !config.placements.is_empty() {
                let mut detected = compute_pivot::detect_fields(&data);
                for field in &mut detected {
                    field.id = compute_pivot::FieldId::new(field.name.clone());
                }
                config.fields = detected;
            }

            let engine_config =
                compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| {
                    ComputeError::Eval {
                        message: format!("Pivot config conversion error: {e}"),
                    }
                })?;
            let resolved = compute_pivot::validate_and_resolve(&engine_config).map_err(|e| {
                ComputeError::Eval {
                    message: format!("Pivot validation error: {e}"),
                }
            })?;

            Ok(compute_pivot::compute_with_show_values_as_resolved(
                &resolved, &data, None,
            ))
        }

        fn output_sheet_id(
            mirror: &CellMirror,
            config: &domain_types::domain::pivot::PivotTableConfig,
        ) -> Option<SheetId> {
            config
                .output_sheet_id
                .as_deref()
                .and_then(|sheet_id| SheetId::from_uuid_str(sheet_id).ok())
                .filter(|sheet_id| mirror.get_sheet(sheet_id).is_some())
                .or_else(|| mirror.sheet_by_name(&config.output_sheet_name))
        }

        let sheet_ids: Vec<SheetId> = mirror.sheet_ids().copied().collect();
        let mut pivot_pairs: Vec<(
            SheetId,
            String,
            domain_types::domain::pivot::PivotTableConfig,
        )> = Vec::new();
        for sid in &sheet_ids {
            for cfg in services::objects::pivot_get_all(stores, sid) {
                let id = cfg.id.clone();
                pivot_pairs.push((*sid, id, cfg));
            }
        }

        for (sheet_id, pivot_id, config) in &pivot_pairs {
            let output_sheet_id = match output_sheet_id(mirror, config) {
                Some(id) => id,
                None => continue,
            };

            let output_sheet_uuid = output_sheet_id.to_uuid_string();
            let old_def = mirror
                .find_pivot_table_def(pivot_id, &config.name, &output_sheet_uuid)
                .cloned();
            if let Some(def) = old_def {
                let old_rows = def.rendered_row_count();
                let old_cols = def.rendered_col_count();
                if old_rows > 0 && old_cols > 0 {
                    mirror.clear_pivot_region(
                        &output_sheet_id,
                        def.start_row,
                        def.start_col,
                        old_rows,
                        old_cols,
                    );
                }
            }

            match compute_from_source(stores, mirror, sheet_id, pivot_id) {
                Ok(result) => {
                    let engine_config = match PivotEngineConfig::try_from(config.clone()) {
                        Ok(config) => config,
                        Err(e) => {
                            tracing::warn!(
                                pivot_id = %pivot_id,
                                error = %e,
                                "Pivot materialization failed to convert config; skipping"
                            );
                            continue;
                        }
                    };
                    let row_field_names: Vec<String> = engine_config
                        .row_placements()
                        .iter()
                        .map(|p| {
                            p.display_name()
                                .map(String::from)
                                .or_else(|| {
                                    engine_config
                                        .fields
                                        .iter()
                                        .find(|f| f.id == *p.field_id())
                                        .map(|f| f.name.clone())
                                })
                                .unwrap_or_else(|| p.field_id().to_string())
                        })
                        .collect();
                    let repeat_row_labels = engine_config
                        .layout
                        .as_ref()
                        .and_then(|layout| layout.repeat_row_labels)
                        .unwrap_or(false);
                    mirror.materialize_pivot_with_identities(
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        &result,
                        &row_field_names,
                        repeat_row_labels,
                        &stores.grid_id_alloc,
                    );
                    apply_pivot_value_number_formats(
                        stores,
                        mirror,
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        config,
                        &result,
                    );
                    let def =
                        engine_config.to_pivot_table_def(&result.rendered_bounds, &output_sheet_id);
                    mirror.upsert_pivot_table_def(def);
                }
                Err(e) => {
                    tracing::warn!(
                        pivot_id = %pivot_id,
                        error = %e,
                        "Pivot materialization failed during import-open recalc; skipping"
                    );
                }
            }
        }
    }

    /// Materialize all pivot tables across all sheets after recalc.
    pub(in crate::storage::engine) fn materialize_all_pivots(&mut self) {
        use compute_pivot::{PivotEngineConfig, PivotTableDefExt};
        let sheet_ids: Vec<SheetId> = self.mirror.sheet_ids().copied().collect();
        let mut pivot_pairs: Vec<(
            SheetId,
            String,
            domain_types::domain::pivot::PivotTableConfig,
        )> = Vec::new();
        for sid in &sheet_ids {
            let configs = services::objects::pivot_get_all(&self.stores, sid);
            for cfg in configs {
                let id = cfg.id.clone();
                pivot_pairs.push((*sid, id, cfg));
            }
        }
        for (sheet_id, pivot_id, config) in &pivot_pairs {
            // Resolve output sheet
            let output_sheet_id = match config
                .output_sheet_id
                .as_deref()
                .and_then(|sheet_id| SheetId::from_uuid_str(sheet_id).ok())
                .filter(|sheet_id| self.mirror.get_sheet(sheet_id).is_some())
                .or_else(|| self.mirror.sheet_by_name(&config.output_sheet_name))
            {
                Some(id) => id,
                None => continue,
            };

            // Clear old cells if previously materialized
            {
                let output_sheet_uuid = output_sheet_id.to_uuid_string();
                let old_def = self
                    .mirror
                    .find_pivot_table_def(pivot_id, &config.name, &output_sheet_uuid)
                    .cloned();
                if let Some(def) = old_def {
                    let old_rows = def.rendered_row_count();
                    let old_cols = def.rendered_col_count();
                    if old_rows > 0 && old_cols > 0 {
                        self.mirror.clear_pivot_region(
                            &output_sheet_id,
                            def.start_row,
                            def.start_col,
                            old_rows,
                            old_cols,
                        );
                    }
                }
            }

            // Compute
            match self.pivot_compute_from_source(sheet_id, pivot_id, None) {
                Ok(result) => {
                    let engine_config = match PivotEngineConfig::try_from(config.clone()) {
                        Ok(config) => config,
                        Err(e) => {
                            tracing::warn!(
                                pivot_id = %pivot_id,
                                error = %e,
                                "Pivot materialization failed to convert config; skipping"
                            );
                            continue;
                        }
                    };
                    let row_field_names: Vec<String> = engine_config
                        .row_placements()
                        .iter()
                        .map(|p| {
                            p.display_name()
                                .map(String::from)
                                .or_else(|| {
                                    engine_config
                                        .fields
                                        .iter()
                                        .find(|f| f.id == *p.field_id())
                                        .map(|f| f.name.clone())
                                })
                                .unwrap_or_else(|| p.field_id().to_string())
                        })
                        .collect();
                    let repeat_row_labels = engine_config
                        .layout
                        .as_ref()
                        .and_then(|layout| layout.repeat_row_labels)
                        .unwrap_or(false);
                    self.mirror.materialize_pivot_with_identities(
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        &result,
                        &row_field_names,
                        repeat_row_labels,
                        &self.stores.grid_id_alloc,
                    );
                    apply_pivot_value_number_formats(
                        &self.stores,
                        &self.mirror,
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        config,
                        &result,
                    );
                    let def =
                        engine_config.to_pivot_table_def(&result.rendered_bounds, &output_sheet_id);
                    self.mirror.upsert_pivot_table_def(def);
                }
                Err(e) => {
                    tracing::warn!(
                        pivot_id = %pivot_id,
                        error = %e,
                        "Pivot materialization failed during recalc; skipping"
                    );
                }
            }
        }
    }
}
