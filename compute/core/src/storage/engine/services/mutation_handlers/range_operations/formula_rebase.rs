use cell_types::SheetId;
use compute_parser::ASTNode;
use formula_types::{IdentityFormulaRef, RefStyle, ReferenceTarget, WorkbookLookup};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

use super::super::fill::{
    AdjustedPositionLookup, build_adjusted_formula, resolve_identity_ref_to_fill_position,
};

// ---------------------------------------------------------------------------
// build_cross_sheet_adjusted_formula
// ---------------------------------------------------------------------------

/// Cross-sheet copy ref-rebind via parse/render round-trip.
///
/// `IdentityCellRef`/`IdentityRangeRef` carry only a `CellId`, not a "naked"
/// flag — the source/target sheet split is recovered at display time via
/// `WorkbookLookup::formula_sheet()`. So a copy from Sheet1!C1 (`=A1+B1`) to
/// Sheet2!C1 cannot just relocate the IDs: each `id` still maps to a cell on
/// Sheet1, and `to_a1_string` would emit `=Sheet1!A1+Sheet1!B1`.
///
/// Cross-sheet paste must rebind naked refs to the target sheet (so Sheet2!C1
/// reads `=A1+B1`) while keeping authored sheet-qualified refs intact (a
/// copied `=Sheet1!A1` stays `=Sheet1!A1`, and a copied `=Sheet2!A1` pasted
/// onto Sheet2 keeps the explicit `Sheet2!` prefix instead of collapsing to a
/// self-reference). The parser already encodes the naked-vs-qualified sheet
/// binding rule:
/// `to_a1_string` strips the sheet prefix when the ref resolves to
/// `lookup.formula_sheet()`, and `to_identity_formula` re-binds unqualified
/// refs (`CURRENT_SHEET` sentinel) to `resolver.current_sheet()`. Round-tripping
/// the formula text through both sides moves naked refs onto the target sheet
/// without touching the identity types.
///
/// Pipeline:
/// 1. Render source `IdentityFormula` to A1 with `formula_sheet = source_sheet`
///    so naked refs come out unqualified.
/// 2. Re-parse the A1 string with `current_sheet = target_sheet` so naked refs
///    rebind to the target sheet (qualified refs preserve their explicit sheet).
/// 3. Build new `ref_positions` against the *fresh* identity formula. Naked
///    refs run through the standard `calculate_adjusted_positions` +
///    `build_adjusted_formula` path. Authored sheet-qualified refs are restored
///    to their original resolved positions because the sheet qualifier is the
///    author intent that must survive cross-sheet paste. With naked refs now
///    living on the target sheet,
///    `mirror.sheet_for_cell(&id)` inside `build_adjusted_formula` returns the
///    target sheet, so newly-allocated post-shift cells land there too.
/// 4. Render via `to_a1_string` with `formula_sheet = target_sheet`.
///
/// Returns `None` if the round-trip yields an empty body or the source formula
/// is unparseable in the target context (in which case the caller falls back
/// to the source's typed value).
#[allow(clippy::too_many_arguments)]
pub(super) fn build_cross_sheet_adjusted_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    source_sheet_id: &SheetId,
    target_sheet_id: &SheetId,
    source_formula: &formula_types::IdentityFormula,
    source_formula_text: Option<&str>,
    src_row: u32,
    src_col: u32,
    tgt_row: u32,
    tgt_col: u32,
) -> Option<String> {
    use crate::mirror::MirrorPositionLookup;

    // Step 1: render source formula to A1 against the source sheet. Naked refs
    // emit no sheet prefix; cross-sheet refs keep their explicit qualifier.
    //
    // Prefer the authored text cache when available: the identity model cannot
    // distinguish `A1` from an explicitly-authored same-sheet `Sheet1!A1`.
    let a1 = source_formula_text
        .and_then(normalize_formula_text)
        .unwrap_or_else(|| {
            let source_lookup = MirrorPositionLookup::new(mirror, *source_sheet_id);
            compute_parser::to_a1_string(source_formula, &source_lookup)
        });
    if a1.is_empty() {
        return None;
    }
    let authored_sheet_qualified_refs = authored_sheet_qualified_ref_flags(&a1)
        .unwrap_or_else(|| vec![false; source_formula.refs.len()]);

    // Step 2 + 3a: re-parse on the target sheet. `to_identity_formula` walks
    // the parser's `IdentityResolver` with `current_sheet = target_sheet_id`,
    // so naked refs are rebound to the target sheet while qualified refs land
    // on whatever sheet the qualifier names. This also recomputes
    // `is_dynamic_array`/`is_volatile`/`is_aggregate` for the new AST.
    let rebased = stores
        .compute
        .to_identity_formula(mirror, target_sheet_id, &a1)
        .ok()?;

    // Step 3b: build fresh ref_positions for the rebased formula. The fill
    // engine works in pure (row, col) space, so this is a per-ref lookup
    // against the (now rebased) mirror identities. Sheet membership for each
    // ref doesn't enter the position math — only the deltas do.
    let ref_positions: Vec<compute_fill::formula_adjust::RefPosition> = rebased
        .refs
        .iter()
        .map(|r| {
            resolve_identity_ref_to_fill_position(mirror, target_sheet_id, r, src_row, src_col)
        })
        .collect();

    // Step 3c: shift positions by (tgt - src) and rebuild the IdentityFormula.
    // `build_adjusted_formula` honors per-ref `out_of_bounds` from
    // `calculate_adjusted_positions` (the resulting A1 carries `#REF!` for
    // those refs).
    let mut adjusted_refs = compute_fill::formula_adjust::calculate_adjusted_positions(
        &rebased,
        (src_row, src_col),
        (tgt_row, tgt_col),
        &ref_positions,
    );
    for (index, ref_position) in ref_positions.iter().enumerate() {
        if authored_sheet_qualified_refs
            .get(index)
            .copied()
            .unwrap_or(false)
            && let Some(adjusted) = adjusted_refs.iter_mut().find(|adj| adj.ref_index == index)
        {
            *adjusted = fixed_adjusted_ref(index, ref_position);
        }
    }
    let (new_formula, overrides) =
        build_adjusted_formula(stores, mirror, target_sheet_id, &rebased, &adjusted_refs)?;

    // Step 4: render against the target sheet so naked refs stay naked.
    let lookup = AdjustedPositionLookup {
        mirror,
        formula_sheet: *target_sheet_id,
        overrides,
    };
    let out = render_a1_with_forced_ref_qualification(
        &new_formula,
        &lookup,
        &authored_sheet_qualified_refs,
    );
    let body = out.strip_prefix('=').unwrap_or(&out).to_string();
    if body.is_empty() { None } else { Some(body) }
}

