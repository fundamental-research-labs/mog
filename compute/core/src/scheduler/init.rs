//! Initialization — snapshot loading, bulk formula parsing, and array function detection.

use super::*;

impl ComputeCore {
    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /// Initialize from a workbook snapshot. Parses all formulas, builds the
    /// dependency graph, and performs a full recalculation.
    #[tracing::instrument(name = "scheduler_init_from_snapshot", skip_all)]
    pub fn init_from_snapshot(
        &mut self,
        mirror: &mut CellMirror,
        snapshot: WorkbookSnapshot,
    ) -> Result<RecalcResult, ComputeError> {
        // Store iterative calculation settings before consuming snapshot
        self.iterative_calc = snapshot.iterative_calc;
        self.max_iterations = snapshot.max_iterations;
        self.max_change = snapshot.max_change.get();
        self.calc_mode = snapshot
            .calculation_settings
            .as_ref()
            .map_or(CalcMode::Auto, |settings| settings.calc_mode);

        // Capture sheet tab order for cycle evaluation (must happen before
        // from_snapshot consumes the snapshot).
        self.sheet_order = snapshot
            .sheets
            .iter()
            .enumerate()
            .filter_map(|(idx, sheet)| SheetId::from_uuid_str(&sheet.id).ok().map(|sid| (sid, idx)))
            .collect();
        self.rebuild_ordered_sheets_cache();

        // Pre-extract formula cells from snapshot before consuming it.
        // CellEntry.formula is now IdentityFormula (and set to None during snapshot loading),
        // so we must extract formula strings here while the snapshot data is still available.
        let formula_cells = {
            let _span = tracing::info_span!("collect_formula_cells").entered();
            Self::extract_formula_cells_from_snapshot(&snapshot)
        };

        // Seed the ID allocator past the max existing ID to avoid collisions.
        {
            let mut max_id: u128 = 0;
            for sheet in &snapshot.sheets {
                if let Ok(sid) = SheetId::from_uuid_str(&sheet.id) {
                    max_id = max_id.max(sid.as_u128());
                }
                for cell in &sheet.cells {
                    if let Ok(cid) = CellId::from_uuid_str(&cell.cell_id) {
                        max_id = max_id.max(cid.as_u128());
                    }
                }
            }
            // Clamp to u64 range — monotonic IDs stay in the low range while
            // legacy UUID-based IDs are astronomically larger (safe, no overlap).
            let seed = if max_id <= u64::MAX as u128 {
                (max_id as u64).saturating_add(1)
            } else {
                // Existing IDs are UUIDs (random u128) — any u64 counter is safe.
                1
            };
            self.id_alloc = std::sync::Arc::new(IdAllocator::with_seed(seed));
        }

        // 1. Populate the cell mirror from snapshot.
        let total_cell_count: usize = snapshot.sheets.iter().map(|s| s.cells.len()).sum();
        *mirror = CellMirror::from_snapshot(snapshot)?;
        let formula_count = formula_cells.len();
        // Pre-size graph: `precedents` needs formula_count entries, `dependents` needs
        // total_cell_count entries (data cells that are depended upon + formula cells).
        self.graph = DependencyGraph::with_capacity_full(formula_count, total_cell_count);
        self.ast_cache = FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.formula_strings =
            FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.cell_formula_text =
            FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.seed_cell_formula_text(&formula_cells);

        // 2. For each cell with a formula, parse and register dependencies.
        //    Skip per-edge cycle detection during bulk init — the topological sort
        //    in full_recalc will catch any cycles. This avoids O(F^2*D) overhead.
        self.bulk_parse_and_register(mirror, formula_cells);

        // 2.1: Register variable formulas as DAG nodes. Variables with raw_expression
        //      get parsed, their ASTs cached under synthetic CellIds, and their
        //      dependencies registered in the graph — just like regular cell formulas.
        self.register_all_variables(mirror);

        // 3. Full recalc: evaluate all formula cells in topological order.
        //    get_evaluation_order uses Kahn's algorithm which detects cycles and
        //    returns Err(GraphError::CycleDetected) — handled by handle_cycles_and_recalc.
        let result = self.full_recalc(mirror)?;

        // Init finished with a successful full recalc — subsequent
        // `recalculate_with_options()` calls can short-circuit until the
        // next mutation.
        self.clear_dirty();

        Ok(result)
    }

