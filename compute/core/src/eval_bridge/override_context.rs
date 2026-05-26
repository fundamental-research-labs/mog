//! OverrideContext — EvaluationContext wrapper with cell value override map.
//!
//! Composes MirrorAccess with an override map. Value access methods check
//! overrides first, falling through to the mirror. Structural/positional
//! queries delegate directly to MirrorAccess.

use std::cell::RefCell;

use rustc_hash::{FxHashMap, FxHashSet};

use super::mirror_access::MirrorAccess;
use super::mirror_context::root_ast_produces_dynamic_array;
use crate::eval::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::sync_block_on;
use crate::formula_text::{FormulaTextLookup, FormulaTextProvider};
use crate::mirror::CellMirror;
use crate::scheduler::AstEntry;
use crate::table::structured_refs::ResolvedStructuredRef;
use cell_types::{CellId, SheetId, SheetPos};
use formula_types::{CellRef, RangeType, ResolvedName};
use snapshot_types::PivotTableDef;
use value_types::{CellArray, CellError, CellValue};
use value_types::{DenseBoolMask, DenseColumn};

/// Wraps a `&CellMirror` and an override map. When a cell value is requested,
/// the override map is checked first; if the cell is not overridden, the mirror
/// is consulted. Used by What-If analysis tools (Goal Seek, Data Tables).
pub struct OverrideContext<'a> {
    pub access: MirrorAccess<'a>,
    pub overrides: &'a FxHashMap<CellId, CellValue>,
    pub ast_cache: &'a FxHashMap<CellId, AstEntry>,
    pub eval_cache: &'a RefCell<FxHashMap<CellId, CellValue>>,
    pub evaluating: &'a RefCell<FxHashSet<CellId>>,
}

impl<'a> OverrideContext<'a> {
    pub fn new(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        overrides: &'a FxHashMap<CellId, CellValue>,
        ast_cache: &'a FxHashMap<CellId, AstEntry>,
        eval_cache: &'a RefCell<FxHashMap<CellId, CellValue>>,
        evaluating: &'a RefCell<FxHashSet<CellId>>,
    ) -> Self {
        Self {
            access: MirrorAccess::new(mirror, current_cell_id, current_sheet),
            overrides,
            ast_cache,
            eval_cache,
            evaluating,
        }
    }

    pub fn with_formula_text_provider(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        overrides: &'a FxHashMap<CellId, CellValue>,
        ast_cache: &'a FxHashMap<CellId, AstEntry>,
        eval_cache: &'a RefCell<FxHashMap<CellId, CellValue>>,
        evaluating: &'a RefCell<FxHashSet<CellId>>,
        formula_text_provider: FormulaTextProvider<'a>,
    ) -> Self {
        Self {
            access: MirrorAccess::with_formula_text_provider(
                mirror,
                current_cell_id,
                current_sheet,
                formula_text_provider,
            ),
            overrides,
            ast_cache,
            eval_cache,
            evaluating,
        }
    }

    /// Resolve a cell's value, recursively evaluating formulas with current overrides.
    /// 1. Check overrides map
    /// 2. Check eval_cache (already computed this probe)
    /// 3. If cell has an AST in ast_cache, recursively evaluate it
    /// 4. Fall through to mirror cached value
    fn resolve_cell_value(&self, cell_id: &CellId) -> CellValue {
        // 1. Direct override
        if let Some(val) = self.overrides.get(cell_id) {
            return val.clone();
        }

        // 2. Already evaluated this probe
        if let Some(val) = self.eval_cache.borrow().get(cell_id).cloned() {
            return val;
        }

        // 3. Cell has a formula — recursively evaluate with current overrides
        if let Some(entry) = self.ast_cache.get(cell_id) {
            // Cycle detection
            if self.evaluating.borrow().contains(cell_id) {
                return CellValue::Error(CellError::Calc, None);
            }

            self.evaluating.borrow_mut().insert(*cell_id);

            // All RefCell borrows are dropped before this sync_block_on call
            let result = match sync_block_on(Evaluator::evaluate(&entry.ast, self, self)) {
                Ok(val) => val,
                Err(_) => CellValue::Error(CellError::Calc, None),
            };

            self.evaluating.borrow_mut().remove(cell_id);
            self.eval_cache
                .borrow_mut()
                .insert(*cell_id, result.clone());

            return result;
        }

        // 4. Fall through to mirror
        self.access
            .mirror
            .get_cell_value(cell_id)
            .cloned()
            .unwrap_or(CellValue::Null)
    }
}

impl<'a> EvalDataAccess for OverrideContext<'a> {
    async fn get_cell_value_by_ref(&self, cell_ref: &CellRef) -> CellValue {
        match cell_ref {
            CellRef::Resolved(id) => self.resolve_cell_value(id),
            CellRef::Positional { sheet, row, col } => {
                if let Some(cell_id) = self
                    .access
                    .mirror
                    .resolve_cell_id(sheet, SheetPos::new(*row, *col))
                {
                    self.resolve_cell_value(&cell_id)
                } else {
                    CellValue::Null
                }
            }
        }
    }

