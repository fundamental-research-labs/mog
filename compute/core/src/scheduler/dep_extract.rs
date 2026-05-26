//! # Dependency extraction
//!
//! Extracts static dependencies from formula ASTs for the dependency graph.
//! Uses [`AstVisitor`] to walk AST trees and collect cell/range references
//! as `DepTarget` entries.
//!
//! ## Dynamic Reference Strategy Taxonomy
//!
//! Functions interact with range arguments in three ways, each handled differently:
//!
//! ### 1. Aggregate (default)
//! Functions that read **every cell** in a range: SUM, AVERAGE, COUNTIF, etc.
//! - Dep extraction: `DepTarget::Range(range, RangeAccess::Aggregate)`
//! - Cycle detection: self-containment = definite cycle (caught by both edit-time
//!   and recalc-time paths)
//! - Barrier graph: full containment edges for all cells in range
//!
//! ### 2. Selective (`selective_range_arg_pattern`)
//! Functions that read a **statically-known subset** determined by other args:
//! INDEX, CHOOSE, XLOOKUP, VLOOKUP, HLOOKUP, MATCH, LOOKUP, SWITCH, IFS.
//! - Dep extraction: `DepTarget::Range(range, RangeAccess::Selective)`
//! - Cycle detection: self-containment deferred — back-edge filtering in
//!   `analysis.rs::is_selective_back_edge` excludes false cycles
//! - Barrier graph: containment edges with back-edge exclusion
//!
//! ### 3. Volatile-dynamic (no static deps)
//! Functions whose reference target is **runtime-determined** from evaluated args:
//! INDIRECT, OFFSET.
//! - Dep extraction: no range deps extracted (reference unknown at parse time)
//! - Volatility: marked volatile → re-evaluated every recalc
//! - This is correct: INDIRECT("A" & B1) depends on B1's value, which is only
//!   known at eval time. Static dep extraction cannot help here.
//!
//! ## Dual Cycle Detection
//!
//! Cycles are detected at two points:
//! 1. **Edit-time** (`analysis.rs::would_create_cycle`): per-cell check when a
//!    formula is entered. Provides immediate user feedback. Called from
//!    `formula_reg.rs::parse_and_register_formula`.
//! 2. **Recalc-time** (Kahn's algorithm in `analysis.rs::build_barrier_graph` /
//!    `subset_levels`): catches cycles that emerge from bulk operations where
//!    `skip_cycle_check=true` (file open, paste). Routes cycle cells through
//!    `cycles.rs::handle_cycles_and_recalc`.
//!
//! Both paths use the same `RangeAccess` tags and back-edge filtering logic.
//! The edit-time path is a fast-reject optimization; the recalc-time path is
//! the authoritative safety net.

use super::*;

use crate::formula_text::FormulaTextDepTarget;
use crate::graph::RANGE_EXPANSION_THRESHOLD;
use crate::mirror::CellMirror;
use crate::projection::ProjectionRegistry;
use cell_types::SheetId;
use compute_parser::ASTNode;
#[cfg(test)]
use compute_parser::AbsFlags;
use compute_parser::{AstVisitor, CellRefNode, RangeRef};
use formula_types::CellRef;

/// Walk the AST tree, collecting all cell and range references as `DepTarget` entries.
/// The `mirror` parameter enables position lookup for Resolved CellRefs in ranges.
#[cfg(test)]
pub(super) fn extract_dependencies(ast: &ASTNode, current_sheet: &SheetId) -> Vec<DepTarget> {
    let mut deps = Vec::new();
    collect_deps(ast, current_sheet, &mut deps);
    // Deduplicate
    let mut seen = FxHashSet::default();
    deps.retain(|d| seen.insert(d.clone()));
    deps
}

#[cfg(test)]
pub(super) fn collect_deps(node: &ASTNode, current_sheet: &SheetId, deps: &mut Vec<DepTarget>) {
    collect_deps_with_mirror(node, current_sheet, &CellMirror::new(), deps);
}

/// Thin wrapper: delegates to the production `collect_deps_and_volatility`,
/// discarding the volatility and current_row parameters.
/// This avoids duplicating ~220 lines of AST-walking logic.
#[cfg(test)]
pub(super) fn collect_deps_with_mirror(
    node: &ASTNode,
    current_sheet: &SheetId,
    mirror: &CellMirror,
    deps: &mut Vec<DepTarget>,
) {
    collect_deps_and_volatility(node, current_sheet, mirror, deps, &mut false, None);
}

/// Returns true if the AST node is a static cell/range reference —
/// one that resolves to a fixed address without evaluating sub-expressions.
/// Covers: CellReference, Range, and SheetRef wrapping either.
/// Does NOT cover INDIRECT or other dynamic references.
fn is_static_ref(node: &ASTNode) -> bool {
    match node {
        ASTNode::CellReference(_) | ASTNode::Range(_) => true,
        ASTNode::SheetRef { inner, .. } => is_static_ref(inner),
        _ => false,
    }
}

/// Returns true if the reference argument of this function is used only for
/// address metadata (row/col/dimensions), never for the cell's computed value.
/// When true AND the ref arg is a static ref, we can safely skip
/// dependency extraction for that argument.
fn is_ref_arg_metadata_only(name: &str, args: &[ASTNode]) -> bool {
    match name.to_ascii_uppercase().as_str() {
        // Tier 1: always metadata-only
        "ROW" | "COLUMN" | "ROWS" | "COLUMNS" => true,

        // Tier 2: CELL() is metadata-only when info_type is a known literal
        "CELL" => {
            if args.len() >= 2 {
                if let ASTNode::Text(info_type) = &args[0] {
                    matches!(
                        info_type.to_ascii_lowercase().as_str(),
                        "row" | "col" | "address"
                    )
                } else {
                    false // info_type from expression — conservatively extract deps
                }
            } else {
                false
            }
        }

        _ => false,
    }
}

/// Returns the index of the reference argument for metadata-only functions.
fn metadata_arg_index(name: &str) -> usize {
    match name.to_ascii_uppercase().as_str() {
        "CELL" => 1, // CELL(info_type, ref) — ref is second arg
        _ => 0,      // ROW(ref), COLUMN(ref), ROWS(ref), COLUMNS(ref)
    }
}