    /// Initialize from a workbook snapshot using an already-populated mirror.
    ///
    /// Rebuild paths that need range-backed values during initial recalc must
    /// install mirror row/column identity maps and finalize range hydration
    /// before formulas evaluate. This variant keeps the caller-provided mirror
    /// intact and rebuilds only ComputeCore state from the supplied snapshot.
    pub(crate) fn init_from_snapshot_with_prebuilt_mirror(
        &mut self,
        mirror: &mut CellMirror,
        snapshot: WorkbookSnapshot,
    ) -> Result<RecalcResult, ComputeError> {
        self.iterative_calc = snapshot.iterative_calc;
        self.max_iterations = snapshot.max_iterations;
        self.max_change = snapshot.max_change.get();
        self.calc_mode = snapshot
            .calculation_settings
            .as_ref()
            .map_or(CalcMode::Auto, |settings| settings.calc_mode);

        self.sheet_order = snapshot
            .sheets
            .iter()
            .enumerate()
            .filter_map(|(idx, sheet)| SheetId::from_uuid_str(&sheet.id).ok().map(|sid| (sid, idx)))
            .collect();
        self.rebuild_ordered_sheets_cache();

        let formula_cells = {
            let _span = tracing::info_span!("collect_formula_cells").entered();
            Self::extract_formula_cells_from_snapshot(&snapshot)
        };

        {
            let mut max_id: u128 = 0;
            for sheet in &snapshot.sheets {
                if let Ok(sid) = SheetId::from_uuid_str(&sheet.id) {
                    max_id = max_id.max(sid.as_u128());
                }
                for cell in &sheet.cells {
                    if let Ok(cid) = CellId::from_uuid_str(&cell.cell_id) {
                        max_id = max_id.max(cid.as_u128());
                    }
                }
            }
            let seed = if max_id <= u64::MAX as u128 {
                (max_id as u64).saturating_add(1)
            } else {
                1
            };
            self.id_alloc = std::sync::Arc::new(IdAllocator::with_seed(seed));
        }

        let total_cell_count: usize = snapshot.sheets.iter().map(|s| s.cells.len()).sum();
        let formula_count = formula_cells.len();
        self.graph = DependencyGraph::with_capacity_full(formula_count, total_cell_count);
        self.ast_cache = FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.formula_strings =
            FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.cell_formula_text =
            FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.seed_cell_formula_text(&formula_cells);

        self.bulk_parse_and_register(mirror, formula_cells);
        self.register_all_variables(mirror);

        let result = self.full_recalc(mirror)?;
        self.clear_dirty();

        Ok(result)
    }

    /// Initialize from a WorkbookSnapshot WITHOUT running formula recalc.
    ///
    /// Use this when cached cell values from the snapshot are sufficient
    /// (e.g., round-trip export where we just need to read values back out).
    /// Formula strings and dependency graph are still parsed and built,
    /// but no cells are evaluated.
    pub fn init_from_snapshot_no_recalc(
        &mut self,
        mirror: &mut CellMirror,
        snapshot: WorkbookSnapshot,
    ) -> Result<RecalcResult, ComputeError> {
        self.iterative_calc = snapshot.iterative_calc;
        self.max_iterations = snapshot.max_iterations;
        self.max_change = snapshot.max_change.get();
        self.calc_mode = snapshot
            .calculation_settings
            .as_ref()
            .map_or(CalcMode::Auto, |settings| settings.calc_mode);

        self.sheet_order = snapshot
            .sheets
            .iter()
            .enumerate()
            .filter_map(|(idx, sheet)| SheetId::from_uuid_str(&sheet.id).ok().map(|sid| (sid, idx)))
            .collect();
        self.rebuild_ordered_sheets_cache();

        let formula_cells = {
            let _span = tracing::info_span!("collect_formula_cells").entered();
            Self::extract_formula_cells_from_snapshot(&snapshot)
        };

        {
            let mut max_id: u128 = 0;
            for sheet in &snapshot.sheets {
                if let Ok(sid) = SheetId::from_uuid_str(&sheet.id) {
                    max_id = max_id.max(sid.as_u128());
                }
                for cell in &sheet.cells {
                    if let Ok(cid) = CellId::from_uuid_str(&cell.cell_id) {
                        max_id = max_id.max(cid.as_u128());
                    }
                }
            }
            let seed = if max_id <= u64::MAX as u128 {
                (max_id as u64).saturating_add(1)
            } else {
                1
            };
            self.id_alloc = std::sync::Arc::new(IdAllocator::with_seed(seed));
        }

        let total_cell_count: usize = snapshot.sheets.iter().map(|s| s.cells.len()).sum();
        *mirror = CellMirror::from_snapshot(snapshot)?;
        let formula_count = formula_cells.len();
        self.graph = DependencyGraph::with_capacity_full(formula_count, total_cell_count);
        self.ast_cache = FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.formula_strings =
            FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.cell_formula_text =
            FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
        self.seed_cell_formula_text(&formula_cells);

        self.bulk_parse_and_register(mirror, formula_cells);
        self.register_all_variables(mirror);

        // Skip full_recalc — cached values from snapshot are sufficient.
        Ok(RecalcResult::empty())
    }

