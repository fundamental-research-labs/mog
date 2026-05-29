use super::*;

use crate::formula_text::FormulaTextDepTarget;
use crate::graph::RANGE_EXPANSION_THRESHOLD;
use crate::mirror::CellMirror;
use cell_types::SheetId;
use compute_functions::helpers::VOLATILE_FUNCTIONS;
use compute_parser::{ASTNode, AstVisitor, BinOp, CellRefNode, RangeRef};
use formula_types::CellRef;

use super::formula_text::{FormulaTextCollectOutcome, FormulaTextDepCollector};
use super::policy::{
    is_ref_arg_metadata_only, is_static_ref, metadata_arg_index, selective_range_arg_pattern,
};
use super::refs::{cell_ref_to_position, push_cell_ref_dep_targets, ref_in_sheet_ctx};

// ---------------------------------------------------------------------------
// DepExtractor — AstVisitor implementation for dependency + volatility extraction
// ---------------------------------------------------------------------------

/// Visitor that collects dependency targets and detects volatile function calls
/// in a single AST walk.
pub(super) struct DepExtractor<'a> {
    pub(super) sheet_ctx: SheetId,
    pub(super) mirror: &'a CellMirror,
    pub(super) ordered_sheets: &'a [SheetId],
    pub(super) deps: Vec<DepTarget>,
    pub(super) formula_text_deps: Vec<FormulaTextDepTarget>,
    pub(super) is_volatile: bool,
    pub(super) current_row: Option<u32>,
    /// Set when visiting a selective function's range argument (e.g., INDEX arg 0).
    /// When true, `visit_range`/`visit_structured_ref`/`visit_identifier` emit
    /// `RangeAccess::Selective` instead of `Aggregate`.
    pub(super) in_selective_arg: bool,
}

