//! MirrorContext — concrete EvaluationContext backed by CellMirror.
//!
//! Delegates all operations to the composed MirrorAccess struct.

use super::mirror_access::{MirrorAccess, PendingCellOverride};
use crate::eval::cache::range_store::RangeStore;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::formula_text::{FormulaTextLookup, FormulaTextProvider};
use crate::mirror::CellMirror;
use crate::scheduler::AstEntry;
use crate::table::structured_refs::ResolvedStructuredRef;
use cell_types::{CellId, SheetId};
use compute_functions::helpers::sumifs_result_cache::SumifsCacheEpoch;
use compute_parser::ASTNode;
use formula_types::{CellRef, RangeType, ResolvedName};
use rustc_hash::FxHashMap;
use snapshot_types::PivotTableDef;
use std::sync::Arc;
use value_types::{CellArray, CellError, CellValue};
use value_types::{DenseBoolMask, DenseColumn};

#[cfg(feature = "native")]
use crate::eval::context::traits::IndexedLookupResult;
#[cfg(feature = "native")]
use crate::eval::lookup::index_cache::LookupIndexCache;

/// Wraps a `&CellMirror` and implements `EvaluationContext` (via split traits).
pub struct MirrorContext<'a> {
    pub access: MirrorAccess<'a>,
    /// Optional shared lookup index cache for O(1) XLOOKUP/VLOOKUP/MATCH.
    /// When `None`, indexed lookups return `NotAvailable` and the evaluator
    /// falls back to the row-by-row materialization path.
    #[cfg(feature = "native")]
    pub lookup_cache: Option<&'a LookupIndexCache>,
    /// Optional shared range store for pre-materialized range data.
    /// When Some, get_range_values delegates to the store instead of
    /// materializing fresh from the mirror.
    pub range_store: Option<&'a RangeStore>,
    /// Optional formula AST cache, used for metadata queries that need the
    /// formula's root shape rather than only persisted identity flags.
    pub ast_cache: Option<&'a FxHashMap<CellId, AstEntry>>,
    /// Optional shared workbook cache for bitmask/frequency caching.
    #[cfg(feature = "native")]
    pub workbook_cache: Option<&'a crate::eval::cache::workbook_cache::WorkbookCache>,
    /// Current scheduler-owned SUMIFS cache epoch.
    pub sumifs_cache_epoch: Option<SumifsCacheEpoch>,
}

impl<'a> MirrorContext<'a> {
    pub fn new(mirror: &'a CellMirror, current_cell_id: CellId, current_sheet: SheetId) -> Self {
        Self {
            access: MirrorAccess::new(mirror, current_cell_id, current_sheet),
            #[cfg(feature = "native")]
            lookup_cache: None,
            range_store: None,
            ast_cache: None,
            #[cfg(feature = "native")]
            workbook_cache: None,
            sumifs_cache_epoch: None,
        }
    }

    pub fn with_formula_text_provider(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        formula_text_provider: FormulaTextProvider<'a>,
    ) -> Self {
        Self {
            access: MirrorAccess::with_formula_text_provider(
                mirror,
                current_cell_id,
                current_sheet,
                formula_text_provider,
            ),
            #[cfg(feature = "native")]
            lookup_cache: None,
            range_store: None,
            ast_cache: None,
            #[cfg(feature = "native")]
            workbook_cache: None,
            sumifs_cache_epoch: None,
        }
    }

    /// Create a context with an ordered sheet list for 3-D reference evaluation.
    pub fn with_sheet_order(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        ordered_sheets: Vec<SheetId>,
    ) -> Self {
        Self {
            access: MirrorAccess::with_sheet_order(
                mirror,
                current_cell_id,
                current_sheet,
                ordered_sheets,
            ),
            #[cfg(feature = "native")]
            lookup_cache: None,
            range_store: None,
            ast_cache: None,
            #[cfg(feature = "native")]
            workbook_cache: None,
            sumifs_cache_epoch: None,
        }
    }