    /// Initialize from a WorkbookSnapshot with MINIMAL processing.
    ///
    /// Skips BOTH formula parsing AND recalc. The dependency graph is NOT built.
    /// Only the cell mirror is populated from the snapshot.
    ///
    /// Use this on WASM for fast initial load: cached values render immediately.
    /// The graph is built lazily on the first mutation (via `ensure_graph_built`).
    pub fn init_from_snapshot_minimal(
        &mut self,
        mirror: &mut CellMirror,
        snapshot: WorkbookSnapshot,
    ) -> Result<RecalcResult, ComputeError> {
        self.iterative_calc = snapshot.iterative_calc;
        self.max_iterations = snapshot.max_iterations;
        self.max_change = snapshot.max_change.get();
        self.calc_mode = snapshot
            .calculation_settings
            .as_ref()
            .map_or(CalcMode::Auto, |settings| settings.calc_mode);

        self.sheet_order = snapshot
            .sheets
            .iter()
            .enumerate()
            .filter_map(|(idx, sheet)| SheetId::from_uuid_str(&sheet.id).ok().map(|sid| (sid, idx)))
            .collect();
        self.rebuild_ordered_sheets_cache();

        // Extract formula cells for deferred parsing
        let formula_cells = {
            let _span = tracing::info_span!("collect_formula_cells").entered();
            Self::extract_formula_cells_from_snapshot(&snapshot)
        };

        {
            let mut max_id: u128 = 0;
            for sheet in &snapshot.sheets {
                if let Ok(sid) = SheetId::from_uuid_str(&sheet.id) {
                    max_id = max_id.max(sid.as_u128());
                }
                for cell in &sheet.cells {
                    if let Ok(cid) = CellId::from_uuid_str(&cell.cell_id) {
                        max_id = max_id.max(cid.as_u128());
                    }
                }
            }
            let seed = if max_id <= u64::MAX as u128 {
                (max_id as u64).saturating_add(1)
            } else {
                1
            };
            self.id_alloc = std::sync::Arc::new(IdAllocator::with_seed(seed));
        }

        *mirror = CellMirror::from_snapshot(snapshot)?;

        // Formula text is document identity, not graph output. Seed it before
        // deferred graph construction so readback/UI/export can identify
        // formula cells while cached values render.
        self.cell_formula_text =
            FxHashMap::with_capacity_and_hasher(formula_cells.len(), Default::default());
        self.seed_cell_formula_text(&formula_cells);

        // Store formula cells for deferred parsing — graph will be built on first mutation.
        self.deferred_formula_cells = Some(formula_cells);

        Ok(RecalcResult::empty())
    }

    /// Ultra-minimal init for deferred-hydration XLSX import.
    /// Seeds formula text for materialized cells but defers graph construction.
    /// Builds CellMirror from the sparse first-paint snapshot, which includes
    /// all sheet headers but only the critical sheet's materialized cells.
    pub fn init_from_snapshot_viewport_only(
        &mut self,
        mirror: &mut CellMirror,
        snapshot: WorkbookSnapshot,
    ) -> Result<RecalcResult, ComputeError> {
        self.iterative_calc = snapshot.iterative_calc;
        self.max_iterations = snapshot.max_iterations;
        self.max_change = snapshot.max_change.get();
        self.calc_mode = snapshot
            .calculation_settings
            .as_ref()
            .map_or(CalcMode::Auto, |settings| settings.calc_mode);

        self.sheet_order = snapshot
            .sheets
            .iter()
            .enumerate()
            .filter_map(|(idx, sheet)| SheetId::from_uuid_str(&sheet.id).ok().map(|sid| (sid, idx)))
            .collect();
        self.rebuild_ordered_sheets_cache();
        let deferred_snapshot = snapshot.clone();

        let materialized_formula_cells = Self::extract_formula_cells_from_snapshot(&snapshot);
        self.cell_formula_text = FxHashMap::with_capacity_and_hasher(
            materialized_formula_cells.len(),
            Default::default(),
        );
        self.seed_cell_formula_text(&materialized_formula_cells);

        // Store the viewport-only marker so graph/recalc callers can reject
        // partial workbook graph construction until full hydration completes.
        // Readback does not depend on this marker.
        self.deferred_snapshot = Some(deferred_snapshot);

        *mirror = CellMirror::from_snapshot(snapshot)?;

        Ok(RecalcResult::empty())
    }

