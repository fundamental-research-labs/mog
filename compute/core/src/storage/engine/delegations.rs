//! Delegation methods (scenarios, bindings, batch ops, sheet management) for YrsComputeEngine.

use super::YrsComputeEngine;
use super::mutation::{EngineMutation, MutationOutput};
use super::mutation_coordinator::SheetLifecycleHistoryHint;
use crate::identity::GridIndex;
use crate::snapshot::{
    CellEdit, ChangeKind, MutationResult, NamedRangeChange, PageBreakChange, PrintAreaChange,
    PrintSettingsChange, PrintTitlesChange, RecalcResult, Scenario, ScenarioCreateInput,
    ScenarioUpdateInput, ScrollPositionChange, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint, SheetSettingsChange, SheetSnapshot,
};
use crate::storage::sheet::bindings;
use crate::storage::sheet::{
    order, print, properties, protection, settings, split_view, view, visibility,
};
use crate::storage::workbook::named_ranges;
use crate::what_if::scenarios;
use bridge_core as bridge;
use cell_types::{CellId, SheetId};
use compute_collab as sync;
use compute_document::hex::id_to_hex;
use domain_types::domain::print::PageBreaks;
use domain_types::domain::sheet::{
    PrintRange, PrintTitles, SheetProtectionOptions, SheetSettings, SplitViewConfig,
};
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

