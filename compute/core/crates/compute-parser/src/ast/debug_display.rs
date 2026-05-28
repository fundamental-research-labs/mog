use std::fmt;

use cell_types::col_to_letter;
use formula_types::{CellRef, RangeType, SpecialItem, StructuredRef, StructuredRefSpecifier};

use super::{ASTNode, AbsFlags, UnaryOp, needs_quoting};

/// Format a cell reference as `A1`, `$A$1`, etc.
fn format_cell_ref(
    f: &mut std::fmt::Formatter<'_>,
    reference: &CellRef,
    abs_row: bool,
    abs_col: bool,
) -> std::fmt::Result {
    match reference {
        CellRef::Positional { row, col, .. } => {
            if abs_col {
                write!(f, "$")?;
            }
            write!(f, "{}", col_to_letter(*col))?;
            if abs_row {
                write!(f, "$")?;
            }
            write!(f, "{}", row + 1)
        }
        CellRef::Resolved(_cell_id) => {
            // Resolved refs don't carry row/col — best-effort fallback.
            write!(f, "<resolved>")
        }
    }
}

/// Format a range reference: `A1:B10`, `A:C`, `1:5`.
fn format_range(
    f: &mut std::fmt::Formatter<'_>,
    start: &CellRef,
    end: &CellRef,
    abs_start: AbsFlags,
    abs_end: AbsFlags,
    range_type: RangeType,
) -> std::fmt::Result {
    match range_type {
        RangeType::CellRange => {
            format_cell_ref(f, start, abs_start.row, abs_start.col)?;
            write!(f, ":")?;
            format_cell_ref(f, end, abs_end.row, abs_end.col)
        }
        RangeType::ColumnRange => {
            if let (CellRef::Positional { col: sc, .. }, CellRef::Positional { col: ec, .. }) =
                (start, end)
            {
                if abs_start.col {
                    write!(f, "$")?;
                }
                write!(f, "{}", col_to_letter(*sc))?;
                write!(f, ":")?;
                if abs_end.col {
                    write!(f, "$")?;
                }
                write!(f, "{}", col_to_letter(*ec))?;
                return Ok(());
            }
            write!(f, "<col-range>")
        }
        RangeType::RowRange => {
            if let (CellRef::Positional { row: sr, .. }, CellRef::Positional { row: er, .. }) =
                (start, end)
            {
                if abs_start.row {
                    write!(f, "$")?;
                }
                write!(f, "{}", sr + 1)?;
                write!(f, ":")?;
                if abs_end.row {
                    write!(f, "$")?;
                }
                write!(f, "{}", er + 1)?;
                return Ok(());
            }
            write!(f, "<row-range>")
        }
        _ => write!(f, "<range>"),
    }
}

/// Format a structured reference directly to a formatter.
fn format_structured_ref(f: &mut fmt::Formatter<'_>, sr: &StructuredRef) -> fmt::Result {
    write!(f, "{}[", sr.table_name)?;
    let specs = &sr.specifiers;
    if specs.len() == 1 {
        format_specifier(f, &specs[0])?;
    } else {
        for (i, spec) in specs.iter().enumerate() {
            if i > 0 {
                write!(f, ",")?;
            }
            format_specifier(f, spec)?;
        }
    }
    write!(f, "]")
}

fn format_specifier(f: &mut fmt::Formatter<'_>, spec: &StructuredRefSpecifier) -> fmt::Result {
    match spec {
        StructuredRefSpecifier::Column { name } => {
            write!(f, "[{name}]")
        }
        StructuredRefSpecifier::ColumnRange { start, end } => {
            write!(f, "[{start}]:[{end}]")
        }
        StructuredRefSpecifier::ThisRow => {
            write!(f, "[#This Row]")
        }
        StructuredRefSpecifier::Special { item } => match item {
            SpecialItem::All => write!(f, "[#All]"),
            SpecialItem::Data => write!(f, "[#Data]"),
            SpecialItem::Headers => write!(f, "[#Headers]"),
            SpecialItem::Totals => write!(f, "[#Totals]"),
            SpecialItem::ThisRow => write!(f, "[#This Row]"),
        },
    }
}

