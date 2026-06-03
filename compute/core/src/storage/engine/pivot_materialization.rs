use cell_types::{RangeId, SheetId};
use domain_types::CellFormat;
use value_types::ComputeError;

use crate::mirror::{CellMirror, FormatRange};

use super::{YrsComputeEngine, services, stores::EngineStores};

const PIVOT_FORMAT_RANGE_PREFIX: u128 = 0xC8F0u128 << 112;
const PIVOT_FORMAT_RANGE_SLOT_BITS: u32 = 48;
const PIVOT_FORMAT_RANGE_SLOT_MASK: u128 = (1u128 << PIVOT_FORMAT_RANGE_SLOT_BITS) - 1;
const PIVOT_FORMAT_RANGE_OWNER_MASK: u128 = !PIVOT_FORMAT_RANGE_SLOT_MASK;

pub(in crate::storage::engine) fn clear_pivot_format_ranges(
    mirror: &mut CellMirror,
    pivot_id: &str,
) {
    let owner_prefix = pivot_format_owner_prefix(pivot_id);
    let sheet_ids: Vec<SheetId> = mirror.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        if let Some(sheet) = mirror.get_sheet_mut(&sheet_id) {
            let removed_ids: Vec<RangeId> = sheet
                .format_ranges
                .iter()
                .filter(|range| range.id.as_u128() & PIVOT_FORMAT_RANGE_OWNER_MASK == owner_prefix)
                .map(|range| range.id)
                .collect();
            if removed_ids.is_empty() {
                continue;
            }
            sheet
                .format_ranges
                .retain(|range| range.id.as_u128() & PIVOT_FORMAT_RANGE_OWNER_MASK != owner_prefix);
            for range_id in removed_ids {
                sheet.range_format_cache.remove(&range_id);
                sheet.range_xlsx_style_id_cache.remove(&range_id);
            }
        }
    }
}

pub(in crate::storage::engine) fn apply_pivot_format_ranges(
    mirror: &mut CellMirror,
    output_sheet_id: &SheetId,
    pivot_id: &str,
    anchor_row: u32,
    anchor_col: u32,
    result: &compute_pivot::types::PivotTableResult,
) {
    clear_pivot_format_ranges(mirror, pivot_id);

    let measure_count = result.measure_descriptors.len();
    if measure_count == 0 {
        return;
    }

    let mut slot = 0u128;
    let mut push_measure_range = |mirror: &mut CellMirror,
                                  measure_index: usize,
                                  start_row: u32,
                                  start_col: u32,
                                  end_row: u32,
                                  end_col: u32| {
        if start_row > end_row || start_col > end_col {
            return;
        }
        let Some(number_format) = result
            .measure_descriptors
            .get(measure_index)
            .and_then(|descriptor| descriptor.number_format.as_ref())
        else {
            return;
        };
        let Some(sheet) = mirror.get_sheet_mut(output_sheet_id) else {
            return;
        };
        let range_id = pivot_format_range_id(pivot_id, slot);
        slot = slot.saturating_add(1);
        sheet.format_ranges.retain(|range| range.id != range_id);
        sheet.format_ranges.push(FormatRange {
            id: range_id,
            start_row,
            start_col,
            end_row,
            end_col,
        });
        sheet.range_format_cache.insert(
            range_id,
            CellFormat {
                number_format: Some(number_format.clone()),
                ..Default::default()
            },
        );
        sheet.range_xlsx_style_id_cache.remove(&range_id);
    };

    let bounds = &result.rendered_bounds;
    let data_start_row = anchor_row + bounds.first_data_row;
    if !result.rows.is_empty() {
        let data_end_row = data_start_row + result.rows.len() as u32 - 1;
        for data_col_offset in 0..bounds.num_data_cols {
            let measure_index = data_col_offset as usize % measure_count;
            let col = anchor_col + bounds.first_data_col + data_col_offset;
            push_measure_range(
                mirror,
                measure_index,
                data_start_row,
                col,
                data_end_row,
                col,
            );
        }
    }

    if let Some(row_totals) = result.grand_totals.row.as_ref() {
        let row = anchor_row + bounds.total_rows.saturating_sub(1);
        for value_index in 0..row_totals.len() {
            let measure_index = value_index % measure_count;
            let col = anchor_col + bounds.first_data_col + value_index as u32;
            push_measure_range(mirror, measure_index, row, col, row, col);
        }
    }

    let num_value_fields = result
        .grand_totals
        .grand
        .as_ref()
        .map(|g| g.len().max(1))
        .or_else(|| {
            result
                .grand_totals
                .column
                .as_ref()
                .and_then(|c| c.first().map(|row| row.len().max(1)))
        })
        .unwrap_or(measure_count) as u32;

    if let Some(column_totals) = result.grand_totals.column.as_ref() {
        for (row_index, row_totals) in column_totals.iter().enumerate() {
            let row = data_start_row + row_index as u32;
            for value_index in 0..row_totals.len() {
                let measure_index = value_index % measure_count;
                let col = anchor_col + bounds.total_cols - num_value_fields + value_index as u32;
                push_measure_range(mirror, measure_index, row, col, row, col);
            }
        }
    }

    if let Some(grand) = result.grand_totals.grand.as_ref() {
        let row = anchor_row + bounds.total_rows.saturating_sub(1);
        for value_index in 0..grand.len() {
            let measure_index = value_index % measure_count;
            let col = anchor_col + bounds.total_cols - num_value_fields + value_index as u32;
            push_measure_range(mirror, measure_index, row, col, row, col);
        }
    }
}

fn pivot_format_range_id(pivot_id: &str, slot: u128) -> RangeId {
    RangeId::from_raw(pivot_format_owner_prefix(pivot_id) | (slot & PIVOT_FORMAT_RANGE_SLOT_MASK))
}

fn pivot_format_owner_prefix(pivot_id: &str) -> u128 {
    PIVOT_FORMAT_RANGE_PREFIX | ((stable_hash64(pivot_id) as u128) << PIVOT_FORMAT_RANGE_SLOT_BITS)
}

fn stable_hash64(input: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    hash
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
            clear_pivot_format_ranges(mirror, pivot_id);
            let output_sheet_id = match mirror.sheet_by_name(&config.output_sheet_name) {
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
                    mirror.materialize_pivot(
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        &result,
                        &row_field_names,
                    );
                    apply_pivot_format_ranges(
                        mirror,
                        &output_sheet_id,
                        pivot_id,
                        config.output_location.row,
                        config.output_location.col,
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
            clear_pivot_format_ranges(&mut self.mirror, pivot_id);
            // Resolve output sheet
            let output_sheet_id = match self.mirror.sheet_by_name(&config.output_sheet_name) {
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
                    self.mirror.materialize_pivot(
                        &output_sheet_id,
                        config.output_location.row,
                        config.output_location.col,
                        &result,
                        &row_field_names,
                    );
                    apply_pivot_format_ranges(
                        &mut self.mirror,
                        &output_sheet_id,
                        pivot_id,
                        config.output_location.row,
                        config.output_location.col,
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
