//! MirrorAccess — shared structural query layer over CellMirror.
//!
//! Provides positional resolution and direct value access methods extracted
//! from MirrorContext. Composed by both MirrorContext and OverrideContext
//! to eliminate duplication of structural queries.

use crate::eval::cache::range_store::{RangeKey, materialize_range};
use crate::formula_text::{FormulaTextLookup, FormulaTextProvider};
use crate::mirror::CellMirror;
use crate::table::structured_refs::{ResolvedStructuredRef, resolve_ranges_from_table_def};
use cell_types::{CellId, SheetId, SheetPos};
use compute_parser::ParsedExpr;
use formula_types::{
    CellRef, IdentityFormulaRef, NamedRangeDef, RangeType, ResolvedName, Scope, TableDef,
};
use snapshot_types::PivotTableDef;
use std::sync::Arc;
use value_types::{CellArray, CellError, CellValue};
use value_types::{DenseBoolMask, DenseColumn};

/// Classify a named-range fallback source as either a constant value or a
/// formula expression. Returns [`ResolvedName::Error(#REF!)`] when the source
/// is empty or an orphaned `#REF!`.
///
/// Replaces the byte-level `try_parse_constant` shadow classifier
/// (typed formula boundary). Routes every user-facing input through
/// [`ParsedExpr::classify`] so non-ASCII payloads (Greek OFFSET, UTF-8 boundary
/// regression) never reach a byte-indexed slicer.
fn classify_name_fallback(raw: &str) -> ResolvedName {
    // Constants short-circuit to `ResolvedName::Constant`; everything else
    // falls through to `ResolvedName::Formula { raw_expression: raw }` —
    // identical to the old `try_parse_constant || raw-string-fall-through`
    // path. We preserve the original bytes verbatim rather than re-emitting
    // a canonical form because:
    //
    // - The evaluator reparses `raw_expression` via
    //   `compute_parser::parse_formula` with a live [`CoreResolver`]; the
    //   canonical form may drop / reorder sheet qualifiers that the resolver
    //   relies on (e.g. `Inputs!$A$1` canonicalizes to `$A$1` which loses
    //   the sheet).
    // - Byte preservation matches the pre-W3 contract; any semantic
    //   cleanup happens inside `compute_parser::parse_formula`.
    match ParsedExpr::classify(raw) {
        ParsedExpr::Constant(cv) => ResolvedName::Constant(cv),
        ParsedExpr::BrokenRef { .. } | ParsedExpr::Empty => ResolvedName::Error(CellError::Ref),
        _ => ResolvedName::Formula {
            raw_expression: raw.to_string(),
        },
    }
}

/// One-cell value override consulted by [`MirrorAccess::get_cell_value_by_ref`]
/// before reading the mirror. Used by the editor-commit data-validation path
/// where the typed value has not yet been committed to the mirror but the
/// formula constraint must see it as if it were.
#[derive(Debug, Clone)]
pub struct PendingCellOverride {
    pub sheet: SheetId,
    pub pos: SheetPos,
    pub value: CellValue,
}

/// Wraps a `&CellMirror` plus evaluation cell context. Provides all structural
/// queries (positional resolution, defined name resolution, table resolution)
/// and direct value access from the mirror.
pub struct MirrorAccess<'a> {
    pub mirror: &'a CellMirror,
    pub current_cell_id: CellId,
    pub current_sheet: SheetId,
    pub pending_override: Option<PendingCellOverride>,
    /// Workbook sheet order (tab order), used for 3-D reference evaluation.
    /// Empty means sheet order is unknown — `sheets_in_range` degrades to single-sheet.
    pub ordered_sheets: Vec<SheetId>,
    pub formula_text_provider: FormulaTextProvider<'a>,
}