/// Debug/test display for AST nodes.
///
/// **Note:** This `Display` impl is intended for debugging and round-trip tests
/// on *unresolved* ASTs only. Resolved ASTs (containing `SheetRef` with `SheetId`
/// or `CellRef::Resolved`) produce unparseable output like `Sheet(UUID)!A1`.
/// Production formula display remains in `display.rs`, `a1_display.rs`, and
/// `r1c1_display.rs`.
#[allow(clippy::too_many_lines)]
#[allow(clippy::float_cmp)]
impl std::fmt::Display for ASTNode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Number(n) => {
                if n.is_nan() {
                    write!(f, "#NUM!")
                } else if n.is_infinite() {
                    if *n > 0.0 {
                        write!(f, "1E+308")
                    } else {
                        write!(f, "-1E+308")
                    }
                } else if *n == 0.0 {
                    write!(f, "0")
                } else if *n == n.floor() && n.abs() < 1e15 {
                    #[allow(clippy::cast_possible_truncation)]
                    let int_val = *n as i64;
                    write!(f, "{int_val}")
                } else {
                    write!(f, "{n}")
                }
            }
            Self::Text(s) => {
                write!(f, "\"")?;
                let mut first = true;
                for part in s.split('"') {
                    if !first {
                        write!(f, "\"\"")?;
                    }
                    first = false;
                    f.write_str(part)?;
                }
                write!(f, "\"")
            }
            Self::Boolean(b) => {
                write!(f, "{}", if *b { "TRUE" } else { "FALSE" })
            }
            Self::Error(e) => write!(f, "{e}"),
            Self::CellReference(c) => format_cell_ref(f, &c.reference, c.abs_row, c.abs_col),
            Self::Range(r) => {
                format_range(f, &r.start, &r.end, r.abs_start, r.abs_end, r.range_type)
            }
            Self::SheetRef { sheet, inner } => {
                write!(f, "Sheet({sheet})!")?;
                write!(f, "{inner}")
            }
            Self::UnresolvedSheetRef { sheet_name, inner } => {
                if needs_quoting(sheet_name) {
                    write!(f, "'{}'!", sheet_name.replace('\'', "''"))?;
                } else {
                    write!(f, "{sheet_name}!")?;
                }
                write!(f, "{inner}")
            }
            Self::ThreeDRef {
                start_sheet,
                end_sheet,
                inner,
            } => {
                write!(f, "Sheet({start_sheet}):Sheet({end_sheet})!")?;
                write!(f, "{inner}")
            }
            Self::UnresolvedThreeDRef {
                start_name,
                end_name,
                inner,
            } => {
                let start_q = needs_quoting(start_name);
                let end_q = needs_quoting(end_name);
                if start_q || end_q {
                    write!(f, "'{}':", start_name.replace('\'', "''"))?;
                    write!(f, "'{}'!", end_name.replace('\'', "''"))?;
                } else {
                    write!(f, "{start_name}:{end_name}!")?;
                }
                write!(f, "{inner}")
            }
            Self::ExternalSheetRef {
                workbook,
                sheet_name,
                inner,
            } => {
                write!(
                    f,
                    "'{}{}'!{inner}",
                    workbook.as_str().replace('\'', "''"),
                    sheet_name.replace('\'', "''")
                )
            }
            Self::ExternalThreeDRef {
                workbook,
                start_sheet,
                end_sheet,
                inner,
            } => write!(
                f,
                "'{}{}:{}'!{inner}",
                workbook.as_str().replace('\'', "''"),
                start_sheet.replace('\'', "''"),
                end_sheet.replace('\'', "''")
            ),
            Self::ExternalNameRef { workbook, name } => {
                write!(f, "{}{}", workbook.as_str(), name)
            }
            Self::StructuredRef(sr) => format_structured_ref(f, sr),
            Self::BinaryOp { op, left, right } => {
                write!(f, "{left}{op}{right}")
            }
            Self::UnaryOp { op, operand } => match op {
                UnaryOp::Percent => write!(f, "{operand}%"),
                UnaryOp::Plus => write!(f, "+{operand}"),
                UnaryOp::Minus => write!(f, "-{operand}"),
                UnaryOp::ImplicitIntersection => write!(f, "@{operand}"),
            },
            Self::Function { name, args } => {
                write!(f, "{name}(")?;
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write!(f, "{arg}")?;
                }
                write!(f, ")")
            }
            Self::Paren(inner) => write!(f, "({inner})"),
            Self::Identifier(name) => write!(f, "{name}"),
            Self::OptionalLambdaParam(name) => write!(f, "[{name}]"),
            Self::Array { rows } => {
                write!(f, "{{")?;
                for (i, row) in rows.iter().enumerate() {
                    if i > 0 {
                        write!(f, ";")?;
                    }
                    for (j, elem) in row.iter().enumerate() {
                        if j > 0 {
                            write!(f, ",")?;
                        }
                        write!(f, "{elem}")?;
                    }
                }
                write!(f, "}}")
            }
            Self::CallExpression { callee, args } => {
                write!(f, "{callee}(")?;
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write!(f, "{arg}")?;
                }
                write!(f, ")")
            }
            Self::Omitted => Ok(()),
            Self::RangeOp { start, end } => write!(f, "{start}:{end}"),
            Self::Union { ranges } => {
                write!(f, "(")?;
                for (i, range) in ranges.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write!(f, "{range}")?;
                }
                write!(f, ")")
            }
        }
    }
}
