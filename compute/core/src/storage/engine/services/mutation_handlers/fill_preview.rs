use std::collections::HashMap;

use cell_types::{CellId, ColId, RowId, SheetId};

use crate::mirror::CellMirror;

pub(super) fn pattern_type_to_wire(pattern_type: &compute_fill::types::FillPatternType) -> String {
    match pattern_type {
        compute_fill::types::FillPatternType::Copy => "copy",
        compute_fill::types::FillPatternType::Linear => "linear",
        compute_fill::types::FillPatternType::Growth => "growth",
        compute_fill::types::FillPatternType::Date => "date",
        compute_fill::types::FillPatternType::Time => "time",
        compute_fill::types::FillPatternType::Weekday => "weekday",
        compute_fill::types::FillPatternType::WeekdayShort => "weekdayShort",
        compute_fill::types::FillPatternType::Month => "month",
        compute_fill::types::FillPatternType::MonthShort => "monthShort",
        compute_fill::types::FillPatternType::Quarter => "quarter",
        compute_fill::types::FillPatternType::Ordinal => "ordinal",
        compute_fill::types::FillPatternType::TextWithNumber => "textWithNumber",
        compute_fill::types::FillPatternType::CustomList => "customList",
    }
    .to_string()
}

pub(super) fn warning_to_bridge(
    warning: &compute_fill::types::FillWarning,
) -> crate::engine_types::fill::BridgeAutoFillWarning {
    let kind = match &warning.kind {
        compute_fill::types::FillWarningKind::MergedCellsInTarget => {
            crate::engine_types::fill::BridgeAutoFillWarningKind::MergedCellsInTarget
        }
        compute_fill::types::FillWarningKind::FormulaRefOutOfBounds { ref_index } => {
            crate::engine_types::fill::BridgeAutoFillWarningKind::FormulaRefOutOfBounds {
                ref_index: *ref_index,
            }
        }
        compute_fill::types::FillWarningKind::SourceCellEmpty => {
            crate::engine_types::fill::BridgeAutoFillWarningKind::SourceCellEmpty
        }
    };

    crate::engine_types::fill::BridgeAutoFillWarning {
        row: warning.row,
        col: warning.col,
        kind,
    }
}

pub(super) fn source_formula_text(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    source_formula: &formula_types::IdentityFormula,
) -> String {
    let lookup = PreviewPositionLookup::new(mirror, *sheet_id);
    compute_parser::to_a1_string(source_formula, &lookup)
}

pub(super) fn render_preview_formula(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    source: &formula_types::IdentityFormula,
    adjusted_refs: &[compute_fill::types::AdjustedRef],
) -> (String, Vec<crate::engine_types::fill::BridgeAdjustedRef>) {
    use formula_types::{
        IdentityCellRef, IdentityFormulaRef, IdentityRangeRef, IdentityRectRangeRef,
    };

    let mut lookup = PreviewPositionLookup::new(mirror, *sheet_id);
    let mut new_refs = Vec::with_capacity(source.refs.len());

    for (index, src_ref) in source.refs.iter().enumerate() {
        let adjusted = adjusted_refs.iter().find(|r| r.ref_index == index);
        match adjusted {
            Some(adjusted) if !adjusted.out_of_bounds => match src_ref {
                IdentityFormulaRef::Cell(cell_ref) => {
                    let ref_sheet = mirror.sheet_for_cell(&cell_ref.id).unwrap_or(*sheet_id);
                    let fake_id = fake_cell_id(index, 0);
                    lookup.cell_positions.insert(
                        fake_id,
                        (ref_sheet, adjusted.target_row, adjusted.target_col),
                    );
                    new_refs.push(IdentityFormulaRef::Cell(IdentityCellRef {
                        id: fake_id,
                        row_absolute: cell_ref.row_absolute,
                        col_absolute: cell_ref.col_absolute,
                    }));
                }
                IdentityFormulaRef::Range(range_ref) => {
                    let ref_sheet = mirror
                        .sheet_for_cell(&range_ref.start_id)
                        .unwrap_or(*sheet_id);
                    let start_id = fake_cell_id(index, 0);
                    let end_id = fake_cell_id(index, 1);
                    let end_row = adjusted.target_end_row.unwrap_or(adjusted.target_row);
                    let end_col = adjusted.target_end_col.unwrap_or(adjusted.target_col);
                    lookup.cell_positions.insert(
                        start_id,
                        (ref_sheet, adjusted.target_row, adjusted.target_col),
                    );
                    lookup
                        .cell_positions
                        .insert(end_id, (ref_sheet, end_row, end_col));
                    new_refs.push(IdentityFormulaRef::Range(IdentityRangeRef {
                        start_id,
                        end_id,
                        start_row_absolute: range_ref.start_row_absolute,
                        start_col_absolute: range_ref.start_col_absolute,
                        end_row_absolute: range_ref.end_row_absolute,
                        end_col_absolute: range_ref.end_col_absolute,
                    }));
                }
                IdentityFormulaRef::RectRange(rect_ref) => {
                    let start_row_id = fake_row_id(index, 0);
                    let start_col_id = fake_col_id(index, 0);
                    let end_row_id = fake_row_id(index, 1);
                    let end_col_id = fake_col_id(index, 1);
                    let end_row = adjusted.target_end_row.unwrap_or(adjusted.target_row);
                    let end_col = adjusted.target_end_col.unwrap_or(adjusted.target_col);
                    lookup
                        .row_positions
                        .insert(start_row_id, (rect_ref.sheet_id, adjusted.target_row));
                    lookup
                        .col_positions
                        .insert(start_col_id, (rect_ref.sheet_id, adjusted.target_col));
                    lookup
                        .row_positions
                        .insert(end_row_id, (rect_ref.sheet_id, end_row));
                    lookup
                        .col_positions
                        .insert(end_col_id, (rect_ref.sheet_id, end_col));
                    new_refs.push(IdentityFormulaRef::RectRange(IdentityRectRangeRef {
                        sheet_id: rect_ref.sheet_id,
                        start_row_id,
                        start_col_id,
                        end_row_id,
                        end_col_id,
                        start_row_absolute: rect_ref.start_row_absolute,
                        start_col_absolute: rect_ref.start_col_absolute,
                        end_row_absolute: rect_ref.end_row_absolute,
                        end_col_absolute: rect_ref.end_col_absolute,
                    }));
                }
                // Match the mutating apply path for non-cell identity variants:
                // compute-fill still reports adjusted positions for diagnostics,
                // but storage apply preserves these refs today.
                other => new_refs.push(other.clone()),
            },
            _ => new_refs.push(src_ref.clone()),
        }
    }

    let formula = formula_types::IdentityFormula {
        template: source.template.clone(),
        refs: new_refs,
        is_dynamic_array: source.is_dynamic_array,
        is_volatile: source.is_volatile,
        is_aggregate: source.is_aggregate,
    };
    let a1 = compute_parser::to_a1_string(&formula, &lookup);
    (
        a1,
        adjusted_refs.iter().map(adjusted_ref_to_bridge).collect(),
    )
}