    /// Build the dependency graph if it hasn't been built yet (deferred from minimal init).
    ///
    /// Called automatically before any recalc or mutation that needs the graph.
    /// After this call, `deferred_formula_cells` is consumed and the graph is ready.
    pub fn ensure_graph_built(&mut self, mirror: &mut CellMirror) -> Result<(), ComputeError> {
        // Path 1: formula cells were pre-extracted during init_from_snapshot_minimal
        if let Some(formula_cells) = self.deferred_formula_cells.take() {
            let formula_count = formula_cells.len();
            let total_cell_count = mirror.total_cell_count();
            self.graph = DependencyGraph::with_capacity_full(formula_count, total_cell_count);
            self.ast_cache = FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
            self.formula_strings =
                FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
            self.cell_formula_text =
                FxHashMap::with_capacity_and_hasher(formula_count, Default::default());
            self.seed_cell_formula_text(&formula_cells);

            self.bulk_parse_and_register(mirror, formula_cells);
            self.register_all_variables(mirror);
            return Ok(());
        }
        self.ensure_graph_construction_ready()?;

        Ok(())
    }

    pub(crate) fn ensure_graph_construction_ready(&self) -> Result<(), ComputeError> {
        // Viewport-only XLSX import does not carry complete workbook graph
        // context: cross-sheet references, names, and later-sheet cells can be
        // absent. Formula readback is seeded separately, but graph construction
        // must wait for full deferred hydration.
        if self.deferred_snapshot.is_some() {
            return Err(Self::deferred_graph_construction_error());
        }

        Ok(())
    }

    fn deferred_graph_construction_error() -> ComputeError {
        ComputeError::InvalidInput {
            message: "dependency graph construction requires deferred XLSX hydration to complete before reading a viewport-only workbook snapshot".to_string(),
        }
    }

    pub(super) fn seed_cell_formula_text(&mut self, formula_cells: &[(CellId, SheetId, String)]) {
        for (cell_id, _sheet_id, formula) in formula_cells {
            self.cell_formula_text.insert(*cell_id, formula.clone());
        }
    }

    /// Extract formula cells from a WorkbookSnapshot before it is consumed.
    /// Returns (CellId, SheetId, formula_string) for each cell with a formula.
    ///
    /// On native targets, sheets are processed in parallel via rayon so that
    /// UUID parsing + formula normalization runs across all available cores.
    fn extract_formula_cells_from_snapshot(
        snapshot: &WorkbookSnapshot,
    ) -> Vec<(CellId, SheetId, String)> {
        #[cfg(feature = "native")]
        {
            use rayon::prelude::*;
            snapshot
                .sheets
                .par_iter()
                .flat_map_iter(|sheet_snap| {
                    let sheet_id = SheetId::from_uuid_str(&sheet_snap.id).ok();
                    sheet_snap.cells.iter().filter_map(move |cell_data| {
                        let sheet_id = sheet_id?;
                        let formula = cell_data.formula.as_ref()?;
                        let cell_id = CellId::from_uuid_str(&cell_data.cell_id).ok()?;
                        let normalized = compute_parser::normalize_xlsx_formula(formula);
                        Some((cell_id, sheet_id, normalized))
                    })
                })
                .collect()
        }
        #[cfg(not(feature = "native"))]
        {
            // Pre-count formula cells to avoid Vec reallocation during collection.
            let formula_estimate: usize = snapshot
                .sheets
                .iter()
                .map(|s| s.cells.iter().filter(|c| c.formula.is_some()).count())
                .sum();
            let mut result = Vec::with_capacity(formula_estimate);
            for sheet_snap in &snapshot.sheets {
                let sheet_id = match SheetId::from_uuid_str(&sheet_snap.id) {
                    Ok(id) => id,
                    Err(_) => continue,
                };
                for cell_data in &sheet_snap.cells {
                    if let Some(formula) = &cell_data.formula {
                        let cell_id = match CellId::from_uuid_str(&cell_data.cell_id) {
                            Ok(id) => id,
                            Err(_) => continue,
                        };
                        let normalized = compute_parser::normalize_xlsx_formula(formula);
                        result.push((cell_id, sheet_id, normalized));
                    }
                }
            }
            result
        }
    }