    async fn get_cell_value(&self, cell_id: &CellId) -> CellValue {
        self.resolve_cell_value(cell_id)
    }

    async fn get_range_values(
        &self,
        start: &CellRef,
        end: &CellRef,
        range_type: &RangeType,
    ) -> Result<std::sync::Arc<CellArray>, CellError> {
        let (s_sheet, s_row, s_col) = self
            .access
            .resolve_ref_to_pos(start)
            .ok_or(CellError::Ref)?;
        let (e_sheet, e_row, e_col) = self.access.resolve_ref_to_pos(end).ok_or(CellError::Ref)?;
        if s_sheet != e_sheet {
            return Err(CellError::Ref);
        }
        let mut min_row = s_row.min(e_row);
        let mut max_row = s_row.max(e_row);
        let mut min_col = s_col.min(e_col);
        let mut max_col = s_col.max(e_col);

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

        if let Some(sheet) = self.access.mirror.get_sheet(&s_sheet) {
            let formula_rows = sheet.formula_rows();
            let formula_cols = sheet.formula_cols();
            if max_row >= formula_rows {
                if formula_rows > 0 {
                    max_row = formula_rows - 1;
                } else {
                    return Ok(std::sync::Arc::new(CellArray::empty()));
                }
            }
            if max_col >= formula_cols {
                if formula_cols > 0 {
                    max_col = formula_cols - 1;
                } else {
                    return Ok(std::sync::Arc::new(CellArray::empty()));
                }
            }
        } else if max_row > 1000 || max_col > 1000 {
            return Ok(std::sync::Arc::new(CellArray::empty()));
        }

        let rows = (max_row - min_row + 1) as usize;
        let cols = (max_col - min_col + 1) as usize;
        let mut values = Vec::with_capacity(rows * cols);

        for r in min_row..=max_row {
            for c in min_col..=max_col {
                let val = if let Some(cell_id) = self
                    .access
                    .mirror
                    .resolve_cell_id(&s_sheet, SheetPos::new(r, c))
                {
                    self.resolve_cell_value(&cell_id)
                } else {
                    CellValue::Null
                };
                values.push(val);
            }
        }

        Ok(std::sync::Arc::new(CellArray::new(values, cols)))
    }
}

impl<'a> EvalMetadata for OverrideContext<'a> {
    fn current_cell(&self) -> CellId {
        self.access.current_cell()
    }

    fn resolve_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        self.access.resolve_position(cell_id)
    }

    fn resolve_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> Option<CellId> {
        self.access.resolve_cell_id(sheet, row, col)
    }

    fn resolve_defined_name(&self, name: &str) -> Option<ResolvedName> {
        self.access.resolve_defined_name(name)
    }

    fn resolve_defined_name_for_sheet(&self, name: &str, sheet: SheetId) -> Option<ResolvedName> {
        self.access.resolve_defined_name_for_sheet(name, sheet)
    }

    fn resolve_structured_ref(
        &self,
        ref_: &crate::table::types::StructuredRef,
    ) -> Result<ResolvedStructuredRef, CellError> {
        self.access.resolve_structured_ref(ref_)
    }

    fn sheet_by_name(&self, name: &str) -> Option<SheetId> {
        self.access.sheet_by_name(name)
    }

    fn sheet_count(&self) -> usize {
        self.access.sheet_count()
    }

    fn get_dense_column(&self, sheet: &SheetId, col: u32) -> Option<&DenseColumn> {
        self.access.get_dense_column(sheet, col)
    }

    fn cell_has_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        self.access.cell_has_formula(sheet, row, col)
    }

    fn formula_text_at(&self, sheet: &SheetId, row: u32, col: u32) -> FormulaTextLookup {
        self.access.formula_text_at(sheet, row, col)
    }

    fn cell_has_dynamic_array_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        if let Some(cell_id) = self.access.resolve_cell_id(sheet, row, col)
            && let Some(entry) = self.ast_cache.get(&cell_id)
        {
            return root_ast_produces_dynamic_array(&entry.ast);
        }

        self.access.cell_has_dynamic_array_formula(sheet, row, col)
    }

    fn cell_has_subtotal_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        self.access.cell_has_subtotal_formula(sheet, row, col)
    }

    fn is_row_hidden(&self, sheet: &SheetId, row: u32) -> bool {
        self.access.is_row_hidden(sheet, row)
    }

    fn get_table(&self, name: &str) -> Option<&formula_types::TableDef> {
        self.access.get_table(name)
    }

    fn find_pivot_table_at(&self, sheet: &SheetId, row: u32, col: u32) -> Option<&PivotTableDef> {
        self.access.find_pivot_table_at(sheet, row, col)
    }

    fn get_dense_bool_mask(&self, sheet: &SheetId, col: u32) -> Option<&DenseBoolMask> {
        self.access.get_dense_bool_mask(sheet, col)
    }

    fn col_version(&self, sheet: &SheetId, col: u32) -> u64 {
        self.access.col_version(sheet, col)
    }
}
