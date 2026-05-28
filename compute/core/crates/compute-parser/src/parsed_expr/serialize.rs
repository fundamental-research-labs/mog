use std::borrow::Cow;

use cell_types::col_to_letter;
use formula_types::{CellRef, IdentityFormula, RangeType};

use crate::ast::{CellRefNode, RangeRef};

use super::ParsedExpr;
use super::literal::constant_to_a1;

impl ParsedExpr {
    /// Materialize an empty [`IdentityFormula`] shell suitable for writing a
    /// `NamedRangeDef` that does not carry concrete identity refs.
    #[must_use]
    pub fn to_identity_formula(&self) -> IdentityFormula {
        IdentityFormula {
            template: String::new(),
            refs: Vec::new(),
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }
    }

    /// Canonical A1 re-emission.
    #[must_use]
    pub fn to_a1_string(&self) -> Cow<'_, str> {
        match self {
            Self::Empty => Cow::Borrowed(""),
            Self::BrokenRef { sheet: None } => Cow::Borrowed("#REF!"),
            Self::BrokenRef { sheet: Some(name) } => {
                Cow::Owned(format!("{}!#REF!", quote_sheet_if_needed(name.as_str())))
            }
            Self::Cell(node) => Cow::Owned(node.to_a1_string()),
            Self::Range(r) => Cow::Owned(r.to_a1_string()),
            Self::SqrefList(list) => Cow::Owned(list.to_a1_string()),
            Self::Constant(v) => Cow::Owned(constant_to_a1(v)),
            Self::Formula(fs) => Cow::Borrowed(fs.original.as_str()),
        }
    }
}

impl CellRefNode {
    /// Canonical A1 form -- upper-case column letters, `$` markers per the
    /// carried `abs_row`/`abs_col` flags.
    #[must_use]
    pub fn to_a1_string(&self) -> String {
        match &self.reference {
            CellRef::Positional { row, col, .. } => {
                format_positional_cell(*row, *col, self.abs_row, self.abs_col)
            }
            CellRef::Resolved(_) => "#REF!".to_string(),
        }
    }
}

impl RangeRef {
    /// Canonical A1 form.
    #[must_use]
    pub fn to_a1_string(&self) -> String {
        match self.range_type {
            RangeType::CellRange => match (&self.start, &self.end) {
                (
                    CellRef::Positional {
                        row: sr, col: sc, ..
                    },
                    CellRef::Positional {
                        row: er, col: ec, ..
                    },
                ) => {
                    let start =
                        format_positional_cell(*sr, *sc, self.abs_start.row, self.abs_start.col);
                    if sr == er
                        && sc == ec
                        && self.abs_start.row == self.abs_end.row
                        && self.abs_start.col == self.abs_end.col
                    {
                        return start;
                    }
                    let end = format_positional_cell(*er, *ec, self.abs_end.row, self.abs_end.col);
                    format!("{start}:{end}")
                }
                _ => "#REF!:#REF!".to_string(),
            },
            RangeType::ColumnRange => match (&self.start, &self.end) {
                (CellRef::Positional { col: sc, .. }, CellRef::Positional { col: ec, .. }) => {
                    let mut out = String::new();
                    if self.abs_start.col {
                        out.push('$');
                    }
                    out.push_str(&col_to_letter(*sc));
                    out.push(':');
                    if self.abs_end.col {
                        out.push('$');
                    }
                    out.push_str(&col_to_letter(*ec));
                    out
                }
                _ => "#REF!:#REF!".to_string(),
            },
            RangeType::RowRange => match (&self.start, &self.end) {
                (CellRef::Positional { row: sr, .. }, CellRef::Positional { row: er, .. }) => {
                    let mut out = String::new();
                    if self.abs_start.row {
                        out.push('$');
                    }
                    out.push_str(&(sr + 1).to_string());
                    out.push(':');
                    if self.abs_end.row {
                        out.push('$');
                    }
                    out.push_str(&(er + 1).to_string());
                    out
                }
                _ => "#REF!:#REF!".to_string(),
            },
            _ => "#REF!".to_string(),
        }
    }
}

pub(super) fn format_positional_cell(row: u32, col: u32, abs_row: bool, abs_col: bool) -> String {
    let mut out = String::new();
    if abs_col {
        out.push('$');
    }
    out.push_str(&col_to_letter(col));
    if abs_row {
        out.push('$');
    }
    out.push_str(&(row + 1).to_string());
    out
}

fn quote_sheet_if_needed(name: &str) -> Cow<'_, str> {
    if crate::ast::needs_quoting(name) {
        Cow::Owned(format!("'{}'", name.replace('\'', "''")))
    } else {
        Cow::Borrowed(name)
    }
}
