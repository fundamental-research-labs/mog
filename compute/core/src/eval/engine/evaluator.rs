//! Evaluator struct — recursive AST evaluator with safety limits and variable scoping.

use rustc_hash::FxHashMap;

use super::super::{MAX_DEPTH, MAX_OPERATIONS, MAX_SCOPE_DEPTH};
use crate::eval::cache::lambda_cache::LambdaExprCache;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};

use super::operators::{eval_binary_op, eval_unary_op};
use crate::eval::cache::subexpr_cache;

use crate::eval::eval_value::EvalValue;
use crate::table::structured_refs::ResolvedStructuredRef;
use cell_types::{SheetId, col_to_letter};
use compute_parser::ASTNode;
use compute_parser::{AstFold, CellRefNode, RangeRef};
use formula_types::{CellRef, RangeType, ResolvedName};
use value_types::{CellError, CellValue, ComputeError};

pub(in crate::eval) type RefArea = (SheetId, u32, u32, u32, u32);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert a CellRef to its A1-style text representation (e.g., column 19, row 0 → "T1").
///
/// Used to match CellRef nodes against LET/LAMBDA variable names: the parser
/// produces CellRef(T1) for `t1` inside `=LET(t1, 5, t1+1)`, and the evaluator
/// needs to recognize that CellRef(T1) corresponds to the variable name "T1".
pub(in crate::eval) fn cell_ref_to_a1(reference: &CellRef) -> String {
    match reference {
        CellRef::Positional { col, row, .. } => {
            format!("{}{}", col_to_letter(*col), row + 1)
        }
        CellRef::Resolved(cell_id) => {
            // For resolved refs, use the cell ID string as fallback.
            // In practice, LET variables use Positional refs (no resolver in standalone eval).
            format!("__resolved_{}", cell_id)
        }
    }
}

// ---------------------------------------------------------------------------
// EvalRefResolver — adapter for CellRefResolver at eval time
// ---------------------------------------------------------------------------

/// Adapter that implements `CellRefResolver` by delegating to `EvalMetadata`.
/// Used when parsing named-range `raw_expression` formulas at eval time so that
/// sheet-qualified references (e.g. `Sheet2!A1`) are resolved instead of
/// producing `ASTNode::UnresolvedSheetRef`.
struct EvalRefResolver<'a, M: EvalMetadata> {
    meta: &'a M,
}

impl<M: EvalMetadata> compute_parser::CellRefResolver for EvalRefResolver<'_, M> {
    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.meta.sheet_by_name(name)
    }

    fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef {
        // In formula-eval context we use positional refs (no real CellIds available).
        CellRef::Positional {
            sheet: *sheet,
            row,
            col,
        }
    }

    fn current_sheet(&self) -> SheetId {
        let cell_id = self.meta.current_cell();
        self.meta
            .resolve_position(&cell_id)
            .map(|(sheet, _, _)| sheet)
            .unwrap_or_else(|| SheetId::from_raw(0))
    }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/// Recursive AST evaluator with safety limits and variable scoping.
pub struct Evaluator<'a, D: EvalDataAccess, M: EvalMetadata> {
    pub(in crate::eval) data: &'a D,
    pub(in crate::eval) meta: &'a M,
    pub(in crate::eval) operations: u32,
    pub(in crate::eval) depth: u32,
    /// Variable scope stack for LET/LAMBDA bindings.
    /// Each frame is a map of variable names to their values.
    /// Scopes are searched top-to-bottom (innermost first).
    pub(in crate::eval) scope_stack: Vec<FxHashMap<String, EvalValue>>,
    /// Lambda expression cache -- active during BYROW/MAP/BYCOL/SCAN/REDUCE
    /// iteration loops to cache constant sub-expression results.
    pub(in crate::eval) lambda_expr_cache: Option<LambdaExprCache>,
    /// Optional per-formula deadline. When set, `tick()` checks wall-clock
    /// time every `DEADLINE_CHECK_INTERVAL` operations. If the deadline is
    /// exceeded, evaluation aborts with `ComputeError::OperationLimit`.
    /// Uses WasmSafeInstant which works on both native and WASM targets.
    pub deadline: Option<crate::time_compat::WasmSafeInstant>,
}

// ---------------------------------------------------------------------------
// ScopeGuard — RAII scope cleanup for the evaluator's scope stack
// ---------------------------------------------------------------------------
//
// NOTE: An ideal RAII guard would hold `&mut Vec<FxHashMap<String, EvalValue>>`
// and auto-pop scopes on Drop. However, this conflicts with the borrow checker:
// the guard would mutably borrow `self.scope_stack` while `eval_node` also needs
// `&mut self`. Until the evaluator is restructured to separate the scope stack
// from the evaluator methods (e.g. by passing it as a parameter), we use a
// manual count-based push/pop pattern instead, where `captured_count` tracks the
// exact number of pushed scopes to ensure symmetric cleanup.

/// Check deadline every 1024 operations (~100ns amortised cost).
const DEADLINE_CHECK_INTERVAL: u32 = 1024;

// ---------------------------------------------------------------------------
// SheetPatcher — AstFold that patches SheetId(0) placeholders
// ---------------------------------------------------------------------------

/// Replace the sheet in a `CellRef` with the given `sheet_id`.
struct SheetPatcher {
    sheet_id: SheetId,
}

