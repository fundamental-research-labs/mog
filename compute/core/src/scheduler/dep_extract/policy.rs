use compute_parser::ASTNode;

/// Returns true if the AST node is a static cell/range reference -
/// one that resolves to a fixed address without evaluating sub-expressions.
/// Covers: CellReference, Range, and SheetRef wrapping either.
/// Does NOT cover INDIRECT or other dynamic references.
pub(super) fn is_static_ref(node: &ASTNode) -> bool {
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
pub(super) fn is_ref_arg_metadata_only(name: &str, args: &[ASTNode]) -> bool {
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
                    false // info_type from expression - conservatively extract deps
                }
            } else {
                false
            }
        }

        _ => false,
    }
}

/// Returns the index of the reference argument for metadata-only functions.
pub(super) fn metadata_arg_index(name: &str) -> usize {
    match name.to_ascii_uppercase().as_str() {
        "CELL" => 1, // CELL(info_type, ref) - ref is second arg
        _ => 0,      // ROW(ref), COLUMN(ref), ROWS(ref), COLUMNS(ref)
    }
}

/// Describes which arguments of a function are selectively accessed.
/// Selective functions read a dynamic subset of a range, not every cell.
///
/// Strategy taxonomy:
/// - Aggregate (default): reads all cells -> full barrier edges
/// - Selective (this enum): reads a subset -> back-edge filtered
/// - Volatile-dynamic (INDIRECT, OFFSET): runtime-determined refs -> no static deps, volatility flag
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SelectiveArgs {
    /// No args are selective - function reads all cells (Aggregate).
    Aggregate,
    /// Specific arg indices are selective.
    Indices(&'static [usize]),
    /// All args from index N onward are selective.
    AllFrom(usize),
}

impl SelectiveArgs {
    pub(super) fn includes(&self, i: usize) -> bool {
        match self {
            Self::Aggregate => false,
            Self::Indices(s) => s.contains(&i),
            Self::AllFrom(n) => i >= *n,
        }
    }
}

/// Returns the selective argument pattern for a function.
/// Selective functions read a dynamic subset of a range argument, not every cell.
pub(super) fn selective_range_arg_pattern(name: &str) -> SelectiveArgs {
    match name.to_ascii_uppercase().as_str() {
        // INDEX(array, row_num, [col_num]) - reads one cell from array
        "INDEX" => SelectiveArgs::Indices(&[0]),
        // CHOOSE(index, val1, val2, ...) - reads one of the value args.
        // Arg 0 (index) is fully evaluated; all subsequent args are candidates.
        "CHOOSE" => SelectiveArgs::AllFrom(1),
        // XLOOKUP(lookup, lookup_array, return_array, ...) - searches lookup_array,
        // reads one row from return_array
        "XLOOKUP" => SelectiveArgs::Indices(&[1, 2]),
        // VLOOKUP(lookup, table_array, col_idx, ...) - searches first column of table_array
        "VLOOKUP" => SelectiveArgs::Indices(&[1]),
        // HLOOKUP(lookup, table_array, row_idx, ...) - searches first row of table_array
        "HLOOKUP" => SelectiveArgs::Indices(&[1]),
        // MATCH(lookup, lookup_array, match_type) - searches lookup_array
        "MATCH" => SelectiveArgs::Indices(&[1]),
        // LOOKUP(lookup, lookup_vector, [result_vector]) - searches lookup_vector,
        // reads one cell from result_vector
        "LOOKUP" => SelectiveArgs::Indices(&[1, 2]),
        // SWITCH(expr, val1, result1, ..., [default]) - only matching result used.
        // All non-expr args are selective (engine reads a subset regardless).
        "SWITCH" => SelectiveArgs::AllFrom(1),
        // IFS(cond1, val1, cond2, val2, ...) - short-circuits on first true.
        // All args are candidates; only one pair is evaluated.
        "IFS" => SelectiveArgs::AllFrom(0),
        _ => SelectiveArgs::Aggregate,
    }
}