impl<'a> DepExtractor<'a> {
    pub(super) fn new(
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

    fn push_cell_ref_dep(&mut self, cell_ref: &CellRef) {
        let registry = Some(&self.mirror.projection_registry);
        let effective = ref_in_sheet_ctx(cell_ref, self.sheet_ctx);
        push_cell_ref_dep_targets(&effective, self.mirror, registry, None, &mut self.deps);
    }

    fn push_range_dep(
        &mut self,
        sheet: SheetId,
        min_row: u32,
        min_col: u32,
        max_row: u32,
        max_col: u32,
        access: RangeAccess,
    ) {
        let row_count = (max_row - min_row + 1) as u64;
        let col_count = (max_col - min_col + 1) as u64;
        let cell_count = row_count * col_count;

        self.deps.push(DepTarget::Range(
            RangePos::new(sheet, min_row, min_col, max_row, max_col),
            access,
        ));

        if cell_count < RANGE_EXPANSION_THRESHOLD && access == RangeAccess::Aggregate {
            for row in min_row..=max_row {
                for col in min_col..=max_col {
                    if let Some(cell_id) =
                        self.mirror.resolve_cell_id(&sheet, SheetPos::new(row, col))
                    {
                        self.deps.push(DepTarget::Cell(cell_id));
                    } else if let Some((source, _, _)) =
                        self.mirror.projection_registry.resolve(&sheet, row, col)
                    {
                        self.deps.push(DepTarget::Cell(source));
                    }
                }
            }
        }
    }

    fn node_static_area_in_sheet(
        &self,
        node: &ASTNode,
        sheet_ctx: SheetId,
    ) -> Option<(SheetId, u32, u32, u32, u32)> {
        match node {
            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                let (sheet, row, col) = cell_ref_to_position(reference, &sheet_ctx, self.mirror)?;
                Some((sheet, row, col, row, col))
            }
            ASTNode::Range(RangeRef { start, end, .. }) => {
                let (s_sheet, s_row, s_col) = cell_ref_to_position(start, &sheet_ctx, self.mirror)?;
                let (_, e_row, e_col) = cell_ref_to_position(end, &sheet_ctx, self.mirror)?;
                Some((
                    s_sheet,
                    s_row.min(e_row),
                    s_col.min(e_col),
                    s_row.max(e_row),
                    s_col.max(e_col),
                ))
            }
            ASTNode::SheetRef { sheet, inner } => self.node_static_area_in_sheet(inner, *sheet),
            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                let sheet = self.mirror.sheet_by_name(sheet_name)?;
                self.node_static_area_in_sheet(inner, sheet)
            }
            ASTNode::Paren(inner) => self.node_static_area_in_sheet(inner, sheet_ctx),
            ASTNode::BinaryOp {
                op: BinOp::Intersect,
                left,
                right,
            } => {
                let left = self.node_static_area_in_sheet(left, sheet_ctx)?;
                let right = self.node_static_area_in_sheet(right, sheet_ctx)?;
                Self::intersect_static_areas(left, right)
            }
            ASTNode::RangeOp { start, end } => {
                let (start_sheet, start_row, start_col, _, _) =
                    self.node_static_area_in_sheet(start, sheet_ctx)?;
                let (end_sheet, _, _, end_row, end_col) =
                    self.node_static_area_in_sheet(end, sheet_ctx)?;
                if start_sheet != end_sheet {
                    return None;
                }
                Some((
                    start_sheet,
                    start_row.min(end_row),
                    start_col.min(end_col),
                    start_row.max(end_row),
                    start_col.max(end_col),
                ))
            }
            _ => None,
        }
    }

    fn node_static_area(&self, node: &ASTNode) -> Option<(SheetId, u32, u32, u32, u32)> {
        self.node_static_area_in_sheet(node, self.sheet_ctx)
    }

    fn intersect_static_areas(
        left: (SheetId, u32, u32, u32, u32),
        right: (SheetId, u32, u32, u32, u32),
    ) -> Option<(SheetId, u32, u32, u32, u32)> {
        let (left_sheet, left_start_row, left_start_col, left_end_row, left_end_col) = left;
        let (right_sheet, right_start_row, right_start_col, right_end_row, right_end_col) = right;
        if left_sheet != right_sheet {
            return None;
        }

        let start_row = left_start_row.max(right_start_row);
        let start_col = left_start_col.max(right_start_col);
        let end_row = left_end_row.min(right_end_row);
        let end_col = left_end_col.min(right_end_col);
        (start_row <= end_row && start_col <= end_col)
            .then_some((left_sheet, start_row, start_col, end_row, end_col))
    }

    fn collect_formulatext_dep(&mut self, node: &ASTNode) {
        let mut collector = FormulaTextDepCollector {
            sheet_ctx: &mut self.sheet_ctx,
            mirror: self.mirror,
            out: &mut self.formula_text_deps,
        };
        if matches!(collector.collect(node), FormulaTextCollectOutcome::Fallback) {
            self.visit(node);
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

                let access = self.current_range_access();
                self.push_range_dep(s_sheet, min_row, min_col, max_row, max_col, access);

                if (max_row - min_row + 1) as u64 * (max_col - min_col + 1) as u64
                    >= RANGE_EXPANSION_THRESHOLD
                    && access == RangeAccess::Aggregate
                {
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

    fn visit_binary_op(&mut self, op: BinOp, left: &ASTNode, right: &ASTNode) {
        if op != BinOp::Intersect {
            self.visit(left);
            self.visit(right);
            return;
        }

        match (self.node_static_area(left), self.node_static_area(right)) {
            (Some(left_area), Some(right_area)) => {
                if let Some((sheet, min_row, min_col, max_row, max_col)) =
                    Self::intersect_static_areas(left_area, right_area)
                {
                    self.push_range_dep(
                        sheet,
                        min_row,
                        min_col,
                        max_row,
                        max_col,
                        self.current_range_access(),
                    );
                }
            }
            _ => {
                self.visit(left);
                self.visit(right);
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
