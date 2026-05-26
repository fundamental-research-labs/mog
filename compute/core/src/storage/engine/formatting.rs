//! Formatting methods (cell format, CF rules, schemas, row/col format) for YrsComputeEngine.

use super::YrsComputeEngine;
use super::services;
use super::validation;
use crate::snapshot::MutationResult;
use crate::storage::properties;
use crate::storage::sheet::cf_store::{CFCellRange, CFIconSetPreset, CFPresetCategory};
use crate::storage::sheet::schemas::{CellValidationResult, ColumnSchema, RangeSchema};
use bridge_core as bridge;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::CellFormat;
use domain_types::ResolvedCellFormat;
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "formatting",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Schema Map Management
    // -------------------------------------------------------------------

    /// Load or replace the schema map for post-recalc validation.
    /// Accepts wire-friendly `Vec<SchemaMapEntryWire>` (string sheet IDs) and converts internally.
    #[bridge::write(scope = "workbook")]
    pub fn set_schema_map(
        &mut self,
        entries: Vec<crate::bridge_types::SchemaMapEntryWire>,
        version: f64,
    ) {
        services::formatting::set_schema_map(&mut self.stores, entries, version);
    }

    /// Update a single column schema. Returns false if version is stale.
    /// Accepts wire-friendly types (string sheet_id) and converts internally.
    #[bridge::write(scope = "workbook")]
    pub fn update_schema(
        &mut self,
        sheet_id: String,
        column: u32,
        schema: crate::schema::types::ColumnSchema,
        version: f64,
    ) -> bool {
        services::formatting::update_schema(&mut self.stores, &sheet_id, column, schema, version)
    }

    /// Remove a column schema. Returns false if version is stale.
    /// Accepts wire-friendly types (string sheet_id) and converts internally.
    #[bridge::write(scope = "workbook")]
    pub fn remove_schema(&mut self, sheet_id: String, column: u32, version: f64) -> bool {
        services::formatting::remove_schema(&mut self.stores, &sheet_id, column, version)
    }

    /// Clear all schemas.
    #[bridge::write(scope = "workbook")]
    pub fn clear_schemas(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::clear_schemas(&mut self.stores)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // -------------------------------------------------------------------
    // Properties operations
    // -------------------------------------------------------------------

    /// Get effective cell format (merges default → col → row → cell).
    #[bridge::read(scope = "cell")]
    pub fn get_cell_format(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
        row: u32,
        col: u32,
    ) -> CellFormat {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let table_fmt =
            services::tables::resolve_table_format_at_cell(&self.mirror, sheet_id, row, col);
        properties::get_effective_format(
            &self.stores.storage,
            sheet_id,
            &cell_hex,
            row,
            col,
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(sheet_id),
            self.mirror.get_sheet(sheet_id),
        )
    }

    /// Get effective cell format including CF evaluation results.
    ///
    /// This is the complete 6-layer format cascade:
    /// default → column → row → table → cell → CF
    #[bridge::read(scope = "cell")]
    pub fn get_cell_format_with_cf(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
        row: u32,
        col: u32,
    ) -> CellFormat {
        let mut fmt = self.get_cell_format(sheet_id, cell_id, row, col);

        // Merge CF as 6th layer
        if let Some(cache_entry) = self.stores.cf_cache.get(sheet_id)
            && let Some(cf_result) = cache_entry.results.get(&(row, col))
        {
            super::viewport::merge_cf_into_format(&mut fmt, cf_result);
        }

        fmt
    }

    /// Get the fully-resolved format for a cell position.
    ///
    /// Performs the complete resolution pipeline matching the viewport:
    /// 1. 5-layer cascade: default → column → row → table → cell
    /// 2. Theme color resolution (theme refs → hex)
    /// 3. CF merge (6th layer)
    /// 4. Convert to `ResolvedCellFormat` (dense: `None` → JSON `null`)
    ///
    /// Unlike `get_cell_format`/`get_cell_format_with_cf`, this endpoint:
    /// - Takes a position (row, col) instead of requiring a cell_id
    /// - Resolves theme color references to hex
    /// - Returns dense JSON (all fields present, `None` → `null`)
    #[bridge::read(scope = "cell")]
    pub fn get_resolved_format(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> ResolvedCellFormat {
        // Use grid_indexes (the in-memory position→id allocator) to find cell IDs.
        // This reflects the latest state including recent mutations from
        // set_format_for_ranges, unlike the Yrs CRDT which may lag.
        let pos = SheetPos::new(row, col);
        let cell_id = self
            .stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|grid| grid.cell_id_at(row, col))
            .or_else(|| self.mirror.resolve_cell_id(sheet_id, pos));

        let mut fmt = if let Some(cid) = cell_id {
            // Cell exists: full cascade (default -> col -> row -> Format Range -> table -> cell)
            let cell_hex = id_to_hex(cid.as_u128());
            let table_fmt =
                services::tables::resolve_table_format_at_cell(&self.mirror, sheet_id, row, col);
            properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                row,
                col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            )
        } else {
            // No cell: positional only (default -> col -> row -> Format Range)
            properties::get_positional_format(
                &self.stores.storage,
                sheet_id,
                row,
                col,
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            )
        };

        // Theme resolution BEFORE CF (matches viewport pipeline order).
        // No formula format inheritance: a formula cell uses its OWN format.
        // Excel applies operand-format inheritance at edit time (the format is
        // baked into the formula cell), not at display time.
        domain_types::theme_color::resolve_theme_refs(&mut fmt, &self.settings.theme_palette);

        // CF as 6th layer (only if a cell exists — CF rules are cell-bound)
        if cell_id.is_some()
            && let Some(cache_entry) = self.stores.cf_cache.get(sheet_id)
            && let Some(cf_result) = cache_entry.results.get(&(row, col))
        {
            super::viewport::merge_cf_into_format(&mut fmt, cf_result);
        }

        ResolvedCellFormat::from(fmt)
    }

    /// Set cell format. Returns MutationResult.
    #[bridge::write(scope = "sheet")]
    pub fn set_cell_format(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &CellId,
        format: &CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        validation::format::validate_cell_format(format)?;
        let cell_hex = id_to_hex(cell_id.as_u128());
        services::formatting::set_cell_format(&mut self.stores, sheet_id, &cell_hex, format);
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Clear cell format. Returns MutationResult.
    #[bridge::write(scope = "sheet")]
    pub fn clear_cell_format(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let cell_hex = id_to_hex(cell_id.as_u128());
        services::formatting::clear_cell_format(&mut self.stores, sheet_id, &cell_hex);
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Toggle a boolean format property for all cells in the given ranges.
    ///
    /// Reads the effective format at (`active_row`, `active_col`) to determine
    /// the toggle direction. For example: if bold is currently true at the active
    /// cell, sets bold=false for all cells in the supplied ranges.
    ///
    /// `property` must be one of: `"bold"`, `"italic"`, `"strikethrough"`,
    /// `"wrapText"`, `"underline"`.
    ///
    /// For `"underline"`, toggles between `None`/`"none"` and `"single"`.
    ///
    /// Returns viewport patches and a [`MutationResult`] with `property_changes` for each affected cell.
    #[bridge::write(scope = "sheet")]
    pub fn toggle_format_property(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        property: &str,
        active_row: u32,
        active_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (affected_cells, result) = {
            let _guard = self.mutation.suppress_guard();
            services::formatting::toggle_format_property(
                &mut self.stores,
                &self.mirror,
                sheet_id,
                ranges,
                property,
                active_row,
                active_col,
            )?
        };
        let patches = self.produce_format_change_patches(sheet_id, &affected_cells);
        Ok((patches, result))
    }

    /// Set a format for all cells in the given ranges.
    ///
    /// Used for non-toggle format operations (e.g., set number format, set alignment).
    /// Returns viewport patches and a [`MutationResult`] with `property_changes` for each affected cell.
    #[bridge::write(scope = "sheet")]
    pub fn set_format_for_ranges(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        validation::format::validate_cell_format(format)?;
        let (affected_cells, result) = {
            let _guard = self.mutation.suppress_guard();
            services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                sheet_id,
                ranges,
                format,
            )?
        };
        let patches = self.produce_format_change_patches(sheet_id, &affected_cells);
        Ok((patches, result))
    }

    /// Clear format for all cells in the given ranges.
    ///
    /// Returns viewport patches and a [`MutationResult`] with `property_changes` for each affected cell.
    #[bridge::write(scope = "sheet")]
    pub fn clear_format_for_ranges(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (affected_cells, result) = {
            let _guard = self.mutation.suppress_guard();
            services::formatting::clear_format_for_ranges(&mut self.stores, sheet_id, ranges)?
        };
        let patches = self.produce_format_change_patches(sheet_id, &affected_cells);
        Ok((patches, result))
    }

    // -------------------------------------------------------------------
    // CF CRUD Mutations
    // -------------------------------------------------------------------

    /// Add a conditional format (with rules) to a sheet.
    ///
    /// Accepts the canonical TS schema as wire input (`serde_json::Value`).
    /// Normalizes the full public CF rule-type set
    /// (`cellIs`/`cellValue`, `containsText`, `containsBlanks`,
    /// `containsErrors`, `top10`, `aboveAverage`/`belowAverage`,
    /// `duplicateValues`/`uniqueValues`, `formula`/`expression`,
    /// `colorScale`, `dataBar`, `iconSet`, `timePeriod`, plus the negation
    /// aliases `notContainsBlanks`/`notContainsErrors`) via
    /// [`normalize_conditional_format_input`] before deserializing into
    /// the canonical [`ConditionalFormat`] struct.
    ///
    /// Owns CF priority insertion: new formats are inserted at the front
    /// (lowest priority numeric value = highest priority in Excel
    /// semantics), matching Excel's "newly-added rule wins ties" behavior.
    /// Existing formats are renumbered upward via the typed
    /// `services::formatting::bump_cf_priorities` (filter viewport finding 13).
    #[bridge::write(scope = "sheet")]
    pub fn add_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // 1. Normalize wire input to canonical schema.
        let mut rule_json = rule;
        domain_types::domain::conditional_format::normalize_conditional_format_input(
            &mut rule_json,
        );
        let mut rule: ConditionalFormat =
            serde_json::from_value(rule_json).map_err(|e| ComputeError::Eval {
                message: format!("invalid conditional format payload: {e}"),
            })?;

        // 2. Populate range_identities from position-based ranges for CRDT safety.
        if rule.range_identities.as_ref().is_none_or(|r| r.is_empty()) && !rule.ranges.is_empty() {
            let identities = services::formatting::resolve_cf_ranges_to_identities(
                &mut self.mirror,
                &self.stores.grid_id_alloc,
                sheet_id,
                &rule.ranges,
            );
            if !identities.is_empty() {
                rule.range_identities = Some(identities);
            }
        }

        // 3. Excel semantics: newly-added formats get the highest priority
        //    (priority value 1; lower number = higher precedence). All
        //    existing formats are renumbered upward so the new format sits
        //    at the front of the sort order produced by
        //    `get_formats_for_sheet`. Rules within the new format are
        //    numbered sequentially starting at 1; existing formats keep
        //    their relative order (sorted by current first-rule priority).
        for (offset, r) in rule.rules.iter_mut().enumerate() {
            r.set_priority(1 + offset as i32);
        }
        let new_rule_count = rule.rules.len() as i32;

        // Bump existing formats' priorities BEFORE inserting the new one.
        // The typed in-place rewrite (filter viewport finding 13) replaces an N+1
        // JSON round-trip + `update_cf_rule` loop that silently dropped
        // errors via `let _ =`. Failures here propagate to the caller.
        if new_rule_count > 0 {
            services::formatting::bump_cf_priorities(&mut self.stores, sheet_id, new_rule_count)?;
        }

        let result = services::formatting::add_cf_rule(&mut self.stores, sheet_id, &rule);

        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    /// Update an existing conditional format by merging JSON updates.
    // TODO: If `updates` contains "ranges", also resolve and set "range_identities"
    // for CRDT safety. Requires parsing the JSON to detect range changes before passing to cf_store.
    #[bridge::write(scope = "sheet")]
    pub fn update_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule_id: &str,
        updates: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::formatting::update_cf_rule(&mut self.stores, sheet_id, rule_id, &updates)?;
        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    /// Delete a conditional format by ID.
    #[bridge::write(scope = "sheet")]
    pub fn delete_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::delete_cf_rule(&mut self.stores, sheet_id, rule_id)?;
        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    /// Reorder conditional formats for a sheet by providing the new order of format IDs.
    #[bridge::write(scope = "sheet")]
    pub fn reorder_cf_rules(
        &mut self,
        sheet_id: &SheetId,
        rule_ids: Vec<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::reorder_cf_rules(&mut self.stores, sheet_id, &rule_ids)?;
        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    /// Get all conditional formats for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_cf_rules(&self, sheet_id: &SheetId) -> Vec<ConditionalFormat> {
        services::formatting::get_all_cf_rules(&self.stores, sheet_id)
    }

    /// Get conditional formats that apply to a specific cell.
    #[bridge::read(scope = "cell")]
    pub fn get_cf_rules_for_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<ConditionalFormat> {
        services::formatting::get_cf_rules_for_cell(&self.stores, sheet_id, row, col)
    }

    /// Get a single conditional format by ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_conditional_format(
        &self,
        sheet_id: &SheetId,
        format_id: &str,
    ) -> Option<ConditionalFormat> {
        services::formatting::get_conditional_format(&self.stores, sheet_id, format_id)
    }

    /// Check if a cell has any conditional formatting rules applied.
    #[bridge::read(scope = "cell")]
    pub fn has_cf_for_cell(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        services::formatting::has_cf_for_cell(&self.stores, sheet_id, row, col)
    }

    /// Update the ranges of a conditional format.
    // TODO: Also resolve and store range_identities alongside ranges for CRDT safety.
    #[bridge::write(scope = "sheet")]
    pub fn update_cf_ranges(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        new_ranges: &[CFCellRange],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::update_cf_ranges(
            &mut self.stores,
            sheet_id,
            format_id,
            new_ranges,
        )?;
        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    /// Clear all conditional formats for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_cf_formats_for_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::clear_cf_formats_for_sheet(&mut self.stores, sheet_id)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // -------------------------------------------------------------------
    // CF Rule-level CRUD
    // -------------------------------------------------------------------

    /// Add a rule to an existing conditional format. Rules are kept sorted by priority.
    #[bridge::write(scope = "sheet")]
    pub fn add_rule_to_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule: &CFRule,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::formatting::add_rule_to_cf(&mut self.stores, sheet_id, format_id, rule)?;
        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    /// Update a rule within a conditional format by merging JSON updates.
    #[bridge::write(scope = "sheet")]
    pub fn update_rule_in_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule_id: &str,
        updates: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::update_rule_in_cf(
            &mut self.stores,
            sheet_id,
            format_id,
            rule_id,
            &updates,
        )?;
        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    /// Delete a rule from a conditional format. If no rules remain, deletes the format.
    #[bridge::write(scope = "sheet")]
    pub fn delete_rule_from_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::delete_rule_from_cf(
            &mut self.stores,
            sheet_id,
            format_id,
            rule_id,
        )?;
        let sid = *sheet_id;
        self.refresh_cf_cache(&sid);
        let patches = self.produce_cf_viewport_patches(&sid);
        Ok((patches, result))
    }

    // -------------------------------------------------------------------
    // CF Range Geometry Queries
    // -------------------------------------------------------------------

    // Pure geometric utilities over CFCellRange shape — do not read or
    // write sheet data and carry no SheetId. Scope = "workbook" because
    // they operate on policy-agnostic CF range geometry, not cells.
    /// Check if two CF ranges overlap (share any cells).
    #[bridge::read(scope = "workbook")]
    pub fn cf_ranges_overlap(&self, a: &CFCellRange, b: &CFCellRange) -> bool {
        services::formatting::cf_ranges_overlap(a, b)
    }

    /// Check if one CF range completely contains another.
    #[bridge::read(scope = "workbook")]
    pub fn cf_range_contains(&self, outer: &CFCellRange, inner: &CFCellRange) -> bool {
        services::formatting::cf_range_contains(outer, inner)
    }

    /// Subtract one CF range from another, returning up to 4 non-overlapping strips.
    #[bridge::read(scope = "workbook")]
    pub fn cf_subtract_range(
        &self,
        original: &CFCellRange,
        subtract: &CFCellRange,
    ) -> Vec<CFCellRange> {
        services::formatting::cf_subtract_range(original, subtract)
    }

    /// Calculate the intersection of two CF ranges.
    #[bridge::read(scope = "workbook")]
    pub fn cf_intersect_ranges(&self, a: &CFCellRange, b: &CFCellRange) -> Option<CFCellRange> {
        services::formatting::cf_intersect_ranges(a, b)
    }

    /// Check if a CF range is valid (end >= start).
    #[bridge::read(scope = "workbook")]
    pub fn cf_is_valid_range(&self, range: &CFCellRange) -> bool {
        services::formatting::cf_is_valid_range(range)
    }

    // NOTE: get_color_scale_presets and get_data_bar_presets live on CfBridge
    // (bridge_pure.rs) as pure functions — no engine state needed.

    /// Get all icon set presets.
    #[bridge::read(scope = "workbook")]
    pub fn get_icon_set_presets(&self) -> Vec<CFIconSetPreset> {
        services::formatting::get_icon_set_presets()
    }

    /// Get a preset by ID (searches all categories: data bar, color scale, icon set).
    #[bridge::read(scope = "workbook")]
    pub fn get_cf_preset_by_id(&self, id: &str) -> Option<CFPresetCategory> {
        services::formatting::get_cf_preset_by_id(id)
    }

    // -------------------------------------------------------------------
    // Row/Col format
    // -------------------------------------------------------------------

    /// Set format for an entire row.
    #[bridge::write(scope = "sheet")]
    pub fn set_row_format(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        format: CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::formatting::set_row_format(&mut self.stores, sheet_id, row, &format)?;
        // Row-level format affects every cell in the row, including virtual
        // positions with no allocated cell — there is no enumerable affected
        // set, so rebuild the visible viewport region. Mirrors the broad-effect
        // pattern used by `produce_cf_viewport_patches`.
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Set format for an entire column.
    #[bridge::write(scope = "sheet")]
    pub fn set_col_format(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        format: CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::formatting::set_col_format(&mut self.stores, sheet_id, col, &format)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    // -------------------------------------------------------------------
    // Bulk Row/Col/Cell Property Endpoints
    // -------------------------------------------------------------------

    /// Get formats for multiple rows at once.
    ///
    /// Returns `(row_index, Option<CellFormat>)` for each requested row.
    /// Rows with no explicit format return `None`.
    #[bridge::read(scope = "sheet")]
    pub fn get_row_formats(
        &self,
        sheet_id: &SheetId,
        rows: Vec<u32>,
    ) -> Vec<(u32, Option<CellFormat>)> {
        let grid_index = self.stores.grid_indexes.get(sheet_id);
        rows.into_iter()
            .map(|row| {
                let fmt =
                    properties::get_row_format(&self.stores.storage, sheet_id, row, grid_index);
                (row, fmt)
            })
            .collect()
    }

    /// Set formats for multiple rows at once.
    ///
    /// Each entry is `(row_index, CellFormat)`. Merges with existing row
    /// formats on a per-property basis (same as `set_row_format`).
    #[bridge::write(scope = "sheet")]
    pub fn set_row_formats(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, CellFormat)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        for (row, format) in &updates {
            services::formatting::set_row_format(&mut self.stores, sheet_id, *row, format)?;
        }
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, MutationResult::empty()))
    }

    /// Get formats for multiple columns at once.
    ///
    /// Returns `(col_index, Option<CellFormat>)` for each requested column.
    /// Columns with no explicit format return `None`.
    #[bridge::read(scope = "sheet")]
    pub fn get_col_formats(
        &self,
        sheet_id: &SheetId,
        cols: Vec<u32>,
    ) -> Vec<(u32, Option<CellFormat>)> {
        let grid_index = self.stores.grid_indexes.get(sheet_id);
        cols.into_iter()
            .map(|col| {
                let fmt =
                    properties::get_col_format(&self.stores.storage, sheet_id, col, grid_index);
                (col, fmt)
            })
            .collect()
    }

    /// Set formats for multiple columns at once.
    ///
    /// Each entry is `(col_index, CellFormat)`. Merges with existing column
    /// formats on a per-property basis (same as `set_col_format`).
    #[bridge::write(scope = "sheet")]
    pub fn set_col_formats(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, CellFormat)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        for (col, format) in &updates {
            services::formatting::set_col_format(&mut self.stores, sheet_id, *col, format)?;
        }
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, MutationResult::empty()))
    }

    /// Get effective (resolved) cell formats for a rectangular range.
    ///
    /// Returns a 2D array (row-major) of `Option<CellFormat>` where each
    /// element is the fully resolved 5-layer cascade (default -> col -> row ->
    /// table -> cell). Cells with no data still get positional format
    /// (default -> col -> row).
    ///
    /// Range size is capped at 10,000 cells to prevent excessive memory usage.
    #[bridge::read(scope = "range")]
    pub fn query_range_properties(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<Vec<Vec<Option<CellFormat>>>, ComputeError> {
        if start_row > end_row || start_col > end_col {
            return Err(ComputeError::Eval {
                message: "query_range_properties: inverted range (start > end)".to_string(),
            });
        }
        let num_rows = (end_row - start_row + 1) as u64;
        let num_cols = (end_col - start_col + 1) as u64;
        let cell_count = num_rows * num_cols;

        if cell_count > 10_000 {
            return Err(ComputeError::Eval {
                message: format!(
                    "query_range_properties: range too large ({} cells, max 10000)",
                    cell_count
                ),
            });
        }

        let grid_index = self.stores.grid_indexes.get(sheet_id);
        let sheet_mirror = self.mirror.get_sheet(sheet_id);
        let mut result = Vec::with_capacity(num_rows as usize);

        for row in start_row..=end_row {
            let mut row_formats = Vec::with_capacity(num_cols as usize);
            for col in start_col..=end_col {
                let cell_id = grid_index
                    .and_then(|grid| grid.cell_id_at(row, col))
                    .or_else(|| {
                        self.mirror
                            .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                    });

                let fmt = if let Some(cid) = cell_id {
                    let cell_hex = id_to_hex(cid.as_u128());
                    let table_fmt = services::tables::resolve_table_format_at_cell(
                        &self.mirror,
                        sheet_id,
                        row,
                        col,
                    );
                    Some(properties::get_effective_format(
                        &self.stores.storage,
                        sheet_id,
                        &cell_hex,
                        row,
                        col,
                        table_fmt.as_ref(),
                        grid_index,
                        sheet_mirror,
                    ))
                } else {
                    // No cell at this position — return positional format if non-default
                    let positional = properties::get_positional_format(
                        &self.stores.storage,
                        sheet_id,
                        row,
                        col,
                        grid_index,
                        sheet_mirror,
                    );
                    if positional == CellFormat::default() {
                        None
                    } else {
                        Some(positional)
                    }
                };
                row_formats.push(fmt);
            }
            result.push(row_formats);
        }

        Ok(result)
    }

    /// Set cell formats for a batch of individual cells.
    ///
    /// Each entry is `(row, col, CellFormat)`. Resolves cell IDs via the
    /// grid index (allocating if needed) and applies the format per cell.
    /// Formats merge with existing cell formats on a per-property basis.
    #[bridge::write(scope = "sheet")]
    pub fn set_cell_properties_batch(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, CellFormat)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if !self.stores.grid_indexes.contains_key(sheet_id) {
            return Err(ComputeError::Eval {
                message: format!("Sheet not found: {:?}", sheet_id),
            });
        }

        for (row, col, format) in &updates {
            let Some(grid) = self.stores.grid_indexes.get_mut(sheet_id) else {
                continue;
            };
            // Pre-register virtual CellId for Range-resident positions so
            // ensure_cell_id returns the deterministic virtual ID.
            crate::storage::cells::values::maybe_register_virtual_cell_id(
                &self.mirror,
                sheet_id,
                grid,
                *row,
                *col,
            );
            let cell_id = grid.ensure_cell_id(*row, *col);
            let cell_hex = id_to_hex(cell_id.as_u128());
            services::formatting::set_cell_format(&mut self.stores, sheet_id, &cell_hex, format);
        }

        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // -------------------------------------------------------------------
    // Displayed (CF-merged) Cell Properties
    // -------------------------------------------------------------------

    /// Get the "displayed" format for a single cell position.
    ///
    /// Performs the complete 6-layer resolution pipeline:
    /// 1. 5-layer cascade: default -> column -> row -> table -> cell
    /// 2. Theme color resolution (theme refs -> hex)
    /// 3. CF merge (6th layer)
    ///
    /// This is the format a user would visually see in the spreadsheet, after
    /// all cascading rules and conditional formatting have been applied.
    ///
    /// Unlike `get_resolved_format`, this returns a sparse `CellFormat` (fields
    /// that are `None` are omitted from JSON) rather than a dense
    /// `ResolvedCellFormat` (fields that are `None` serialize as `null`).
    #[bridge::read(scope = "cell")]
    pub fn get_displayed_cell_properties(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> CellFormat {
        let pos = SheetPos::new(row, col);
        let cell_id = self
            .stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|grid| grid.cell_id_at(row, col))
            .or_else(|| self.mirror.resolve_cell_id(sheet_id, pos));

        let mut fmt = if let Some(cid) = cell_id {
            let cell_hex = id_to_hex(cid.as_u128());
            let table_fmt =
                services::tables::resolve_table_format_at_cell(&self.mirror, sheet_id, row, col);
            properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                row,
                col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            )
        } else {
            properties::get_positional_format(
                &self.stores.storage,
                sheet_id,
                row,
                col,
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            )
        };

        // Theme resolution (matches viewport pipeline order).
        // No formula format inheritance — see `get_resolved_format` for rationale.
        domain_types::theme_color::resolve_theme_refs(&mut fmt, &self.settings.theme_palette);

        // CF as 6th cascade layer (range-scoped — applies to blank cells too).
        super::viewport::apply_cf_to_format(self.stores.cf_cache.get(sheet_id), &mut fmt, row, col);

        // Number-format section color (e.g. [Red]) — value-dependent override.
        // Lower priority than CF font_color, higher than stored font_color.
        if let Some(value) =
            crate::storage::cells::values::get_effective_value(&self.mirror, sheet_id, row, col)
        {
            let format_code = fmt.number_format.as_deref().unwrap_or("General");
            let fr = compute_formats::format_value(&value, format_code, &self.settings.locale);
            if let Some(ref color) = fr.color {
                super::viewport::apply_number_format_color(
                    &mut fmt,
                    color,
                    self.stores.cf_cache.get(sheet_id),
                    row,
                    col,
                );
            }
        }

        fmt
    }

    /// Get displayed (CF-merged) cell formats for a rectangular range.
    ///
    /// Returns a 2D array (row-major) of `CellFormat` where each element
    /// is the fully resolved 6-layer cascade (default -> col -> row ->
    /// table -> cell -> CF) with theme colors resolved.
    ///
    /// Range size is capped at 10,000 cells to prevent excessive memory usage.
    #[bridge::read(scope = "range")]
    pub fn get_displayed_range_properties(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<Vec<Vec<CellFormat>>, ComputeError> {
        if start_row > end_row || start_col > end_col {
            return Err(ComputeError::Eval {
                message: "get_displayed_range_properties: inverted range (start > end)".to_string(),
            });
        }
        let num_rows = (end_row - start_row + 1) as u64;
        let num_cols = (end_col - start_col + 1) as u64;
        let cell_count = num_rows * num_cols;

        if cell_count > 10_000 {
            return Err(ComputeError::Eval {
                message: format!(
                    "get_displayed_range_properties: range too large ({} cells, max 10000)",
                    cell_count
                ),
            });
        }

        let grid_index = self.stores.grid_indexes.get(sheet_id);
        let sheet_mirror = self.mirror.get_sheet(sheet_id);
        let cf_cache_entry = self.stores.cf_cache.get(sheet_id);
        let mut result = Vec::with_capacity(num_rows as usize);

        for row in start_row..=end_row {
            let mut row_formats = Vec::with_capacity(num_cols as usize);
            for col in start_col..=end_col {
                let cell_id = grid_index
                    .and_then(|grid| grid.cell_id_at(row, col))
                    .or_else(|| {
                        self.mirror
                            .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                    });

                let mut fmt = if let Some(cid) = cell_id {
                    let cell_hex = id_to_hex(cid.as_u128());
                    let table_fmt = services::tables::resolve_table_format_at_cell(
                        &self.mirror,
                        sheet_id,
                        row,
                        col,
                    );
                    properties::get_effective_format(
                        &self.stores.storage,
                        sheet_id,
                        &cell_hex,
                        row,
                        col,
                        table_fmt.as_ref(),
                        grid_index,
                        sheet_mirror,
                    )
                } else {
                    properties::get_positional_format(
                        &self.stores.storage,
                        sheet_id,
                        row,
                        col,
                        grid_index,
                        sheet_mirror,
                    )
                };

                // Theme resolution.
                // No formula format inheritance — see `get_resolved_format`.
                domain_types::theme_color::resolve_theme_refs(
                    &mut fmt,
                    &self.settings.theme_palette,
                );

                // CF as 6th cascade layer (range-scoped — applies to blank cells too).
                super::viewport::apply_cf_to_format(cf_cache_entry, &mut fmt, row, col);

                row_formats.push(fmt);
            }
            result.push(row_formats);
        }

        Ok(result)
    }

    // -------------------------------------------------------------------
    // Schema Storage CRUD
    // -------------------------------------------------------------------

    /// Get the column schema at the given column index.
    #[bridge::read(scope = "sheet")]
    pub fn get_column_schema(&self, sheet_id: &SheetId, col_index: u32) -> Option<ColumnSchema> {
        services::formatting::get_column_schema(&self.stores, sheet_id, col_index)
    }

    /// Set (create or overwrite) a column schema at the given column index.
    #[bridge::write(scope = "sheet")]
    pub fn set_column_schema(
        &mut self,
        sheet_id: &SheetId,
        col_index: u32,
        schema: &ColumnSchema,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::formatting::set_column_schema(&mut self.stores, sheet_id, col_index, schema)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Remove the column schema at the given column index.
    #[bridge::write(scope = "sheet")]
    pub fn clear_column_schema(
        &mut self,
        sheet_id: &SheetId,
        col_index: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::formatting::clear_column_schema(&mut self.stores, sheet_id, col_index)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Return all column schemas for a sheet as `(col_position, ColumnSchema)` pairs.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_column_schemas(&self, sheet_id: &SheetId) -> Vec<(u32, ColumnSchema)> {
        services::formatting::get_all_column_schemas(&self.stores, sheet_id)
    }

    /// Get a single range schema by its ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_range_schema(&self, sheet_id: &SheetId, schema_id: &str) -> Option<RangeSchema> {
        services::formatting::get_range_schema(&self.stores, sheet_id, schema_id)
    }

    /// Return all range schemas for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_range_schemas_for_sheet(&self, sheet_id: &SheetId) -> Vec<RangeSchema> {
        services::formatting::get_range_schemas_for_sheet(&self.stores, sheet_id)
    }

    /// Create or overwrite a range schema.
    #[bridge::write(scope = "sheet")]
    pub fn set_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema: &RangeSchema,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::set_range_schema(&mut self.stores, sheet_id, schema)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Update an existing range schema (full replacement).
    #[bridge::write(scope = "sheet")]
    pub fn update_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema_id: &str,
        updates: &RangeSchema,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::formatting::update_range_schema(
            &mut self.stores,
            sheet_id,
            schema_id,
            updates,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Delete a range schema by ID.
    #[bridge::write(scope = "sheet")]
    pub fn delete_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::formatting::delete_range_schema(&mut self.stores, sheet_id, schema_id)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Validate a cell value against any applicable schema (column or range).
    #[bridge::read(scope = "cell")]
    pub fn validate_cell_value(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        value: &str,
    ) -> CellValidationResult {
        services::formatting::validate_cell_value(
            &self.stores,
            &self.mirror,
            sheet_id,
            row,
            col,
            value,
        )
    }
}

// Removed: unused convenience wrapper `resolve_cf_ranges_to_identities` —
// callers use `services::formatting::resolve_cf_ranges_to_identities` directly.