    /// Build a context with a one-cell value override. Used by the editor-commit
    /// data-validation path so that custom-formula constraints see the typed
    /// value at its target position before it has been committed to the mirror.
    pub fn with_pending_override(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        pending_override: PendingCellOverride,
    ) -> Self {
        Self {
            access: MirrorAccess::with_pending_override(
                mirror,
                current_cell_id,
                current_sheet,
                pending_override,
            ),
            #[cfg(feature = "native")]
            lookup_cache: None,
            range_store: None,
            ast_cache: None,
            #[cfg(feature = "native")]
            workbook_cache: None,
            sumifs_cache_epoch: None,
        }
    }

    /// Create a context with a shared lookup index cache for indexed lookups.
    #[cfg(feature = "native")]
    pub fn with_lookup_cache(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        cache: &'a LookupIndexCache,
    ) -> Self {
        Self {
            access: MirrorAccess::new(mirror, current_cell_id, current_sheet),
            lookup_cache: Some(cache),
            range_store: None,
            ast_cache: None,
            workbook_cache: None,
            sumifs_cache_epoch: None,
        }
    }

    /// Create a context with a shared RangeStore for pre-materialized range data.
    /// Also uses the RangeStore's lookup cache for indexed lookups.
    #[cfg(feature = "native")]
    pub fn with_range_store(
        mirror: &'a CellMirror,
        current_cell_id: CellId,
        current_sheet: SheetId,
        range_store: &'a RangeStore,
    ) -> Self {
        Self {
            access: MirrorAccess::new(mirror, current_cell_id, current_sheet),
            lookup_cache: Some(range_store.lookup_cache()),
            range_store: Some(range_store),
            ast_cache: None,
            workbook_cache: None,
            sumifs_cache_epoch: None,
        }
    }

    pub fn with_sumifs_cache_epoch(mut self, epoch: Option<SumifsCacheEpoch>) -> Self {
        self.sumifs_cache_epoch = epoch;
        self
    }
}

const ROOT_DYNAMIC_ARRAY_FUNCTIONS: &[&str] = &[
    "SEQUENCE",
    "SORT",
    "SORTBY",
    "FILTER",
    "UNIQUE",
    "RANDARRAY",
    "MAP",
    "MAKEARRAY",
    "BYROW",
    "BYCOL",
    "SCAN",
    "ANCHORARRAY",
];

pub(super) fn root_ast_produces_dynamic_array(ast: &ASTNode) -> bool {
    match ast {
        ASTNode::Range(_) | ASTNode::Array { .. } => true,
        ASTNode::SheetRef { inner, .. }
        | ASTNode::UnresolvedSheetRef { inner, .. }
        | ASTNode::Paren(inner) => root_ast_produces_dynamic_array(inner),
        ASTNode::Function { name, .. } => {
            ROOT_DYNAMIC_ARRAY_FUNCTIONS.contains(&name.to_uppercase().as_str())
        }
        ASTNode::BinaryOp { left, right, .. } => {
            root_ast_produces_dynamic_array(left) || root_ast_produces_dynamic_array(right)
        }
        ASTNode::UnaryOp { op, operand } => {
            !matches!(op, compute_parser::UnaryOp::ImplicitIntersection)
                && root_ast_produces_dynamic_array(operand)
        }
        _ => false,
    }
}

impl<'a> EvalDataAccess for MirrorContext<'a> {
    async fn get_cell_value_by_ref(&self, cell_ref: &CellRef) -> CellValue {
        self.access.get_cell_value_by_ref(cell_ref)
    }

    async fn get_cell_value(&self, cell_id: &CellId) -> CellValue {
        self.access.get_cell_value(cell_id)
    }

    async fn get_source_array(&self, cell_id: &CellId) -> Option<CellValue> {
        let mirror = self.access.mirror;

        // Only projection sources support ANCHORARRAY (#)
        if !mirror.projection_registry.is_source(cell_id) {
            return None;
        }

        // Source cells store CellValue::Array directly — read the raw value.
        mirror.get_cell_value_raw(cell_id).cloned()
    }

    async fn get_range_values(
        &self,
        start: &CellRef,
        end: &CellRef,
        range_type: &RangeType,
    ) -> Result<std::sync::Arc<CellArray>, CellError> {
        // If we have a range store, resolve refs to a RangeKey and delegate
        if let Some(store) = self.range_store {
            use crate::eval::cache::range_store::RangeKey;

            let (s_sheet, s_row, s_col) = self
                .access
                .resolve_ref_to_pos(start)
                .ok_or(CellError::Ref)?;
            let (e_sheet, e_row, e_col) =
                self.access.resolve_ref_to_pos(end).ok_or(CellError::Ref)?;
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

            // Clamp to the formula grid, not the materialized content extent.
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

            let key = RangeKey::new(s_sheet, min_row, min_col, max_row, max_col);
            return Ok(store.get_or_materialize(key, self.access.mirror));
        }

        // Fallback: delegate directly to mirror access (original behavior)
        self.access.get_range_values(start, end, range_type)
    }
}

