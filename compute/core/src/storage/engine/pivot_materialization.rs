use cell_types::SheetId;
use value_types::ComputeError;

use crate::mirror::CellMirror;

use super::{YrsComputeEngine, services, stores::EngineStores};

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
