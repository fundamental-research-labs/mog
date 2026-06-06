use cell_types::SheetId;
use compute_fill::types::AdjustedRef;
use formula_types::{IdentityFormula, ReferenceTarget, WorkbookLookup};

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
/// Excel's rule is to rebind naked refs to the target sheet (so Sheet2!C1
/// reads `=A1+B1`) while keeping qualified cross-sheet refs intact (a
/// `=Sheet1!A1` stays `=Sheet1!A1`). The parser already encodes that rule:
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
/// 3. Build new `ref_positions` against the *fresh* identity formula and run
///    the standard `calculate_adjusted_positions` + `build_adjusted_formula`
///    path. With refs now living on the target sheet,
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
    let source_lookup = MirrorPositionLookup::new(mirror, *source_sheet_id);
    let a1 = source_formula_text
        .filter(|text| !text.trim().is_empty())
        .map(ensure_formula_prefix)
        .unwrap_or_else(|| compute_parser::to_a1_string(source_formula, &source_lookup));
    if a1.is_empty() {
        return None;
    }
    let force_qualified_refs =
        compute_parser::sheet_qualified_reference_flags(&a1, source_formula.refs.len())
            .unwrap_or_else(|| {
                infer_cross_sheet_ref_flags(source_formula, &source_lookup, source_sheet_id)
            });

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
    for (idx, preserve) in force_qualified_refs.iter().copied().enumerate() {
        if preserve
            && let Some(adjusted_ref) = adjusted_refs.iter_mut().find(|a| a.ref_index == idx)
            && let Some(ref_position) = ref_positions.get(idx)
        {
            preserve_original_ref_position(adjusted_ref, ref_position);
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
    let out = compute_parser::to_a1_string_with_forced_qualifiers(
        &new_formula,
        &lookup,
        &force_qualified_refs,
    );
    let body = out.strip_prefix('=').unwrap_or(&out).to_string();
    if body.is_empty() { None } else { Some(body) }
}

fn ensure_formula_prefix(text: &str) -> String {
    if text.starts_with('=') {
        text.to_string()
    } else {
        format!("={text}")
    }
}

fn infer_cross_sheet_ref_flags(
    formula: &IdentityFormula,
    lookup: &dyn WorkbookLookup,
    source_sheet_id: &SheetId,
) -> Vec<bool> {
    formula
        .refs
        .iter()
        .map(|ref_| {
            ref_.resolved_sheet(lookup)
                .is_some_and(|sid| sid != *source_sheet_id)
        })
        .collect()
}

fn preserve_original_ref_position(
    adjusted_ref: &mut AdjustedRef,
    ref_position: &compute_fill::formula_adjust::RefPosition,
) {
    use compute_fill::formula_adjust::RefPosition;

    match ref_position {
        RefPosition::Cell { row, col } => {
            adjusted_ref.target_row = *row;
            adjusted_ref.target_col = *col;
            adjusted_ref.target_end_row = None;
            adjusted_ref.target_end_col = None;
        }
        RefPosition::Range {
            start_row,
            start_col,
            end_row,
            end_col,
        } => {
            adjusted_ref.target_row = *start_row;
            adjusted_ref.target_col = *start_col;
            adjusted_ref.target_end_row = Some(*end_row);
            adjusted_ref.target_end_col = Some(*end_col);
        }
        RefPosition::FullRow { row } => {
            adjusted_ref.target_row = *row;
            adjusted_ref.target_col = 0;
            adjusted_ref.target_end_row = None;
            adjusted_ref.target_end_col = None;
        }
        RefPosition::RowRange { start_row, end_row } => {
            adjusted_ref.target_row = *start_row;
            adjusted_ref.target_col = 0;
            adjusted_ref.target_end_row = Some(*end_row);
            adjusted_ref.target_end_col = None;
        }
        RefPosition::FullCol { col } => {
            adjusted_ref.target_row = 0;
            adjusted_ref.target_col = *col;
            adjusted_ref.target_end_row = None;
            adjusted_ref.target_end_col = None;
        }
        RefPosition::ColRange { start_col, end_col } => {
            adjusted_ref.target_row = 0;
            adjusted_ref.target_col = *start_col;
            adjusted_ref.target_end_row = None;
            adjusted_ref.target_end_col = Some(*end_col);
        }
    }
    adjusted_ref.out_of_bounds = false;
}