impl<'a> EvalMetadata for MirrorContext<'a> {
    fn current_cell(&self) -> CellId {
        self.access.current_cell()
    }

    fn current_sheet(&self) -> SheetId {
        self.access.current_sheet
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

    fn sheets_in_range(&self, start: &SheetId, end: &SheetId) -> Vec<SheetId> {
        self.access.sheets_in_range(start, end)
    }

    fn get_dense_column(&self, sheet: &SheetId, col: u32) -> Option<&DenseColumn> {
        self.access.get_dense_column(sheet, col)
    }

    fn get_column_values(&self, sheet: &SheetId, col: u32) -> Option<&[CellValue]> {
        self.access.get_column_values(sheet, col)
    }

    fn get_dense_bool_mask(&self, sheet: &SheetId, col: u32) -> Option<&DenseBoolMask> {
        self.access.get_dense_bool_mask(sheet, col)
    }

    fn col_version(&self, sheet: &SheetId, col: u32) -> u64 {
        self.access.col_version(sheet, col)
    }

    fn sumifs_cache_epoch(&self) -> Option<SumifsCacheEpoch> {
        self.sumifs_cache_epoch
    }

    fn cell_has_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        self.access.cell_has_formula(sheet, row, col)
    }

    fn formula_text_at(&self, sheet: &SheetId, row: u32, col: u32) -> FormulaTextLookup {
        self.access.formula_text_at(sheet, row, col)
    }

    fn cell_has_dynamic_array_formula(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        if let Some(ast_cache) = self.ast_cache
            && let Some(cell_id) = self
                .access
                .mirror
                .resolve_cell_id(sheet, cell_types::SheetPos::new(row, col))
            && let Some(entry) = ast_cache.get(&cell_id)
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

    #[cfg(feature = "native")]
    fn indexed_column_search(
        &self,
        sheet: &SheetId,
        col: u32,
        target: &CellValue,
        match_mode: i32,
    ) -> IndexedLookupResult {
        let cache = match self.lookup_cache {
            Some(c) => c,
            None => return IndexedLookupResult::NotAvailable,
        };

        let col_values = match self.access.get_column_values(sheet, col) {
            Some(v) => v,
            None => return IndexedLookupResult::NotAvailable,
        };

        let index_ref = cache.get_or_build_from_col_data(*sheet, col, col_values);

        let result = match (match_mode, target) {
            (0, CellValue::Number(n)) => index_ref.search_exact_numeric(n.get()),
            (0, CellValue::Text(s)) => index_ref.search_exact_text(s),
            (1, CellValue::Number(n)) => index_ref.search_leq_numeric(n.get()),
            (1, CellValue::Text(s)) => index_ref.search_leq_text(s),
            (-1, CellValue::Number(n)) => index_ref.search_geq_numeric(n.get()),
            (-1, CellValue::Text(s)) => index_ref.search_geq_text(s),
            _ => return IndexedLookupResult::NotAvailable,
        };

        #[cfg(feature = "journal")]
        {
            let hit = result.is_some();
            let target_str = crate::journal::journal_fmt_value(target);
            crate::journal::record(crate::journal::JournalEvent::CacheAccess {
                cell: Some(self.access.current_cell()),
                tier: "lookup_index",
                key_summary: format!("col={} target={} mode={}", col, target_str, match_mode),
                hit,
            });
        }

        match result {
            Some(row) => IndexedLookupResult::Found(row),
            None => IndexedLookupResult::NotFound,
        }
    }

    #[cfg(feature = "native")]
    fn indexed_column_wildcard_search(
        &self,
        sheet: &SheetId,
        col: u32,
        pattern: &str,
    ) -> IndexedLookupResult {
        let cache = match self.lookup_cache {
            Some(c) => c,
            None => return IndexedLookupResult::NotAvailable,
        };

        let col_values = match self.access.get_column_values(sheet, col) {
            Some(v) => v,
            None => return IndexedLookupResult::NotAvailable,
        };

        let index_ref = cache.get_or_build_from_col_data(*sheet, col, col_values);

        let search_result = index_ref.search_wildcard(pattern);

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::CacheAccess {
                cell: Some(self.access.current_cell()),
                tier: "lookup_index_wildcard",
                key_summary: format!("col={} pattern={}", col, pattern),
                hit: search_result.is_some(),
            });
        }