impl SheetPatcher {
    fn patch_cell_ref(cell_ref: &CellRef, sheet_id: SheetId) -> CellRef {
        match cell_ref {
            CellRef::Positional { row, col, .. } => CellRef::Positional {
                sheet: sheet_id,
                row: *row,
                col: *col,
            },
            // Resolved refs already have a correct CellId; leave unchanged.
            CellRef::Resolved(id) => CellRef::Resolved(*id),
        }
    }
}

impl AstFold for SheetPatcher {
    fn fold_cell_ref(&mut self, r: CellRefNode) -> ASTNode {
        ASTNode::CellReference(CellRefNode {
            reference: Self::patch_cell_ref(&r.reference, self.sheet_id),
            ..r
        })
    }

    fn fold_range(&mut self, r: RangeRef) -> ASTNode {
        ASTNode::Range(RangeRef {
            start: Self::patch_cell_ref(&r.start, self.sheet_id),
            end: Self::patch_cell_ref(&r.end, self.sheet_id),
            ..r
        })
    }
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    /// Top-level entry point.
    pub async fn evaluate(
        node: &ASTNode,
        data: &'a D,
        meta: &'a M,
    ) -> Result<CellValue, ComputeError> {
        let mut eval = Evaluator {
            data,
            meta,
            operations: 0,
            depth: 0,
            scope_stack: Vec::new(),
            lambda_expr_cache: None,
            deadline: None,
        };
        eval.eval_node(node).await.map(|ev| ev.into_cell_value())
    }

    /// Top-level entry point with a per-formula deadline.
    pub async fn evaluate_with_deadline(
        node: &ASTNode,
        data: &'a D,
        meta: &'a M,
        deadline: crate::time_compat::WasmSafeInstant,
    ) -> Result<CellValue, ComputeError> {
        let mut eval = Evaluator {
            data,
            meta,
            operations: 0,
            depth: 0,
            scope_stack: Vec::new(),
            lambda_expr_cache: None,
            deadline: Some(deadline),
        };
        eval.eval_node(node).await.map(|ev| ev.into_cell_value())
    }

    // -----------------------------------------------------------------------
    // Scope management for LET/LAMBDA
    // -----------------------------------------------------------------------
    //
    // Manual push/pop with count-based tracking. Each call site that pushes
    // N scopes must pop exactly N scopes afterward (including on error paths).
    // See the ScopeGuard comment above for why RAII is not used here.
    // -----------------------------------------------------------------------

    pub(in crate::eval) fn push_scope(&mut self) -> Result<(), ComputeError> {
        if self.scope_stack.len() >= MAX_SCOPE_DEPTH {
            return Err(ComputeError::DepthLimit);
        }
        self.scope_stack.push(FxHashMap::default());
        Ok(())
    }

    pub(in crate::eval) fn pop_scope(&mut self) {
        self.scope_stack.pop();
    }

    /// Pop exactly `count` scopes from the stack. Used to clean up after
    /// pushing multiple captured scope frames (e.g. lambda closure restoration).
    pub(in crate::eval) fn pop_scopes(&mut self, count: usize) {
        for _ in 0..count {
            self.scope_stack.pop();
        }
    }

    pub(in crate::eval) fn set_variable(&mut self, name: String, value: EvalValue) {
        if let Some(frame) = self.scope_stack.last_mut() {
            frame.insert(name, value);
        }
    }

    pub(in crate::eval) fn get_variable(&self, name: &str) -> Option<&EvalValue> {
        // Search from innermost scope outward
        for frame in self.scope_stack.iter().rev() {
            if let Some(v) = frame.get(name) {
                return Some(v);
            }
        }
        None
    }

    /// Case-insensitive variable lookup for CellRef→variable resolution.
    ///
    /// In Excel, `=LET(t1, 5, T1+1)` returns 6 — LET variable names are
    /// case-insensitive. When the parser produces CellRef(T1) for `t1` inside
    /// a LET body, we need to match it against LET-bound variables regardless
    /// of case.
    fn get_variable_case_insensitive(&self, name: &str) -> Option<&EvalValue> {
        if self.scope_stack.is_empty() {
            return None;
        }
        let upper = name.to_ascii_uppercase();
        for frame in self.scope_stack.iter().rev() {
            for (key, value) in frame.iter() {
                if key.to_ascii_uppercase() == upper {
                    return Some(value);
                }
            }
        }
        None
    }

    pub(in crate::eval) fn tick(&mut self) -> Result<(), ComputeError> {
        self.operations += 1;
        if self.operations > MAX_OPERATIONS {
            return Err(ComputeError::OperationLimit);
        }
        self.check_deadline()
    }

    /// Check whether the per-formula deadline has been exceeded.
    /// Only performs the actual time check every `DEADLINE_CHECK_INTERVAL`
    /// operations to amortize cost. Works on both native and WASM.
    #[inline]
    fn check_deadline(&self) -> Result<(), ComputeError> {
        if let Some(dl) = self.deadline
            && self.operations.is_multiple_of(DEADLINE_CHECK_INTERVAL)
            && crate::time_compat::WasmSafeInstant::now() > dl
        {
            return Err(ComputeError::DeadlineExceeded);
        }
        Ok(())
    }