impl<'a> MirrorAccess<'a> {
    pub fn new(mirror: &'a CellMirror, current_cell_id: CellId, current_sheet: SheetId) -> Self {
        Self {
            mirror,
            current_cell_id,
            current_sheet,
            pending_override: None,
            ordered_sheets: Vec::new(),
            formula_text_provider: FormulaTextProvider::mirror_identity_only_for_test_unavailable(),
        }
    }

    pub fn with_formula_text_provider(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        formula_text_provider: FormulaTextProvider<'a>,
    ) -> Self {
        Self {
            mirror,
            current_cell_id,
            current_sheet,
            pending_override: None,
            ordered_sheets: Vec::new(),
            formula_text_provider,
        }
    }

    pub fn with_sheet_order(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        ordered_sheets: Vec<SheetId>,
    ) -> Self {
        Self {
            mirror,
            current_cell_id,
            current_sheet,
            pending_override: None,
            ordered_sheets,
            formula_text_provider: FormulaTextProvider::mirror_identity_only_for_test_unavailable(),
        }
    }

    pub fn with_pending_override(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        pending_override: PendingCellOverride,
    ) -> Self {
        Self {
            mirror,
            current_cell_id,
            current_sheet,
            pending_override: Some(pending_override),
            ordered_sheets: Vec::new(),
            formula_text_provider: FormulaTextProvider::mirror_identity_only_for_test_unavailable(),
        }
    }

    // -----------------------------------------------------------------------
    // Positional resolution
    // -----------------------------------------------------------------------

    /// Resolve a CellRef to (SheetId, row, col).
    pub fn resolve_ref_to_pos(&self, cell_ref: &CellRef) -> Option<(SheetId, u32, u32)> {
        match cell_ref {
            CellRef::Resolved(id) => {
                let sheet_id = self.mirror.sheet_for_cell(id).unwrap_or(self.current_sheet);
                let sheet = self.mirror.get_sheet(&sheet_id)?;
                let pos = sheet.position_of(id)?;
                Some((sheet_id, pos.row(), pos.col()))
            }
            CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
        }
    }

    pub fn current_cell(&self) -> CellId {
        self.current_cell_id
    }