        match search_result {
            Some(row) => IndexedLookupResult::Found(row),
            None => IndexedLookupResult::NotFound,
        }
    }

    fn get_or_build_sorted_for_range(
        &self,
        sheet: &SheetId,
        col: u32,
        row_start: u32,
        row_end: u32,
        values: &[CellValue],
    ) -> Option<Arc<Vec<f64>>> {
        #[cfg(feature = "native")]
        {
            let cache = self.workbook_cache?;
            let key = (*sheet, col, row_start, row_end);
            cache.get_or_build_sorted(key, self.access.mirror, sheet, col, values)
        }
        #[cfg(not(feature = "native"))]
        {
            let _ = (sheet, col, row_start, row_end, values);
            None
        }
    }

    fn get_criteria_bitmask(
        &self,
        sheet: &SheetId,
        col: u32,
        row_start: u32,
        row_end: u32,
        criteria: &CellValue,
        _col_values: &[CellValue],
    ) -> Option<compute_functions::helpers::column_bitset::ColumnBitset> {
        #[cfg(feature = "native")]
        {
            let cache = self.workbook_cache?;

            // Hash the criteria for the cache key using NormalizedKey (same as frequency cache)
            use std::hash::{Hash, Hasher};
            let normalized =
                compute_functions::helpers::frequency_cache::NormalizedKey::from_cell_value(
                    criteria,
                );
            let mut hasher = rustc_hash::FxHasher::default();
            normalized.hash(&mut hasher);
            let criteria_hash = hasher.finish();

            let key = (*sheet, col, row_start, row_end, criteria_hash);

            // Hit-only: check cache but don't build on miss.
            // Building on miss is pathological for dynamic criteria (e.g., ">="&$CY109)
            // where each cell has a unique criteria value — every miss allocates a
            // full column clone via to_vec() that's used once then evicted, causing OOM.
            // The row-scan fallback in borrowed_multi_criteria handles misses efficiently.
            // Bitmasks will be pre-populated by the agg prepass for shared criteria patterns.
            cache.try_get_bitmask(&key, self.access.mirror, criteria)
        }
        #[cfg(not(feature = "native"))]
        {
            let _ = (sheet, col, row_start, row_end, criteria, _col_values);
            None
        }
    }

    fn get_or_build_criteria_bitmask(
        &self,
        sheet: &SheetId,
        col: u32,
        row_start: u32,
        row_end: u32,
        criteria: &CellValue,
        col_values: &[CellValue],
    ) -> Option<compute_functions::helpers::column_bitset::ColumnBitset> {
        #[cfg(feature = "native")]
        {
            let cache = self.workbook_cache?;

            use std::hash::{Hash, Hasher};
            let normalized =
                compute_functions::helpers::frequency_cache::NormalizedKey::from_cell_value(
                    criteria,
                );
            let mut hasher = rustc_hash::FxHasher::default();
            normalized.hash(&mut hasher);
            let criteria_hash = hasher.finish();

            let key = (*sheet, col, row_start, row_end, criteria_hash);

            // Build-on-miss: safe for exact-match criteria where key space is bounded.
            // The caller must verify is_exact_match_criteria() before calling this.
            let start = row_start as usize;
            let end = (row_end as usize).saturating_add(1).min(col_values.len());
            let entry = cache.get_or_build_bitmask(
                key,
                self.access.mirror,
                sheet,
                col,
                col,
                criteria,
                || {
                    if start < end {
                        col_values[start..end].to_vec()
                    } else {
                        Vec::new()
                    }
                },
            );
            Some(entry.value.bitmask.clone())
        }
        #[cfg(not(feature = "native"))]
        {
            let _ = (sheet, col, row_start, row_end, criteria, col_values);
            None
        }
    }
}