fn adjusted_ref_to_bridge(
    adjusted_ref: &compute_fill::types::AdjustedRef,
) -> crate::engine_types::fill::BridgeAdjustedRef {
    crate::engine_types::fill::BridgeAdjustedRef {
        ref_index: adjusted_ref.ref_index,
        target_row: adjusted_ref.target_row,
        target_col: adjusted_ref.target_col,
        target_end_row: adjusted_ref.target_end_row,
        target_end_col: adjusted_ref.target_end_col,
        out_of_bounds: adjusted_ref.out_of_bounds,
    }
}

fn fake_cell_id(ref_index: usize, endpoint: u128) -> CellId {
    CellId::from_raw(u128::MAX - ((ref_index as u128) * 4 + endpoint))
}

fn fake_row_id(ref_index: usize, endpoint: u128) -> RowId {
    RowId::from_raw(u128::MAX - 10_000 - ((ref_index as u128) * 4 + endpoint))
}

fn fake_col_id(ref_index: usize, endpoint: u128) -> ColId {
    ColId::from_raw(u128::MAX - 20_000 - ((ref_index as u128) * 4 + endpoint))
}

struct PreviewPositionLookup<'a> {
    mirror: &'a CellMirror,
    formula_sheet: SheetId,
    cell_positions: HashMap<CellId, (SheetId, u32, u32)>,
    row_positions: HashMap<RowId, (SheetId, u32)>,
    col_positions: HashMap<ColId, (SheetId, u32)>,
}

impl<'a> PreviewPositionLookup<'a> {
    fn new(mirror: &'a CellMirror, formula_sheet: SheetId) -> Self {
        Self {
            mirror,
            formula_sheet,
            cell_positions: HashMap::new(),
            row_positions: HashMap::new(),
            col_positions: HashMap::new(),
        }
    }
}

impl formula_types::WorkbookLookup for PreviewPositionLookup<'_> {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        if let Some(pos) = self.cell_positions.get(cell_id) {
            return Some(*pos);
        }
        let sheet_id = self.mirror.sheet_for_cell(cell_id)?;
        let pos = self.mirror.resolve_position(cell_id)?;
        Some((sheet_id, pos.row(), pos.col()))
    }

    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.row_positions
            .get(row_id)
            .copied()
            .or_else(|| self.mirror.row_index_lookup(row_id))
    }

    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.col_positions
            .get(col_id)
            .copied()
            .or_else(|| self.mirror.col_index_lookup(col_id))
    }

    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.mirror.get_sheet(sheet_id).map(|s| s.name.as_str())
    }

    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}