    pub fn resolve_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        let sheet_id = self
            .mirror
            .sheet_for_cell(cell_id)
            .unwrap_or(self.current_sheet);
        let sheet = self.mirror.get_sheet(&sheet_id)?;
        let pos = sheet.position_of(cell_id)?;
        Some((sheet_id, pos.row(), pos.col()))
    }

    pub fn resolve_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> Option<CellId> {
        self.mirror.resolve_cell_id(sheet, SheetPos::new(row, col))
    }

    pub fn sheet_by_name(&self, name: &str) -> Option<SheetId> {
        self.mirror.sheet_by_name(name)
    }

    pub fn sheet_count(&self) -> usize {
        self.mirror.sheet_count()
    }

    /// Return the ordered sheet IDs between `start` and `end` (inclusive) in
    /// tab order. Used by 3-D reference evaluation (`Sheet1:Sheet3!A1`).
    pub fn sheets_in_range(&self, start: &SheetId, end: &SheetId) -> Vec<SheetId> {
        if self.ordered_sheets.is_empty() {
            // No ordering available — return start only as a safe fallback.
            let _ = end;
            return vec![*start];
        }
        let start_pos = self.ordered_sheets.iter().position(|s| s == start);
        let end_pos = self.ordered_sheets.iter().position(|s| s == end);
        match (start_pos, end_pos) {
            (Some(a), Some(b)) => {
                let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
                self.ordered_sheets[lo..=hi].to_vec()
            }
            _ => {
                // One or both sheets not found in order list — return start only.
                vec![*start]
            }
        }
    }

    // -----------------------------------------------------------------------
    // Formula metadata queries
    // -----------------------------------------------------------------------

    pub fn cell_has_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        if let Some(cell_id) = self.mirror.resolve_cell_id(sheet, SheetPos::new(row, col)) {
            return self.mirror.get_formula(&cell_id).is_some();
        }
        false
    }

    pub fn formula_text_at(&self, sheet: &SheetId, row: u32, col: u32) -> FormulaTextLookup {
        self.formula_text_provider
            .lookup(self.mirror, sheet, row, col)
    }

    pub fn cell_has_dynamic_array_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        if let Some(cell_id) = self.mirror.resolve_cell_id(sheet, SheetPos::new(row, col))
            && let Some(formula) = self.mirror.get_formula(&cell_id)
        {
            return formula.is_dynamic_array;
        }
        false
    }

    pub fn cell_has_subtotal_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        if let Some(cell_id) = self.mirror.resolve_cell_id(sheet, SheetPos::new(row, col))
            && let Some(formula) = self.mirror.get_formula(&cell_id)
        {
            // Typed formula boundary: precomputed at IdentityFormula construction time
            // by the compute-parser AST visitor. Replaces the string-prefix
            // shadow parser that lived in eval::functions::subtotal.
            return formula.is_aggregate;
        }
        false
    }

    pub fn is_row_hidden(&self, sheet: &SheetId, row: u32) -> bool {
        self.mirror.is_row_hidden(sheet, row)
    }

    pub fn get_table(&self, name: &str) -> Option<&TableDef> {
        self.mirror.get_table_def(name)
    }

    pub fn find_pivot_table_at(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<&PivotTableDef> {
        self.mirror.find_pivot_table_at(sheet, row, col)
    }

    pub fn get_dense_column(&self, sheet: &SheetId, col: u32) -> Option<&DenseColumn> {
        self.mirror.dense_cache().get(sheet, col)
    }

    pub fn get_column_values(&self, sheet: &SheetId, col: u32) -> Option<&[CellValue]> {
        self.mirror.get_sheet(sheet)?.get_column_slice(col)
    }

    pub fn col_version(&self, sheet: &SheetId, col: u32) -> u64 {
        self.mirror.col_version(sheet, col)
    }

    pub fn get_dense_bool_mask(&self, sheet: &SheetId, col: u32) -> Option<&DenseBoolMask> {
        self.mirror.dense_cache().get_bool_mask(sheet, col)
    }

    // -----------------------------------------------------------------------
    // NEW: Position-only resolution methods
    // -----------------------------------------------------------------------

    /// Resolve a defined name to positional data only (no cell values).
    ///
    /// Resolves the `IdentityFormula` stored in the `NamedRangeDef` by mapping
    /// each identity ref to its current position via the mirror. If any ref
    /// cannot be resolved (e.g. deleted cell), returns `ResolvedName::Error(#REF!)`.
    pub fn resolve_defined_name(&self, name: &str) -> Option<ResolvedName> {
        // Build scope chain: current sheet first, then workbook
        let chain = [Scope::Sheet(self.current_sheet), Scope::Workbook];
        let nr = self.mirror.resolve_variable(name, &chain)?;
        self.resolve_named_range_def(nr)
    }

    /// Resolve a named range using a specific sheet's scope chain.
    /// Used when evaluating `'Sheet1'!MyName` where Sheet1 may differ from the current sheet.
    pub fn resolve_defined_name_for_sheet(
        &self,
        name: &str,
        sheet: SheetId,
    ) -> Option<ResolvedName> {
        let chain = [Scope::Sheet(sheet), Scope::Workbook];
        let nr = self.mirror.resolve_variable(name, &chain)?;
        self.resolve_named_range_def(nr)
    }

    /// Core resolution logic shared by `resolve_defined_name` and
    /// `resolve_defined_name_for_sheet`.
    fn resolve_named_range_def(&self, nr: &NamedRangeDef) -> Option<ResolvedName> {
        let formula = &nr.refers_to;

        // If no refs, dispatch on the typed [`ParsedExpr`] shape of
        // `raw_expression` (constant / formula / broken-ref / empty).
        // Replaces the byte-level `try_parse_constant` shadow classifier
        // deleted in typed formula boundary
        if formula.refs.is_empty() {
            if let Some(ref raw) = nr.raw_expression {
                return Some(classify_name_fallback(raw));
            }
            // No refs and no raw_expression — error
            return Some(ResolvedName::Error(CellError::Ref));
        }

        // Resolve based on the first (and typically only) ref.
        // If positional resolution fails (CellId not in mirror — common in
        // formula-eval where snapshot CellIds are random UUIDs), fall back to
        // raw_expression which gets parsed and evaluated as a formula.
        let positional_result = match &formula.refs[0] {
            IdentityFormulaRef::Cell(cell_ref) => {
                self.resolve_position(&cell_ref.id)
                    .map(|(resolved_sheet, row, col)| ResolvedName::Cell {
                        sheet: resolved_sheet,
                        row,
                        col,
                    })
            }
            IdentityFormulaRef::Range(range_ref) => {
                let start = self.resolve_position(&range_ref.start_id);
                let end = self.resolve_position(&range_ref.end_id);
                match (start, end) {
                    (
                        Some((start_sheet, start_row, start_col)),
                        Some((_end_sheet, end_row, end_col)),
                    ) => Some(ResolvedName::Range {
                        sheet: start_sheet,
                        start_row,
                        start_col,
                        end_row,
                        end_col,
                    }),
                    _ => None,
                }
            }
            IdentityFormulaRef::RectRange(rect_ref) => {
                let (Some((start_row_sheet, start_row)), Some((end_row_sheet, end_row))) = (
                    self.mirror.row_index_lookup(&rect_ref.start_row_id),
                    self.mirror.row_index_lookup(&rect_ref.end_row_id),
                ) else {
                    return Some(ResolvedName::Error(CellError::Ref));
                };
                let (Some((start_col_sheet, start_col)), Some((end_col_sheet, end_col))) = (
                    self.mirror.col_index_lookup(&rect_ref.start_col_id),
                    self.mirror.col_index_lookup(&rect_ref.end_col_id),
                ) else {
                    return Some(ResolvedName::Error(CellError::Ref));
                };
                if start_row_sheet == rect_ref.sheet_id
                    && end_row_sheet == rect_ref.sheet_id
                    && start_col_sheet == rect_ref.sheet_id
                    && end_col_sheet == rect_ref.sheet_id
                {
                    Some(ResolvedName::Range {
                        sheet: rect_ref.sheet_id,
                        start_row,
                        start_col,
                        end_row,
                        end_col,
                    })
                } else {
                    Some(ResolvedName::Error(CellError::Ref))
                }
            }
            IdentityFormulaRef::FullRow(row_ref) => self
                .mirror
                .row_index_lookup(&row_ref.row_id)
                .map(|(sheet, row)| {
                    let max_col = self
                        .mirror
                        .get_sheet(&sheet)
                        .map(|s| s.cols.saturating_sub(1))
                        .unwrap_or(0);
                    ResolvedName::Range {
                        sheet,
                        start_row: row,
                        start_col: 0,
                        end_row: row,
                        end_col: max_col,
                    }
                }),
            IdentityFormulaRef::RowRange(rr) => {
                let start = self.mirror.row_index_lookup(&rr.start_row_id);
                let end = self.mirror.row_index_lookup(&rr.end_row_id);
                match (start, end) {
                    (Some((sheet, start_row)), Some((_, end_row))) => {
                        let max_col = self
                            .mirror
                            .get_sheet(&sheet)
                            .map(|s| s.cols.saturating_sub(1))
                            .unwrap_or(0);
                        Some(ResolvedName::Range {
                            sheet,
                            start_row,
                            start_col: 0,
                            end_row,
                            end_col: max_col,
                        })
                    }
                    _ => None,
                }
            }
            IdentityFormulaRef::FullCol(col_ref) => self
                .mirror
                .col_index_lookup(&col_ref.col_id)
                .map(|(sheet, col)| {
                    let max_row = self
                        .mirror
                        .get_sheet(&sheet)
                        .map(|s| s.rows.saturating_sub(1))
                        .unwrap_or(0);
                    ResolvedName::Range {
                        sheet,
                        start_row: 0,
                        start_col: col,
                        end_row: max_row,
                        end_col: col,
                    }
                }),
            IdentityFormulaRef::ColRange(cr) => {
                let start = self.mirror.col_index_lookup(&cr.start_col_id);
                let end = self.mirror.col_index_lookup(&cr.end_col_id);
                match (start, end) {
                    (Some((sheet, start_col)), Some((_, end_col))) => {
                        let max_row = self
                            .mirror
                            .get_sheet(&sheet)
                            .map(|s| s.rows.saturating_sub(1))
                            .unwrap_or(0);
                        Some(ResolvedName::Range {
                            sheet,
                            start_row: 0,
                            start_col,
                            end_row: max_row,
                            end_col,
                        })
                    }
                    _ => None,
                }
            }
            IdentityFormulaRef::ExternalCell(_)
            | IdentityFormulaRef::ExternalRange(_)
            | IdentityFormulaRef::ExternalName(_) => Some(ResolvedName::Error(CellError::Ref)),
        };

        // If positional resolution succeeded, return it.
        if let Some(resolved) = positional_result {
            return Some(resolved);
        }

        // Positional resolution failed (CellIds not found in mirror — common in
        // formula-eval where snapshot CellIds are random UUIDs that don't match
        // the mirror's actual CellIds). Fall back to `raw_expression` which
        // gets classified and evaluated (as constant or reparsed formula).
        // The typed classifier replaces the byte-level `try_parse_constant`
        // deleted in typed formula boundary
        if let Some(ref raw) = nr.raw_expression {
            return Some(classify_name_fallback(raw));
        }

        // No positional resolution and no raw_expression — unresolvable
        Some(ResolvedName::Error(CellError::Ref))
    }

    /// Resolve a structured (table) reference to positional data only (no cell values).
    pub fn resolve_structured_ref(
        &self,
        ref_: &crate::table::types::StructuredRef,
    ) -> Result<ResolvedStructuredRef, CellError> {
        let table_def = self
            .mirror
            .get_table_def(&ref_.table_name)
            .ok_or(CellError::Ref)?;

        // Get current row for ThisRow specifiers
        let current_row = self
            .mirror
            .resolve_position(&self.current_cell_id)
            .map(|pos| pos.row());

        let ranges =
            resolve_ranges_from_table_def(ref_, table_def, current_row).ok_or(CellError::Ref)?;

        Ok(ResolvedStructuredRef {
            sheet: table_def.sheet,
            ranges,
        })
    }

    // -----------------------------------------------------------------------
    // Direct value access (from mirror)
    // -----------------------------------------------------------------------

    pub fn get_cell_value_by_ref(&self, cell_ref: &CellRef) -> CellValue {
        if let Some(over) = self.pending_override.as_ref()
            && let Some((sheet, row, col)) = self.resolve_ref_to_pos(cell_ref)
            && sheet == over.sheet
            && row == over.pos.row()
            && col == over.pos.col()
        {
            return over.value.clone();
        }

        match cell_ref {
            CellRef::Resolved(id) => match self.mirror.get_cell_value(id) {
                Some(v) => v.clone(),
                None => {
                    // If the CellId isn't registered in the mirror at all
                    // (its sheet was deleted), return #REF!. Otherwise it's
                    // just an empty cell -> Null.
                    if self.mirror.sheet_for_cell(id).is_none() {
                        CellValue::Error(CellError::Ref, None)
                    } else {
                        CellValue::Null
                    }
                }
            },
            CellRef::Positional { sheet, row, col } => {
                // If the target sheet no longer exists, return #REF!.
                if self.mirror.get_sheet(sheet).is_none() {
                    return CellValue::Error(CellError::Ref, None);
                }
                self.mirror
                    .get_cell_value_at(sheet, SheetPos::new(*row, *col))
                    .cloned()
                    .unwrap_or(CellValue::Null)
            }
        }
    }

    pub fn get_cell_value(&self, cell_id: &CellId) -> CellValue {
        self.mirror
            .get_cell_value(cell_id)
            .cloned()
            .unwrap_or(CellValue::Null)
    }

    pub fn get_range_values(
        &self,
        start: &CellRef,
        end: &CellRef,
        range_type: &RangeType,
    ) -> Result<Arc<CellArray>, CellError> {
        let (s_sheet, s_row, s_col) = self.resolve_ref_to_pos(start).ok_or(CellError::Ref)?;
        let (e_sheet, e_row, e_col) = self.resolve_ref_to_pos(end).ok_or(CellError::Ref)?;
        if s_sheet != e_sheet {
            return Err(CellError::Ref);
        }
        let mut min_row = s_row.min(e_row);
        let mut max_row = s_row.max(e_row);
        let mut min_col = s_col.min(e_col);
        let mut max_col = s_col.max(e_col);

        // ColumnRange ($I:$I) and RowRange (1:5) store sentinel row/col=0
        // in their CellRefs. Expand to full extent; clamping below reduces
        // to actual sheet dimensions.
        match range_type {
            RangeType::ColumnRange => {
                min_row = 0;
                max_row = u32::MAX;
            }
            RangeType::RowRange => {
                min_col = 0;
                max_col = u32::MAX;
            }
            _ => {}
        }

        // Clamp ranges that extend beyond the sheet's formula grid dimensions.
        // This handles three cases:
        //   1. ColumnRange (A:A) — syntactic full-column reference
        //   2. RowRange (1:5) — syntactic full-row reference
        //   3. CellRange (A1:A1048576) — explicit bounds that happen to span
        //      the full extent (common in XLSX normalization, named ranges,
        //      INDIRECT/OFFSET). Without clamping, these materialize 1M+ row
        //      vectors even when the sheet has only a few dozen rows.
        if let Some(sheet) = self.mirror.get_sheet(&s_sheet) {
            let formula_rows = sheet.formula_rows();
            let formula_cols = sheet.formula_cols();
            if max_row >= formula_rows {
                #[cfg(feature = "profile")]
                let pre_clamp = max_row;
                if formula_rows > 0 {
                    max_row = formula_rows - 1;
                } else {
                    // Empty sheet — return empty result immediately
                    return Ok(Arc::new(CellArray::empty()));
                }
                #[cfg(feature = "profile")]
                let _span = tracing::info_span!(
                    "range_access",
                    kind = "row_clamp",
                    result_rows = max_row - min_row + 1,
                    sheet_rows = formula_rows,
                    pre_clamp_rows = pre_clamp - min_row + 1,
                )
                .entered();
            }
            if max_col >= formula_cols {
                #[cfg(feature = "profile")]
                let pre_clamp = max_col;
                if formula_cols > 0 {
                    max_col = formula_cols - 1;
                } else {
                    return Ok(Arc::new(CellArray::empty()));
                }
                #[cfg(feature = "profile")]
                let _span = tracing::info_span!(
                    "range_access",
                    kind = "col_clamp",
                    result_cols = max_col - min_col + 1,
                    sheet_cols = formula_cols,
                    pre_clamp_cols = pre_clamp - min_col + 1,
                )
                .entered();
            }
        } else {
            // Sheet not in mirror — no data to materialize
            if max_row > 1000 || max_col > 1000 {
                return Ok(Arc::new(CellArray::empty()));
            }
        }

        #[cfg(feature = "profile")]
        let _materialize_span = tracing::info_span!(
            "range_materialize",
            rows = (max_row - min_row + 1),
            cols = (max_col - min_col + 1)
        )
        .entered();

        let key = RangeKey::new(s_sheet, min_row, min_col, max_row, max_col);
        Ok(materialize_range(&key, self.mirror, None))
    }

    /// Fetch cell values for resolved structured reference ranges from the mirror.
    ///
    /// Returns an empty Vec if the total range exceeds 10M cells to prevent OOM.
    pub fn fetch_structured_ref_values(
        &self,
        resolved: &ResolvedStructuredRef,
    ) -> Vec<Vec<CellValue>> {
        // Guard: check total cell count across all ranges to prevent OOM.
        let total_cells: u64 = resolved
            .ranges
            .iter()
            .map(|range| {
                let rows = (range.end_row as u64).saturating_sub(range.start_row as u64) + 1;
                let cols = range.columns.len() as u64;
                rows * cols
            })
            .sum();
        if total_cells > 10_000_000 {
            return Vec::new();
        }

        let mut all_rows: Vec<Vec<CellValue>> = Vec::new();
        for range in &resolved.ranges {
            let sheet = self.mirror.get_sheet(&resolved.sheet);
            for r in range.start_row..=range.end_row {
                let mut row = Vec::new();
                for &c in &range.columns {
                    let val = sheet
                        .and_then(|s| s.get_column_slice(c))
                        .and_then(|col| col.get(r as usize))
                        .cloned()
                        .unwrap_or_else(|| {
                            self.mirror
                                .get_cell_value_at(&resolved.sheet, SheetPos::new(r, c))
                                .cloned()
                                .unwrap_or(CellValue::Null)
                        });
                    row.push(val);
                }
                all_rows.push(row);
            }
        }
        all_rows
    }

    /// Fetch cell value for a resolved defined name from the mirror.
    ///
    /// Returns `CellValue::Error(CellError::Value, None)` if the range exceeds 10M cells
    /// to prevent OOM from unbounded range materialization.
    pub fn fetch_defined_name_value(&self, resolved: &ResolvedName) -> CellValue {
        match resolved {
            ResolvedName::Error(err) => CellValue::Error(*err, None),
            ResolvedName::Cell { sheet, row, col } => self
                .mirror
                .get_cell_value_at(sheet, SheetPos::new(*row, *col))
                .cloned()
                .unwrap_or(CellValue::Null),
            ResolvedName::Range {
                sheet,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                // Guard: prevent OOM from materializing enormous ranges
                // (e.g. full-column references like A:A resolving to 1M+ rows).
                let total_cells = (*end_row as u64 - *start_row as u64 + 1)
                    * (*end_col as u64 - *start_col as u64 + 1);
                if total_cells > 10_000_000 {
                    return CellValue::Error(CellError::Value, None);
                }

                let mut rows = Vec::new();
                for r in *start_row..=*end_row {
                    let mut row = Vec::new();
                    for c in *start_col..=*end_col {
                        let val = self
                            .mirror
                            .get_cell_value_at(sheet, SheetPos::new(r, c))
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        row.push(val);
                    }
                    rows.push(row);
                }
                CellValue::from_rows(rows)
            }
            ResolvedName::Constant(cv) => cv.clone(),
            ResolvedName::Formula { .. } => {
                // TODO: add recursive formula evaluation here
                CellValue::Error(CellError::Name, None)
            }
        }
    }
}

