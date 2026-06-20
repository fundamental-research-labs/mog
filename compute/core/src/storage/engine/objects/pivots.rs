use super::shared;
use crate::engine_types::PivotCreateWithSheetOptions;
use crate::snapshot::{
    ChangeKind, MutationResult, PivotTableChange, SheetChange, SheetChangeField,
};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::pivot_materialization::apply_pivot_value_number_formats;
use crate::storage::engine::services;
use crate::storage::sheet::order;
use bridge_core as bridge;
use cell_types::SheetId;
use compute_pivot::PivotTableDefExt;
use compute_pivot::types::validate_pivot_config_json;
use compute_pivot::types::{PivotExpansionState, PivotFieldItems, PivotTableResult};
use domain_types::domain::pivot::PivotTableConfig;
use value_types::{CellValue, ComputeError};

use crate::storage::workbook::imported_pivots::ImportedPivotViewRecord;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PivotUpdateMaterializeResult {
    config: Option<PivotTableConfig>,
    result: Option<PivotTableResult>,
}

impl YrsComputeEngine {
    fn normalize_pivot_update_config(
        &self,
        sheet_id: &SheetId,
        mut config: PivotTableConfig,
    ) -> Result<PivotTableConfig, ComputeError> {
        let sheet_uuid = sheet_id.to_uuid_string();
        if let Some(output_sheet_id) = config.output_sheet_id.as_deref() {
            if output_sheet_id != sheet_uuid {
                return Err(ComputeError::InvalidInput {
                    message: format!(
                        "pivot_update outputSheetId '{}' does not match containing sheet '{}'",
                        output_sheet_id, sheet_uuid
                    ),
                });
            }
        }
        config.output_sheet_id = Some(sheet_uuid);
        if let Some(sheet) = self.mirror.get_sheet(sheet_id) {
            config.output_sheet_name = sheet.name.clone();
        }
        let config = self.resolve_pivot_source_identity(config)?;
        self.populate_missing_pivot_fields_from_source(config)
    }

