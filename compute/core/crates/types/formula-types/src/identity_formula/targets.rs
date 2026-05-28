use std::fmt::Write as _;

use cell_types::{SheetId, col_to_letter_buf};

use super::deps::{DepEdge, DepEdges};
use super::display::{write_r1c1_col, write_r1c1_row};
use super::external;
use super::lookup::{RefStyle, ReferenceTarget, WorkbookLookup};
use super::types::{
    IdentityCellRef, IdentityColRangeRef, IdentityFormulaRef, IdentityFullColRef,
    IdentityFullRowRef, IdentityRangeRef, IdentityRectRangeRef, IdentityRowRangeRef,
};

impl ReferenceTarget for IdentityCellRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.cell_position(&self.id).map(|(s, _, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let Some((_, row, col)) = l.cell_position(&self.id) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(col, out);
                if self.row_absolute {
                    out.push('$');
                }
                write!(out, "{}", row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, base_col } => {
                write_r1c1_row(out, row, self.row_absolute, base_row);
                write_r1c1_col(out, col, self.col_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Cell(self.id));
    }
}

impl ReferenceTarget for IdentityRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        // Sheet is determined by the start corner; that's the historical contract.
        l.cell_position(&self.start_id).map(|(s, _, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((_, s_row, s_col)), Some((_, e_row, e_col))) = (
            l.cell_position(&self.start_id),
            l.cell_position(&self.end_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.start_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(s_col, out);
                if self.start_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", s_row + 1).unwrap();
                out.push(':');
                if self.end_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(e_col, out);
                if self.end_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", e_row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, base_col } => {
                write_r1c1_row(out, s_row, self.start_row_absolute, base_row);
                write_r1c1_col(out, s_col, self.start_col_absolute, base_col);
                out.push(':');
                write_r1c1_row(out, e_row, self.end_row_absolute, base_row);
                write_r1c1_col(out, e_col, self.end_col_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Range {
            start: self.start_id,
            end: self.end_id,
        });
    }
}

impl ReferenceTarget for IdentityRectRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        let (Some((start_row_sheet, _)), Some((end_row_sheet, _))) = (
            l.row_index(&self.start_row_id),
            l.row_index(&self.end_row_id),
        ) else {
            return None;
        };
        let (Some((start_col_sheet, _)), Some((end_col_sheet, _))) = (
            l.col_index(&self.start_col_id),
            l.col_index(&self.end_col_id),
        ) else {
            return None;
        };
        (start_row_sheet == self.sheet_id
            && end_row_sheet == self.sheet_id
            && start_col_sheet == self.sheet_id
            && end_col_sheet == self.sheet_id)
            .then_some(self.sheet_id)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((start_row_sheet, s_row)), Some((end_row_sheet, e_row))) = (
            l.row_index(&self.start_row_id),
            l.row_index(&self.end_row_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        let (Some((start_col_sheet, s_col)), Some((end_col_sheet, e_col))) = (
            l.col_index(&self.start_col_id),
            l.col_index(&self.end_col_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        if start_row_sheet != self.sheet_id
            || end_row_sheet != self.sheet_id
            || start_col_sheet != self.sheet_id
            || end_col_sheet != self.sheet_id
        {
            out.push_str("#REF!");
            return;
        }
        match style {
            RefStyle::A1 => {
                if self.start_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(s_col, out);
                if self.start_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", s_row + 1).unwrap();
                out.push(':');
                if self.end_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(e_col, out);
                if self.end_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", e_row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, base_col } => {
                write_r1c1_row(out, s_row, self.start_row_absolute, base_row);
                write_r1c1_col(out, s_col, self.start_col_absolute, base_col);
                out.push(':');
                write_r1c1_row(out, e_row, self.end_row_absolute, base_row);
                write_r1c1_col(out, e_col, self.end_col_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::RectRange {
            sheet: self.sheet_id,
            start_row: self.start_row_id,
            end_row: self.end_row_id,
            start_col: self.start_col_id,
            end_col: self.end_col_id,
        });
    }
}

impl ReferenceTarget for IdentityFullRowRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.row_index(&self.row_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let Some((_, row)) = l.row_index(&self.row_id) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.absolute {
                    out.push('$');
                }
                write!(out, "{}", row + 1).unwrap();
                out.push(':');
                if self.absolute {
                    out.push('$');
                }
                write!(out, "{}", row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, .. } => {
                write_r1c1_row(out, row, self.absolute, base_row);
                out.push(':');
                write_r1c1_row(out, row, self.absolute, base_row);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Row(self.row_id));
    }
}

impl ReferenceTarget for IdentityRowRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.row_index(&self.start_row_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((_, s_row)), Some((_, e_row))) = (
            l.row_index(&self.start_row_id),
            l.row_index(&self.end_row_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.start_absolute {
                    out.push('$');
                }
                write!(out, "{}", s_row + 1).unwrap();
                out.push(':');
                if self.end_absolute {
                    out.push('$');
                }
                write!(out, "{}", e_row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, .. } => {
                write_r1c1_row(out, s_row, self.start_absolute, base_row);
                out.push(':');
                write_r1c1_row(out, e_row, self.end_absolute, base_row);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::RowRange {
            start: self.start_row_id,
            end: self.end_row_id,
        });
    }
}

impl ReferenceTarget for IdentityFullColRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.col_index(&self.col_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let Some((_, col)) = l.col_index(&self.col_id) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.absolute {
                    out.push('$');
                }
                col_to_letter_buf(col, out);
                out.push(':');
                if self.absolute {
                    out.push('$');
                }
                col_to_letter_buf(col, out);
            }
            RefStyle::R1C1 { base_col, .. } => {
                write_r1c1_col(out, col, self.absolute, base_col);
                out.push(':');
                write_r1c1_col(out, col, self.absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Col(self.col_id));
    }
}

impl ReferenceTarget for IdentityColRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.col_index(&self.start_col_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((_, s_col)), Some((_, e_col))) = (
            l.col_index(&self.start_col_id),
            l.col_index(&self.end_col_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.start_absolute {
                    out.push('$');
                }
                col_to_letter_buf(s_col, out);
                out.push(':');
                if self.end_absolute {
                    out.push('$');
                }
                col_to_letter_buf(e_col, out);
            }
            RefStyle::R1C1 { base_col, .. } => {
                write_r1c1_col(out, s_col, self.start_absolute, base_col);
                out.push(':');
                write_r1c1_col(out, e_col, self.end_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::ColRange {
            start: self.start_col_id,
            end: self.end_col_id,
        });
    }
}

impl ReferenceTarget for IdentityFormulaRef {
    #[inline]
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        match self {
            Self::Cell(r) => r.resolved_sheet(l),
            Self::Range(r) => r.resolved_sheet(l),
            Self::RectRange(r) => r.resolved_sheet(l),
            Self::FullRow(r) => r.resolved_sheet(l),
            Self::RowRange(r) => r.resolved_sheet(l),
            Self::FullCol(r) => r.resolved_sheet(l),
            Self::ColRange(r) => r.resolved_sheet(l),
            Self::ExternalCell(_) | Self::ExternalRange(_) | Self::ExternalName(_) => None,
        }
    }

    #[inline]
    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        match self {
            Self::Cell(r) => r.display_body(l, style, out),
            Self::Range(r) => r.display_body(l, style, out),
            Self::RectRange(r) => r.display_body(l, style, out),
            Self::FullRow(r) => r.display_body(l, style, out),
            Self::RowRange(r) => r.display_body(l, style, out),
            Self::FullCol(r) => r.display_body(l, style, out),
            Self::ColRange(r) => r.display_body(l, style, out),
            Self::ExternalCell(_) | Self::ExternalRange(_) | Self::ExternalName(_) => {
                external::display_body(l, style, out);
            }
        }
    }

    #[inline]
    fn dep_edges(&self, out: &mut DepEdges) {
        match self {
            Self::Cell(r) => r.dep_edges(out),
            Self::Range(r) => r.dep_edges(out),
            Self::RectRange(r) => r.dep_edges(out),
            Self::FullRow(r) => r.dep_edges(out),
            Self::RowRange(r) => r.dep_edges(out),
            Self::FullCol(r) => r.dep_edges(out),
            Self::ColRange(r) => r.dep_edges(out),
            Self::ExternalCell(r) => external::cell_dep_edges(r, out),
            Self::ExternalRange(r) => external::range_dep_edges(r, out),
            Self::ExternalName(r) => external::name_dep_edges(r, out),
        }
    }
}
