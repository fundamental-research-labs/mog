use super::shared;
use crate::snapshot::{ChangeKind, MutationResult, PivotTableChange};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use compute_pivot::PivotTableDefExt;
use compute_pivot::types::validate_pivot_config_json;
use compute_pivot::types::{PivotExpansionState, PivotFieldItems, PivotTableResult};
use domain_types::domain::pivot::PivotTableConfig;
use value_types::{CellValue, ComputeError};

impl YrsComputeEngine {
    fn resolve_pivot_source_identity(
        &self,
        mut config: PivotTableConfig,
    ) -> Result<PivotTableConfig, ComputeError> {
        if let Some(source_sheet_id) = config.source_sheet_id.as_deref() {
            let source_id = SheetId::from_uuid_str(source_sheet_id).map_err(|e| {
                ComputeError::InvalidInput {
                    message: format!("Invalid pivot sourceSheetId '{source_sheet_id}': {e}"),
                }
            })?;
            let sheet =
                self.mirror
                    .get_sheet(&source_id)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: source_sheet_id.to_string(),
                    })?;
            if !config.source_sheet_name.is_empty() && config.source_sheet_name != sheet.name {
                return Err(ComputeError::InvalidInput {
                    message: format!(
                        "Pivot source identity conflict: sourceSheetId '{}' resolves to sheet '{}', but sourceSheetName is '{}'",
                        source_sheet_id, sheet.name, config.source_sheet_name
                    ),
                });
            }
            config.source_sheet_name = sheet.name.clone();
            config.source_sheet_id = Some(source_id.to_uuid_string());
            return Ok(config);
        }

        if config.source_sheet_name.is_empty() {
            return Err(ComputeError::InvalidInput {
                message: "Pivot source identity requires sourceSheetId or sourceSheetName"
                    .to_string(),
            });
        }

        let source_id = self
            .mirror
            .sheet_by_name(&config.source_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.source_sheet_name.clone(),
            })?;
        config.source_sheet_id = Some(source_id.to_uuid_string());
        Ok(config)
    }

    fn derive_pivot_source_name(&self, mut config: PivotTableConfig) -> PivotTableConfig {
        if let Some(source_sheet_id) = config.source_sheet_id.as_deref()
            && let Ok(source_id) = SheetId::from_uuid_str(source_sheet_id)
            && let Some(sheet) = self.mirror.get_sheet(&source_id)
        {
            config.source_sheet_name = sheet.name.clone();
            config.source_sheet_id = Some(source_id.to_uuid_string());
        } else if config.source_sheet_id.is_none()
            && !config.source_sheet_name.is_empty()
            && let Some(source_id) = self.mirror.sheet_by_name(&config.source_sheet_name)
        {
            config.source_sheet_id = Some(source_id.to_uuid_string());
        }
        config
    }

    fn pivot_source_sheet_id(&self, config: &PivotTableConfig) -> Result<SheetId, ComputeError> {
        if let Some(source_sheet_id) = config.source_sheet_id.as_deref() {
            let source_id = SheetId::from_uuid_str(source_sheet_id).map_err(|e| {
                ComputeError::InvalidInput {
                    message: format!("Invalid pivot sourceSheetId '{source_sheet_id}': {e}"),
                }
            })?;
            if self.mirror.get_sheet(&source_id).is_some() {
                return Ok(source_id);
            }
            return Err(ComputeError::SheetNotFound {
                sheet_id: source_sheet_id.to_string(),
            });
        }

        self.mirror
            .sheet_by_name(&config.source_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.source_sheet_name.clone(),
            })
    }

    fn load_pivot_source_data(
        &self,
        config: &PivotTableConfig,
    ) -> Result<Vec<Vec<CellValue>>, ComputeError> {
        let range = &config.source_range;
        let total_cells = (range.end_row() as u64 - range.start_row() as u64 + 1)
            * (range.end_col() as u64 - range.start_col() as u64 + 1);
        if total_cells > 10_000_000 {
            return Err(ComputeError::Eval {
                message: "Pivot source range exceeds 10M cells".to_string(),
            });
        }

        let source_sid = self.pivot_source_sheet_id(config)?;
        let mut data = Vec::with_capacity((range.end_row() - range.start_row() + 1) as usize);
        for row in range.start_row()..=range.end_row() {
            let mut row_values =
                Vec::with_capacity((range.end_col() - range.start_col() + 1) as usize);
            for col in range.start_col()..=range.end_col() {
                let value = crate::storage::cells::values::get_effective_value(
                    &self.mirror,
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

        Ok(data)
    }

    fn prepare_pivot_engine_config(
        &self,
        mut config: PivotTableConfig,
        data: &[Vec<CellValue>],
    ) -> Result<
        (
            compute_pivot::PivotEngineConfig,
            compute_pivot::ResolvedPivotConfig,
        ),
        ComputeError,
    > {
        if config.fields.is_empty() && !config.placements.is_empty() {
            let mut detected = compute_pivot::detect_fields(data);
            for field in &mut detected {
                field.id = compute_pivot::FieldId::new(field.name.clone());
            }
            config.fields = detected;
        }

        let engine_config =
            compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| ComputeError::Eval {
                message: format!("Pivot config conversion error: {e}"),
            })?;
        let resolved = compute_pivot::validate_and_resolve(&engine_config).map_err(|e| {
            ComputeError::Eval {
                message: format!("Pivot validation error: {e}"),
            }
        })?;
        Ok((engine_config, resolved))
    }
}

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects_pivots",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "workbook")]
    pub fn pivot_create(
        &mut self,
        config: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Validate all fields upfront — one comprehensive error, not one-at-a-time
        validate_pivot_config_json(&config)
            .map_err(|msg| ComputeError::InvalidInput { message: msg })?;
        let config: PivotTableConfig =
            serde_json::from_value(config).map_err(|e| ComputeError::Deserialize {
                message: e.to_string(),
            })?;
        let config = self.resolve_pivot_source_identity(config)?;
        let sheet_id = self
            .mirror
            .sheet_by_name(&config.output_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.output_sheet_name.clone(),
            })?;
        let result = services::objects::pivot_create(&mut self.stores, &sheet_id, config)?;
        // Pivot CRUD doesn't touch cells but `recalculate_with_options` uses
        // `materialize_all_pivots` to render output — must not short-circuit.
        self.stores.compute.mark_dirty();
        Ok((shared::empty_patches(), result))
    }

    /// Atomically create a new sheet AND a pivot table on it.
    ///
    /// Both the sheet creation and pivot creation happen within a single
    /// `#[bridge::write(scope = "workbook")]` scope, so undo reverts both operations together.
    /// Returns the new sheet's ID (hex) and the stored pivot config.
    ///
    /// Accepts raw JSON with comprehensive upfront validation.
    #[bridge::skip(ts_bridge)]
    #[bridge::write(scope = "workbook")]
    pub fn pivot_create_with_sheet(
        &mut self,
        sheet_name: &str,
        config: serde_json::Value,
    ) -> Result<(String, PivotTableConfig, MutationResult), ComputeError> {
        // Validate all fields upfront — one comprehensive error, not one-at-a-time
        validate_pivot_config_json(&config)
            .map_err(|msg| ComputeError::InvalidInput { message: msg })?;
        let mut config: PivotTableConfig =
            serde_json::from_value(config).map_err(|e| ComputeError::Deserialize {
                message: e.to_string(),
            })?;
        config = self.resolve_pivot_source_identity(config)?;
        let (sheet_hex, mut sheet_result) = self.mutation_create_sheet(sheet_name)?;
        let sheet_id = SheetId::from_uuid_str(&sheet_hex).map_err(|e| ComputeError::Eval {
            message: format!("Invalid SheetId after creation: {e}"),
        })?;
        // Default output_sheet_name to the newly created sheet when empty
        if config.output_sheet_name.is_empty() {
            config.output_sheet_name = sheet_name.to_string();
        }
        let pivot =
            services::objects::pivot_create_with_sheet_inner(&mut self.stores, &sheet_id, config)?;
        sheet_result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot.id.clone(),
            kind: ChangeKind::Set,
        });
        Ok((sheet_hex, pivot, sheet_result))
    }

    /// Replace a pivot table config.
    ///
    /// Returns `MutationResult` with `PivotTableConfig | null` in `data`.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_update(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        config: PivotTableConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let config = self.resolve_pivot_source_identity(config)?;
        let result = services::objects::pivot_update(&mut self.stores, sheet_id, pivot_id, config)?;
        // Pivot config changes layout/aggregation — next calculate must
        // re-materialize, so don't let the idempotent short-circuit skip it.
        self.stores.compute.mark_dirty();
        Ok((shared::empty_patches(), result))
    }

    /// Delete a pivot table by ID. Returns `MutationResult` with `bool` in `data`.
    /// Clears materialized cells before deleting.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_delete(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Clear materialized cells before deleting
        if let Some(config) = services::objects::pivot_get(&self.stores, sheet_id, pivot_id)
            && let Some(output_sheet_id) = self.mirror.sheet_by_name(&config.output_sheet_name)
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
        let result = services::objects::pivot_delete(&mut self.stores, sheet_id, pivot_id)?;
        // Removed pivot must not be re-materialized on next calculate —
        // but cells we just cleared need the flush; mark dirty either way.
        self.stores.compute.mark_dirty();
        Ok((shared::empty_patches(), result))
    }

    /// Get a single pivot table by ID.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get(&self, sheet_id: &SheetId, pivot_id: &str) -> Option<PivotTableConfig> {
        services::objects::pivot_get(&self.stores, sheet_id, pivot_id)
            .map(|config| self.derive_pivot_source_name(config))
    }

    /// Get all pivot tables in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get_all(&self, sheet_id: &SheetId) -> Vec<PivotTableConfig> {
        services::objects::pivot_get_all(&self.stores, sheet_id)
            .into_iter()
            .map(|config| self.derive_pivot_source_name(config))
            .collect()
    }

    /// Compute a pivot table from its stored config, reading source data directly
    /// from the engine. This avoids the TS→Rust→TS data round-trip that the
    /// stateless `pivot_compute` free function requires.
    ///
    /// Auto-detects fields from source data if the config has placements but no
    /// field metadata (common when fields are added via the TS `addField()` API).
    #[bridge::read(scope = "sheet")]
    pub fn pivot_compute_from_source(
        &self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<PivotTableResult, ComputeError> {
        let config =
            services::objects::pivot_get(&self.stores, sheet_id, pivot_id).ok_or_else(|| {
                ComputeError::Eval {
                    message: format!("Pivot table '{pivot_id}' not found"),
                }
            })?;

        let data = self.load_pivot_source_data(&config)?;
        let (_, resolved) = self.prepare_pivot_engine_config(config, &data)?;

        Ok(compute_pivot::compute_with_show_values_as_resolved(
            &resolved,
            &data,
            expansion_state.as_ref(),
        ))
    }

    /// Get pivot items for all placed fields.
    ///
    /// Computes the pivot result from stored config and source data, then extracts
    /// discrete `PivotItemInfo` objects for each non-value field. This avoids the
    /// TS layer needing to walk raw row/column headers itself.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get_all_items(
        &self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<Vec<PivotFieldItems>, ComputeError> {
        let config =
            services::objects::pivot_get(&self.stores, sheet_id, pivot_id).ok_or_else(|| {
                ComputeError::Eval {
                    message: format!("Pivot table '{pivot_id}' not found"),
                }
            })?;

        let data = self.load_pivot_source_data(&config)?;
        let (engine_config, resolved) = self.prepare_pivot_engine_config(config, &data)?;
        let result = compute_pivot::compute_with_show_values_as_resolved(
            &resolved,
            &data,
            expansion_state.as_ref(),
        );

        // Extract items
        Ok(compute_pivot::get_all_field_items(
            &result,
            &engine_config,
            Some(&data),
        ))
    }

    /// Register a rendered pivot table definition for GETPIVOTDATA formula evaluation.
    ///
    /// Called by the TS layer after computing a pivot table to register its rendered
    /// bounds in the CellMirror. GETPIVOTDATA reads from these definitions to locate
    /// values in rendered pivot cells.
    ///
    /// The `bounds` parameter provides the rendered extent from the pivot compute result.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_register_def(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        total_rows: u32,
        total_cols: u32,
        first_data_row: u32,
        first_data_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::pivot_register_def(
            &self.stores,
            &mut self.mirror,
            sheet_id,
            pivot_id,
            total_rows,
            total_cols,
            first_data_row,
            first_data_col,
        )
        .map(shared::with_empty_patches)
    }

    /// Remove a pivot table definition from the GETPIVOTDATA registry.
    ///
    /// Called when a pivot table is deleted to ensure stale definitions don't
    /// linger in the CellMirror.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_unregister_def(
        &mut self,
        sheet_id: &SheetId,
        pivot_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::pivot_unregister_def(&mut self.mirror, sheet_id, pivot_name)
            .map(shared::with_empty_patches)
    }

    /// Compute and materialize a pivot table to sheet cells.
    ///
    /// This reads source data, computes the pivot, writes result cells into the
    /// output sheet's col_data, and registers the rendered bounds for GETPIVOTDATA.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_materialize(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<PivotTableResult, ComputeError> {
        // 1. Look up config
        let config =
            services::objects::pivot_get(&self.stores, sheet_id, pivot_id).ok_or_else(|| {
                ComputeError::Eval {
                    message: format!("Pivot table '{pivot_id}' not found"),
                }
            })?;

        // 2. Resolve output sheet
        let output_sheet_id = self
            .mirror
            .sheet_by_name(&config.output_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.output_sheet_name.clone(),
            })?;

        // 3. Clear old cells if previously materialized
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

        // 4. Compute pivot result
        let result = self.pivot_compute_from_source(sheet_id, pivot_id, expansion_state)?;
        let engine_config =
            compute_pivot::PivotEngineConfig::try_from(config.clone()).map_err(|e| {
                ComputeError::Eval {
                    message: format!("Pivot config conversion error: {e}"),
                }
            })?;

        // 5. Write cells
        // Collect row field display names for the header row.
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

        // 6. Register bounds for GETPIVOTDATA
        let bounds = &result.rendered_bounds;
        let def = engine_config.to_pivot_table_def(bounds, &output_sheet_id);
        self.mirror.upsert_pivot_table_def(def);

        Ok(result)
    }
}