    pub(in crate::eval) fn push_depth(&mut self) -> Result<(), ComputeError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(ComputeError::DepthLimit);
        }
        Ok(())
    }

    pub(in crate::eval) fn pop_depth(&mut self) {
        debug_assert!(self.depth > 0, "pop_depth called at depth 0");
        self.depth = self.depth.saturating_sub(1);
    }

    // -----------------------------------------------------------------------
    // Helper: resolve a CellRef to (SheetId, row, col)
    // -----------------------------------------------------------------------

    /// Resolve a `CellRef` to `(SheetId, row, col)` using metadata.
    /// Works for both `Resolved` (has CellId) and `Positional` (empty cell) variants.
    pub(in crate::eval) fn resolve_cell_ref_position(
        &self,
        cell_ref: &CellRef,
    ) -> Option<(SheetId, u32, u32)> {
        match cell_ref {
            CellRef::Resolved(id) => self.meta.resolve_position(id),
            CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
        }
    }

    // -----------------------------------------------------------------------
    // Helper: patch SheetId in an unresolved inner AST node
    // -----------------------------------------------------------------------

    /// Replace `SheetId(0)` (the placeholder used by the parser when no resolver
    /// is provided) with the correct `sheet_id` in cell references and ranges
    /// within an `UnresolvedSheetRef`'s inner node.
    ///
    /// This creates a new AST node with corrected sheet references so it can be
    /// evaluated just like a resolved `SheetRef` inner node.
    fn patch_sheet_id(node: &ASTNode, sheet_id: SheetId) -> ASTNode {
        SheetPatcher { sheet_id }.fold(node.clone())
    }

    pub(in crate::eval) fn eval_node<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<EvalValue, ComputeError>> + 'b>>
    {
        Box::pin(async move {
            self.tick()?;
            self.push_depth()?;
            let result = self.eval_node_inner(node).await;
            self.pop_depth();
            result
        })
    }

    /// Convenience wrapper: evaluate a node and collapse to `CellValue`.
    /// Used by eval_primitives and other sites that don't need lambda propagation.
    pub(in crate::eval) fn eval_node_cv<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<CellValue, ComputeError>> + 'b>>
    {
        Box::pin(async move { self.eval_node(node).await.map(|ev| ev.into_cell_value()) })
    }

    async fn eval_node_inner(&mut self, node: &ASTNode) -> Result<EvalValue, ComputeError> {
        // Lambda expression cache: return cached value if available
        if let Some(ref cache) = self.lambda_expr_cache {
            let ptr = node as *const ASTNode;
            if let Some(cached) = cache.values.get(&ptr) {
                return Ok(cached.clone());
            }
        }

        // === Subexpression cache (content-hash-based, for array dedup across formulas) ===
        // Only cache Function call nodes — BinaryOp/Paren/etc are cheap and caching
        // them can interfere with special dispatch paths (e.g. SUMPRODUCT fused mul-chain).
        let subexpr_key =
            if matches!(node, ASTNode::Function { .. }) && subexpr_cache::is_cacheable(node) {
                let key = subexpr_cache::hash_ast(node);
                if let Some(cached) = subexpr_cache::get(key, node) {
                    return Ok(EvalValue::Cell(cached));
                }
                Some(key)
            } else {
                None
            };

        let result = match node {
            ASTNode::Number(n) => Ok(EvalValue::Cell(CellValue::number(*n))),
            ASTNode::Text(s) => Ok(EvalValue::Cell(CellValue::Text(s.clone().into()))),
            ASTNode::Boolean(b) => Ok(EvalValue::Cell(CellValue::Boolean(*b))),
            ASTNode::Error(e) => Ok(EvalValue::Cell(CellValue::Error(*e, None))),
            ASTNode::Omitted => Ok(EvalValue::Cell(CellValue::Null)),

            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                // If we're inside a LET/LAMBDA scope and this CellRef's A1 text
                // matches a bound variable, resolve as the variable instead.
                // This handles `=LET(t1, 5, t1+1)` → 6 (Excel behavior): the parser
                // produces CellRef(T1) for `t1`, but it should resolve to the LET var.
                if !self.scope_stack.is_empty() {
                    let a1 = cell_ref_to_a1(reference);
                    if let Some(v) = self.get_variable_case_insensitive(&a1) {
                        return Ok(v.clone());
                    }
                }
                Ok(EvalValue::Cell(
                    self.data.get_cell_value_by_ref(reference).await,
                ))
            }

            ASTNode::Range(RangeRef {
                start,
                end,
                range_type,
                ..
            }) => match self.data.get_range_values(start, end, range_type).await {
                Ok(arr) => Ok(EvalValue::Cell(CellValue::Array(arr))),
                Err(e) => Ok(EvalValue::Cell(CellValue::Error(e, None))),
            },

            ASTNode::SheetRef { sheet, inner } => {
                if let ASTNode::Identifier(name) = inner.as_ref() {
                    self.eval_sheet_qualified_identifier(name, *sheet).await
                } else {
                    self.eval_node(inner).await
                }
            }

            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                match self.meta.sheet_by_name(sheet_name) {
                    Some(sheet_id) => {
                        if let ASTNode::Identifier(name) = inner.as_ref() {
                            self.eval_sheet_qualified_identifier(name, sheet_id).await
                        } else {
                            // Resolve at runtime: patch the inner node's cell references
                            // with the correct sheet_id and evaluate, mirroring SheetRef handling.
                            let resolved = Self::patch_sheet_id(inner, sheet_id);
                            self.eval_node(&resolved).await
                        }
                    }
                    None => Ok(EvalValue::Cell(CellValue::error_with_message(
                        CellError::Ref,
                        format!("Sheet '{}' not found", sheet_name),
                    ))),
                }
            }

            // 3-D references: Sheet1:Sheet50!A1 — collect one value per sheet into a
            // single-column array so that SUM/AVERAGE/etc. can aggregate across sheets.
            ASTNode::ThreeDRef {
                start_sheet,
                end_sheet,
                inner,
            } => {
                let sheets = self.meta.sheets_in_range(start_sheet, end_sheet);
                let mut values = Vec::with_capacity(sheets.len());
                for sheet_id in sheets {
                    let resolved = Self::patch_sheet_id(inner, sheet_id);
                    let val = self.eval_node(&resolved).await?.into_cell_value();
                    values.push(val);
                }
                Ok(EvalValue::Cell(CellValue::Array(std::sync::Arc::new(
                    value_types::CellArray::single_column(values),
                ))))
            }

            ASTNode::UnresolvedThreeDRef {
                start_name,
                end_name,
                inner,
            } => {
                let start_id = self.meta.sheet_by_name(start_name);
                let end_id = self.meta.sheet_by_name(end_name);
                match (start_id, end_id) {
                    (Some(start), Some(end)) => {
                        let sheets = self.meta.sheets_in_range(&start, &end);
                        let mut values = Vec::with_capacity(sheets.len());
                        for sheet_id in sheets {
                            let resolved = Self::patch_sheet_id(inner, sheet_id);
                            let val = self.eval_node(&resolved).await?.into_cell_value();
                            values.push(val);
                        }
                        Ok(EvalValue::Cell(CellValue::Array(std::sync::Arc::new(
                            value_types::CellArray::single_column(values),
                        ))))
                    }
                    _ => Ok(EvalValue::Cell(CellValue::error_with_message(
                        CellError::Ref,
                        format!(
                            "3-D ref: sheet '{}' or '{}' not found",
                            start_name, end_name
                        ),
                    ))),
                }
            }

            ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. } => Ok(EvalValue::Cell(CellValue::Error(
                CellError::Ref,
                Some("External workbook provider not configured".into()),
            ))),

            ASTNode::BinaryOp { op, left, right } => {
                if matches!(op, compute_parser::BinOp::Intersect) {
                    return Ok(EvalValue::Cell(
                        self.eval_reference_intersection(left, right).await?,
                    ));
                }
                Ok(EvalValue::Cell(
                    self.eval_left_deep_binary_chain(*op, left, right).await?,
                ))
            }

            ASTNode::UnaryOp { op, operand } => {
                // Excel `@` implicit-intersection: pick the row-aligned (column
                // ranges), column-aligned (row ranges), or both-aligned (2-D
                // ranges) scalar from the operand range, relative to the
                // formula's own (sheet, row, col).  If alignment is impossible,
                // produce `#VALUE!`.
                if matches!(op, compute_parser::UnaryOp::ImplicitIntersection) {
                    return self.eval_implicit_intersection(operand).await;
                }
                let val = self.eval_node(operand).await?.into_cell_value();
                Ok(EvalValue::Cell(eval_unary_op(*op, &val)))
            }

            ASTNode::Function { name, args } => self.eval_function(name, args).await,

            ASTNode::Paren(inner) => self.eval_node(inner).await,

            ASTNode::Identifier(name) => {
                // First check scope stack (LET/LAMBDA variables)
                if let Some(v) = self.get_variable(name) {
                    return Ok(v.clone());
                }
                // Then check defined names (variables / named ranges)
                match self.meta.resolve_defined_name(name) {
                    Some(ResolvedName::Formula { raw_expression }) => {
                        // Parse and recursively evaluate the variable's formula.
                        // The existing depth counter (push_depth/pop_depth in eval_node)
                        // naturally limits recursion — if a variable chain is too deep,
                        // ComputeError::DepthLimit fires and we map it to #REF!.
                        let resolver = EvalRefResolver { meta: self.meta };
                        match compute_parser::parse_formula(&raw_expression, Some(&resolver)) {
                            Ok(spanned) => {
                                let ast = spanned.into_inner();
                                match self.eval_node(&ast).await {
                                    Ok(val) => Ok(val),
                                    Err(ComputeError::DepthLimit) => {
                                        // Circular or excessively deep variable chain → #REF!
                                        Ok(EvalValue::Cell(CellValue::error_with_message(
                                            CellError::Ref,
                                            format!("Circular reference in name '{}'", name),
                                        )))
                                    }
                                    Err(e) => Err(e),
                                }
                            }
                            Err(_) => Ok(EvalValue::Cell(CellValue::error_with_message(
                                CellError::Name,
                                format!("Undefined name '{}'", name),
                            ))),
                        }
                    }
                    Some(resolved) => Ok(EvalValue::Cell(
                        self.fetch_defined_name_value(&resolved).await,
                    )),
                    None => Ok(EvalValue::Cell(CellValue::error_with_message(
                        CellError::Name,
                        format!("Undefined name '{}'", name),
                    ))),
                }
            }

            ASTNode::StructuredRef(ref_) => match self.meta.resolve_structured_ref(ref_) {
                Ok(resolved) => {
                    let rows = self.fetch_structured_ref_values(&resolved).await;
                    // Excel: Table[@Col] (ThisRow) returns a scalar value;
                    // Table[Col] (full column) returns an array even if 1 row.
                    use crate::table::types::{SpecialItem, StructuredRefSpecifier};
                    let is_this_row = ref_.specifiers.iter().any(|s| {
                        matches!(
                            s,
                            StructuredRefSpecifier::ThisRow
                                | StructuredRefSpecifier::Special {
                                    item: SpecialItem::ThisRow
                                }
                        )
                    });
                    if is_this_row && rows.len() == 1 && rows[0].len() == 1 {
                        Ok(EvalValue::Cell(
                            rows.into_iter().next().unwrap().into_iter().next().unwrap(),
                        ))
                    } else {
                        Ok(EvalValue::Cell(CellValue::from_rows(rows)))
                    }
                }
                Err(e) => Ok(EvalValue::Cell(CellValue::Error(e, None))),
            },

            ASTNode::Array { rows } => {
                let mut result = Vec::with_capacity(rows.len());
                for row in rows {
                    let mut row_vals = Vec::with_capacity(row.len());
                    for cell in row {
                        row_vals.push(self.eval_node(cell).await?.into_cell_value());
                    }
                    result.push(row_vals);
                }
                Ok(EvalValue::Cell(CellValue::from_rows(result)))
            }

            ASTNode::CallExpression { callee, args } => {
                self.eval_call_expression(callee, args).await
            }

            ASTNode::RangeOp { start, end } => {
                let area_start = match self.eval_node_as_area(start).await {
                    Ok(a) => a,
                    Err(ComputeError::Eval { .. }) => {
                        return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
                    }
                    Err(e) => return Err(e),
                };
                let area_end = match self.eval_node_as_area(end).await {
                    Ok(a) => a,
                    Err(ComputeError::Eval { .. }) => {
                        return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
                    }
                    Err(e) => return Err(e),
                };
                let (s1, sr1, sc1, er1, ec1) = area_start;
                let (s2, sr2, sc2, er2, ec2) = area_end;
                if s1 != s2 {
                    return Ok(EvalValue::Cell(CellValue::Error(CellError::Ref, None)));
                }
                // Compute bounding box of both areas
                let min_row = sr1.min(sr2).min(er1).min(er2);
                let min_col = sc1.min(sc2).min(ec1).min(ec2);
                let max_row = er1.max(er2).max(sr1).max(sr2);
                let max_col = ec1.max(ec2).max(sc1).max(sc2);
                let start_ref = CellRef::Positional {
                    sheet: s1,
                    row: min_row,
                    col: min_col,
                };
                let end_ref = CellRef::Positional {
                    sheet: s1,
                    row: max_row,
                    col: max_col,
                };
                if min_row == max_row && min_col == max_col {
                    Ok(EvalValue::Cell(
                        self.data.get_cell_value_by_ref(&start_ref).await,
                    ))
                } else {
                    match self
                        .data
                        .get_range_values(&start_ref, &end_ref, &RangeType::CellRange)
                        .await
                    {
                        Ok(arr) => Ok(EvalValue::Cell(CellValue::Array(arr))),
                        Err(e) => Ok(EvalValue::Cell(CellValue::Error(e, None))),
                    }
                }
            }

            ASTNode::Union { ranges } => {
                // Evaluate each range in the union, collect all values into a
                // single flat array. This matches Excel's behavior where a union
                // in a function argument (e.g. SUM((A1:A5,C1:C5))) aggregates
                // all constituent ranges.
                let mut all_values: Vec<CellValue> = Vec::new();
                for range in ranges {
                    let val = self.eval_node(range).await?.into_cell_value();
                    match val {
                        CellValue::Array(arr) => {
                            all_values.extend(arr.data().iter().cloned());
                        }
                        other => all_values.push(other),
                    }
                }
                // Return as a 1-column array (consistent with Excel's union behavior
                // when used in aggregate functions).
                let rows: Vec<Vec<CellValue>> = all_values.into_iter().map(|v| vec![v]).collect();
                Ok(EvalValue::Cell(CellValue::from_rows(rows)))
            }
        };

        // Lambda expression cache: store result for cacheable nodes
        if let Some(ref mut cache) = self.lambda_expr_cache {
            let ptr = node as *const ASTNode;
            if cache.cacheable.contains(&ptr)
                && let Ok(ref val) = result
            {
                cache.values.insert(ptr, val.clone());
            }
        }

        // Cache array results on the way out
        if let (Some(key), Ok(val)) = (&subexpr_key, &result)
            && let Some(cv) = val.as_cell()
            && matches!(cv, CellValue::Array(_))
        {
            subexpr_cache::insert(*key, node.clone(), cv.clone());
        }

        result
    }

    async fn eval_left_deep_binary_chain(
        &mut self,
        root_op: compute_parser::BinOp,
        root_left: &ASTNode,
        root_right: &ASTNode,
    ) -> Result<CellValue, ComputeError> {
        let mut spine = vec![(root_op, root_right)];
        let mut leftmost = root_left;

        while let ASTNode::BinaryOp { op, left, right } = leftmost {
            if matches!(op, compute_parser::BinOp::Intersect) {
                break;
            }
            self.tick()?;
            spine.push((*op, right));
            leftmost = left;
        }

        let mut acc = self.eval_node(leftmost).await?.into_cell_value();
        while let Some((op, right)) = spine.pop() {
            let rval = self.eval_node(right).await?.into_cell_value();
            acc = eval_binary_op(op, &acc, &rval);
        }

        Ok(acc)
    }

    async fn eval_reference_intersection(
        &mut self,
        left: &ASTNode,
        right: &ASTNode,
    ) -> Result<CellValue, ComputeError> {
        let left_area = match self.eval_node_as_intersection_area(left).await {
            Ok(Some(area)) => area,
            Ok(None) => return Ok(CellValue::Error(CellError::Null, None)),
            Err(ComputeError::Eval { .. }) => return Ok(CellValue::Error(CellError::Value, None)),
            Err(e) => return Err(e),
        };
        let right_area = match self.eval_node_as_intersection_area(right).await {
            Ok(Some(area)) => area,
            Ok(None) => return Ok(CellValue::Error(CellError::Null, None)),
            Err(ComputeError::Eval { .. }) => return Ok(CellValue::Error(CellError::Value, None)),
            Err(e) => return Err(e),
        };
        let Some((sheet, start_row, start_col, end_row, end_col)) =
            Self::intersect_ref_areas(left_area, right_area)
        else {
            return Ok(CellValue::Error(CellError::Null, None));
        };

        let start_ref = CellRef::Positional {
            sheet,
            row: start_row,
            col: start_col,
        };
        let end_ref = CellRef::Positional {
            sheet,
            row: end_row,
            col: end_col,
        };
        if start_row == end_row && start_col == end_col {
            return Ok(self.data.get_cell_value_by_ref(&start_ref).await);
        }
        match self
            .data
            .get_range_values(&start_ref, &end_ref, &RangeType::CellRange)
            .await
        {
            Ok(array) => Ok(CellValue::Array(array)),
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }

    // -----------------------------------------------------------------------
    // Implicit-intersection (`@`) — Excel's row/column-aligned scalar pick
    // -----------------------------------------------------------------------

    /// Evaluate `@<operand>`: collapse a multi-cell range/array operand to a
    /// single scalar via row-aligned (column ranges), column-aligned (row
    /// ranges), or both-aligned (2-D ranges) intersection with the formula's
    /// own (sheet, row, col).
    ///
    /// Semantics (matches Excel):
    ///   In C3, `=@A1:A5` → A3 (column range, row-aligned)
    ///   In C3, `=@A3:E3` → C3 (row range, column-aligned)
    ///   In C3, `=@A1:E5` → C3 (2-D range, both axes aligned)
    ///   In C7, `=@A1:A5` → #VALUE! (caller row not in 1..=5)
    ///   `@scalar` → scalar (identity, no-op for single values)
    ///   `@function_returning_array` → top-left of the array (fallback path)
    pub(in crate::eval) fn eval_implicit_intersection<'b>(
        &'b mut self,
        operand: &'b ASTNode,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<EvalValue, ComputeError>> + 'b>>
    {
        Box::pin(async move {
            // Find the calling formula's position.  If unavailable (e.g. inside
            // a defined-name evaluation that has no positional context), fall
            // back to the position-agnostic top-left scalar.
            let caller_id = self.meta.current_cell();
            let Some((caller_sheet, caller_row, caller_col)) =
                self.meta.resolve_position(&caller_id)
            else {
                let val = self.eval_node(operand).await?.into_cell_value();
                return Ok(EvalValue::Cell(super::operators::eval_unary_op(
                    compute_parser::UnaryOp::ImplicitIntersection,
                    &val,
                )));
            };

            // If the operand is a reference expression (Range, CellReference,
            // SheetRef-wrapped, or RangeOp), we can compute alignment using the
            // referenced area without materialising the full range.
            if Self::is_referenceable_for_intersection(operand) {
                match self.eval_node_as_area(operand).await {
                    Ok((area_sheet, sr, sc, er, ec)) => {
                        // Single cell — alignment is trivially the cell itself.
                        if sr == er && sc == ec {
                            let cv = self
                                .data
                                .get_cell_value_by_ref(&CellRef::Positional {
                                    sheet: area_sheet,
                                    row: sr,
                                    col: sc,
                                })
                                .await;
                            return Ok(EvalValue::Cell(cv));
                        }

                        let single_row = sr == er;
                        let single_col = sc == ec;

                        let pick_row = if single_row {
                            sr
                        } else if caller_row >= sr && caller_row <= er {
                            caller_row
                        } else {
                            return Ok(EvalValue::Cell(CellValue::error_with_message(
                                CellError::Value,
                                format!(
                                    "@: caller row {} not in range rows {}..={}",
                                    caller_row + 1,
                                    sr + 1,
                                    er + 1
                                ),
                            )));
                        };

                        let pick_col = if single_col {
                            sc
                        } else if caller_col >= sc && caller_col <= ec {
                            caller_col
                        } else {
                            return Ok(EvalValue::Cell(CellValue::error_with_message(
                                CellError::Value,
                                format!(
                                    "@: caller column {} not in range cols {}..={}",
                                    col_to_letter(caller_col),
                                    col_to_letter(sc),
                                    col_to_letter(ec)
                                ),
                            )));
                        };

                        let _ = caller_sheet; // pick lives on the operand's sheet, not the caller's
                        let cv = self
                            .data
                            .get_cell_value_by_ref(&CellRef::Positional {
                                sheet: area_sheet,
                                row: pick_row,
                                col: pick_col,
                            })
                            .await;
                        return Ok(EvalValue::Cell(cv));
                    }
                    Err(_) => {
                        // Fall through to the value-based fallback below.
                    }
                }
            }

            // Operand is an expression (e.g. function call) — evaluate normally
            // and apply the value-level fallback (top-left of array, identity
            // for scalars). This matches Excel's behaviour when the operand
            // does not produce a contiguous reference area.
            let val = self.eval_node(operand).await?.into_cell_value();
            Ok(EvalValue::Cell(super::operators::eval_unary_op(
                compute_parser::UnaryOp::ImplicitIntersection,
                &val,
            )))
        })
    }

    /// Is this AST node a reference expression for which `eval_node_as_area`
    /// returns a meaningful area? Includes literal cell/range refs, reference
    /// intersections, and their sheet-qualified or parenthesised wrappers.
    fn is_referenceable_for_intersection(node: &ASTNode) -> bool {
        match node {
            ASTNode::CellReference(_) | ASTNode::Range(_) | ASTNode::RangeOp { .. } => true,
            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Intersect,
                left,
                right,
            } => {
                Self::is_referenceable_for_intersection(left)
                    && Self::is_referenceable_for_intersection(right)
            }
            ASTNode::SheetRef { inner, .. } | ASTNode::UnresolvedSheetRef { inner, .. } => {
                Self::is_referenceable_for_intersection(inner)
            }
            ASTNode::Paren(inner) => Self::is_referenceable_for_intersection(inner),
            _ => false,
        }
    }

    fn intersect_ref_areas(left: RefArea, right: RefArea) -> Option<RefArea> {
        let (left_sheet, left_start_row, left_start_col, left_end_row, left_end_col) = left;
        let (right_sheet, right_start_row, right_start_col, right_end_row, right_end_col) = right;
        if left_sheet != right_sheet {
            return None;
        }

        let start_row = left_start_row.max(right_start_row);
        let start_col = left_start_col.max(right_start_col);
        let end_row = left_end_row.min(right_end_row);
        let end_col = left_end_col.min(right_end_col);
        if start_row > end_row || start_col > end_col {
            None
        } else {
            Some((left_sheet, start_row, start_col, end_row, end_col))
        }
    }

    fn eval_node_as_intersection_area<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<RefArea>, ComputeError>> + 'b>,
    > {
        Box::pin(async move {
            match node {
                ASTNode::BinaryOp {
                    op: compute_parser::BinOp::Intersect,
                    left,
                    right,
                } => {
                    let Some(left_area) = self.eval_node_as_intersection_area(left).await? else {
                        return Ok(None);
                    };
                    let Some(right_area) = self.eval_node_as_intersection_area(right).await? else {
                        return Ok(None);
                    };
                    Ok(Self::intersect_ref_areas(left_area, right_area))
                }
                ASTNode::SheetRef { inner, .. } | ASTNode::Paren(inner) => {
                    self.eval_node_as_intersection_area(inner).await
                }
                ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                    match self.meta.sheet_by_name(sheet_name) {
                        Some(sheet_id) => {
                            let resolved = Self::patch_sheet_id(inner, sheet_id);
                            self.eval_node_as_intersection_area(&resolved).await
                        }
                        None => Err(ComputeError::Eval {
                            message: format!("Intersection: unknown sheet '{}'", sheet_name),
                        }),
                    }
                }
                _ => self.eval_node_as_area(node).await.map(Some),
            }
        })
    }

    // -----------------------------------------------------------------------
    // Reference-area evaluation for RangeOp (expr:expr range operator)
    // -----------------------------------------------------------------------

    /// Evaluate an AST node as a reference area for `RangeOp`.
    ///
    /// Returns `(SheetId, start_row, start_col, end_row, end_col)` representing
    /// the rectangular area the expression references. Used by `RangeOp` to
    /// construct a range from two expression endpoints (e.g. `INDEX():INDEX()`).
    ///
    /// This is the boxed-future wrapper for recursion safety (same pattern as
    /// `eval_node`). The actual dispatch is in `eval_node_as_area_inner`.
    #[allow(clippy::type_complexity)]
    pub(in crate::eval) fn eval_node_as_area<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<RefArea, ComputeError>> + 'b>,
    > {
        Box::pin(async move {
            self.tick()?;
            self.eval_node_as_area_inner(node).await
        })
    }

    /// Inner dispatch for `eval_node_as_area`. Matches AST node types and
    /// extracts the reference area each represents.
    async fn eval_node_as_area_inner(
        &mut self,
        node: &ASTNode,
    ) -> Result<RefArea, ComputeError> {
        match node {
            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                let (sheet, row, col) =
                    self.resolve_cell_ref_position(reference).ok_or_else(|| {
                        ComputeError::Eval {
                            message: "RangeOp: cannot resolve cell reference".into(),
                        }
                    })?;
                Ok((sheet, row, col, row, col))
            }

            ASTNode::Range(RangeRef { start, end, .. }) => {
                let (s_sheet, s_row, s_col) =
                    self.resolve_cell_ref_position(start)
                        .ok_or_else(|| ComputeError::Eval {
                            message: "RangeOp: cannot resolve range start".into(),
                        })?;
                let (_, e_row, e_col) =
                    self.resolve_cell_ref_position(end)
                        .ok_or_else(|| ComputeError::Eval {
                            message: "RangeOp: cannot resolve range end".into(),
                        })?;
                Ok((
                    s_sheet,
                    s_row.min(e_row),
                    s_col.min(e_col),
                    s_row.max(e_row),
                    s_col.max(e_col),
                ))
            }

            ASTNode::SheetRef { inner, .. } => self.eval_node_as_area(inner).await,

            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                match self.meta.sheet_by_name(sheet_name) {
                    Some(sheet_id) => {
                        let resolved = Self::patch_sheet_id(inner, sheet_id);
                        self.eval_node_as_area(&resolved).await
                    }
                    None => Err(ComputeError::Eval {
                        message: format!("RangeOp: unknown sheet '{}'", sheet_name),
                    }),
                }
            }

            ASTNode::Paren(inner) => self.eval_node_as_area(inner).await,

            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Intersect,
                ..
            } => {
                self.eval_node_as_intersection_area(node).await?.ok_or_else(|| {
                    ComputeError::Eval {
                        message: "Intersection: referenced areas do not overlap".into(),
                    }
                })
            }

            ASTNode::Function { name, args } => {
                let upper = name.to_uppercase();
                match upper.as_str() {
                    "INDEX" => self.eval_index_as_area(args).await,
                    "OFFSET" => self.eval_offset_as_area(args).await,
                    _ => Err(ComputeError::Eval {
                        message: format!("RangeOp: function '{}' cannot produce a reference", name),
                    }),
                }
            }

            _ => Err(ComputeError::Eval {
                message: "RangeOp: expression cannot produce a reference".into(),
            }),
        }
    }

    // -----------------------------------------------------------------------
    // Value fetching helpers for position-only resolution results
    // -----------------------------------------------------------------------

    /// Evaluate a sheet-qualified identifier (`'Sheet1'!MyName`).
    ///
    /// Resolves the named range using the qualifier sheet's scope chain instead
    /// of the current evaluation sheet's scope chain. This ensures cross-sheet
    /// references like `'Sheet1'!MyName` from Sheet2 resolve correctly.
    async fn eval_sheet_qualified_identifier(
        &mut self,
        name: &str,
        sheet: SheetId,
    ) -> Result<EvalValue, ComputeError> {
        // First check scope stack (LET/LAMBDA variables)
        if let Some(v) = self.get_variable(name) {
            return Ok(v.clone());
        }
        // Resolve using the qualifier sheet's scope chain
        match self.meta.resolve_defined_name_for_sheet(name, sheet) {
            Some(ResolvedName::Formula { raw_expression }) => {
                let resolver = EvalRefResolver { meta: self.meta };
                match compute_parser::parse_formula(&raw_expression, Some(&resolver)) {
                    Ok(spanned) => {
                        let ast = spanned.into_inner();
                        match self.eval_node(&ast).await {
                            Ok(val) => Ok(val),
                            Err(ComputeError::DepthLimit) => {
                                Ok(EvalValue::Cell(CellValue::Error(CellError::Ref, None)))
                            }
                            Err(e) => Err(e),
                        }
                    }
                    Err(_) => Ok(EvalValue::Cell(CellValue::Error(CellError::Name, None))),
                }
            }
            Some(resolved) => Ok(EvalValue::Cell(
                self.fetch_defined_name_value(&resolved).await,
            )),
            None => Ok(EvalValue::Cell(CellValue::Error(CellError::Name, None))),
        }
    }

    /// Fetch cell values for a resolved defined name using data access.
    pub(in crate::eval) async fn fetch_defined_name_value(
        &self,
        resolved: &ResolvedName,
    ) -> CellValue {
        match resolved {
            ResolvedName::Error(err) => CellValue::Error(*err, None),
            ResolvedName::Cell { sheet, row, col } => {
                let cell_ref = CellRef::Positional {
                    sheet: *sheet,
                    row: *row,
                    col: *col,
                };
                self.data.get_cell_value_by_ref(&cell_ref).await
            }
            ResolvedName::Range {
                sheet,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let start = CellRef::Positional {
                    sheet: *sheet,
                    row: *start_row,
                    col: *start_col,
                };
                let end = CellRef::Positional {
                    sheet: *sheet,
                    row: *end_row,
                    col: *end_col,
                };
                match self
                    .data
                    .get_range_values(&start, &end, &RangeType::CellRange)
                    .await
                {
                    Ok(arr) => CellValue::Array(arr),
                    Err(e) => CellValue::Error(e, None),
                }
            }
            ResolvedName::Constant(cv) => cv.clone(),
            ResolvedName::Formula { raw_expression } => {
                // Formula variables are handled in the ASTNode::Identifier branch
                // via parse + eval_node. If we reach here via a non-Identifier path,
                // we cannot evaluate (no async context in this sync helper).
                // Return #NAME? as a fallback — this path should not normally be hit.
                let _ = raw_expression;
                CellValue::Error(CellError::Name, None)
            }
        }
    }

    /// Fetch cell values for a resolved structured reference using data access.
    pub(in crate::eval) async fn fetch_structured_ref_values(
        &self,
        resolved: &ResolvedStructuredRef,
    ) -> Vec<Vec<CellValue>> {
        if resolved.ranges.is_empty() {
            return vec![];
        }
        let mut all_rows: Vec<Vec<CellValue>> = Vec::new();
        for range in &resolved.ranges {
            for r in range.start_row..=range.end_row {
                let mut row = Vec::new();
                for &c in &range.columns {
                    let cell_ref = CellRef::Positional {
                        sheet: resolved.sheet,
                        row: r,
                        col: c,
                    };
                    row.push(self.data.get_cell_value_by_ref(&cell_ref).await);
                }
                all_rows.push(row);
            }
        }
        all_rows
    }
}