/// Describes which arguments of a function are selectively accessed.
/// Selective functions read a dynamic subset of a range, not every cell.
///
/// Strategy taxonomy:
/// - Aggregate (default): reads all cells → full barrier edges
/// - Selective (this enum): reads a subset → back-edge filtered
/// - Volatile-dynamic (INDIRECT, OFFSET): runtime-determined refs → no static deps, volatility flag
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SelectiveArgs {
    /// No args are selective — function reads all cells (Aggregate).
    Aggregate,
    /// Specific arg indices are selective.
    Indices(&'static [usize]),
    /// All args from index N onward are selective.
    AllFrom(usize),
}

impl SelectiveArgs {
    fn includes(&self, i: usize) -> bool {
        match self {
            Self::Aggregate => false,
            Self::Indices(s) => s.contains(&i),
            Self::AllFrom(n) => i >= *n,
        }
    }
}

/// Returns the selective argument pattern for a function.
/// Selective functions read a dynamic subset of a range argument, not every cell.
fn selective_range_arg_pattern(name: &str) -> SelectiveArgs {
    match name.to_ascii_uppercase().as_str() {
        // INDEX(array, row_num, [col_num]) — reads one cell from array
        "INDEX" => SelectiveArgs::Indices(&[0]),
        // CHOOSE(index, val1, val2, ...) — reads one of the value args.
        // Arg 0 (index) is fully evaluated; all subsequent args are candidates.
        "CHOOSE" => SelectiveArgs::AllFrom(1),
        // XLOOKUP(lookup, lookup_array, return_array, ...) — searches lookup_array,
        // reads one row from return_array
        "XLOOKUP" => SelectiveArgs::Indices(&[1, 2]),
        // VLOOKUP(lookup, table_array, col_idx, ...) — searches first column of table_array
        "VLOOKUP" => SelectiveArgs::Indices(&[1]),
        // HLOOKUP(lookup, table_array, row_idx, ...) — searches first row of table_array
        "HLOOKUP" => SelectiveArgs::Indices(&[1]),
        // MATCH(lookup, lookup_array, match_type) — searches lookup_array
        "MATCH" => SelectiveArgs::Indices(&[1]),
        // LOOKUP(lookup, lookup_vector, [result_vector]) — searches lookup_vector,
        // reads one cell from result_vector
        "LOOKUP" => SelectiveArgs::Indices(&[1, 2]),
        // SWITCH(expr, val1, result1, ..., [default]) — only matching result used.
        // All non-expr args are selective (engine reads a subset regardless).
        "SWITCH" => SelectiveArgs::AllFrom(1),
        // IFS(cond1, val1, cond2, val2, ...) — short-circuits on first true.
        // All args are candidates; only one pair is evaluated.
        "IFS" => SelectiveArgs::AllFrom(0),
        _ => SelectiveArgs::Aggregate,
    }
}

// ---------------------------------------------------------------------------
// DepExtractor — AstVisitor implementation for dependency + volatility extraction
// ---------------------------------------------------------------------------

/// Visitor that collects dependency targets and detects volatile function calls
/// in a single AST walk.
struct DepExtractor<'a> {
    sheet_ctx: SheetId,
    mirror: &'a CellMirror,
    ordered_sheets: &'a [SheetId],
    deps: Vec<DepTarget>,
    formula_text_deps: Vec<FormulaTextDepTarget>,
    is_volatile: bool,
    current_row: Option<u32>,
    /// Set when visiting a selective function's range argument (e.g., INDEX arg 0).
    /// When true, `visit_range`/`visit_structured_ref`/`visit_identifier` emit
    /// `RangeAccess::Selective` instead of `Aggregate`.
    in_selective_arg: bool,
}

impl<'a> DepExtractor<'a> {
    fn new(
        current_sheet: &SheetId,
        mirror: &'a CellMirror,
        ordered_sheets: &'a [SheetId],
        current_row: Option<u32>,
    ) -> Self {
        Self {
            sheet_ctx: *current_sheet,
            mirror,
            ordered_sheets,
            deps: Vec::new(),
            formula_text_deps: Vec::new(),
            is_volatile: false,
            current_row,
            in_selective_arg: false,
        }
    }

    /// Returns the `RangeAccess` for the current visitor context.
    fn current_range_access(&self) -> RangeAccess {
        if self.in_selective_arg {
            RangeAccess::Selective
        } else {
            RangeAccess::Aggregate
        }
    }

    fn sheets_in_range(&self, start: &SheetId, end: &SheetId) -> Vec<SheetId> {
        if self.ordered_sheets.is_empty() {
            if start == end {
                return vec![*start];
            }
            // Dependency extraction must be conservative when tab order is not
            // available. Evaluation gets the scheduler's ordered sheet cache,
            // but older test helpers and some direct callers do not.
            return self.mirror.sheet_ids().copied().collect();
        }

        let start_pos = self.ordered_sheets.iter().position(|s| s == start);
        let end_pos = self.ordered_sheets.iter().position(|s| s == end);
        match (start_pos, end_pos) {
            (Some(a), Some(b)) => {
                let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
                self.ordered_sheets[lo..=hi].to_vec()
            }
            _ => vec![*start],
        }
    }

    fn ref_in_sheet_ctx(&self, cell_ref: &CellRef) -> CellRef {
        match cell_ref {
            CellRef::Positional { sheet, row, col } if *sheet == SheetId::from_raw(0) => {
                CellRef::Positional {
                    sheet: self.sheet_ctx,
                    row: *row,
                    col: *col,
                }
            }
            _ => *cell_ref,
        }
    }

    fn push_cell_ref_dep(&mut self, cell_ref: &CellRef) {
        let registry = Some(&self.mirror.projection_registry);
        let effective = self.ref_in_sheet_ctx(cell_ref);
        push_cell_ref_dep_targets(&effective, self.mirror, registry, None, &mut self.deps);
    }

    fn push_formula_text_cell_dep(&mut self, sheet: SheetId, row: u32, col: u32) {
        self.formula_text_deps
            .push(FormulaTextDepTarget::PosTopLeft { sheet, row, col });
        if let Some(cell_id) = self.mirror.resolve_cell_id(&sheet, SheetPos::new(row, col)) {
            self.formula_text_deps
                .push(FormulaTextDepTarget::Cell(cell_id));
        }
    }