// ===========================================================================
// Tests — typed formula boundary regression coverage for the typed fallback classifier
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Typed formula boundary: `classify_name_fallback` preserves the semantics of
    /// the deleted `try_parse_constant` + formula fall-through pair.
    ///
    /// The table mirrors the constant-recognition cases that
    /// `try_parse_constant` covered byte-by-byte, now routed through
    /// `ParsedExpr::classify`.
    #[test]
    fn classify_name_fallback_constant_boolean() {
        assert!(matches!(
            classify_name_fallback("TRUE"),
            ResolvedName::Constant(CellValue::Boolean(true))
        ));
        assert!(matches!(
            classify_name_fallback("FALSE"),
            ResolvedName::Constant(CellValue::Boolean(false))
        ));
    }

    #[test]
    fn classify_name_fallback_constant_number() {
        match classify_name_fallback("42") {
            ResolvedName::Constant(CellValue::Number(n)) => assert_eq!(*n, 42.0),
            other => panic!("expected Constant(Number), got {other:?}"),
        }
    }

    #[test]
    fn classify_name_fallback_constant_text() {
        match classify_name_fallback("\"hello\"") {
            ResolvedName::Constant(v) => assert_eq!(v.as_text(), Some("hello")),
            other => panic!("expected Constant(Text), got {other:?}"),
        }
    }

    #[test]
    fn classify_name_fallback_broken_ref() {
        // Broken refs land on ResolvedName::Error(Ref) — same as the old
        // path's fallthrough (no explicit handling for #REF! existed in
        // try_parse_constant's error-token branch; it matched and returned
        // Constant(Error(Ref)), which the evaluator then bubbled up).
        assert!(matches!(
            classify_name_fallback("#REF!"),
            ResolvedName::Error(CellError::Ref)
        ));
        assert!(matches!(
            classify_name_fallback("=#REF!"),
            ResolvedName::Error(CellError::Ref)
        ));
    }

    #[test]
    fn classify_name_fallback_empty_is_error() {
        assert!(matches!(
            classify_name_fallback(""),
            ResolvedName::Error(CellError::Ref)
        ));
        assert!(matches!(
            classify_name_fallback("   "),
            ResolvedName::Error(CellError::Ref)
        ));
    }

    #[test]
    fn classify_name_fallback_formula_preserves_bytes() {
        // Snapshot-load → eval path: raw is a formula body. The classifier
        // returns Formula{raw_expression} with the source bytes preserved so
        // the evaluator can reparse. This is the load-bearing regression
        // path W3.7's design note calls out (positional-resolution fails
        // because snapshot CellIds don't match mirror CellIds).
        match classify_name_fallback("=A1+B1") {
            ResolvedName::Formula { raw_expression } => assert_eq!(raw_expression, "=A1+B1"),
            other => panic!("expected Formula, got {other:?}"),
        }
    }

    #[test]
    fn classify_name_fallback_non_ascii_does_not_panic() {
        // UTF-8 boundary Greek OFFSET class. `ParsedExpr::classify` is total over
        // UTF-8, so none of these should panic. The exact variant is
        // implementation detail — assert "no panic" only.
        let _ = classify_name_fallback("μμμμμμ");
        let _ = classify_name_fallback("=OFFSET(Πλήρης,0,0)");
        let _ = classify_name_fallback("'Πίνακας'!#REF!");
    }

    #[test]
    fn classify_name_fallback_cell_ref_preserves_bytes() {
        // Cell / Range / SqrefList shapes fall through to the Formula arm
        // with the ORIGINAL bytes preserved — load-bearing for the
        // sheet-qualified case (canonical A1 emission drops the sheet
        // qualifier, but the evaluator reparses the raw string with a
        // sheet-aware resolver). This is the regression the
        // `named_range_creates_dependency_graph_edge` integration test
        // locks in: =InputVal where InputVal stores raw "Inputs!$A$1"
        // must not lose the sheet prefix on the fallback path.
        match classify_name_fallback("Inputs!$A$1") {
            ResolvedName::Formula { raw_expression } => {
                assert_eq!(raw_expression, "Inputs!$A$1")
            }
            other => panic!("expected Formula re-emission, got {other:?}"),
        }
        match classify_name_fallback("$A$1") {
            ResolvedName::Formula { raw_expression } => assert_eq!(raw_expression, "$A$1"),
            other => panic!("expected Formula re-emission, got {other:?}"),
        }
    }
}