fn normalize_formula_text(formula: &str) -> Option<String> {
    let trimmed = formula.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('=') {
        Some(trimmed.to_string())
    } else {
        Some(format!("={trimmed}"))
    }
}

fn authored_sheet_qualified_ref_flags(formula: &str) -> Option<Vec<bool>> {
    let ast = compute_parser::parse_formula(formula, None)
        .ok()?
        .into_inner();
    let mut flags = Vec::new();
    collect_ref_qualification_flags(&ast, false, &mut flags);
    Some(flags)
}

fn collect_ref_qualification_flags(node: &ASTNode, sheet_qualified: bool, flags: &mut Vec<bool>) {
    match node {
        ASTNode::CellReference(_) | ASTNode::Range(_) => flags.push(sheet_qualified),
        ASTNode::SheetRef { inner, .. }
        | ASTNode::UnresolvedSheetRef { inner, .. }
        | ASTNode::ThreeDRef { inner, .. }
        | ASTNode::UnresolvedThreeDRef { inner, .. } => {
            collect_ref_qualification_flags(inner, true, flags);
        }
        ASTNode::ExternalSheetRef { .. }
        | ASTNode::ExternalThreeDRef { .. }
        | ASTNode::ExternalNameRef { .. } => flags.push(true),
        ASTNode::BinaryOp { left, right, .. } => {
            collect_ref_qualification_flags(left, sheet_qualified, flags);
            collect_ref_qualification_flags(right, sheet_qualified, flags);
        }
        ASTNode::UnaryOp { operand, .. } | ASTNode::Paren(operand) => {
            collect_ref_qualification_flags(operand, sheet_qualified, flags);
        }
        ASTNode::Function { args, .. } => {
            for arg in args {
                collect_ref_qualification_flags(arg, sheet_qualified, flags);
            }
        }
        ASTNode::Array { rows } => {
            for row in rows {
                for item in row {
                    collect_ref_qualification_flags(item, sheet_qualified, flags);
                }
            }
        }
        ASTNode::CallExpression { callee, args } => {
            collect_ref_qualification_flags(callee, sheet_qualified, flags);
            for arg in args {
                collect_ref_qualification_flags(arg, sheet_qualified, flags);
            }
        }
        ASTNode::RangeOp { start, end } => {
            collect_ref_qualification_flags(start, sheet_qualified, flags);
            collect_ref_qualification_flags(end, sheet_qualified, flags);
        }
        ASTNode::Union { ranges } => {
            for range in ranges {
                collect_ref_qualification_flags(range, sheet_qualified, flags);
            }
        }
        ASTNode::Number(_)
        | ASTNode::Text(_)
        | ASTNode::Boolean(_)
        | ASTNode::Error(_)
        | ASTNode::StructuredRef(_)
        | ASTNode::Identifier(_)
        | ASTNode::OptionalLambdaParam(_)
        | ASTNode::Omitted => {}
    }
}