    fn materialize_pivot_table(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<(SheetId, PivotTableResult), ComputeError> {
        // 1. Look up config
        let config =
            services::objects::pivot_get(&self.stores, sheet_id, pivot_id).ok_or_else(|| {
                ComputeError::Eval {
                    message: format!("Pivot table '{pivot_id}' not found"),
                }
            })?;

        // 2. Resolve output sheet
        let output_sheet_id = if let Some(output_sheet_id) = config.output_sheet_id.as_deref() {
            let output_id = SheetId::from_uuid_str(output_sheet_id).map_err(|e| {
                ComputeError::InvalidInput {
                    message: format!("Invalid pivot outputSheetId '{output_sheet_id}': {e}"),
                }
            })?;
            if self.mirror.get_sheet(&output_id).is_none() {
                return Err(ComputeError::SheetNotFound {
                    sheet_id: output_sheet_id.to_string(),
                });
            }
            output_id
        } else {
            self.mirror
                .sheet_by_name(&config.output_sheet_name)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: config.output_sheet_name.clone(),
                })?
        };

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
            &config,
            &result,
        );

        // 6. Register bounds for GETPIVOTDATA
        let bounds = &result.rendered_bounds;
        let def = engine_config.to_pivot_table_def(bounds, &output_sheet_id);
        self.mirror.upsert_pivot_table_def(def);

        Ok((output_sheet_id, result))
    }

    fn resolve_pivot_sheet_insert_index(
        &self,
        options: Option<&PivotCreateWithSheetOptions>,
    ) -> Result<Option<u32>, ComputeError> {
        let Some(options) = options else {
            return Ok(None);
        };

        if let Some(before_sheet_id) = options.insert_before_sheet_id.as_deref() {
            let target = SheetId::from_uuid_str(before_sheet_id).map_err(|e| {
                ComputeError::InvalidInput {
                    message: format!("Invalid pivot insertBeforeSheetId '{before_sheet_id}': {e}"),
                }
            })?;
            let order = self.stores.storage.sheet_order();
            let index = order
                .iter()
                .position(|sheet_id| sheet_id == &target)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: before_sheet_id.to_string(),
                })?;
            return Ok(Some(index as u32));
        }

        Ok(options.insert_index)
    }

    fn apply_pivot_sheet_insert_index(
        &self,
        sheet_id: &SheetId,
        insert_index: Option<u32>,
        result: &mut MutationResult,
    ) {
        let Some(insert_index) = insert_index else {
            return;
        };

        let order_before_move = self.stores.storage.sheet_order();
        let Some(old_index) = order_before_move
            .iter()
            .position(|candidate| candidate == sheet_id)
        else {
            return;
        };
        let new_index = insert_index.min(order_before_move.len().saturating_sub(1) as u32);
        if old_index as u32 == new_index {
            return;
        }

        if order::move_sheet(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            sheet_id,
            new_index,
        ) {
            result.sheet_changes.push(SheetChange {
                sheet_id: sheet_id.to_uuid_string(),
                kind: ChangeKind::Set,
                field: SheetChangeField::Order,
                name: None,
                old_name: None,
                index: Some(new_index as i32),
                old_index: Some(old_index as i32),
                hidden: None,
                source_sheet_id: None,
                frozen_rows: None,
                old_frozen_rows: None,
                frozen_cols: None,
                old_frozen_cols: None,
                color: None,
                old_color: None,
            });
        }
    }

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

    fn resolve_pivot_output_identity(
        &self,
        mut config: PivotTableConfig,
    ) -> Result<(SheetId, PivotTableConfig), ComputeError> {
        if let Some(output_sheet_id) = config.output_sheet_id.as_deref() {
            let output_id = SheetId::from_uuid_str(output_sheet_id).map_err(|e| {
                ComputeError::InvalidInput {
                    message: format!("Invalid pivot outputSheetId '{output_sheet_id}': {e}"),
                }
            })?;
            let sheet =
                self.mirror
                    .get_sheet(&output_id)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: output_sheet_id.to_string(),
                    })?;
            if !config.output_sheet_name.is_empty() && config.output_sheet_name != sheet.name {
                return Err(ComputeError::InvalidInput {
                    message: format!(
                        "Pivot output identity conflict: outputSheetId '{}' resolves to sheet '{}', but outputSheetName is '{}'",
                        output_sheet_id, sheet.name, config.output_sheet_name
                    ),
                });
            }
            config.output_sheet_name = sheet.name.clone();
            config.output_sheet_id = Some(output_id.to_uuid_string());
            return Ok((output_id, config));
        }

        if config.output_sheet_name.is_empty() {
            return Err(ComputeError::InvalidInput {
                message: "Pivot output identity requires outputSheetId or outputSheetName"
                    .to_string(),
            });
        }

        let output_id = self
            .mirror
            .sheet_by_name(&config.output_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.output_sheet_name.clone(),
            })?;
        config.output_sheet_id = Some(output_id.to_uuid_string());
        Ok((output_id, config))
    }

    fn derive_pivot_source_name(&self, mut config: PivotTableConfig) -> PivotTableConfig {
        let mut resolved_source = false;
        if let Some(source_sheet_id) = config.source_sheet_id.as_deref() {
            if let Ok(source_id) = SheetId::from_uuid_str(source_sheet_id) {
                if let Some(sheet) = self.mirror.get_sheet(&source_id) {
                    config.source_sheet_name = sheet.name.clone();
                    config.source_sheet_id = Some(source_id.to_uuid_string());
                    resolved_source = true;
                }
            }
        }
        if !resolved_source
            && config.source_sheet_id.is_none()
            && !config.source_sheet_name.is_empty()
        {
            if let Some(source_id) = self.mirror.sheet_by_name(&config.source_sheet_name) {
                config.source_sheet_id = Some(source_id.to_uuid_string());
            }
        }
        config
    }

    fn derive_pivot_sheet_names(&self, config: PivotTableConfig) -> PivotTableConfig {
        let mut config = self.derive_pivot_source_name(config);
        if let Some(output_sheet_id) = config.output_sheet_id.as_deref() {
            if let Ok(output_id) = SheetId::from_uuid_str(output_sheet_id) {
                if let Some(sheet) = self.mirror.get_sheet(&output_id) {
                    config.output_sheet_name = sheet.name.clone();
                    config.output_sheet_id = Some(output_id.to_uuid_string());
                }
            }
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

    fn populate_missing_pivot_fields_from_data(
        config: &mut PivotTableConfig,
        data: &[Vec<CellValue>],
    ) {
        if !config.fields.is_empty() || config.placements.is_empty() {
            return;
        }

        let mut detected = compute_pivot::detect_fields(data);
        for field in &mut detected {
            field.id = compute_pivot::FieldId::new(field.name.clone());
        }
        config.fields = detected;
    }

    fn populate_missing_pivot_fields_from_source(
        &self,
        mut config: PivotTableConfig,
    ) -> Result<PivotTableConfig, ComputeError> {
        if config.fields.is_empty() && !config.placements.is_empty() {
            let data = self.load_pivot_source_data(&config)?;
            Self::populate_missing_pivot_fields_from_data(&mut config, &data);
        }
        Ok(config)
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
        Self::populate_missing_pivot_fields_from_data(&mut config, data);

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
        let (sheet_id, config) = self.resolve_pivot_output_identity(config)?;
        let config = self.populate_missing_pivot_fields_from_source(config)?;
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
        options: Option<PivotCreateWithSheetOptions>,
    ) -> Result<(String, PivotTableConfig, MutationResult), ComputeError> {
        // Validate all fields upfront — one comprehensive error, not one-at-a-time
        validate_pivot_config_json(&config)
            .map_err(|msg| ComputeError::InvalidInput { message: msg })?;
        let mut config: PivotTableConfig =
            serde_json::from_value(config).map_err(|e| ComputeError::Deserialize {
                message: e.to_string(),
            })?;
        config = self.resolve_pivot_source_identity(config)?;
        let insert_index = self.resolve_pivot_sheet_insert_index(options.as_ref())?;
        let (sheet_hex, mut sheet_result) = self.mutation_create_sheet(sheet_name)?;
        let sheet_id = SheetId::from_uuid_str(&sheet_hex).map_err(|e| ComputeError::Eval {
            message: format!("Invalid SheetId after creation: {e}"),
        })?;
        self.apply_pivot_sheet_insert_index(&sheet_id, insert_index, &mut sheet_result);
        // Default output_sheet_name to the newly created sheet when empty
        if config.output_sheet_name.is_empty() {
            config.output_sheet_name = sheet_name.to_string();
        }
        config.output_sheet_id = Some(sheet_id.to_uuid_string());
        config = self.populate_missing_pivot_fields_from_source(config)?;
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
        let config = self.normalize_pivot_update_config(sheet_id, config)?;
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
        if let Some(config) = services::objects::pivot_get(&self.stores, sheet_id, pivot_id) {
            if let Some(output_sheet_id) = config
                .output_sheet_id
                .as_deref()
                .and_then(|sheet_id| SheetId::from_uuid_str(sheet_id).ok())
                .or_else(|| self.mirror.sheet_by_name(&config.output_sheet_name))
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
            .map(|config| self.derive_pivot_sheet_names(config))
    }

    /// Get all pivot tables in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get_all(&self, sheet_id: &SheetId) -> Vec<PivotTableConfig> {
        services::objects::pivot_get_all(&self.stores, sheet_id)
            .into_iter()
            .map(|config| self.derive_pivot_sheet_names(config))
            .collect()
    }

    /// Get imported PivotTable view records rendered on an output sheet.
    ///
    /// This is the persisted import read model used by app surfaces. Promoted
    /// imports include their live native config; unsupported imports include a
    /// preserved read-only config from the original OOXML pivot spec.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get_imported_view_records(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<ImportedPivotViewRecord> {
        crate::storage::workbook::imported_pivots::read_view_records_for_output_sheet(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            self.stores.storage.sheets(),
            sheet_id,
        )
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
        let (_, result) = self.materialize_pivot_table(sheet_id, pivot_id, expansion_state)?;
        Ok(result)
    }

    /// Compute and materialize a pivot table, returning viewport patches through
    /// the standard mutation pipeline.
    ///
    /// The generated TS bridge currently treats `pivot_materialize` as a query
    /// despite the Rust method being a write. This companion command gives the
    /// handwritten bridge a production-path mutation tuple without changing the
    /// generated method's public signature.
    #[bridge::skip(ts_bridge)]
    #[bridge::write(scope = "sheet")]
    pub fn pivot_materialize_mutation(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (output_sheet_id, result) =
            self.materialize_pivot_table(sheet_id, pivot_id, expansion_state)?;
        let mutation_result = MutationResult::empty().with_data(&result)?;
        let patches = self.produce_full_viewport_patches(&output_sheet_id);
        Ok((patches, mutation_result))
    }

    /// Replace a pivot config and materialize its output in one mutation.
    ///
    /// Pivot field edits are user-visible config mutations whose rendered cells
    /// should appear as part of the same interaction. Keeping update and
    /// materialization together avoids a second bridge round trip and lets the
    /// mutation event update config subscribers without scheduling another
    /// refresh.
    #[bridge::skip(ts_bridge)]
    #[bridge::write(scope = "sheet")]
    pub fn pivot_update_and_materialize(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        config: PivotTableConfig,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let config = self.normalize_pivot_update_config(sheet_id, config)?;
        let update_result =
            services::objects::pivot_update(&mut self.stores, sheet_id, pivot_id, config)?;
        self.stores.compute.mark_dirty();

        let updated_config: Option<PivotTableConfig> = update_result.extract_data().unwrap_or(None);
        if updated_config.is_none() {
            let data = PivotUpdateMaterializeResult {
                config: None,
                result: None,
            };
            return Ok((shared::empty_patches(), update_result.with_data(&data)?));
        }

        let (output_sheet_id, pivot_result) =
            self.materialize_pivot_table(sheet_id, pivot_id, expansion_state)?;
        let data = PivotUpdateMaterializeResult {
            config: updated_config,
            result: Some(pivot_result),
        };
        let patches = self.produce_full_viewport_patches(&output_sheet_id);
        Ok((patches, update_result.with_data(&data)?))
    }
}