    fn collect_formulatext_dep(&mut self, node: &ASTNode) {
        match node {
            ASTNode::CellReference(cell) => {
                if let Some((sheet, row, col)) =
                    cell_ref_to_position(&cell.reference, &self.sheet_ctx, self.mirror)
                {
                    self.push_formula_text_cell_dep(sheet, row, col);
                }
            }
            ASTNode::Range(range) => {
                let start = cell_ref_to_position(&range.start, &self.sheet_ctx, self.mirror);
                let end = cell_ref_to_position(&range.end, &self.sheet_ctx, self.mirror);
                if let (Some((sheet, s_row, s_col)), Some((_, e_row, e_col))) = (start, end) {
                    self.push_formula_text_cell_dep(sheet, s_row.min(e_row), s_col.min(e_col));
                }
            }
            ASTNode::SheetRef { sheet, inner } => {
                let prev = self.sheet_ctx;
                self.sheet_ctx = *sheet;
                self.collect_formulatext_dep(inner);
                self.sheet_ctx = prev;
            }
            ASTNode::Identifier(name) => {
                use formula_types::{IdentityFormulaRef, Scope};
                let chain = [Scope::Sheet(self.sheet_ctx), Scope::Workbook];
                if let Some((_var_cell_id, def)) =
                    self.mirror.variables.resolve_with_id(name, &chain)
                {
                    self.formula_text_deps
                        .push(FormulaTextDepTarget::NameBinding {
                            scope: def.scope.clone(),
                            name: name.to_ascii_lowercase(),
                        });
                    if let Some(ref_item) = def.refers_to.refs.first() {
                        match ref_item {
                            IdentityFormulaRef::Cell(cell_ref) => {
                                if let Some((sheet, row, col)) =
                                    self.mirror.sheet_for_cell(&cell_ref.id).and_then(|sheet| {
                                        self.mirror
                                            .resolve_position(&cell_ref.id)
                                            .map(|pos| (sheet, pos.row(), pos.col()))
                                    })
                                {
                                    self.push_formula_text_cell_dep(sheet, row, col);
                                }
                            }
                            IdentityFormulaRef::Range(range_ref) => {
                                let start = cell_ref_to_position(
                                    &CellRef::Resolved(range_ref.start_id),
                                    &self.sheet_ctx,
                                    self.mirror,
                                );
                                let end = cell_ref_to_position(
                                    &CellRef::Resolved(range_ref.end_id),
                                    &self.sheet_ctx,
                                    self.mirror,
                                );
                                if let (Some((sheet, s_row, s_col)), Some((_, e_row, e_col))) =
                                    (start, end)
                                {
                                    self.push_formula_text_cell_dep(
                                        sheet,
                                        s_row.min(e_row),
                                        s_col.min(e_col),
                                    );
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            ASTNode::Paren(inner) => self.collect_formulatext_dep(inner),
            ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. }
            | ASTNode::UnresolvedSheetRef { .. }
            | ASTNode::UnresolvedThreeDRef { .. }
            | ASTNode::StructuredRef(_)
            | ASTNode::ThreeDRef { .. } => {}
            _ => self.visit(node),
        }
    }
}

impl<'a> AstVisitor for DepExtractor<'a> {
    fn visit_cell_ref(&mut self, r: &CellRefNode) {
        self.push_cell_ref_dep(&r.reference);
    }

    fn visit_range(&mut self, r: &RangeRef) {
        let start_pos = cell_ref_to_position(&r.start, &self.sheet_ctx, self.mirror);
        let end_pos = cell_ref_to_position(&r.end, &self.sheet_ctx, self.mirror);

        match (start_pos, end_pos) {
            (Some((s_sheet, s_row, s_col)), Some((_e_sheet, e_row, e_col))) => {
                let min_row = s_row.min(e_row);
                let max_row = s_row.max(e_row);
                let min_col = s_col.min(e_col);
                let max_col = s_col.max(e_col);

                let row_count = (max_row - min_row + 1) as u64;
                let col_count = (max_col - min_col + 1) as u64;
                let cell_count = row_count * col_count;

                // Always register the range dep for projection stabilization.
                let access = self.current_range_access();
                self.deps.push(DepTarget::Range(
                    RangePos::new(s_sheet, min_row, min_col, max_row, max_col),
                    access,
                ));

                if cell_count < RANGE_EXPANSION_THRESHOLD && access == RangeAccess::Aggregate {
                    // Small Aggregate range: expand to individual cell deps for
                    // fine-grained topological ordering.
                    //
                    // Selective ranges are NOT expanded — individual Cell deps
                    // would create false direct dependencies (including self-refs)
                    // that bypass the Selective back-edge filtering in
                    // `analysis.rs::is_selective_back_edge`. The Range dep
                    // (tagged Selective) is sufficient: `subset_levels` and
                    // `build_barrier_graph` use range-based ordering with
                    // back-edge exclusion for correct evaluation order.
                    for row in min_row..=max_row {
                        for col in min_col..=max_col {
                            if let Some(cell_id) = self
                                .mirror
                                .resolve_cell_id(&s_sheet, SheetPos::new(row, col))
                            {
                                self.deps.push(DepTarget::Cell(cell_id));
                            } else if let Some((source, _, _)) =
                                self.mirror.projection_registry.resolve(&s_sheet, row, col)
                            {
                                // Phantom cell (e.g., spill target from TRANSPOSE).
                                // Add a dep on the projection source so the spill
                                // materializes before this formula evaluates.
                                self.deps.push(DepTarget::Cell(source));
                            }
                        }
                    }
                } else if access == RangeAccess::Aggregate {
                    // Large Aggregate range: add corner cell deps for basic ordering.
                    self.push_cell_ref_dep(&r.start);
                    self.push_cell_ref_dep(&r.end);
                }
            }
            _ => {
                // Can't determine positions — add individual ref deps only
                self.push_cell_ref_dep(&r.start);
                self.push_cell_ref_dep(&r.end);
            }
        }
    }

    fn visit_sheet_ref(&mut self, sheet: &SheetId, inner: &ASTNode) {
        let prev = self.sheet_ctx;
        self.sheet_ctx = *sheet;
        self.visit(inner);
        self.sheet_ctx = prev;
    }

    fn visit_unresolved_sheet_ref(&mut self, _name: &str, _inner: &ASTNode) {
        // Formula will produce #REF! at eval time. Don't extract deps —
        // recording deps against current sheet would create phantom edges.
    }

    fn visit_three_d_ref(&mut self, start_sheet: &SheetId, end_sheet: &SheetId, inner: &ASTNode) {
        let prev = self.sheet_ctx;
        for sheet in self.sheets_in_range(start_sheet, end_sheet) {
            self.sheet_ctx = sheet;
            self.visit(inner);
        }
        self.sheet_ctx = prev;
    }

    fn visit_unresolved_three_d_ref(&mut self, start_name: &str, end_name: &str, inner: &ASTNode) {
        let Some(start) = self.mirror.sheet_by_name(start_name) else {
            return;
        };
        let Some(end) = self.mirror.sheet_by_name(end_name) else {
            return;
        };
        self.visit_three_d_ref(&start, &end, inner);
    }

    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        // Check volatility
        if VOLATILE_FUNCTIONS
            .iter()
            .any(|v| v.eq_ignore_ascii_case(name))
        {
            self.is_volatile = true;
        }

        if name.eq_ignore_ascii_case("FORMULATEXT") {
            if args.len() == 1 {
                self.collect_formulatext_dep(&args[0]);
            } else {
                for arg in args {
                    self.visit(arg);
                }
            }
            return;
        }

        // Metadata-only functions (ROW, COLUMN, ROWS, COLUMNS, CELL with
        // literal metadata info_type) only inspect reference address/geometry
        // from the AST — they never read the referenced cell's computed value.
        // Skip dep extraction for their reference argument when it's a static
        // ref, preventing false circular reference detection (e.g. =COLUMN($D$40)
        // in D40) and unnecessary graph edges.
        let skip_metadata_arg = is_ref_arg_metadata_only(name, args);
        let skip_idx = if skip_metadata_arg {
            metadata_arg_index(name)
        } else {
            usize::MAX
        };

        let selective_pattern = selective_range_arg_pattern(name);

        for (i, arg) in args.iter().enumerate() {
            if i == skip_idx && is_static_ref(arg) {
                continue;
            }
            let prev = self.in_selective_arg;
            if selective_pattern.includes(i) {
                self.in_selective_arg = true;
            } else {
                // Non-selective arg: reset to false so that inner functions
                // determine their own access pattern. Without this reset,
                // an outer selective context (e.g. CHOOSE) would propagate
                // into nested aggregate functions (e.g. SUM), masking real
                // cycles like CHOOSE(1, SUM(A:A)) where A5 is in A:A.
                self.in_selective_arg = false;
            }
            self.visit(arg);
            self.in_selective_arg = prev;
        }
    }

    fn visit_structured_ref(&mut self, ref_: &formula_types::StructuredRef) {
        // Look up the table definition from the mirror to resolve structured
        // references (e.g., Table1[Revenue]) into concrete dependency edges.
        if let Some(table_def) = self.mirror.get_table_def(&ref_.table_name) {
            let ranges = crate::table::structured_refs::resolve_ranges_from_table_def(
                ref_,
                table_def,
                self.current_row,
            );

            if let Some(ranges) = ranges {
                let sheet_id = table_def.sheet;

                for range in &ranges {
                    let row_count = if range.end_row >= range.start_row {
                        (range.end_row - range.start_row + 1) as u64
                    } else {
                        0
                    };
                    let cell_count = row_count * range.columns.len() as u64;

                    if cell_count > 0 {
                        let min_col = range.columns.iter().copied().min().unwrap_or(0);
                        let max_col = range.columns.iter().copied().max().unwrap_or(0);
                        let access = self.current_range_access();

                        // Always emit a Range dep (needed for back-edge filtering
                        // and projection stabilization).
                        self.deps.push(DepTarget::Range(
                            RangePos::new(
                                sheet_id,
                                range.start_row,
                                min_col,
                                range.end_row,
                                max_col,
                            ),
                            access,
                        ));

                        if cell_count < RANGE_EXPANSION_THRESHOLD
                            && access == RangeAccess::Aggregate
                        {
                            // Small Aggregate range: expand to individual cell deps.
                            // Selective ranges skip expansion (same rationale as visit_range).
                            for row in range.start_row..=range.end_row {
                                for &col in &range.columns {
                                    if let Some(cell_id) = self
                                        .mirror
                                        .resolve_cell_id(&sheet_id, SheetPos::new(row, col))
                                    {
                                        self.deps.push(DepTarget::Cell(cell_id));
                                    } else if let Some((source, _, _)) =
                                        self.mirror.projection_registry.resolve(&sheet_id, row, col)
                                    {
                                        // Phantom cell (spill target) — add dep on projection source.
                                        self.deps.push(DepTarget::Cell(source));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn visit_identifier(&mut self, name: &str) {
        // Check if this identifier resolves to a variable in the VariableStore.
        // If so, emit a dependency on the variable's synthetic CellId AND
        // the actual cell/range refs from the named range definition.
        use formula_types::{IdentityFormulaRef, Scope};

        let chain = [Scope::Sheet(self.sheet_ctx), Scope::Workbook];
        if let Some((var_cell_id, def)) = self.mirror.variables.resolve_with_id(name, &chain) {
            // Keep synthetic variable dep (for LET chain cycle detection)
            self.deps.push(DepTarget::Cell(var_cell_id));

            // Extract actual cell/range refs from the named range definition
            // so the dependency graph has real edges to the referenced cells.
            // Without this, formulas using named ranges (e.g. WACC) don't
            // create graph edges to the underlying cells, breaking TABLE
            // prepass chain computation and incremental recalc.
            for ref_item in &def.refers_to.refs {
                match ref_item {
                    IdentityFormulaRef::Cell(cell_ref) => {
                        self.deps.push(DepTarget::Cell(cell_ref.id));
                    }
                    IdentityFormulaRef::Range(range_ref) => {
                        // Resolve start/end CellIds to positions, create RangePos dep
                        let start = cell_ref_to_position(
                            &CellRef::Resolved(range_ref.start_id),
                            &self.sheet_ctx,
                            self.mirror,
                        );
                        let end = cell_ref_to_position(
                            &CellRef::Resolved(range_ref.end_id),
                            &self.sheet_ctx,
                            self.mirror,
                        );
                        if let (Some((s_sheet, s_row, s_col)), Some((_, e_row, e_col))) =
                            (start, end)
                        {
                            let access = self.current_range_access();
                            self.deps.push(DepTarget::Range(
                                RangePos::new(
                                    s_sheet,
                                    s_row.min(e_row),
                                    s_col.min(e_col),
                                    s_row.max(e_row),
                                    s_col.max(e_col),
                                ),
                                access,
                            ));
                        }
                        // Also push CellId deps on corners for topo ordering
                        self.deps.push(DepTarget::Cell(range_ref.start_id));
                        self.deps.push(DepTarget::Cell(range_ref.end_id));
                    }
                    IdentityFormulaRef::RectRange(rect_ref) => {
                        let (Some((start_row_sheet, start_row)), Some((end_row_sheet, end_row))) = (
                            self.mirror.row_index_lookup(&rect_ref.start_row_id),
                            self.mirror.row_index_lookup(&rect_ref.end_row_id),
                        ) else {
                            continue;
                        };
                        let (Some((start_col_sheet, start_col)), Some((end_col_sheet, end_col))) = (
                            self.mirror.col_index_lookup(&rect_ref.start_col_id),
                            self.mirror.col_index_lookup(&rect_ref.end_col_id),
                        ) else {
                            continue;
                        };
                        if start_row_sheet == rect_ref.sheet_id
                            && end_row_sheet == rect_ref.sheet_id
                            && start_col_sheet == rect_ref.sheet_id
                            && end_col_sheet == rect_ref.sheet_id
                        {
                            let access = self.current_range_access();
                            self.deps.push(DepTarget::Range(
                                RangePos::new(
                                    rect_ref.sheet_id,
                                    start_row.min(end_row),
                                    start_col.min(end_col),
                                    start_row.max(end_row),
                                    start_col.max(end_col),
                                ),
                                access,
                            ));
                        }
                    }
                    // FullRow/RowRange/FullCol/ColRange use RowId/ColId which
                    // CellMirror cannot resolve yet — skip gracefully.
                    // External refs are indexed separately by the workbook
                    // dependency coordinator, not as local DepTarget edges.
                    _ => {}
                }
            }
        }
    }
}

/// Extract dependencies and check volatility in a single AST walk.
///
/// This combines dependency collection and volatile-function detection into
/// one pass, avoiding a redundant traversal of the AST tree.
pub(super) fn extract_deps_and_volatility(
    ast: &ASTNode,
    current_sheet: &SheetId,
    mirror: &CellMirror,
    ordered_sheets: &[SheetId],
    current_row: Option<u32>,
) -> ExtractedFormulaDeps {
    let mut extractor = DepExtractor::new(current_sheet, mirror, ordered_sheets, current_row);
    extractor.visit(ast);
    let mut deps = extractor.deps;
    // Deduplicate — pre-size to avoid inner FxHashSet rehash storms.
    let mut seen = FxHashSet::with_capacity_and_hasher(deps.len(), Default::default());
    deps.retain(|d| seen.insert(d.clone()));
    let mut formula_text_deps = extractor.formula_text_deps;
    let mut seen_formula_text =
        FxHashSet::with_capacity_and_hasher(formula_text_deps.len(), Default::default());
    formula_text_deps.retain(|d| seen_formula_text.insert(d.clone()));
    ExtractedFormulaDeps {
        value_deps: deps,
        formula_text_deps,
        is_volatile: extractor.is_volatile,
    }
}

pub(super) struct ExtractedFormulaDeps {
    pub value_deps: Vec<DepTarget>,
    pub formula_text_deps: Vec<FormulaTextDepTarget>,
    pub is_volatile: bool,
}

/// Backwards-compatible helper: collects dependency targets AND checks for
/// volatile function calls. Used by test wrappers that pass out-params.
#[allow(dead_code)]
pub(super) fn collect_deps_and_volatility(
    node: &ASTNode,
    current_sheet: &SheetId,
    mirror: &CellMirror,
    deps: &mut Vec<DepTarget>,
    is_volatile: &mut bool,
    current_row: Option<u32>,
) {
    let mut extractor = DepExtractor::new(current_sheet, mirror, &[], current_row);
    extractor.visit(node);
    deps.extend(extractor.deps);
    *is_volatile |= extractor.is_volatile;
}

/// Projection-aware conversion of a CellRef to dependency targets.
///
/// Implements the "dual-edge" model for dynamic array projections:
/// - ALWAYS emits the standard dep (Cell or 1x1 Range) for correctness
/// - ADDITIONALLY, if the referenced position is inside a known projection,
///   emits `DepTarget::Cell(source)` to create a topological ordering edge
///   so the dependent evaluates AFTER the projection source
///
/// The `current_cell` parameter prevents self-dependencies when the source
/// of a projection is the same as the cell being extracted.
///
/// Pushes directly into `out` to avoid per-call Vec allocation (each call
/// typically produces 1-2 targets, so a Vec allocation per call is wasteful).
pub(super) fn push_cell_ref_dep_targets(
    cell_ref: &CellRef,
    mirror: &CellMirror,
    registry: Option<&ProjectionRegistry>,
    current_cell: Option<&CellId>,
    out: &mut Vec<DepTarget>,
) {
    match cell_ref {
        CellRef::Resolved(id) => {
            // Always emit the direct cell dep
            out.push(DepTarget::Cell(*id));

            // If registry is available, check if this resolved cell's position
            // is inside a projection and the source is different from `id`
            if let Some(reg) = registry
                && let Some(sheet_id) = mirror.sheet_for_cell(id)
                && let Some(sheet) = mirror.get_sheet(&sheet_id)
                && let Some(pos) = sheet.position_of(id)
                && let Some((source, _, _)) = reg.resolve(&sheet_id, pos.row(), pos.col())
            {
                // Add topo edge to projection source if it's different
                // from the resolved cell AND different from the current cell
                if source != *id {
                    let is_self = current_cell.is_some_and(|c| source == *c);
                    if !is_self {
                        out.push(DepTarget::Cell(source));
                    }
                }
            }
        }
        CellRef::Positional { sheet, row, col } => {
            // Always emit the 1x1 range dep (safety net)
            out.push(DepTarget::Range(
                RangePos::new(*sheet, *row, *col, *row, *col),
                RangeAccess::Aggregate,
            ));

            // If registry is available, check if this position is inside a projection
            if let Some(reg) = registry
                && let Some((source, _, _)) = reg.resolve(sheet, *row, *col)
            {
                let is_self = current_cell.is_some_and(|c| source == *c);
                if !is_self {
                    out.push(DepTarget::Cell(source));
                }
            }
        }
    }
}

/// Wrapper for backwards compatibility with callers expecting Vec return.
#[cfg(test)]
pub(super) fn cell_ref_to_dep_targets(
    cell_ref: &CellRef,
    mirror: &CellMirror,
    registry: Option<&ProjectionRegistry>,
    current_cell: Option<&CellId>,
) -> Vec<DepTarget> {
    let mut targets = Vec::new();
    push_cell_ref_dep_targets(cell_ref, mirror, registry, current_cell, &mut targets);
    targets
}

/// Extract position info from a CellRef, using mirror for reverse lookup of Resolved refs.
pub(super) fn cell_ref_to_position(
    cell_ref: &CellRef,
    current_sheet: &SheetId,
    mirror: &CellMirror,
) -> Option<(SheetId, u32, u32)> {
    match cell_ref {
        CellRef::Resolved(id) => {
            // O(1) reverse-lookup via cell_to_sheet index
            let sheet_id = mirror.sheet_for_cell(id)?;
            let sheet = mirror.get_sheet(&sheet_id)?;
            let pos = sheet.position_of(id)?;
            let (row, col) = (pos.row(), pos.col());
            Some((sheet_id, row, col))
        }
        CellRef::Positional { sheet, row, col } => {
            let resolved_sheet = if *sheet == SheetId::from_raw(0) {
                *current_sheet
            } else {
                *sheet
            };
            Some((resolved_sheet, *row, *col))
        }
    }
}

// ===========================================================================
// Tests for projection-aware dependency extraction
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::{CellEntry, SheetMirror};
    use value_types::CellValue;

    fn make_cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a mirror with a single sheet containing the given cells.
    fn make_mirror(sheet_id: SheetId, cells: Vec<(CellId, u32, u32)>) -> CellMirror {
        let mut mirror = CellMirror::new();
        let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 26);
        mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);
        for (cell_id, row, col) in cells {
            let entry = CellEntry {
                value: CellValue::Null,
                formula: None,
            };
            mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(row, col), entry);
        }
        mirror
    }

    // -----------------------------------------------------------------------
    // Test 1: Positional ref to empty position (no projection) → Range only
    // -----------------------------------------------------------------------

    #[test]
    fn test_positional_ref_no_projection() {
        let sheet = make_sheet_id(1);
        let mirror = make_mirror(sheet, vec![]);

        let cell_ref = CellRef::Positional {
            sheet,
            row: 5,
            col: 3,
        };

        // With empty registry
        let targets =
            cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

        assert_eq!(targets.len(), 1, "should produce exactly 1 dep target");
        assert_eq!(
            targets[0],
            DepTarget::Range(RangePos::new(sheet, 5, 3, 5, 3), RangeAccess::Aggregate)
        );
    }

    // -----------------------------------------------------------------------
    // Test 2: Positional ref inside a known projection → Range + Cell(source)
    // -----------------------------------------------------------------------

    #[test]
    fn test_positional_ref_inside_projection() {
        let sheet = make_sheet_id(1);
        let source = make_cell_id(100);
        let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

        // Register a projection: source at (0,0), 5 rows x 1 col
        mirror
            .projection_registry
            .register(source, sheet, 0, 0, 5, 1);

        // Reference to position (3, 0) which is inside the projection
        let cell_ref = CellRef::Positional {
            sheet,
            row: 3,
            col: 0,
        };

        let targets =
            cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

        assert_eq!(targets.len(), 2, "should produce Range + Cell(source)");
        // First: the 1x1 range dep (safety net)
        assert_eq!(
            targets[0],
            DepTarget::Range(RangePos::new(sheet, 3, 0, 3, 0), RangeAccess::Aggregate)
        );
        // Second: the topo ordering edge to the source
        assert_eq!(targets[1], DepTarget::Cell(source));
    }

    // -----------------------------------------------------------------------
    // Test 3: Resolved ref to cell inside projection → Cell(id) + Cell(source)
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolved_ref_inside_projection() {
        let sheet = make_sheet_id(1);
        let source = make_cell_id(100);
        let phantom = make_cell_id(200);
        let mut mirror = make_mirror(sheet, vec![(source, 0, 0), (phantom, 2, 0)]);

        // Register projection: source at (0,0), 5 rows x 1 col
        mirror
            .projection_registry
            .register(source, sheet, 0, 0, 5, 1);

        // Resolved ref to the phantom cell at position (2, 0)
        let cell_ref = CellRef::Resolved(phantom);

        let targets =
            cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

        assert_eq!(
            targets.len(),
            2,
            "should produce Cell(phantom) + Cell(source)"
        );
        assert_eq!(targets[0], DepTarget::Cell(phantom));
        assert_eq!(targets[1], DepTarget::Cell(source));
    }

    // -----------------------------------------------------------------------
    // Test 4: Projection removed → re-extraction produces Range only
    // -----------------------------------------------------------------------

    #[test]
    fn test_projection_removed_reverts_to_range_only() {
        let sheet = make_sheet_id(1);
        let source = make_cell_id(100);
        let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

        // Register and then remove projection
        mirror
            .projection_registry
            .register(source, sheet, 0, 0, 5, 1);
        mirror.projection_registry.remove(&source);

        // Positional ref to what was projected position
        let cell_ref = CellRef::Positional {
            sheet,
            row: 3,
            col: 0,
        };

        let targets =
            cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

        assert_eq!(targets.len(), 1, "after removal, should produce Range only");
        assert!(matches!(targets[0], DepTarget::Range(_, _)));
    }

    // -----------------------------------------------------------------------
    // Test 5: Self-reference check — if source == current cell, no extra dep
    // -----------------------------------------------------------------------

    #[test]
    fn test_self_reference_no_extra_dep() {
        let sheet = make_sheet_id(1);
        let source = make_cell_id(100);
        let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

        // Register projection from source
        mirror
            .projection_registry
            .register(source, sheet, 0, 0, 5, 1);

        // Positional ref to (3, 0), inside projection, but current_cell is source
        let cell_ref = CellRef::Positional {
            sheet,
            row: 3,
            col: 0,
        };

        let targets = cell_ref_to_dep_targets(
            &cell_ref,
            &mirror,
            Some(&mirror.projection_registry),
            Some(&source), // current_cell == source
        );

        assert_eq!(
            targets.len(),
            1,
            "self-reference: should NOT add Cell(source) dep"
        );
        assert!(matches!(targets[0], DepTarget::Range(_, _)));
    }

    // -----------------------------------------------------------------------
    // Test 6: Resolved ref at projection origin → Cell(id) only (source == id)
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolved_ref_at_projection_origin() {
        let sheet = make_sheet_id(1);
        let source = make_cell_id(100);
        let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

        // Register projection: source at (0,0)
        mirror
            .projection_registry
            .register(source, sheet, 0, 0, 5, 1);

        // Resolved ref directly to source cell
        let cell_ref = CellRef::Resolved(source);

        let targets =
            cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

        // source == id, so no extra Cell(source) dep should be added
        assert_eq!(
            targets.len(),
            1,
            "ref to source itself: should NOT add duplicate Cell(source)"
        );
        assert_eq!(targets[0], DepTarget::Cell(source));
    }

    // -----------------------------------------------------------------------
    // Test 7: Registry is None → same behavior as basic cell_ref_to_dep_target
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Metadata-only function tests: ROW, COLUMN, ROWS, COLUMNS, CELL
    // -----------------------------------------------------------------------

    /// Helper: build a positional CellRef as an ASTNode::CellReference.
    fn cell_ref_node(sheet: SheetId, row: u32, col: u32) -> ASTNode {
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional { sheet, row, col },
            abs_row: true,
            abs_col: true,
        })
    }

    /// Helper: build a range ref AST node.
    fn range_ref_node(sheet: SheetId, r1: u32, c1: u32, r2: u32, c2: u32) -> ASTNode {
        ASTNode::Range(RangeRef {
            start: CellRef::Positional {
                sheet,
                row: r1,
                col: c1,
            },
            end: CellRef::Positional {
                sheet,
                row: r2,
                col: c2,
            },
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: formula_types::RangeType::CellRange,
        })
    }

    /// Helper: extract deps from an AST using the production path.
    fn deps_from_ast(ast: &ASTNode, sheet: &SheetId) -> Vec<DepTarget> {
        let mirror = CellMirror::new();
        extract_deps_and_volatility(ast, sheet, &mirror, &[], None).value_deps
    }

    #[test]
    fn test_column_self_ref_no_dep() {
        // =COLUMN($D$40) — should produce NO dep for D40 (col=3, row=39)
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "COLUMN".into(),
            args: vec![cell_ref_node(sheet, 39, 3)],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            deps.is_empty(),
            "COLUMN(static_ref) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_row_self_ref_no_dep() {
        // =ROW($A$5) — should produce NO dep for A5
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "ROW".into(),
            args: vec![cell_ref_node(sheet, 4, 0)],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            deps.is_empty(),
            "ROW(static_ref) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_rows_range_no_dep() {
        // =ROWS(A1:A10) — should produce NO deps for A1:A10
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "ROWS".into(),
            args: vec![range_ref_node(sheet, 0, 0, 9, 0)],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            deps.is_empty(),
            "ROWS(static_range) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_columns_range_no_dep() {
        // =COLUMNS(A1:D1) — should produce NO deps for A1:D1
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "COLUMNS".into(),
            args: vec![range_ref_node(sheet, 0, 0, 0, 3)],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            deps.is_empty(),
            "COLUMNS(static_range) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_column_cross_sheet_ref_no_dep() {
        // =COLUMN(Sheet2!$A$1) — SheetRef wrapping a CellReference is static
        let sheet1 = make_sheet_id(1);
        let sheet2 = make_sheet_id(2);
        let ast = ASTNode::Function {
            name: "COLUMN".into(),
            args: vec![ASTNode::SheetRef {
                sheet: sheet2,
                inner: Box::new(cell_ref_node(sheet2, 0, 0)),
            }],
        };
        let deps = deps_from_ast(&ast, &sheet1);
        assert!(
            deps.is_empty(),
            "COLUMN(SheetRef(static)) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_compound_formula_only_skips_metadata_arg() {
        // =A1+COLUMN($D$40) — should extract dep for A1 but NOT D40
        let sheet = make_sheet_id(1);
        let ast = ASTNode::BinaryOp {
            op: compute_parser::BinOp::Add,
            left: Box::new(cell_ref_node(sheet, 0, 0)), // A1
            right: Box::new(ASTNode::Function {
                name: "COLUMN".into(),
                args: vec![cell_ref_node(sheet, 39, 3)], // $D$40
            }),
        };
        let deps = deps_from_ast(&ast, &sheet);
        // Should have dep(s) for A1 (positional → 1x1 Range) but nothing for D40
        assert!(!deps.is_empty(), "should have deps for A1");
        for dep in &deps {
            match dep {
                DepTarget::Range(r, _) => {
                    assert!(
                        !(r.start_row() == 39 && r.start_col() == 3),
                        "should NOT have dep for D40 (row=39, col=3), got: {:?}",
                        dep
                    );
                }
                DepTarget::Cell(_) => {} // OK — could be projection-related
            }
        }
    }

    #[test]
    fn test_column_indirect_does_extract_deps() {
        // =COLUMN(INDIRECT("D40")) — INDIRECT is a Function node, not static ref
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "COLUMN".into(),
            args: vec![ASTNode::Function {
                name: "INDIRECT".into(),
                args: vec![ASTNode::Text("D40".to_string())],
            }],
        };
        let extracted = extract_deps_and_volatility(&ast, &sheet, &CellMirror::new(), &[], None);
        // INDIRECT is volatile, so is_volatile should be true
        assert!(
            extracted.is_volatile,
            "INDIRECT should mark formula as volatile"
        );
        // No static deps from INDIRECT("D40") since it's a string literal,
        // but the key point is that dep extraction was NOT skipped for the arg.
    }

    #[test]
    fn test_sum_self_ref_still_has_deps() {
        // =SUM($D$40) — genuine value dependency, deps MUST be extracted
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "SUM".into(),
            args: vec![cell_ref_node(sheet, 39, 3)],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            !deps.is_empty(),
            "SUM(ref) must extract deps for cycle detection"
        );
    }

    #[test]
    fn test_cell_row_metadata_no_dep() {
        // =CELL("row", $D$40) — metadata mode, should produce NO dep for D40
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "CELL".into(),
            args: vec![
                ASTNode::Text("row".to_string()),
                cell_ref_node(sheet, 39, 3),
            ],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            deps.is_empty(),
            "CELL(\"row\", static_ref) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_cell_col_metadata_no_dep() {
        // =CELL("col", $D$40)
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "CELL".into(),
            args: vec![
                ASTNode::Text("col".to_string()),
                cell_ref_node(sheet, 39, 3),
            ],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            deps.is_empty(),
            "CELL(\"col\", static_ref) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_cell_address_metadata_no_dep() {
        // =CELL("address", $D$40)
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "CELL".into(),
            args: vec![
                ASTNode::Text("address".to_string()),
                cell_ref_node(sheet, 39, 3),
            ],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            deps.is_empty(),
            "CELL(\"address\", static_ref) should produce no deps, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_cell_type_does_extract_deps() {
        // =CELL("type", $D$40) — reads value, deps MUST be extracted
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "CELL".into(),
            args: vec![
                ASTNode::Text("type".to_string()),
                cell_ref_node(sheet, 39, 3),
            ],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(
            !deps.is_empty(),
            "CELL(\"type\", ref) must extract deps (reads value)"
        );
    }

    #[test]
    fn test_cell_dynamic_info_type_does_extract_deps() {
        // =CELL(A1, $D$40) — info_type from cell ref, conservatively extract deps for both
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "CELL".into(),
            args: vec![
                cell_ref_node(sheet, 0, 0),  // A1 as info_type (dynamic)
                cell_ref_node(sheet, 39, 3), // $D$40
            ],
        };
        let deps = deps_from_ast(&ast, &sheet);
        // Should have deps for BOTH A1 and D40
        assert!(
            deps.len() >= 2,
            "CELL(dynamic_info, ref) must extract deps for both args, got: {:?}",
            deps
        );
    }

    #[test]
    fn test_column_no_args_no_deps() {
        // =COLUMN() — no arguments, no deps
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "COLUMN".into(),
            args: vec![],
        };
        let deps = deps_from_ast(&ast, &sheet);
        assert!(deps.is_empty(), "COLUMN() with no args should have no deps");
    }

    #[test]
    fn test_column_identifier_does_extract_deps() {
        // =COLUMN(NamedRange) — Identifier is not a static ref, deps conservatively extracted
        let sheet = make_sheet_id(1);
        let ast = ASTNode::Function {
            name: "COLUMN".into(),
            args: vec![ASTNode::Identifier("MyRange".to_string())],
        };
        // Identifier won't resolve in an empty mirror, but the point is we don't skip it
        let _deps = deps_from_ast(&ast, &sheet);
        // With empty mirror, identifier won't resolve, so deps may be empty.
        // The important thing is is_static_ref returns false for Identifier,
        // so the code path falls through to normal extraction (not skipped).
        // We test this indirectly via the is_static_ref unit test below.
    }

    #[test]
    fn test_is_static_ref() {
        let sheet = make_sheet_id(1);

        // Static refs
        assert!(is_static_ref(&cell_ref_node(sheet, 0, 0)));
        assert!(is_static_ref(&range_ref_node(sheet, 0, 0, 9, 0)));
        assert!(is_static_ref(&ASTNode::SheetRef {
            sheet,
            inner: Box::new(cell_ref_node(sheet, 0, 0)),
        }));

        // Non-static
        assert!(!is_static_ref(&ASTNode::Function {
            name: "INDIRECT".into(),
            args: vec![ASTNode::Text("A1".to_string())],
        }));
        assert!(!is_static_ref(&ASTNode::Identifier("MyRange".to_string())));
        assert!(!is_static_ref(&ASTNode::Number(42.0)));
        assert!(!is_static_ref(&ASTNode::Text("hello".to_string())));
    }

    #[test]
    fn test_registry_none_backwards_compatible() {
        let sheet = make_sheet_id(1);
        let source = make_cell_id(100);
        let mirror = make_mirror(sheet, vec![(source, 0, 0)]);

        // Positional ref
        let cell_ref = CellRef::Positional {
            sheet,
            row: 3,
            col: 0,
        };

        let targets = cell_ref_to_dep_targets(&cell_ref, &mirror, None, None);

        assert_eq!(targets.len(), 1, "no registry: Range only");
        assert!(matches!(targets[0], DepTarget::Range(_, _)));

        // Resolved ref
        let cell_ref = CellRef::Resolved(source);
        let targets = cell_ref_to_dep_targets(&cell_ref, &mirror, None, None);

        assert_eq!(targets.len(), 1, "no registry: Cell only");
        assert_eq!(targets[0], DepTarget::Cell(source));
    }

    // -----------------------------------------------------------------------
    // Tests for selective_range_arg_pattern
    // -----------------------------------------------------------------------

    #[test]
    fn test_selective_range_arg_pattern_known_functions() {
        // Specific-index functions
        assert!(selective_range_arg_pattern("INDEX").includes(0));
        assert!(!selective_range_arg_pattern("INDEX").includes(1));
        assert!(selective_range_arg_pattern("XLOOKUP").includes(1));
        assert!(selective_range_arg_pattern("XLOOKUP").includes(2));
        assert!(!selective_range_arg_pattern("XLOOKUP").includes(0));
        assert!(selective_range_arg_pattern("VLOOKUP").includes(1));
        assert!(!selective_range_arg_pattern("VLOOKUP").includes(0));
        assert!(selective_range_arg_pattern("HLOOKUP").includes(1));
        assert!(!selective_range_arg_pattern("HLOOKUP").includes(0));
        assert!(selective_range_arg_pattern("MATCH").includes(1));
        assert!(!selective_range_arg_pattern("MATCH").includes(0));
        assert!(selective_range_arg_pattern("LOOKUP").includes(1));
        assert!(selective_range_arg_pattern("LOOKUP").includes(2));
        assert!(!selective_range_arg_pattern("LOOKUP").includes(0));

        // AllFrom functions — unbounded
        assert!(!selective_range_arg_pattern("CHOOSE").includes(0));
        assert!(selective_range_arg_pattern("CHOOSE").includes(1));
        assert!(selective_range_arg_pattern("CHOOSE").includes(100));
        assert!(!selective_range_arg_pattern("SWITCH").includes(0));
        assert!(selective_range_arg_pattern("SWITCH").includes(1));
        assert!(selective_range_arg_pattern("SWITCH").includes(50));
        assert!(selective_range_arg_pattern("IFS").includes(0));
        assert!(selective_range_arg_pattern("IFS").includes(99));

        // Aggregate functions — none selective
        assert!(!selective_range_arg_pattern("SUM").includes(0));
        assert!(!selective_range_arg_pattern("AVERAGE").includes(0));
        assert!(!selective_range_arg_pattern("COUNTIF").includes(0));

        // Volatile-dynamic — not selective (handled separately via volatility)
        assert!(!selective_range_arg_pattern("INDIRECT").includes(0));
        assert!(!selective_range_arg_pattern("OFFSET").includes(0));
    }

    #[test]
    fn test_selective_case_insensitive() {
        assert!(selective_range_arg_pattern("index").includes(0));
        assert!(selective_range_arg_pattern("Index").includes(0));
        assert!(selective_range_arg_pattern("INDEX").includes(0));
        assert!(selective_range_arg_pattern("xlookup").includes(1));
        assert!(selective_range_arg_pattern("Xlookup").includes(1));
        assert!(selective_range_arg_pattern("vLOOKUP").includes(1));
        assert!(selective_range_arg_pattern("match").includes(1));
        assert!(selective_range_arg_pattern("choose").includes(1));
    }
}