fn fixed_adjusted_ref(
    ref_index: usize,
    pos: &compute_fill::formula_adjust::RefPosition,
) -> compute_fill::types::AdjustedRef {
    use compute_fill::formula_adjust::RefPosition;
    match pos {
        RefPosition::Cell { row, col } => compute_fill::types::AdjustedRef {
            ref_index,
            target_row: *row,
            target_col: *col,
            target_end_row: None,
            target_end_col: None,
            out_of_bounds: false,
        },
        RefPosition::Range {
            start_row,
            start_col,
            end_row,
            end_col,
        } => compute_fill::types::AdjustedRef {
            ref_index,
            target_row: *start_row,
            target_col: *start_col,
            target_end_row: Some(*end_row),
            target_end_col: Some(*end_col),
            out_of_bounds: false,
        },
        RefPosition::FullRow { row } => compute_fill::types::AdjustedRef {
            ref_index,
            target_row: *row,
            target_col: 0,
            target_end_row: None,
            target_end_col: None,
            out_of_bounds: false,
        },
        RefPosition::RowRange { start_row, end_row } => compute_fill::types::AdjustedRef {
            ref_index,
            target_row: *start_row,
            target_col: 0,
            target_end_row: Some(*end_row),
            target_end_col: None,
            out_of_bounds: false,
        },
        RefPosition::FullCol { col } => compute_fill::types::AdjustedRef {
            ref_index,
            target_row: 0,
            target_col: *col,
            target_end_row: None,
            target_end_col: None,
            out_of_bounds: false,
        },
        RefPosition::ColRange { start_col, end_col } => compute_fill::types::AdjustedRef {
            ref_index,
            target_row: 0,
            target_col: *start_col,
            target_end_row: None,
            target_end_col: Some(*end_col),
            out_of_bounds: false,
        },
    }
}

fn render_a1_with_forced_ref_qualification(
    formula: &formula_types::IdentityFormula,
    lookup: &dyn WorkbookLookup,
    force_qualified: &[bool],
) -> String {
    let template = formula.template.as_bytes();
    let mut out = String::with_capacity(template.len() + 8);
    out.push('=');

    let mut i = 0;
    while i < template.len() {
        if template[i] == b'{'
            && let Some((index, end)) = parse_placeholder(template, i)
        {
            if let Some(ref_) = formula.refs.get(index) {
                format_ref_with_forced_qualification(
                    ref_,
                    lookup,
                    force_qualified.get(index).copied().unwrap_or(false),
                    &mut out,
                );
            } else {
                out.push_str("#REF!");
            }
            i = end;
            continue;
        }
        out.push(template[i] as char);
        i += 1;
    }

    out
}

fn format_ref_with_forced_qualification(
    r: &IdentityFormulaRef,
    lookup: &dyn WorkbookLookup,
    force_qualified: bool,
    out: &mut String,
) {
    if let Some(sid) = r.resolved_sheet(lookup)
        && (force_qualified || sid != lookup.formula_sheet())
    {
        write_sheet_prefix(out, lookup, sid);
    }
    r.display_body(lookup, RefStyle::A1, out);
}

fn parse_placeholder(template: &[u8], start: usize) -> Option<(usize, usize)> {
    let after_open = start + 1;
    let mut end = after_open;
    while end < template.len() && template[end] != b'}' {
        if !template[end].is_ascii_digit() {
            return None;
        }
        end += 1;
    }
    if end >= template.len() || end == after_open {
        return None;
    }
    let index = std::str::from_utf8(&template[after_open..end])
        .ok()?
        .parse()
        .ok()?;
    Some((index, end + 1))
}

fn write_sheet_prefix(out: &mut String, lookup: &dyn WorkbookLookup, sheet: SheetId) {
    let Some(name) = lookup.sheet_name(&sheet) else {
        out.push_str("#REF!");
        return;
    };
    if compute_parser::needs_quoting(name) {
        out.push('\'');
        for ch in name.chars() {
            if ch == '\'' {
                out.push('\'');
            }
            out.push(ch);
        }
        out.push('\'');
    } else {
        out.push_str(name);
    }
    out.push('!');
}