    /// Bulk-parse and register formulas using parallel parsing + sequential graph registration.
    /// Used by init_from_snapshot, structure_change, and add_sheet where the graph has been
    /// cleared (or cells are brand-new) and formulas need to be parsed from scratch.
    ///
    /// Pass 1: Parse formulas and extract deps in parallel (read-only on mirror).
    /// Pass 2: Register in graph sequentially using set_precedents_fresh (no old edges).
    /// Pass 3: Rebuild the spatial range index.
    pub(super) fn bulk_parse_and_register(
        &mut self,
        mirror: &mut CellMirror,
        formula_cells: Vec<(CellId, SheetId, String)>,
    ) {
        let _span =
            tracing::info_span!("bulk_parse_and_register", count = formula_cells.len()).entered();
        let ordered_sheets = self.ordered_sheets_cache.clone();
        self.formula_text_deps.clear_all();

        #[cfg(feature = "native")]
        {
            use dashmap::DashMap;
            use rayon::prelude::*;

            // Pass 1: Parallel parse + dep extraction + identity resolution
            let mirror_ref = &*mirror;
            // Ghost cells are typically ~1-5% of formula count (references to
            // empty cells that need CellIds). Pre-size to avoid rehash storms.
            let ghost_cells: DashMap<(SheetId, SheetPos), CellId> =
                DashMap::with_capacity(formula_cells.len() / 16);
            let ghost_ref = &ghost_cells;

            let formula_count_hint = formula_cells.len();
            let registry = &crate::eval::GLOBAL_REGISTRY;

            let compiled: Vec<_> = {
                let _span =
                    tracing::info_span!("bulk_phase1_parallel", count = formula_cells.len())
                        .entered();
                formula_cells
                    .into_par_iter()
                    .map(|(cell_id, sheet_id, formula)| {
                        let resolver = CoreResolver {
                            mirror: mirror_ref,
                            current_sheet: sheet_id,
                        };
                        match parse_formula(&formula, Some(&resolver)) {
                            Ok(spanned) => {
                                let ast = spanned.into_inner();
                                let current_row =
                                    mirror_ref.resolve_position(&cell_id).map(|pos| pos.row());
                                let extracted = extract_deps_and_volatility(
                                    &ast,
                                    &sheet_id,
                                    mirror_ref,
                                    &ordered_sheets,
                                    current_row,
                                );
                                // Identity resolution — now parallel!
                                let id_resolver = ConcurrentIdentityResolver {
                                    mirror: mirror_ref,
                                    ghost_cells: ghost_ref,
                                    id_alloc: &self.id_alloc,
                                    current_sheet: sheet_id,
                                };
                                let identity_formula =
                                    compute_parser::ast_to_identity(&ast, &id_resolver).ok();
                                // Array function detection — moved to parallel phase
                                let is_dynamic_array =
                                    Self::ast_contains_array_function(&ast, registry);
                                // Range key extraction — moved to parallel phase to avoid
                                // redundant sequential AST walk during recalc.
                                let range_keys = {
                                    let sheet_ctx = mirror_ref.sheet_for_cell(&cell_id);
                                    let mut plan =
                                        crate::eval::cache::range_store::DataPlan::default();
                                    crate::eval::cache::range_store::collect_static_ranges_pub(
                                        &ast, sheet_ctx, mirror_ref, &mut plan,
                                    );
                                    plan.into_iter().collect::<Vec<_>>()
                                };
                                (
                                    cell_id,
                                    Ok((
                                        sheet_id,
                                        ast,
                                        extracted.value_deps,
                                        extracted.formula_text_deps,
                                        extracted.is_volatile,
                                        formula,
                                        identity_formula,
                                        is_dynamic_array,
                                        range_keys,
                                    )),
                                )
                            }
                            Err(_) => (cell_id, Err(formula)),
                        }
                    })
                    .collect()
            };

            // Flush ghost cells into mirror with their exact CellIds
            for entry in ghost_cells.into_iter() {
                let ((sheet_id, pos), cell_id) = entry;
                mirror.register_ghost_cell(&sheet_id, pos, cell_id);
            }

            // Pass 2: Sequential graph registration ONLY (no parsing, no identity)
            // Collect all (cell_id, deps) for bulk graph registration to avoid
            // inner FxHashSet rehash storms in the dependents map.
            let mut graph_edges: Vec<(CellId, Vec<DepTarget>)> =
                Vec::with_capacity(formula_count_hint);
            let mut builder =
                GraphBuilder::with_capacity_full(formula_count_hint, formula_count_hint);
            for (cell_id, result) in compiled {
                match result {
                    Ok((
                        sheet_id,
                        ast,
                        deps,
                        formula_text_deps,
                        is_volatile,
                        formula,
                        identity_formula,
                        is_dynamic_array,
                        range_keys,
                    )) => {
                        let rendered_formula = Self::rendered_formula_string_or_fallback(
                            mirror,
                            sheet_id,
                            identity_formula.as_ref(),
                            &formula,
                        );
                        mirror.set_formula(&cell_id, identity_formula);
                        graph_edges.push((cell_id, deps));
                        self.formula_text_deps.replace(cell_id, formula_text_deps);
                        if is_volatile {
                            builder.mark_volatile(&cell_id);
                        }
                        self.ast_cache.insert(
                            cell_id,
                            AstEntry {
                                ast,
                                is_dynamic_array,
                            },
                        );
                        self.formula_strings.insert(cell_id, rendered_formula);
                        self.cell_formula_text.insert(cell_id, formula);
                        if !range_keys.is_empty() {
                            self.cell_range_keys.insert(cell_id, range_keys);
                        }
                    }
                    Err(formula) => {
                        mirror.set_value_mut(&cell_id, CellValue::Error(CellError::Name, None));
                        self.formula_strings.insert(cell_id, formula.clone());
                        self.cell_formula_text.insert(cell_id, formula);
                    }
                }
            }
            builder.bulk_set_precedents(graph_edges);
            self.graph = builder.build();
        }

        #[cfg(not(feature = "native"))]
        {
            use std::cell::RefCell;

            // WASM: sequential parse but BATCHED graph construction.
            // Per-formula set_precedents is 3-5x slower than bulk_set_precedents due
            // to per-edge graph updates vs pre-sized batch insertion.
            let registry = &crate::eval::GLOBAL_REGISTRY;
            let formula_count_hint = formula_cells.len();
            let mut builder = GraphBuilder::with_capacity(formula_count_hint);
            let mut graph_edges: Vec<(CellId, Vec<DepTarget>)> =
                Vec::with_capacity(formula_count_hint);
            let ghost_cells: RefCell<FxHashMap<(SheetId, SheetPos), CellId>> = RefCell::new(
                FxHashMap::with_capacity_and_hasher(formula_count_hint / 16, Default::default()),
            );

            for (cell_id, sheet_id, formula) in formula_cells {
                let resolver = CoreResolver {
                    mirror: &*mirror,
                    current_sheet: sheet_id,
                };
                match parse_formula(&formula, Some(&resolver)) {
                    Ok(spanned) => {
                        let ast = spanned.into_inner();
                        let current_row = mirror.resolve_position(&cell_id).map(|pos| pos.row());
                        let extracted = extract_deps_and_volatility(
                            &ast,
                            &sheet_id,
                            &*mirror,
                            &ordered_sheets,
                            current_row,
                        );
                        // Identity resolution (sequential, using FxHashMap for ghost cells)
                        let identity_formula = {
                            struct SeqResolver<'a> {
                                mirror: &'a CellMirror,
                                ghost_cells: &'a RefCell<FxHashMap<(SheetId, SheetPos), CellId>>,
                                id_alloc: &'a IdAllocator,
                                current_sheet: SheetId,
                            }
                            impl compute_parser::IdentityResolver for SeqResolver<'_> {
                                fn get_or_create_cell_id(
                                    &self,
                                    sheet: &SheetId,
                                    row: u32,
                                    col: u32,
                                ) -> CellId {
                                    let pos = SheetPos::new(row, col);
                                    if let Some(id) = self.mirror.resolve_cell_id(sheet, pos) {
                                        return id;
                                    }
                                    let key = (*sheet, pos);
                                    *self
                                        .ghost_cells
                                        .borrow_mut()
                                        .entry(key)
                                        .or_insert_with(|| self.id_alloc.next_cell_id())
                                }
                                fn get_row_id(&self, _sheet: &SheetId, _row: u32) -> Option<RowId> {
                                    None
                                }
                                fn get_col_id(&self, _sheet: &SheetId, _col: u32) -> Option<ColId> {
                                    None
                                }
                                fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
                                    self.mirror.sheet_by_name(name)
                                }
                                fn current_sheet(&self) -> SheetId {
                                    self.current_sheet
                                }
                            }
                            let resolver = SeqResolver {
                                mirror: &*mirror,
                                ghost_cells: &ghost_cells,
                                id_alloc: &self.id_alloc,
                                current_sheet: sheet_id,
                            };
                            compute_parser::ast_to_identity(&ast, &resolver).ok()
                        };
                        let is_dynamic_array = Self::ast_contains_array_function(&ast, registry);
                        let range_keys = {
                            let sheet_ctx = mirror.sheet_for_cell(&cell_id);
                            let mut plan = crate::eval::cache::range_store::DataPlan::default();
                            crate::eval::cache::range_store::collect_static_ranges_pub(
                                &ast, sheet_ctx, &*mirror, &mut plan,
                            );
                            plan.into_iter().collect::<Vec<_>>()
                        };

                        let rendered_formula = Self::rendered_formula_string_or_fallback(
                            mirror,
                            sheet_id,
                            identity_formula.as_ref(),
                            &formula,
                        );
                        mirror.set_formula(&cell_id, identity_formula);
                        graph_edges.push((cell_id, extracted.value_deps));
                        self.formula_text_deps
                            .replace(cell_id, extracted.formula_text_deps);
                        if extracted.is_volatile {
                            builder.mark_volatile(&cell_id);
                        }
                        self.ast_cache.insert(
                            cell_id,
                            AstEntry {
                                ast,
                                is_dynamic_array,
                            },
                        );
                        self.formula_strings.insert(cell_id, rendered_formula);
                        self.cell_formula_text.insert(cell_id, formula);
                        if !range_keys.is_empty() {
                            self.cell_range_keys.insert(cell_id, range_keys);
                        }
                    }
                    Err(_) => {
                        mirror.set_value_mut(&cell_id, CellValue::Error(CellError::Name, None));
                        self.formula_strings.insert(cell_id, formula.clone());
                        self.cell_formula_text.insert(cell_id, formula);
                    }
                }
            }

            // Register ghost cells in mirror
            for ((sheet_id, pos), cell_id) in ghost_cells.into_inner() {
                mirror.register_ghost_cell(&sheet_id, pos, cell_id);
            }

            builder.bulk_set_precedents(graph_edges);
            self.graph = builder.build();
        }

        // Pass 3: Range index is rebuilt automatically:
        // - Native path: builder.build() handles it
        // - WASM path: set_precedents() auto-rebuilds per call
    }

    /// Inline-dispatched functions (not in the registry) that return arrays.
    pub(super) const INLINE_ARRAY_FUNCTIONS: &'static [&'static str] = &[
        "ARRAYFORMULA",
        "MAP",
        "MAKEARRAY",
        "BYROW",
        "BYCOL",
        "SCAN",
        "ANCHORARRAY",
    ];

    /// Inline operator-function aliases that inherit operator broadcasting.
    /// They are array-producing only when an operand is a multi-cell range or
    /// another array expression; the runtime evaluator still owns semantics.
    pub(super) const OPERATOR_FUNCTION_ALIASES: &'static [&'static str] = &[
        "ADD",
        "MINUS",
        "MULTIPLY",
        "DIVIDE",
        "POW",
        "EQ",
        "NE",
        "GT",
        "GTE",
        "LT",
        "LTE",
        "UMINUS",
        "UPLUS",
        "UNARY_PERCENT",
    ];

    /// Recursively check if an AST node contains a call to an array-returning function
    /// or a range-arithmetic pattern that produces an array result.
    ///
    /// In Excel's dynamic array engine, formulas like `=A1:A3*B1:B3` produce array
    /// results via element-wise lifting and should spill. This function detects:
    /// - Explicit array-returning functions (SEQUENCE, FILTER, etc.).
    /// - Implicit array production from arithmetic/comparison operators applied to
    ///   multi-cell ranges.
    /// - Bare range references at the root (e.g. `=A1:A5`, `=Sheet2!A1:A5`),
    ///   which auto-spill in modern Excel's dynamic-array engine.
    ///
    /// The `@` (implicit-intersection) prefix forces a single-value result and
    /// is treated as a hard barrier: `=@A1:A5` does NOT spill, regardless of
    /// what's inside. CSE-entered formulas (`{=A1:A5}`) take a different path
    /// (the spill handler's `cse_single_cell` set) and are not affected here.
    pub(super) fn ast_contains_array_function(
        node: &ASTNode,
        registry: &crate::functions::FunctionRegistry,
    ) -> bool {
        // Modern Excel auto-spills bare-range formulas: `=A1:A5` typed without
        // CSE produces a 5-cell spill. Detect this at the root before falling
        // through to the visitor (which only checks operators/functions).
        if Self::node_yields_range(node) {
            return true;
        }

        use compute_parser::AstVisitor;

        struct ArrayFnChecker<'a> {
            registry: &'a crate::functions::FunctionRegistry,
            found: bool,
        }

        impl<'a> AstVisitor for ArrayFnChecker<'a> {
            fn visit(&mut self, node: &ASTNode) {
                if self.found {
                    return;
                }
                self.walk(node);
            }

            fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
                let upper = name.to_uppercase();
                if ComputeCore::OPERATOR_FUNCTION_ALIASES.contains(&upper.as_str())
                    && args.iter().any(ComputeCore::node_yields_range)
                {
                    self.found = true;
                    return;
                }
                let is_array_fn = ComputeCore::INLINE_ARRAY_FUNCTIONS.contains(&upper.as_str())
                    || self
                        .registry
                        .get_by_name(&upper)
                        .is_some_and(|(_, f)| f.returns_array());
                if is_array_fn {
                    self.found = true;
                    return;
                }
                for arg in args {
                    self.visit(arg);
                }
            }

            fn visit_binary_op(
                &mut self,
                _op: compute_parser::BinOp,
                left: &ASTNode,
                right: &ASTNode,
            ) {
                // A binary operation with a multi-cell range operand produces an
                // array result via element-wise lifting (e.g. =A1:A3*B1:B3).
                if ComputeCore::node_yields_range(left) || ComputeCore::node_yields_range(right) {
                    self.found = true;
                    return;
                }
                self.visit(left);
                self.visit(right);
            }

            fn visit_unary_op(&mut self, op: compute_parser::UnaryOp, operand: &ASTNode) {
                // The `@` implicit-intersection prefix forces a single-value
                // result — its subtree never produces a spill, regardless of
                // what's inside.
                if matches!(op, compute_parser::UnaryOp::ImplicitIntersection) {
                    return;
                }
                // A unary operation on a multi-cell range produces an array
                // (e.g. =-A1:A3).
                if ComputeCore::node_yields_range(operand) {
                    self.found = true;
                    return;
                }
                self.visit(operand);
            }

            fn visit_array(&mut self, rows: &[Vec<ASTNode>]) {
                // Array literals like {1,2,3} or {1;2;3} produce multi-cell
                // arrays that must spill. A 1×1 literal ({1}) is unwrapped to
                // scalar by the spill handler, so flagging it here is harmless.
                let total_elements: usize = rows.iter().map(|r| r.len()).sum();
                if total_elements > 1 {
                    self.found = true;
                    return;
                }
                for row in rows {
                    for elem in row {
                        self.visit(elem);
                    }
                }
            }
        }

        let mut checker = ArrayFnChecker {
            registry,
            found: false,
        };
        checker.visit(node);
        checker.found
    }

    /// Check if an AST node directly yields a multi-cell range value.
    ///
    /// Returns true for `Range` nodes (A1:A3), and for `SheetRef`/`Paren` wrappers
    /// around range nodes. Does NOT recurse into function calls or operators —
    /// this only checks whether the node itself is a range reference that would
    /// produce a multi-cell array when used as an operand.
    fn node_yields_range(node: &ASTNode) -> bool {
        match node {
            ASTNode::Range(..) => true,
            ASTNode::SheetRef { inner, .. } => Self::node_yields_range(inner),
            ASTNode::UnresolvedSheetRef { inner, .. } => Self::node_yields_range(inner),
            ASTNode::Paren(inner) => Self::node_yields_range(inner),
            _ => false,
        }
    }
}