// Used by set_date_value / set_time_value
use compute_formats;
use compute_wire::mutation::serialize_multi_viewport_patches;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "delegations",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Scenarios
    // -------------------------------------------------------------------

    #[bridge::write(scope = "workbook")]
    pub fn create_scenario(
        &self,
        input: ScenarioCreateInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = scenarios::create(&self.stores.storage, input, &self.stores.id_alloc);
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty().with_data(&result)?,
        ))
    }

    #[bridge::write(scope = "workbook")]
    pub fn update_scenario(
        &self,
        scenario_id: &str,
        input: ScenarioUpdateInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = scenarios::update(&self.stores.storage, scenario_id, input);
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty().with_data(&result)?,
        ))
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_scenario(
        &self,
        scenario_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = scenarios::remove(&self.stores.storage, scenario_id);
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty().with_data(&result)?,
        ))
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_all_scenarios(&self) -> Vec<Scenario> {
        scenarios::get_all(&self.stores.storage)
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_active_scenario_state(&self) -> Option<crate::snapshot::ScenarioActiveState> {
        scenarios::active_state(&self.stores.storage, &self.scenario_session)
    }

    #[bridge::write(scope = "workbook")]
    pub fn apply_scenario(
        &mut self,
        scenario_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::ApplyScenario {
            scenario_id: scenario_id.to_string(),
        })? {
            MutationOutput::Recalc(result) => Ok((self.flush_viewport_patches(), result)),
            MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    #[bridge::write(scope = "workbook")]
    pub fn restore_scenario(
        &mut self,
        baseline_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::RestoreScenario {
            baseline_id: baseline_id.to_string(),
        })? {
            MutationOutput::Recalc(result) => Ok((self.flush_viewport_patches(), result)),
            MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    #[bridge::write(scope = "workbook")]
    pub fn set_active_scenario(
        &self,
        scenario_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios::set_active_scenario_id(&self.stores.storage, scenario_id.as_deref())?;
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // -------------------------------------------------------------------
    // Bindings
    // -------------------------------------------------------------------

    #[bridge::write(scope = "sheet")]
    pub fn create_binding(
        &self,
        sheet_id: &SheetId,
        binding: bindings::CreateBindingInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let sheet_id = id_to_hex(sheet_id.as_u128());
        let options = bindings::CreateBindingOptions {
            auto_generate_rows: binding.auto_generate_rows,
            header_row: binding.header_row,
            data_start_row: binding.data_start_row,
            preserve_header_formatting: binding.preserve_header_formatting,
        };
        let result = bindings::create_binding(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            &sheet_id,
            &binding.connection_id,
            binding.column_mappings,
            options,
            &self.stores.id_alloc,
        )?;
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty().with_data(&result)?,
        ))
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_binding(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
        updates: bindings::UpdateBindingFields,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let sheet_id = id_to_hex(sheet_id.as_u128());
        bindings::update_binding(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            &sheet_id,
            binding_id,
            updates,
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    #[bridge::write(scope = "sheet")]
    pub fn remove_binding(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let sheet_id = id_to_hex(sheet_id.as_u128());
        bindings::remove_binding(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            &sheet_id,
            binding_id,
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_all_bindings(&self, sheet_id: &SheetId) -> Vec<bindings::SheetDataBinding> {
        let sheet_id = id_to_hex(sheet_id.as_u128());
        bindings::get_all_bindings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            &sheet_id,
        )
    }

    /// Get a specific data binding by ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_binding(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
    ) -> Option<bindings::SheetDataBinding> {
        let sheet_id = id_to_hex(sheet_id.as_u128());
        bindings::get_binding(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            &sheet_id,
            binding_id,
        )
    }

    /// Get all data bindings for a specific connection across all sheets.
    #[bridge::read(scope = "workbook")]
    pub fn get_bindings_for_connection(
        &self,
        connection_id: &str,
    ) -> Vec<bindings::SheetDataBinding> {
        bindings::get_bindings_for_connection(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            connection_id,
        )
    }

    /// Update binding refresh metadata (lastRefresh, lastRowCount).
    #[bridge::write(scope = "sheet")]
    pub fn update_refresh_metadata(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
        last_refresh: i64,
        last_row_count: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let sheet_id = id_to_hex(sheet_id.as_u128());
        bindings::update_refresh_metadata(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            &sheet_id,
            binding_id,
            last_refresh,
            last_row_count,
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Remove all data bindings for a connection across all sheets.
    #[bridge::write(scope = "workbook")]
    pub fn remove_bindings_for_connection(
        &self,
        connection_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let count = bindings::remove_bindings_for_connection(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            connection_id,
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty().with_data(&count)?,
        ))
    }

    // -------------------------------------------------------------------
    // ComputeCore delegations (bridge reach-throughs)
    // -------------------------------------------------------------------
    // These thin wrappers expose ComputeCore methods that WASM/Tauri bindings
    // call via engine.compute_mut().xxx(). By lifting them onto
    // YrsComputeEngine, the bridge generator can emit bindings for them.

    /// Batch-set cells by (SheetId, CellId, row, col, CellInput).
    ///
    /// Routes through `apply_mutation()` to update all five stores:
    /// yrs Doc, mirror, grid_indexes, compute, and undo_manager.
    //
    // Scope = "workbook" because the edit list can span multiple
    // sheets. Per-cell gating inside the loop would require per-sheet
    // matrix lookups on each edit; R3 checks the coarse workbook-level
    // write permission up front and R4 can refine to per-sheet if the
    // perf budget warrants.
    #[bridge::write(scope = "workbook")]
    pub fn batch_set_cells(
        &mut self,
        edits: Vec<(SheetId, CellId, u32, u32, super::mutation::CellInput)>,
        skip_cycle_check: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::SetCells {
            edits,
            skip_cycle_check,
        })? {
            super::mutation::MutationOutput::Recalc(r) => Ok((self.flush_viewport_patches(), r)),
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Clear one or more cells.
    ///
    /// Routes through `apply_mutation()` to update all five stores.
    #[bridge::write(scope = "workbook")]
    pub fn batch_clear_cells(
        &mut self,
        cell_ids: Vec<CellId>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::ClearCells { cell_ids })? {
            super::mutation::MutationOutput::Recalc(r) => Ok((self.flush_viewport_patches(), r)),
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Batch-set cells by position (no CellId required from caller).
    ///
    /// Routes through `apply_mutation()` to update all five stores.
    /// CellIds are resolved internally: existing cells reuse their CellId,
    /// new cells get a fresh UUID v4. Empty inputs clear existing cells,
    /// skip non-existent cells.
    //
    // Scope = "workbook" for the same reason as `batch_set_cells`: the
    // edit list spans arbitrary sheets and the macro has no per-edit
    // gating hook.
    #[bridge::write(scope = "workbook")]
    pub fn batch_set_cells_by_position(
        &mut self,
        edits: Vec<(SheetId, u32, u32, super::mutation::CellInput)>,
        skip_cycle_check: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::SetCellsByPosition {
            edits,
            skip_cycle_check,
        })? {
            super::mutation::MutationOutput::Recalc(r) => Ok((self.flush_viewport_patches(), r)),
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Batch-set cells with A1 address resolution, value normalization, and dedup.
    ///
    /// Accepts an array of `BatchCellInput` (which may specify cells by A1 address
    /// or by row/col), normalizes values (formulas, nulls, empty strings), deduplicates
    /// by (row, col) with last-write-wins, then writes all cells in one mutation.
    #[bridge::write(scope = "sheet")]
    pub fn set_cells_batch(
        &mut self,
        sheet_id: &SheetId,
        cells: Vec<crate::snapshot::BatchCellInput>,
    ) -> Result<crate::snapshot::SetCellsBatchResult, ComputeError> {
        use std::collections::HashMap;

        if cells.is_empty() {
            return Ok(crate::snapshot::SetCellsBatchResult {
                cells_written: 0,
                duplicates_removed: 0,
            });
        }

        // 1. Resolve addresses and normalize values into typed CellInput.
        use super::mutation::CellInput;
        let mut edits: Vec<(u32, u32, CellInput)> = Vec::with_capacity(cells.len());
        for cell in &cells {
            let (row, col) = if let Some(ref addr) = cell.addr {
                let parsed =
                    crate::range_manager::parse_cell(addr).ok_or_else(|| ComputeError::Eval {
                        message: format!("Invalid cell address: {}", addr),
                    })?;
                (parsed.row, parsed.col)
            } else {
                match (cell.row, cell.col) {
                    (Some(r), Some(c)) => (r, c),
                    _ => {
                        return Err(ComputeError::Eval {
                            message: "Cell must have either addr or both row and col".to_string(),
                        });
                    }
                }
            };

            // Normalize value: null → Clear, empty string → Literal(""),
            // other values → Parse (rich input).
            let input = match &cell.value {
                None => CellInput::Clear,
                Some(v) if v.is_empty() => CellInput::Literal {
                    text: String::new(),
                },
                Some(v) => CellInput::Parse { text: v.clone() },
            };

            edits.push((row, col, input));
        }

        // 2. Dedup by (row, col) — last-write-wins
        let original_count = edits.len();
        let mut deduped: HashMap<(u32, u32), CellInput> = HashMap::with_capacity(original_count);
        for (row, col, input) in edits {
            deduped.insert((row, col), input);
        }
        let duplicates_removed = (original_count - deduped.len()) as u32;

        // 3. Build the edits vector for the mutation
        let mutation_edits: Vec<(SheetId, u32, u32, CellInput)> = deduped
            .into_iter()
            .map(|((row, col), input)| (*sheet_id, row, col, input))
            .collect();
        let cells_written = mutation_edits.len() as u32;

        // 4. Execute through the standard mutation path.
        // Trusted bulk path: skip per-edge cycle detection. The topological
        // sort in recalc() catches any cycles; per-edge DFS here would
        // spuriously #REF! whichever formula happens to close an intentional
        // cycle.
        self.apply_mutation(EngineMutation::SetCellsByPosition {
            edits: mutation_edits,
            skip_cycle_check: true,
        })?;

        Ok(crate::snapshot::SetCellsBatchResult {
            cells_written,
            duplicates_removed,
        })
    }

    /// Set a date value in a cell, automatically applying date format if needed.
    ///
    /// Combines what was previously 3-5 IPC calls in TS: get format, prepare date,
    /// write cell, apply format. All done in a single Rust call.
    #[bridge::write(scope = "cell")]
    pub fn set_date_value(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        year: i32,
        month: u32,
        day: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // 1. Get existing format for the cell
        let existing_format = {
            let cell_id =
                super::services::cell_editing::find_cell_id_at(&self.stores, sheet_id, row, col);
            cell_id.and_then(|cid| {
                let cell_hex = id_to_hex(cid.as_u128());
                let table_fmt = super::services::tables::resolve_table_format_at_cell(
                    &self.mirror,
                    sheet_id,
                    row,
                    col,
                );
                let fmt = crate::storage::properties::get_effective_format(
                    &self.stores.storage,
                    sheet_id,
                    &cell_hex,
                    row,
                    col,
                    table_fmt.as_ref(),
                    self.stores.grid_indexes.get(sheet_id),
                    self.mirror.get_sheet(sheet_id),
                );
                fmt.number_format
            })
        };

        // 2. Prepare date value (serial + format decision)
        let result =
            compute_formats::prepare_date_value(year, month, day, existing_format.as_deref());

        // 3. Write the serial number to the cell.
        // Single-cell write but routed through the batch mutation variant;
        // pass skip_cycle_check: true so the path aligns with other batch
        // callers. A serialised numeric date value cannot introduce a new
        // cycle anyway, so there is nothing for per-edge detection to catch.
        let edits = vec![(
            *sheet_id,
            row,
            col,
            super::mutation::CellInput::Parse {
                text: result.serial.to_string(),
            },
        )];
        let output = self.apply_mutation(EngineMutation::SetCellsByPosition {
            edits,
            skip_cycle_check: true,
        })?;

        // 4. Apply format if needed
        if let Some(ref fmt_code) = result.format_to_apply {
            let ranges = vec![(row, col, row, col)];
            let format = domain_types::CellFormat {
                number_format: Some(fmt_code.clone()),
                ..Default::default()
            };
            let _guard = self.mutation.suppress_guard();
            super::services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                sheet_id,
                &ranges,
                &format,
            )?;
        }

        let mutation_result = match output {
            MutationOutput::Recalc(r)
            | MutationOutput::SheetId(_, r)
            | MutationOutput::Plain(r) => r,
        };
        Ok((self.flush_viewport_patches(), mutation_result))
    }

    /// Set a time value in a cell, automatically applying time format if needed.
    ///
    /// Combines what was previously 3-5 IPC calls in TS: get format, prepare time,
    /// write cell, apply format. All done in a single Rust call.
    #[bridge::write(scope = "cell")]
    pub fn set_time_value(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        hours: u32,
        minutes: u32,
        seconds: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // 1. Get existing format for the cell
        let existing_format = {
            let cell_id =
                super::services::cell_editing::find_cell_id_at(&self.stores, sheet_id, row, col);
            cell_id.and_then(|cid| {
                let cell_hex = id_to_hex(cid.as_u128());
                let table_fmt = super::services::tables::resolve_table_format_at_cell(
                    &self.mirror,
                    sheet_id,
                    row,
                    col,
                );
                let fmt = crate::storage::properties::get_effective_format(
                    &self.stores.storage,
                    sheet_id,
                    &cell_hex,
                    row,
                    col,
                    table_fmt.as_ref(),
                    self.stores.grid_indexes.get(sheet_id),
                    self.mirror.get_sheet(sheet_id),
                );
                fmt.number_format
            })
        };

        // 2. Prepare time value (serial + format decision)
        let result = compute_formats::prepare_time_value(
            hours,
            minutes,
            seconds,
            existing_format.as_deref(),
        );

        // 3. Write the serial number to the cell.
        // Same reasoning as set_date_value: batch-variant routing, a serial
        // time value cannot close a cycle, skip per-edge detection to keep
        // the path consistent with other trusted batch callers.
        let edits = vec![(
            *sheet_id,
            row,
            col,
            super::mutation::CellInput::Parse {
                text: result.serial.to_string(),
            },
        )];
        let output = self.apply_mutation(EngineMutation::SetCellsByPosition {
            edits,
            skip_cycle_check: true,
        })?;

        // 4. Apply format if needed
        if let Some(ref fmt_code) = result.format_to_apply {
            let ranges = vec![(row, col, row, col)];
            let format = domain_types::CellFormat {
                number_format: Some(fmt_code.clone()),
                ..Default::default()
            };
            let _guard = self.mutation.suppress_guard();
            super::services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                sheet_id,
                &ranges,
                &format,
            )?;
        }

        let mutation_result = match output {
            MutationOutput::Recalc(r)
            | MutationOutput::SheetId(_, r)
            | MutationOutput::Plain(r) => r,
        };
        Ok((self.flush_viewport_patches(), mutation_result))
    }

    /// Clear all cells in a range by position.
    ///
    /// Routes through `apply_mutation()` for proper undo tracking and recalc.
    /// Only clears cells that exist — positions with no cell are skipped.
    #[bridge::write(scope = "range")]
    pub fn clear_range_by_position(
        &mut self,
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::ClearRangeByPosition {
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        })? {
            super::mutation::MutationOutput::Recalc(r) => Ok((self.flush_viewport_patches(), r)),
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Apply a batch of CellEdit changes (undo/redo/collaboration sync).
    ///
    /// This is a compute-only operation: CellEdits already contain
    /// fully-resolved values and formulas from the yrs Doc. The yrs Doc
    /// and mirror are updated through the undo/redo/sync pathways that
    /// produce these CellEdits.
    #[bridge::write(scope = "workbook")]
    pub fn apply_changes(
        &mut self,
        changes: Vec<CellEdit>,
        skip_cycle_check: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut recalc =
            self.stores
                .compute
                .apply_changes(&mut self.mirror, &changes, skip_cycle_check)?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, MutationResult::from_recalc(recalc)))
    }

    /// Add a sheet to the compute engine from a snapshot.
    ///
    /// Also builds and inserts a GridIndex so identity tracking stays in sync.
    #[bridge::write(scope = "workbook")]
    pub fn add_compute_sheet(
        &mut self,
        snapshot: SheetSnapshot,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Build GridIndex from the snapshot before passing it to compute
        let sheet_id = SheetId::from_uuid_str(&snapshot.id)?;
        let mut grid = GridIndex::new(
            sheet_id,
            snapshot.rows,
            snapshot.cols,
            self.stores.grid_id_alloc.clone(),
        );
        for cell_data in &snapshot.cells {
            let cell_id = CellId::from_uuid_str(&cell_data.cell_id)?;
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
        self.stores.grid_indexes.insert(sheet_id, grid);

        self.stores.compute.add_sheet(&mut self.mirror, snapshot)?;
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Remove a sheet from the compute engine and grid_indexes.
    #[bridge::write(scope = "sheet")]
    pub fn remove_compute_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Remove from grid_indexes (compute.remove_sheet handles mirror + graph)
        self.stores.grid_indexes.remove(sheet_id);
        let recalc = self
            .stores
            .compute
            .remove_sheet(&mut self.mirror, sheet_id)?;
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::from_recalc(recalc),
        ))
    }

    /// Rename a sheet in all stores (yrs Doc, mirror, compute).
    ///
    /// Routes through `apply_mutation()` to update all stores consistently.
    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "sheet")]
    pub fn rename_compute_sheet(
        &mut self,
        sheet_id: &SheetId,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::RenameSheet {
            sheet_id: *sheet_id,
            name: name.to_string(),
        })? {
            super::mutation::MutationOutput::Plain(result) => {
                Ok((serialize_multi_viewport_patches(&[]), result))
            }
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Add or update a named range definition.
    #[bridge::write(scope = "workbook")]
    pub fn set_named_range(
        &mut self,
        name: String,
        def: NamedRangeDef,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Convert scope for Yrs storage
        let scope_str = match &def.scope {
            formula_types::Scope::Sheet(id) => Some(id.to_uuid_string()),
            formula_types::Scope::Workbook => None,
        };

        // Canonicalize to JSON-serialized IdentityFormula at the write site
        // (refactor typed formula boundary). Typed-boundary picks IdentityFormula JSON as the
        // single on-disk format for `DefinedName.refers_to` in Yrs:
        //
        //   - Identity-stable under structural ops: CellIds don't shift when
        //     rows/columns are inserted or deleted; A1 coordinates do. CRDT
        //     sync carries the Yrs document — both peers see the same CellIds
        //     because cells are allocated in Yrs with stable UUID-based ids.
        //   - JSON at this boundary is an external-format serialization of an
        //     already-typed value, not a stringly-typed smell.
        //
        // If the resolver can produce an `IdentityFormula` from the raw A1
        // expression, serialize it. If parsing fails (constants, `#REF!`
        // literals, array constants, etc.), fall back to a template-only
        // `IdentityFormula` so the wire shape is unchanged from the reader's
        // perspective. Both arms below produce serde_json JSON.
        // Determine a context sheet for parsing: prefer the name's scope,
        // else fall back to the first sheet in the workbook.
        let first_sheet = self.mirror.sheet_ids().next().copied();
        let context_sheet = match &def.scope {
            formula_types::Scope::Sheet(id) => Some(*id),
            formula_types::Scope::Workbook => first_sheet,
        };
        let identity = match (&def.raw_expression, context_sheet) {
            (Some(expr), Some(ctx)) => {
                let a1 = if expr.starts_with('=') {
                    expr.clone()
                } else {
                    format!("={}", expr)
                };
                match self
                    .stores
                    .compute
                    .to_identity_formula(&mut self.mirror, &ctx, &a1)
                {
                    Ok(id) => id,
                    Err(_) => {
                        // Non-parseable (constant, #REF!, etc.) — wrap as
                        // a template-only IdentityFormula with no refs.
                        let template = expr.strip_prefix('=').unwrap_or(expr).to_string();
                        IdentityFormula {
                            template,
                            refs: vec![],
                            is_dynamic_array: false,
                            is_volatile: false,
                            // No AST available; conservative default.
                            is_aggregate: false,
                        }
                    }
                }
            }
            _ => def.refers_to.clone(),
        };

        // Persist identity mappings (CellId ↔ position) for every cell the
        // IdentityFormula references into Yrs `gridIndex/{posToId, idToPos}`.
        // `to_identity_formula` above allocated these CellIds into the local
        // `CellMirror` only (via `CoreIdentityResolver`), but the on-disk
        // named-range format is IdentityFormula JSON — so remote peers need
        // the identity mappings in Yrs to resolve those CellIds back to
        // `(sheet, row, col)`. Without this step, remote renderers fall back
        // to `#REF!` on the receiving side.
        super::services::cell_editing::persist_identity_formula_cell_identities(
            &mut self.stores,
            &self.mirror,
            &identity,
        );

        // SAFETY: serializing a struct with #[derive(Serialize)]; no map
        // keys and no non-finite floats in IdentityFormula.
        let refers_to_json = serde_json::to_string(&identity)
            .expect("IdentityFormula serialization should not fail");

        // Capture the variable's synthetic CellId now, before `set_named_range`
        // potentially re-keys it. Used as a recalc seed below — every formula
        // cell that references this name has a graph edge into this synthetic
        // CellId, so seeding from it walks straight to the dependents.
        let scope_for_seed = def.scope.clone();
        let key_for_seed = name.to_ascii_lowercase();

        // Write to scheduler/mirror (in-memory DAG)
        self.stores
            .compute
            .set_named_range(&mut self.mirror, name.clone(), def);

        // Persist to Yrs storage.
        // Suppress the observer to prevent the Yrs write from being picked up
        // and overwriting the mirror entry we just set with correct data.
        self.mutation.observer.set_suppressed(true);
        let defined_name = named_ranges::DefinedName {
            id: self.stores.next_id_simple(),
            name: name.clone(),
            refers_to: refers_to_json,
            raw_refers_to: None,
            scope: scope_str,
            comment: None,
            custom_menu: None,
            description: None,
            help: None,
            status_bar: None,
            visible: true,
            xlm: false,
            function: false,
            vb_procedure: false,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
            order: None,
            linked_range_id: None,
        };
        named_ranges::upsert_named_range(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            &defined_name,
        );
        self.mutation.observer.set_suppressed(false);

        // Run an incremental recalc seeded from the variable's synthetic
        // CellId. Every formula cell that references the name has a graph
        // edge into this CellId, so `affected_cells` walks straight to the
        // dependents and topologically re-evaluates them. Without this, the
        // dependent values stay stale until someone explicitly invokes
        // `wb.calculate()` (which is a workaround the auto-improve evals
        // happen to do, but the UI does not — Excel's parity is "redefining
        // a name immediately recomputes formulas that use it").
        //
        // `prepare_recalc_for_flush` runs `mark_dirty()` for us as well as
        // CF-cache refresh, display-text enrichment, and schema validation —
        // exactly the same post-mutation funnel cell edits go through.
        let seed_id = self
            .mirror
            .variables
            .get_variable_cell_id(&scope_for_seed, &key_for_seed);
        let mut recalc = match seed_id {
            Some(cell_id) => self.stores.compute.recalc(&mut self.mirror, &[cell_id])?,
            None => RecalcResult::empty(),
        };
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();

        let mut result = MutationResult::from_recalc(recalc);
        result.named_range_changes.push(NamedRangeChange {
            name,
            kind: ChangeKind::Set,
        });
        Ok((patches, result))
    }

    /// Remove a named range by name.
    #[bridge::write(scope = "workbook")]
    pub fn remove_named_range(
        &mut self,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Capture every variable synthetic CellId for this name (across all
        // scopes) BEFORE the variable store removes them — these are the
        // recalc seeds for the formulas that reference this name. Once
        // `compute.remove_named_range` runs, the variable cell ids are gone
        // from the mirror and we can't recover them.
        let key = name.to_ascii_lowercase();
        let seed_ids: Vec<CellId> = self
            .mirror
            .variables
            .all_variables()
            .filter(|(_, var_name, _)| var_name.as_str() == key)
            .filter_map(|(scope, _, _)| self.mirror.variables.get_variable_cell_id(scope, &key))
            .collect();

        self.stores
            .compute
            .remove_named_range(&mut self.mirror, name);

        // Also remove from Yrs storage
        // Try both workbook scope and all sheet scopes
        named_ranges::remove_named_range_by_name(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            name,
            None,
        );
        // Also remove any sheet-scoped versions
        let sheet_ids: Vec<_> = self.mirror.sheet_ids().copied().collect();
        for sheet_id in &sheet_ids {
            named_ranges::remove_named_range_by_name(
                self.stores.storage.doc(),
                self.stores.storage.workbook_map(),
                name,
                Some(&sheet_id.to_uuid_string()),
            );
        }

        // Formulas that referenced this name now resolve to #NAME?; recalc
        // from the variable seeds so dependents flip to #NAME? immediately
        // and the result includes their changed cells (drives viewport
        // patches in the UI).
        let mut recalc = if seed_ids.is_empty() {
            RecalcResult::empty()
        } else {
            self.stores.compute.recalc(&mut self.mirror, &seed_ids)?
        };
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();

        let mut result = MutationResult::from_recalc(recalc);
        result.named_range_changes.push(NamedRangeChange {
            name: name.to_string(),
            kind: ChangeKind::Removed,
        });
        Ok((patches, result))
    }

    /// Evaluate conditional formatting rules for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn eval_cf(
        &self,
        sheet_id: &SheetId,
        rules: Vec<crate::cf::types::CFRuleWire>,
    ) -> Vec<crate::cf::types::CellCFResult> {
        let rules: Vec<crate::cf::types::CFRule> = rules
            .into_iter()
            .filter_map(|w| crate::cf::types::CFRule::try_from(w).ok())
            .collect();
        self.stores.compute.eval_cf(&self.mirror, sheet_id, &rules)
    }

    /// Convert an A1-style formula string to an identity formula.
    #[bridge::write(scope = "sheet")]
    pub fn to_identity_formula(
        &mut self,
        sheet_id: &SheetId,
        formula_a1: &str,
    ) -> Result<IdentityFormula, ComputeError> {
        self.stores
            .compute
            .to_identity_formula(&mut self.mirror, sheet_id, formula_a1)
    }

    /// Convert an identity formula back to A1-style display string.
    #[bridge::read(scope = "sheet")]
    pub fn to_a1_display(&self, sheet_id: &SheetId, formula: &IdentityFormula) -> String {
        self.stores
            .compute
            .to_a1_display(&self.mirror, sheet_id, formula)
    }

    /// Convert an identity formula to a fully sheet-qualified A1 string.
    ///
    /// Unlike [`to_a1_display`], every reference is emitted with its sheet
    /// prefix regardless of `sheet_id`. This is the right shape for callers
    /// that have no implicit sheet context (e.g. workbook-scoped named-range
    /// display): the qualified output is unambiguous on its own.
    ///
    /// Workbook scope so callers don't have to fabricate a sheet that exists
    /// in the workbook just to satisfy a sheet-scope guard. Any `SheetId` is
    /// accepted (including a nil/sentinel value) — it is only used as
    /// disambiguation context for relative resolution and the qualified
    /// output never depends on the sheet existing.
    #[bridge::read(scope = "workbook")]
    pub fn to_a1_display_qualified(&self, sheet_id: &SheetId, formula: &IdentityFormula) -> String {
        self.stores
            .compute
            .to_a1_display_qualified(&self.mirror, sheet_id, formula)
    }

    // -----------------------------------------------------------------------
    // What-If Analysis delegations (solver, goal seek, data table)
    // -----------------------------------------------------------------------

    /// Run the unified solver (root finding / multi-variable optimization).
    ///
    /// Returns a default non-converged result on compute errors rather than
    /// propagating the error — matching the existing transport-layer behavior.
    #[bridge::read(scope = "workbook")]
    #[bridge::skip(tauri)]
    pub fn solve(&self, params: &crate::solver::SolverParams) -> crate::solver::SolverResult {
        self.stores
            .compute
            .solve(&self.mirror, params)
            .unwrap_or_else(|_e| crate::solver::SolverResult {
                converged: false,
                solution: vec![],
                objective_value: f64::NAN,
                evaluations: 0,
                iterations: 0,
                elapsed_ms: 0,
                termination: crate::solver::TerminationReason::NumericalError,
                message: "Compute error".to_string(),
                dual_values: None,
            })
    }

    /// Run Goal Seek: find the input value that makes a formula achieve a target.
    #[bridge::read(scope = "workbook")]
    pub fn goal_seek(
        &self,
        params: &crate::solver::GoalSeekParams,
    ) -> crate::solver::GoalSeekResult {
        self.stores
            .compute
            .goal_seek(&self.mirror, params)
            .unwrap_or_else(|_e| crate::solver::GoalSeekResult {
                found: false,
                solution_value: None,
                achieved_value: None,
                iterations: 0,
                error: Some(crate::solver::GoalSeekError::NonNumeric),
                error_message: Some("Compute error".to_string()),
            })
    }

    /// Calculate a data table: evaluate formula with each combination of input values.
    #[bridge::read(scope = "workbook")]
    pub fn data_table(
        &self,
        params: &crate::data_table::DataTableParams,
    ) -> crate::data_table::DataTableResult {
        self.stores
            .compute
            .data_table(&self.mirror, params)
            .unwrap_or_else(|_e| crate::data_table::DataTableResult {
                results: vec![],
                cell_count: 0,
                cancelled: false,
            })
    }

    /// Create a persistent What-If Data Table region.
    #[bridge::write(scope = "range")]
    pub fn create_data_table(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        input: &crate::data_table::CreateDataTableInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if &input.sheet_id != sheet_id {
            return Err(ComputeError::InvalidInput {
                message: "create_data_table sheet_id parameter does not match input.sheet_id"
                    .to_string(),
            });
        }
        let expected_range =
            crate::range_manager::stringify_range(&crate::range_manager::A1RangeRef {
                start: crate::range_manager::A1CellRef {
                    row: start_row,
                    col: start_col,
                    row_absolute: false,
                    col_absolute: false,
                },
                end: crate::range_manager::A1CellRef {
                    row: end_row,
                    col: end_col,
                    row_absolute: false,
                    col_absolute: false,
                },
                sheet_name: None,
            });
        if input.table_range != expected_range {
            return Err(ComputeError::InvalidInput {
                message: "create_data_table range scope does not match input.table_range"
                    .to_string(),
            });
        }
        match self.apply_mutation(super::mutation::EngineMutation::CreateDataTable {
            input: input.clone(),
        })? {
            super::mutation::MutationOutput::Plain(result)
            | super::mutation::MutationOutput::Recalc(result) => {
                Ok((self.flush_viewport_patches(), result))
            }
            _ => Err(ComputeError::Eval {
                message: "Unexpected output from CreateDataTable".to_string(),
            }),
        }
    }

    /// Encode the full document state as a v1 update (for initial sync).
    #[bridge::read(scope = "workbook")]
    pub fn sync_full_state(&self) -> Vec<u8> {
        sync::encode_full_state(self.stores.storage.doc())
    }

    // =========================================================================
    // Sheet lifecycle (delegation to self.stores.storage)
    // =========================================================================

    /// Create a new sheet with a generated UUID. Returns the new SheetId as hex
    /// and a MutationResult with sheet_changes for event emission.
    ///
    /// When `name` is empty, the engine auto-generates a unique "SheetN" name
    /// by checking existing sheet names (avoids collisions after deletions).
    ///
    /// Delegates to `apply_mutation()` to update all stores consistently.
    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "workbook")]
    pub fn create_sheet(&mut self, name: &str) -> Result<(String, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::CreateSheet {
            name: name.to_string(),
        })? {
            super::mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
            _ => Err(ComputeError::Eval {
                message: "Unexpected output from CreateSheet".to_string(),
            }),
        }
    }

    /// Create the implicit default sheet on a freshly-started blank workbook.
    ///
    /// Behaves like [`Self::create_sheet`] for store synchronisation, but the
    /// underlying Yrs transaction is tagged `ORIGIN_BOOTSTRAP` so it is not
    /// recorded by the undo manager. A fresh workbook must report
    /// `canUndo == false` — routing this through the user-edit origin would
    /// pollute the undo stack and the user's first Cmd+Z would delete the
    /// only sheet (api-eval `history/undo-redo-state`,
    /// `history/undo-state-tracking`).
    ///
    /// This is the only intended caller-facing entry point for the bootstrap
    /// origin; user-facing sheet creation continues to flow through
    /// `create_sheet`.
    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "workbook")]
    pub fn create_default_sheet(
        &mut self,
        name: &str,
    ) -> Result<(String, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::CreateDefaultSheet {
            name: name.to_string(),
        })? {
            super::mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
            _ => Err(ComputeError::Eval {
                message: "Unexpected output from CreateDefaultSheet".to_string(),
            }),
        }
    }

    /// Delete a sheet by SheetId. Updates all stores: yrs doc, mirror,
    /// grid_indexes, and compute.
    ///
    /// Cannot delete the last remaining sheet.
    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "sheet")]
    pub fn delete_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::DeleteSheet {
            sheet_id: *sheet_id,
        })? {
            super::mutation::MutationOutput::Recalc(result)
            | super::mutation::MutationOutput::Plain(result) => {
                Ok((serialize_multi_viewport_patches(&[]), result))
            }
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Reorder all sheets. `new_order` is an array of SheetId hex strings.
    #[bridge::structural(scope = "workbook")]
    pub fn reorder_sheets(
        &mut self,
        new_order: Vec<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let ids: Vec<SheetId> = new_order
            .iter()
            .map(|s| {
                SheetId::from_uuid_str(s).map_err(|e| ComputeError::Eval {
                    message: format!("Invalid SheetId in reorder: {}", e),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        order::reorder_sheets(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            &ids,
        )?;
        // R2.3 — sheet order changed; bump so the cache treats pre-reorder
        // entries as stale. Sheet-scope policy matrices key on SheetId
        // (unchanged by reorder), but keeping the bump uniform across
        // every structural op matches the invariant R3.2 will enforce.
        self.security.bump_structure_version();
        let mut result = MutationResult::empty();
        result.sheet_changes.push(SheetChange {
            sheet_id: String::new(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Order,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // =========================================================================
    // Sheet advanced ops (delegation to self.stores.storage)
    // =========================================================================

    /// Copy a sheet. Returns the new SheetId as hex and a MutationResult
    /// with sheet_changes for event emission.
    ///
    /// Delegates to `apply_mutation()` to update all stores consistently.
    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "sheet")]
    pub fn copy_sheet(
        &mut self,
        sheet_id: &SheetId,
        new_name: &str,
    ) -> Result<(String, MutationResult), ComputeError> {
        match self.apply_mutation(super::mutation::EngineMutation::CopySheet {
            source_sheet_id: *sheet_id,
            new_name: new_name.to_string(),
        })? {
            super::mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
            _ => Err(ComputeError::Eval {
                message: "Unexpected output from CopySheet".to_string(),
            }),
        }
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_frozen_panes(
        &self,
        sheet_id: &SheetId,
        rows: u32,
        cols: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Capture old values before mutation
        let old = view::get_frozen_panes(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );

        view::set_frozen_panes(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            rows,
            cols,
        );

        let mut result = MutationResult::empty();
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Frozen,
            frozen_rows: Some(rows),
            old_frozen_rows: Some(old.rows),
            frozen_cols: Some(cols),
            old_frozen_cols: Some(old.cols),
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            color: None,
            old_color: None,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_view_option(
        &self,
        sheet_id: &SheetId,
        key: &str,
        value: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        view::set_view_option(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            key,
            value,
        );
        let settings = settings::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            changed_key: key.to_string(),
            settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Set the scroll position for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn set_scroll_position(
        &self,
        sheet_id: &SheetId,
        top_row: u32,
        left_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        view::set_scroll_position(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            top_row,
            left_col,
        );
        let mut result = MutationResult::empty();
        result.scroll_position_changes.push(ScrollPositionChange {
            sheet_id: sheet_id.to_uuid_string(),
            top_row,
            left_col,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn move_sheet(
        &self,
        sheet_id: &SheetId,
        new_index: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Capture old index before move
        let old_index = {
            let order = self.stores.storage.sheet_order();
            order
                .iter()
                .position(|id| id == sheet_id)
                .map(|i| i as i32)
                .unwrap_or(-1)
        };

        order::move_sheet(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            sheet_id,
            new_index,
        );

        let mut result = MutationResult::empty();
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Order,
            name: None,
            old_name: None,
            index: Some(new_index as i32),
            old_index: Some(old_index),
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_tab_color(
        &self,
        sheet_id: &SheetId,
        color: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Read old color before mutation
        let old_color = properties::get_sheet_meta(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        )
        .and_then(|m| m.tab_color);
        visibility::set_tab_color(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            color.as_deref(),
        );
        let mut result = MutationResult::empty();
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            field: SheetChangeField::TabColor,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: color.map(|c| c.to_string()),
            old_color,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_hidden(
        &mut self,
        sheet_id: &SheetId,
        hidden: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        visibility::set_sheet_hidden(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            hidden,
        );

        let mut result = MutationResult::empty();
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Hidden,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: Some(hidden),
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
        let hint = if hidden {
            SheetLifecycleRuntimeHint::reconcile()
        } else {
            SheetLifecycleRuntimeHint::focus(*sheet_id)
        };
        result.sheet_lifecycle_runtime_hint = Some(hint.clone());
        self.record_sheet_lifecycle_history_hint(
            self.mutation.undo_manager.undo_depth(),
            SheetLifecycleHistoryHint {
                undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                redo: Some(hint),
            },
        );
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Set whether formula calculation is enabled for a sheet.
    ///
    /// When disabled, the scheduler skips evaluation for cells in this sheet,
    /// retaining their last computed values. Cells remain in the dependency
    /// graph so re-enabling triggers correct recalculation.
    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_enable_calculation(
        &mut self,
        sheet_id: &SheetId,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        visibility::set_sheet_enable_calculation(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            enabled,
        );

        // Update the mirror so the scheduler can check the flag without
        // hitting the Yrs document on every recalc pass.
        self.mirror.set_enable_calculation(sheet_id, enabled);

        let mut result = MutationResult::empty();
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            field: SheetChangeField::EnableCalculation,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });

        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_visibility(
        &mut self,
        sheet_id: &SheetId,
        state: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        visibility::set_sheet_visibility(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            state,
        );

        let hidden = state == "hidden" || state == "veryHidden";
        let mut result = MutationResult::empty();
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Visibility,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: Some(hidden),
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
        let hint = if hidden {
            SheetLifecycleRuntimeHint::reconcile()
        } else {
            SheetLifecycleRuntimeHint::focus(*sheet_id)
        };
        result.sheet_lifecycle_runtime_hint = Some(hint.clone());
        self.record_sheet_lifecycle_history_hint(
            self.mutation.undo_manager.undo_depth(),
            SheetLifecycleHistoryHint {
                undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                redo: Some(hint),
            },
        );
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_visibility(&self, sheet_id: &SheetId) -> Result<String, ComputeError> {
        Ok(visibility::get_sheet_visibility(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        ))
    }

    // =========================================================================
    // Sheet settings (delegation to self.stores.storage)
    // =========================================================================

    /// Get all settings for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_settings(&self, sheet_id: &SheetId) -> SheetSettings {
        settings::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        )
    }

    /// Set a single sheet setting by key and string value.
    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_setting(
        &mut self,
        sheet_id: &SheetId,
        key: &str,
        value: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        settings::set_sheet_setting(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            key,
            value,
        );
        let settings = settings::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            changed_key: key.to_string(),
            settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // =========================================================================
    // Sheet protection (delegation to self.stores.storage)
    // =========================================================================

    /// Protect a sheet with an optional password hash.
    #[bridge::write(scope = "sheet")]
    pub fn protect_sheet(
        &mut self,
        sheet_id: &SheetId,
        password_hash: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        protection::protect_sheet(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            password_hash.as_deref(),
        );
        let settings = settings::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            changed_key: "isProtected".to_string(),
            settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Protect a sheet and set its full protection option set atomically.
    #[bridge::write(scope = "sheet")]
    pub fn protect_sheet_with_options(
        &mut self,
        sheet_id: &SheetId,
        password_hash: Option<String>,
        options: SheetProtectionOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        protection::protect_sheet_with_options(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            password_hash.as_deref(),
            &options,
        );
        let settings = settings::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            changed_key: "protectionDetails".to_string(),
            settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Replace a sheet's full protection option set atomically.
    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_protection_options(
        &mut self,
        sheet_id: &SheetId,
        options: SheetProtectionOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        protection::set_sheet_protection_options(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            &options,
        );
        let settings = settings::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            changed_key: "protectionDetails".to_string(),
            settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Unprotect a sheet. Validates password hash if the sheet is password-protected.
    #[bridge::write(scope = "sheet")]
    pub fn unprotect_sheet(
        &mut self,
        sheet_id: &SheetId,
        password_hash: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let success = protection::unprotect_sheet(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            password_hash.as_deref(),
        );
        if !success {
            return Err(ComputeError::InvalidInput {
                message: "Incorrect password".to_string(),
            });
        }
        let settings = settings::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            changed_key: "isProtected".to_string(),
            settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // =========================================================================
    // Page breaks (delegation to self.stores.storage)
    // =========================================================================

    /// Get page breaks for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_page_breaks(&self, sheet_id: &SheetId) -> PageBreaks {
        print::get_page_breaks(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        )
    }

    /// Add a horizontal page break.
    #[bridge::write(scope = "sheet")]
    pub fn add_horizontal_page_break(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::add_horizontal_page_break(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            row,
        );
        let breaks = print::get_page_breaks(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.page_break_changes.push(PageBreakChange {
            sheet_id: sheet_id.to_uuid_string(),
            breaks,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Remove a horizontal page break.
    #[bridge::write(scope = "sheet")]
    pub fn remove_horizontal_page_break(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::remove_horizontal_page_break(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            row,
        );
        let breaks = print::get_page_breaks(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.page_break_changes.push(PageBreakChange {
            sheet_id: sheet_id.to_uuid_string(),
            breaks,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Add a vertical page break.
    #[bridge::write(scope = "sheet")]
    pub fn add_vertical_page_break(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::add_vertical_page_break(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            col,
        );
        let breaks = print::get_page_breaks(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.page_break_changes.push(PageBreakChange {
            sheet_id: sheet_id.to_uuid_string(),
            breaks,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Remove a vertical page break.
    #[bridge::write(scope = "sheet")]
    pub fn remove_vertical_page_break(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::remove_vertical_page_break(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            col,
        );
        let breaks = print::get_page_breaks(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.page_break_changes.push(PageBreakChange {
            sheet_id: sheet_id.to_uuid_string(),
            breaks,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Clear all page breaks.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_page_breaks(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::clear_all_page_breaks(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let breaks = print::get_page_breaks(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let mut result = MutationResult::empty();
        result.page_break_changes.push(PageBreakChange {
            sheet_id: sheet_id.to_uuid_string(),
            breaks,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // =========================================================================
    // Print area & titles (delegation to self.stores.storage)
    // =========================================================================

    /// Get the print area for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_print_area(&self, sheet_id: &SheetId) -> Option<PrintRange> {
        print::get_print_area(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        )
    }

    /// Set or clear the print area for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn set_print_area(
        &mut self,
        sheet_id: &SheetId,
        area: Option<PrintRange>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::set_print_area(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            area.as_ref(),
        );
        let kind = if area.is_some() {
            ChangeKind::Set
        } else {
            ChangeKind::Removed
        };
        let mut result = MutationResult::empty();
        result.print_area_changes.push(PrintAreaChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind,
            area,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Get print titles for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_print_titles(&self, sheet_id: &SheetId) -> PrintTitles {
        print::get_print_titles(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        )
    }

    /// Set print titles for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn set_print_titles(
        &mut self,
        sheet_id: &SheetId,
        titles: PrintTitles,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::set_print_titles(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            &titles,
        );
        let mut result = MutationResult::empty();
        result.print_titles_changes.push(PrintTitlesChange {
            sheet_id: sheet_id.to_uuid_string(),
            titles,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // =========================================================================
    // Split view (delegation to self.stores.storage)
    // =========================================================================

    /// Get split view configuration.
    #[bridge::read(scope = "sheet")]
    pub fn get_split_config(&self, sheet_id: &SheetId) -> Option<SplitViewConfig> {
        split_view::get_split_config(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        )
    }

    /// Set or clear split view configuration.
    #[bridge::write(scope = "sheet")]
    pub fn set_split_config(
        &mut self,
        sheet_id: &SheetId,
        config: Option<SplitViewConfig>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = super::services::delegations::set_split_config(
            &mut self.stores,
            sheet_id,
            config.as_ref(),
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // =========================================================================
    // Named Ranges — write operations (delegation to storage::named_ranges)
    // =========================================================================

    /// Create a new named range (defined name).
    /// Routes through `apply_mutation()`. Returns `MutationResult` with
    /// `DefinedName` in `data` and populated `named_range_changes`.
    #[bridge::write(scope = "workbook")]
    pub fn create_named_range(
        &mut self,
        input: named_ranges::DefinedNameInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::CreateNamedRange { input })? {
            MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Update an existing named range by ID.
    /// Routes through `apply_mutation()`. Returns `MutationResult` with
    /// `DefinedName` in `data` and populated `named_range_changes`. When the
    /// update changes `refers_to`, the dispatch runs an incremental recalc
    /// seeded from the variable's synthetic CellId so dependent formulas
    /// recompute (Excel parity); the recalc result is propagated here so
    /// callers see the changed cells.
    #[bridge::write(scope = "workbook")]
    pub fn update_named_range(
        &mut self,
        id: &str,
        updates: named_ranges::NamedRangeUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::UpdateNamedRange {
            id: id.to_string(),
            updates,
        })? {
            MutationOutput::Plain(result) | MutationOutput::Recalc(result) => {
                let patches = self.flush_viewport_patches();
                Ok((patches, result))
            }
            MutationOutput::SheetId(_, result) => {
                Ok((serialize_multi_viewport_patches(&[]), result))
            }
        }
    }

    /// Remove a named range by its unique ID.
    /// Only removes the specific scoped entry, not all names with the same identifier.
    #[bridge::write(scope = "workbook")]
    pub fn remove_named_range_by_id(
        &mut self,
        id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Look up the name before removing so we can sync the in-memory mirror
        let existing = named_ranges::get_named_range_by_id(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            id,
        )
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Defined name with ID {} not found", id),
        })?;

        let scope = match &existing.scope {
            Some(sheet_uuid) => {
                let sheet_id =
                    SheetId::from_uuid_str(sheet_uuid).map_err(|_| ComputeError::Eval {
                        message: format!("Invalid sheet UUID in named range scope: {}", sheet_uuid),
                    })?;
                formula_types::Scope::Sheet(sheet_id)
            }
            None => formula_types::Scope::Workbook,
        };

        // Capture the variable's synthetic CellId before removal — needed
        // as a recalc seed once the entry is gone.
        let key = existing.name.to_ascii_lowercase();
        let seed_id = self.mirror.variables.get_variable_cell_id(&scope, &key);

        // Remove from in-memory mirror (scoped — only this specific entry)
        self.stores
            .compute
            .remove_named_range_scoped(&mut self.mirror, &scope, &existing.name);

        // Remove from Yrs persistent storage
        named_ranges::remove_named_range_by_id(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            id,
        )?;

        // Formulas that referenced this name now resolve to #NAME?; recalc
        // from the variable seed so dependents flip to #NAME? immediately
        // and the result includes their changed cells (drives viewport
        // patches). `prepare_recalc_for_flush` runs `mark_dirty()` for us.
        let mut recalc = match seed_id {
            Some(cell_id) => self.stores.compute.recalc(&mut self.mirror, &[cell_id])?,
            None => RecalcResult::empty(),
        };
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();

        let mut result = MutationResult::from_recalc(recalc);
        result.named_range_changes.push(NamedRangeChange {
            name: existing.name.clone(),
            kind: ChangeKind::Removed,
        });
        Ok((patches, result))
    }

    /// Remove all named ranges in a scope (useful when deleting a sheet).
    #[bridge::write(scope = "workbook")]
    pub fn remove_named_ranges_by_scope(
        &mut self,
        scope: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Collect names before removal so we can sync the in-memory mirror.
        let removed = named_ranges::get_named_ranges_by_scope(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            scope.as_deref(),
        );

        named_ranges::remove_named_ranges_by_scope(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
            scope.as_deref(),
        );

        // Sync in-memory mirror — remove each name from the scheduler's DAG
        // and the variable store. Otherwise dependent formulas still resolve.
        for dn in &removed {
            let dn_scope = match &dn.scope {
                Some(sheet_uuid) => match SheetId::from_uuid_str(sheet_uuid) {
                    Ok(sid) => formula_types::Scope::Sheet(sid),
                    Err(_) => formula_types::Scope::Workbook,
                },
                None => formula_types::Scope::Workbook,
            };
            self.stores
                .compute
                .remove_named_range_scoped(&mut self.mirror, &dn_scope, &dn.name);
        }

        // Force next recalc so dependent formulas re-resolve to #NAME?.
        self.stores.compute.mark_dirty();

        let mut result = MutationResult::empty();
        result.named_range_changes.push(NamedRangeChange {
            name: scope.unwrap_or_default(),
            kind: ChangeKind::Removed,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Import multiple named ranges (e.g., from XLSX). Returns count of imported names.
    /// Routes through `apply_mutation()`. Count is in `MutationResult.data`.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::write(scope = "workbook")]
    #[bridge::skip(napi)]
    pub fn import_named_ranges(
        &mut self,
        names: Vec<named_ranges::DefinedName>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::ImportNamedRanges { names })? {
            MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    // =========================================================================
    // Sheet print settings — write operation
    // =========================================================================

    /// Set print settings for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn set_print_settings(
        &mut self,
        sheet_id: &SheetId,
        settings: domain_types::domain::print::PrintSettings,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        print::set_print_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            &settings,
        );
        let mut result = MutationResult::empty();
        result.print_settings_changes.push(PrintSettingsChange {
            sheet_id: sheet_id.to_uuid_string(),
            settings,
        });
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Set or replace a header/footer image at the specified position.
    #[bridge::write(scope = "sheet")]
    pub fn set_hf_image(
        &mut self,
        sheet_id: &SheetId,
        info: domain_types::domain::print::HeaderFooterImageInfo,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut images = print::get_hf_images(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        // Replace existing at same position, or append
        let pos = info.position;
        if let Some(existing) = images.iter_mut().find(|i| i.position == pos) {
            *existing = info;
        } else {
            images.push(info);
        }
        print::set_hf_images(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            &images,
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Remove the header/footer image at the specified position.
    #[bridge::write(scope = "sheet")]
    pub fn remove_hf_image(
        &mut self,
        sheet_id: &SheetId,
        position: domain_types::domain::print::HfImagePosition,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut images = print::get_hf_images(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        images.retain(|i| i.position != position);
        print::set_hf_images(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            &images,
        );
        Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // =========================================================================
    // Cell Iteration — write operations (delegation to storage::cell_iter)
    // =========================================================================

    /// Clear cells in a range, preserving cell identity (marker cells).
    /// Routes through `apply_mutation()` for proper recalc + viewport patches.
    #[bridge::write(scope = "range")]
    pub fn clear_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::ClearRange {
            sheet_id: *sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        })? {
            MutationOutput::Recalc(result) => Ok((self.flush_viewport_patches(), result)),
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Clear all cells in a range and return their CellIds as hex strings.
    /// This fully deletes cells (for structural operations where #REF! is correct).
    /// Routes through `apply_mutation()` for proper recalc + viewport patches.
    /// Cleared CellIds are returned via `MutationResult.data` as `Vec<String>`.
    #[bridge::write(scope = "range")]
    pub fn clear_range_and_return_ids(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::ClearRangeAndReturnIds {
            sheet_id: *sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        })? {
            MutationOutput::Recalc(result) => Ok((self.flush_viewport_patches(), result)),
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }

    /// Find-and-replace all matching literal text in a range.
    ///
    /// Skips formula cells. Writes replacements through `mutation_set_cells_by_position`
    /// for proper undo/redo support. The replacement count is stored in
    /// `MutationResult.data` as a JSON number.
    #[bridge::write(scope = "range")]
    #[allow(clippy::too_many_arguments)]
    pub fn replace_all_in_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        text: String,
        replacement: String,
        options: crate::engine_types::queries::FindInRangeOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let count = super::services::mutation_handlers::replace_all_in_range(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            &text,
            &replacement,
            &options,
        )?;
        let patches = self.flush_viewport_patches();
        Ok((patches, MutationResult::empty().with_data(&count)?))
    }
}
