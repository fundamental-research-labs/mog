use super::*;

use compute_graph::positions::PositionResolver;

// ---------------------------------------------------------------------------
// Range extraction helpers
// ---------------------------------------------------------------------------

/// Resolve a `CellRef` to `(sheet, row, col)`.
/// `Positional` is extracted directly; `Resolved(CellId)` is looked up via the
/// caller-provided resolver (backed by the mirror in production).
fn resolve_cell_ref(cr: &CellRef, resolver: &impl PositionResolver) -> Option<(SheetId, u32, u32)> {
    match cr {
        CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
        CellRef::Resolved(cell_id) => {
            let p = resolver.resolve(cell_id)?;
            Some((p.sheet, p.row, p.col))
        }
    }
}

/// Extract a single-column range from an AST node.
/// Handles both `ASTNode::Range` directly and `ASTNode::SheetRef { inner: Range }`.
fn extract_range(node: &ASTNode, resolver: &impl PositionResolver) -> Option<RangeInfo> {
    match node {
        ASTNode::Range(range_ref) => extract_range_ref(range_ref, resolver),
        ASTNode::SheetRef { sheet, inner } => {
            if let ASTNode::Range(range_ref) = inner.as_ref() {
                // Cross-sheet: override the sheet from the SheetRef wrapper.
                let mut info = extract_range_ref(range_ref, resolver)?;
                info.0 = *sheet;
                Some(info)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Extract range info from a RangeRef. Returns `(sheet, col, start_row, end_row)`.
fn extract_range_ref(rr: &RangeRef, resolver: &impl PositionResolver) -> Option<RangeInfo> {
    match rr.range_type {
        RangeType::ColumnRange => {
            // Full column range like A:A. Rows are implicit (0..sheet.rows).
            let (sheet_s, _, col_s) = resolve_cell_ref(&rr.start, resolver)?;
            let (_, _, col_e) = resolve_cell_ref(&rr.end, resolver)?;
            if col_s != col_e {
                return None; // Multi-column — not supported
            }
            // Use sentinel 0..u32::MAX; caller will clamp to actual sheet rows.
            Some((sheet_s, col_s, 0, u32::MAX))
        }
        RangeType::CellRange => {
            let (sheet_s, row_s, col_s) = resolve_cell_ref(&rr.start, resolver)?;
            let (_, row_e, col_e) = resolve_cell_ref(&rr.end, resolver)?;
            if col_s != col_e {
                return None; // Multi-column
            }
            Some((sheet_s, col_s, row_s, row_e + 1)) // end_row exclusive
        }
        RangeType::RowRange | _ => None, // Row ranges and unknown variants not useful here
    }
}

// ---------------------------------------------------------------------------
// Criteria classification
// ---------------------------------------------------------------------------

/// Classify a criteria AST argument into a CriteriaSource.
fn classify_criteria(node: &ASTNode, resolver: &impl PositionResolver) -> Option<CriteriaSource> {
    match node {
        // Dynamic: row-relative cell reference (Positional or Resolved)
        ASTNode::CellReference(CellRefNode {
            abs_row: false,
            reference,
            ..
        }) => {
            let (sheet, _, col) = resolve_cell_ref(reference, resolver)?;
            Some(CriteriaSource::Dynamic { sheet, col })
        }

        // Static: absolute-row cell reference (e.g., BK$4). Constant across group.
        ASTNode::CellReference(CellRefNode {
            abs_row: true,
            reference,
            ..
        }) => {
            let (sheet, row, col) = resolve_cell_ref(reference, resolver)?;
            Some(CriteriaSource::StaticFromCell { sheet, row, col })
        }

        // Concatenation: ">="&$CY109 — prefix text + row-relative cell ref
        ASTNode::BinaryOp { op, left, right } if *op == compute_parser::BinOp::Concat => {
            match (left.as_ref(), right.as_ref()) {
                (
                    ASTNode::Text(prefix),
                    ASTNode::CellReference(CellRefNode {
                        abs_row: false,
                        reference,
                        ..
                    }),
                ) => {
                    let (sheet, _, col) = resolve_cell_ref(reference, resolver)?;
                    Some(CriteriaSource::DynamicWithPrefix {
                        sheet,
                        col,
                        prefix: prefix.clone(),
                    })
                }
                (ASTNode::Text(prefix), ASTNode::SheetRef { sheet, inner }) => {
                    if let ASTNode::CellReference(CellRefNode {
                        abs_row: false,
                        reference,
                        ..
                    }) = inner.as_ref()
                    {
                        let (_, _, col) = resolve_cell_ref(reference, resolver)?;
                        Some(CriteriaSource::DynamicWithPrefix {
                            sheet: *sheet,
                            col,
                            prefix: prefix.clone(),
                        })
                    } else {
                        None
                    }
                }
                // Static concatenation: Text + literal (e.g., "<>"&0 -> StaticFilter { text: "<>0" })
                (ASTNode::Text(prefix), ASTNode::Number(n)) => {
                    let combined = format!("{}{}", prefix, n);
                    classify_criteria_static(&ASTNode::Text(combined), None)
                }
                (ASTNode::Text(prefix), ASTNode::Boolean(b)) => {
                    let combined = format!("{}{}", prefix, if *b { "TRUE" } else { "FALSE" });
                    classify_criteria_static(&ASTNode::Text(combined), None)
                }
                (ASTNode::Text(prefix), ASTNode::Text(suffix)) => {
                    let combined = format!("{}{}", prefix, suffix);
                    classify_criteria_static(&ASTNode::Text(combined), None)
                }
                _ => None,
            }
        }

        // SheetRef wrapping a CellReference
        ASTNode::SheetRef { sheet, inner } => {
            if let ASTNode::CellReference(CellRefNode {
                abs_row: false,
                reference,
                ..
            }) = inner.as_ref()
            {
                let (_, _, col) = resolve_cell_ref(reference, resolver)?;
                Some(CriteriaSource::Dynamic { sheet: *sheet, col })
            } else if let ASTNode::CellReference(CellRefNode {
                abs_row: true,
                reference,
                ..
            }) = inner.as_ref()
            {
                let (_, row, col) = resolve_cell_ref(reference, resolver)?;
                Some(CriteriaSource::StaticFromCell {
                    sheet: *sheet,
                    row,
                    col,
                })
            } else {
                // Try static classification on inner
                classify_criteria_static(inner, Some(*sheet))
            }
        }

        other => classify_criteria_static(other, None),
    }
}

/// Classify non-dynamic (static) criteria.
fn classify_criteria_static(
    node: &ASTNode,
    _sheet_override: Option<SheetId>,
) -> Option<CriteriaSource> {
    match node {
        ASTNode::Number(n) => {
            let cv = CellValue::number(*n);
            Some(CriteriaSource::StaticExact {
                key: NormalizedKey::from_cell_value(&cv),
            })
        }
        ASTNode::Text(s) => {
            let cv = CellValue::Text(s.clone().into());
            if is_exact_match_criteria(&cv) {
                Some(CriteriaSource::StaticExact {
                    key: NormalizedKey::from_cell_value(&cv),
                })
            } else {
                Some(CriteriaSource::StaticFilter { text: s.clone() })
            }
        }
        ASTNode::Boolean(b) => Some(CriteriaSource::StaticExact {
            key: NormalizedKey::Boolean(*b),
        }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// extract_agg_pattern
// ---------------------------------------------------------------------------

/// Extract an aggregation pattern from a formula AST.
///
/// Returns `None` if the formula is not a recognized conditional aggregation function
/// or if any argument fails to resolve to a single-column range.
///
/// Returns `(AggPattern, Option<PostOp>)` where `PostOp` captures an arithmetic
/// wrapper like `SUMIFS(...) / $DD$2`.
///
/// Supports unwrapping through:
/// - `IF(cond, then, else)` — tries `then` and `else` branches
/// - `IFERROR(expr, fallback)` / `IFNA(expr, fallback)` — tries `expr`
/// - `Paren(inner)` — unwraps parentheses
/// - Nested arithmetic — recursively searches both sides of `+`, `-`, `*`, `/`
pub fn extract_agg_pattern(
    ast: &ASTNode,
    cell_sheet: SheetId,
    cell_row: u32,
    cell_col: u32,
    resolver: &impl PositionResolver,
) -> Option<(AggPattern, Option<PostOp>)> {
    // Try direct function match first (no arithmetic wrapper).
    if let Some(pattern) = extract_agg_pattern_inner(ast, cell_sheet, cell_row, cell_col, resolver)
    {
        return Some((pattern, None));
    }

    // Try unwrapping arithmetic wrapper: SUMIFS(...) op expr
    if let ASTNode::BinaryOp { op, left, right } = ast {
        use compute_parser::BinOp;
        if matches!(op, BinOp::Div | BinOp::Mul | BinOp::Add | BinOp::Sub)
            && let Some(pattern) =
                extract_agg_pattern_inner(left, cell_sheet, cell_row, cell_col, resolver)
            && let Some(operand) = extract_post_op_operand(right, cell_sheet, resolver)
        {
            return Some((pattern, Some(PostOp { op: *op, operand })));
        }
    }

    None
}

/// Recursively search through wrapper constructs (IF, IFERROR, Paren, arithmetic)
/// to find an aggregation pattern. Returns the first successful extraction.
///
/// This does NOT preserve PostOp — wrapper formulas are evaluated normally and
/// only benefit from the prepass having pre-computed the SUMIFS results.
#[allow(dead_code)]
pub(super) fn extract_through_wrappers(
    ast: &ASTNode,
    cell_sheet: SheetId,
    cell_row: u32,
    cell_col: u32,
    resolver: &impl PositionResolver,
) -> Option<AggPattern> {
    match ast {
        // Unwrap parentheses: (expr)
        ASTNode::Paren(inner) => {
            try_extract_or_recurse(inner, cell_sheet, cell_row, cell_col, resolver)
        }

        // Unwrap IF(cond, then, else): try `then` first, then `else`
        // Also handles IFERROR(expr, fallback), IFNA(expr, fallback): try `expr`
        ASTNode::Function { name, args } => {
            let upper = name.to_uppercase();
            match upper.as_str() {
                "IF" if args.len() >= 2 => {
                    // Try `then` branch
                    if let Some(p) =
                        try_extract_or_recurse(&args[1], cell_sheet, cell_row, cell_col, resolver)
                    {
                        return Some(p);
                    }
                    // Try `else` branch (if present)
                    if args.len() >= 3
                        && let Some(p) = try_extract_or_recurse(
                            &args[2], cell_sheet, cell_row, cell_col, resolver,
                        )
                    {
                        return Some(p);
                    }
                    // Try `cond` branch (sometimes the SUMIFS is in the condition, e.g. IF(SUMIFS(...)=0, ...))
                    try_extract_or_recurse(&args[0], cell_sheet, cell_row, cell_col, resolver)
                }
                "IFERROR" | "IFNA" if !args.is_empty() => {
                    try_extract_or_recurse(&args[0], cell_sheet, cell_row, cell_col, resolver)
                }
                _ => None,
            }
        }

        // Unwrap nested arithmetic and comparisons:
        // (SUMIFS(...) - SUMIFS(...)) / expr1 / expr2
        // IF(SUMIFS(...)=0, ...)  — comparison wrapping a SUMIFS
        // Recursively search both sides for an agg pattern.
        ASTNode::BinaryOp { left, right, .. } => {
            if let Some(p) = try_extract_or_recurse(left, cell_sheet, cell_row, cell_col, resolver)
            {
                return Some(p);
            }
            try_extract_or_recurse(right, cell_sheet, cell_row, cell_col, resolver)
        }

        _ => None,
    }
}

/// Try direct extraction first, then recurse through wrappers.
#[allow(dead_code)]
fn try_extract_or_recurse(
    ast: &ASTNode,
    cell_sheet: SheetId,
    cell_row: u32,
    cell_col: u32,
    resolver: &impl PositionResolver,
) -> Option<AggPattern> {
    // Direct match
    if let Some(pattern) = extract_agg_pattern_inner(ast, cell_sheet, cell_row, cell_col, resolver)
    {
        return Some(pattern);
    }
    // Recurse through wrappers
    extract_through_wrappers(ast, cell_sheet, cell_row, cell_col, resolver)
}

/// Extract the operand of a post-aggregation arithmetic operation.
///
/// Only accepts constant operands: literal numbers or fully-absolute cell references.
fn extract_post_op_operand(
    node: &ASTNode,
    _cell_sheet: SheetId,
    resolver: &impl PositionResolver,
) -> Option<PostOpOperand> {
    match node {
        ASTNode::Number(n) => Some(PostOpOperand::Number(*n)),
        ASTNode::CellReference(CellRefNode {
            abs_row: true,
            abs_col: true,
            reference,
        }) => {
            let (sheet, row, col) = resolve_cell_ref(reference, resolver)?;
            Some(PostOpOperand::Cell { sheet, row, col })
        }
        ASTNode::SheetRef { sheet, inner } => {
            if let ASTNode::CellReference(CellRefNode {
                abs_row: true,
                abs_col: true,
                reference,
                ..
            }) = inner.as_ref()
            {
                let (_, row, col) = resolve_cell_ref(reference, resolver)?;
                Some(PostOpOperand::Cell {
                    sheet: *sheet,
                    row,
                    col,
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Inner helper: extract an AggPattern from a direct function call AST node.
fn extract_agg_pattern_inner(
    ast: &ASTNode,
    _cell_sheet: SheetId,
    _cell_row: u32,
    _cell_col: u32,
    resolver: &impl PositionResolver,
) -> Option<AggPattern> {
    let (name, args) = match ast {
        ASTNode::Function { name, args } => (name.to_uppercase(), args),
        _ => return None,
    };

    let agg_fn = match name.as_str() {
        "COUNTIF" => AggFn::CountIf,
        "COUNTIFS" => AggFn::CountIfs,
        "SUMIF" => AggFn::SumIf,
        "SUMIFS" => AggFn::SumIfs,
        "AVERAGEIF" => AggFn::AverageIf,
        "AVERAGEIFS" => AggFn::AverageIfs,
        "MAXIFS" => AggFn::MaxIfs,
        "MINIFS" => AggFn::MinIfs,
        _ => return None,
    };

    match agg_fn {
        // -------------------------------------------------------------------
        // Single-criteria family: COUNTIF(range, criteria)
        //                         SUMIF(range, criteria [, sum_range])
        //                         AVERAGEIF(range, criteria [, avg_range])
        // -------------------------------------------------------------------
        AggFn::CountIf => {
            if args.len() != 2 {
                return None;
            }
            let range_info = extract_range(&args[0], resolver)?;
            let criteria = classify_criteria(&args[1], resolver)?;
            let pair = AggCriteriaPair {
                data_sheet: range_info.0,
                data_col: range_info.1,
                data_start_row: range_info.2,
                data_end_row: range_info.3,
                criteria,
            };
            Some(AggPattern {
                agg_fn,
                value_range: None,
                pairs: SmallVec::from_vec(vec![pair]),
            })
        }
        AggFn::SumIf | AggFn::AverageIf => {
            if args.len() < 2 || args.len() > 3 {
                return None;
            }
            let range_info = extract_range(&args[0], resolver)?;
            let criteria = classify_criteria(&args[1], resolver)?;

            let value_range = if args.len() == 3 {
                let vr = extract_range(&args[2], resolver)?;
                Some((vr.0, vr.1, vr.2, vr.3))
            } else {
                // Default: sum/average the criteria range itself
                Some((range_info.0, range_info.1, range_info.2, range_info.3))
            };

            let pair = AggCriteriaPair {
                data_sheet: range_info.0,
                data_col: range_info.1,
                data_start_row: range_info.2,
                data_end_row: range_info.3,
                criteria,
            };
            Some(AggPattern {
                agg_fn,
                value_range,
                pairs: SmallVec::from_vec(vec![pair]),
            })
        }

        // -------------------------------------------------------------------
        // Multi-criteria family: COUNTIFS(range1, criteria1, range2, criteria2, ...)
        //                        SUMIFS(sum_range, range1, criteria1, ...)
        //                        AVERAGEIFS(avg_range, range1, criteria1, ...)
        //                        MAXIFS(max_range, range1, criteria1, ...)
        //                        MINIFS(min_range, range1, criteria1, ...)
        // -------------------------------------------------------------------
        AggFn::CountIfs => {
            if args.len() < 2 || args.len() % 2 != 0 {
                return None;
            }
            let mut pairs = SmallVec::new();
            let mut i = 0;
            while i + 1 < args.len() {
                let range_info = extract_range(&args[i], resolver)?;
                let criteria = classify_criteria(&args[i + 1], resolver)?;
                pairs.push(AggCriteriaPair {
                    data_sheet: range_info.0,
                    data_col: range_info.1,
                    data_start_row: range_info.2,
                    data_end_row: range_info.3,
                    criteria,
                });
                i += 2;
            }
            Some(AggPattern {
                agg_fn,
                value_range: None,
                pairs,
            })
        }
        AggFn::SumIfs | AggFn::AverageIfs | AggFn::MaxIfs | AggFn::MinIfs => {
            if args.len() < 3 || (args.len() - 1) % 2 != 0 {
                return None;
            }
            let vr = extract_range(&args[0], resolver)?;
            let value_range = Some((vr.0, vr.1, vr.2, vr.3));

            let mut pairs = SmallVec::new();
            let mut i = 1;
            while i + 1 < args.len() {
                let range_info = extract_range(&args[i], resolver)?;
                let criteria = classify_criteria(&args[i + 1], resolver)?;
                pairs.push(AggCriteriaPair {
                    data_sheet: range_info.0,
                    data_col: range_info.1,
                    data_start_row: range_info.2,
                    data_end_row: range_info.3,
                    criteria,
                });
                i += 2;
            }
            Some(AggPattern {
                agg_fn,
                value_range,
                pairs,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// detect_agg_groups
// ---------------------------------------------------------------------------

/// Detect groups of consecutive dirty cells sharing the same aggregation pattern.
///
/// Mirrors `detect_groups()` from `eval/vectorized.rs`:
/// 1. For each dirty cell: resolve position, extract AggPattern from AST.
/// 2. Sort by (sheet, col, row).
/// 3. Walk sorted list, group consecutive cells with same (sheet, col, AggPattern).
/// 4. Filter groups with `len >= min_group_size`.
pub fn detect_agg_groups<'a>(
    dirty_set: &FxHashSet<CellId>,
    get_ast: impl Fn(&CellId) -> Option<&'a ASTNode>,
    resolve_pos: &impl PositionResolver,
    min_group_size: usize,
) -> Vec<AggFormulaGroup> {
    struct Entry {
        cell_id: CellId,
        sheet: SheetId,
        row: u32,
        col: u32,
        pattern: AggPattern,
        post_op: Option<PostOp>,
    }

    let mut entries: Vec<Entry> = Vec::new();

    for &cell_id in dirty_set {
        if let Some(ast) = get_ast(&cell_id)
            && let Some(pos) = resolve_pos.resolve(&cell_id)
        {
            let (sheet, row, col) = (pos.sheet, pos.row, pos.col);
            if let Some((pattern, post_op)) = extract_agg_pattern(ast, sheet, row, col, resolve_pos)
            {
                entries.push(Entry {
                    cell_id,
                    sheet,
                    row,
                    col,
                    pattern,
                    post_op,
                });
            }
        }
    }

    // Sort by (sheet, col, row)
    entries.sort_by(|a, b| {
        a.sheet
            .as_u128()
            .cmp(&b.sheet.as_u128())
            .then(a.col.cmp(&b.col))
            .then(a.row.cmp(&b.row))
    });

    // Walk sorted list, group consecutive cells with same (sheet, col, pattern)
    let mut groups = Vec::new();
    let mut i = 0;
    while i < entries.len() {
        let start = i;
        let ref_entry = &entries[start];
        let sheet = ref_entry.sheet;
        let col = ref_entry.col;
        let pattern = &ref_entry.pattern;

        i += 1;
        while i < entries.len() {
            let e = &entries[i];
            if e.sheet != sheet || e.col != col || e.pattern != *pattern {
                break;
            }
            // Rows must be consecutive — gaps mean different formula rows
            // (SUM subtotals, empty rows, etc.) exist between group members.
            // execute_agg_group uses `start_row + idx` for criteria lookup,
            // which is wrong when rows have gaps.
            if e.row != entries[i - 1].row + 1 {
                break;
            }
            i += 1;
        }

        let count = i - start;
        if count >= min_group_size {
            let cell_ids: Vec<CellId> = entries[start..i].iter().map(|e| e.cell_id).collect();
            let start_row = entries[start].row;
            let end_row = entries[i - 1].row + 1; // exclusive
            let post_op = entries[start].post_op.clone();
            groups.push(AggFormulaGroup {
                sheet,
                col,
                start_row,
                end_row,
                pattern: pattern.clone(),
                post_op,
                cell_ids,
            });
        }
    }

    groups
}

// ---------------------------------------------------------------------------
// detect_cache_only_patterns — find SUMIFS inside IF/IFERROR wrappers
// ---------------------------------------------------------------------------

/// Collect unique SUMIFS patterns from dirty cells whose formulas contain
/// SUMIFS inside IF/IFERROR wrappers. These patterns cannot be cell-resolved
/// by the prepass (the cell value depends on IF/IFERROR logic), but the
/// prepass can pre-populate the SUMIFS result cache so that normal evaluation
/// performs O(1) lookups instead of O(N) scans.
///
/// Returns deduplicated `AggPattern`s. Only patterns suitable for the
/// `sumifs_result_cache` are included (SumIfs/SumIf with all-exact-match
/// criteria columns — the cache doesn't support filter/prefix criteria).
///
/// Excludes cells that were already captured by `detect_agg_groups` (those
/// have direct SUMIFS patterns and are fully resolved by the prepass).
pub fn detect_cache_only_patterns<'a>(
    dirty_set: &FxHashSet<CellId>,
    already_resolved: &FxHashSet<CellId>,
    get_ast: impl Fn(&CellId) -> Option<&'a ASTNode>,
    resolve_pos: &impl PositionResolver,
) -> Vec<AggPattern> {
    let mut seen = FxHashSet::default();
    let mut patterns = Vec::new();

    for &cell_id in dirty_set {
        // Skip cells already captured by the direct prepass
        if already_resolved.contains(&cell_id) {
            continue;
        }

        if let Some(ast) = get_ast(&cell_id)
            && let Some(pos) = resolve_pos.resolve(&cell_id)
        {
            let (sheet, row, col) = (pos.sheet, pos.row, pos.col);
            // Skip if direct extraction works (already handled)
            if extract_agg_pattern(ast, sheet, row, col, resolve_pos).is_some() {
                continue;
            }

            // Try wrapper extraction — collect ALL patterns found
            collect_patterns_through_wrappers(
                ast,
                sheet,
                row,
                col,
                resolve_pos,
                &mut seen,
                &mut patterns,
            );
        }
    }

    patterns
}

/// Recursively collect ALL SUMIFS range layouts from a wrapped formula AST.
///
/// Unlike `extract_through_wrappers` which returns the first match,
/// this collects ALL patterns found in the formula tree (a wrapped
/// formula like `(SUMIFS(...) - SUMIFS(...)) / $C6` contains two).
///
/// Uses `extract_range_layout` instead of `extract_agg_pattern_inner` —
/// this is more relaxed: it only needs to extract the range columns, not
/// classify the criteria values. This handles formulas with function-call
/// criteria like `EDATE($B6, COLUMN()-5)` that `classify_criteria` can't parse.
#[allow(clippy::only_used_in_recursion)]
fn collect_patterns_through_wrappers(
    ast: &ASTNode,
    cell_sheet: SheetId,
    cell_row: u32,
    cell_col: u32,
    resolver: &impl PositionResolver,
    seen: &mut FxHashSet<CacheWarmKey>,
    patterns: &mut Vec<AggPattern>,
) {
    // Try range layout extraction (relaxed — ignores criteria values)
    if let Some(pattern) = extract_range_layout(ast, resolver) {
        let key = CacheWarmKey::from_pattern(&pattern);
        if seen.insert(key) {
            patterns.push(pattern);
        }
        return; // Don't recurse into function arguments
    }

    // Recurse through wrappers
    match ast {
        ASTNode::Paren(inner) => {
            collect_patterns_through_wrappers(
                inner, cell_sheet, cell_row, cell_col, resolver, seen, patterns,
            );
        }
        ASTNode::Function { name, args } => {
            let upper = name.to_uppercase();
            match upper.as_str() {
                "IF" => {
                    for arg in args {
                        collect_patterns_through_wrappers(
                            arg, cell_sheet, cell_row, cell_col, resolver, seen, patterns,
                        );
                    }
                }
                "IFERROR" | "IFNA" => {
                    if let Some(first) = args.first() {
                        collect_patterns_through_wrappers(
                            first, cell_sheet, cell_row, cell_col, resolver, seen, patterns,
                        );
                    }
                }
                _ => {} // Other functions: don't recurse
            }
        }
        ASTNode::BinaryOp { left, right, .. } => {
            collect_patterns_through_wrappers(
                left, cell_sheet, cell_row, cell_col, resolver, seen, patterns,
            );
            collect_patterns_through_wrappers(
                right, cell_sheet, cell_row, cell_col, resolver, seen, patterns,
            );
        }
        _ => {}
    }
}

/// Deduplication key for cache warming: (sum_range, criteria_ranges).
/// We only care about the column layout, not the criteria values.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheWarmKey {
    value_range: Option<(SheetId, u32, u32, u32)>,
    criteria_ranges: SmallVec<[(SheetId, u32, u32, u32); 4]>,
}

impl CacheWarmKey {
    fn from_pattern(pattern: &AggPattern) -> Self {
        CacheWarmKey {
            value_range: pattern.value_range,
            criteria_ranges: pattern
                .pairs
                .iter()
                .map(|p| (p.data_sheet, p.data_col, p.data_start_row, p.data_end_row))
                .collect(),
        }
    }
}

/// Extract range layout from a SUMIFS/SUMIF function call for cache warming.
///
/// Like `extract_agg_pattern_inner` but only extracts the range columns —
/// it does NOT classify criteria values. This allows it to handle formulas
/// where criteria are arbitrary expressions (e.g., `EDATE($B6, COLUMN()-5)`).
///
/// Returns a "dummy" `AggPattern` where criteria are all `Dynamic` placeholders.
/// This pattern is only used for `warm_sumifs_result_cache` which only needs
/// the range columns to build the `SumifsResultMap`.
fn extract_range_layout(ast: &ASTNode, resolver: &impl PositionResolver) -> Option<AggPattern> {
    let (name, args) = match ast {
        ASTNode::Function { name, args } => (name.to_uppercase(), args),
        _ => return None,
    };

    match name.as_str() {
        // SUMIFS(sum_range, crit_range1, crit1, crit_range2, crit2, ...)
        "SUMIFS" => {
            if args.len() < 3 || (args.len() - 1) % 2 != 0 {
                return None;
            }
            let vr = extract_range(&args[0], resolver)?;
            let value_range = Some((vr.0, vr.1, vr.2, vr.3));

            let mut pairs = SmallVec::new();
            let mut i = 1;
            while i + 1 < args.len() {
                let range_info = extract_range(&args[i], resolver)?;
                // Use a dummy Dynamic criteria — we only need the range columns
                pairs.push(AggCriteriaPair {
                    data_sheet: range_info.0,
                    data_col: range_info.1,
                    data_start_row: range_info.2,
                    data_end_row: range_info.3,
                    criteria: CriteriaSource::Dynamic {
                        sheet: range_info.0,
                        col: 0, // placeholder
                    },
                });
                i += 2;
            }

            Some(AggPattern {
                agg_fn: AggFn::SumIfs,
                value_range,
                pairs,
            })
        }
        // SUMIF(crit_range, crit, [sum_range])
        "SUMIF" => {
            if args.len() < 2 || args.len() > 3 {
                return None;
            }
            let range_info = extract_range(&args[0], resolver)?;
            let value_range = if args.len() == 3 {
                let vr = extract_range(&args[2], resolver)?;
                Some((vr.0, vr.1, vr.2, vr.3))
            } else {
                Some((range_info.0, range_info.1, range_info.2, range_info.3))
            };

            let pair = AggCriteriaPair {
                data_sheet: range_info.0,
                data_col: range_info.1,
                data_start_row: range_info.2,
                data_end_row: range_info.3,
                criteria: CriteriaSource::Dynamic {
                    sheet: range_info.0,
                    col: 0, // placeholder
                },
            };
            Some(AggPattern {
                agg_fn: AggFn::SumIf,
                value_range,
                pairs: SmallVec::from_vec(vec![pair]),
            })
        }
        _ => None,
    }
}
