//! Parsed table-reference rewrites shared by native cell and named formulas.

use compute_parser::{ReferenceTokenClass, parse_structured_ref, rewrite_reference_tokens};
use formula_types::{StructuredRef, StructuredRefSpecifier, TableDef};

pub(crate) enum TableReferenceEdit<'a> {
    RenameTable {
        old: &'a str,
        new: &'a str,
    },
    RenameColumn {
        table: &'a str,
        old: &'a str,
        new: &'a str,
    },
    DeleteTable {
        table: &'a str,
    },
    DeleteColumn {
        table: &'a str,
        column: &'a str,
    },
    ConvertToRange {
        table: &'a TableDef,
        sheet_name: &'a str,
    },
}

impl TableReferenceEdit<'_> {
    pub(crate) fn rewrite(&self, formula: &str, current_row: Option<u32>) -> String {
        rewrite_reference_tokens(formula, |class, text| {
            let mut reference = match class {
                ReferenceTokenClass::StructuredRef => parse_structured_ref(text).ok()?,
                _ => return None,
            };
            let target = match self {
                Self::RenameTable { old, .. } => *old,
                Self::RenameColumn { table, .. }
                | Self::DeleteTable { table }
                | Self::DeleteColumn { table, .. } => *table,
                Self::ConvertToRange { table, .. } => table.name.as_str(),
            };
            if !reference.table_name.eq_ignore_ascii_case(target) {
                return None;
            }
            match self {
                Self::RenameTable { new, .. } => {
                    // Preserve the user's bracket spelling when only the name changes.
                    Some(format!("{}{}", new, &text[reference.table_name.len()..]))
                }
                Self::DeleteTable { .. } => Some("#REF!".to_string()),
                Self::RenameColumn { old, new, .. } => {
                    let mut changed = false;
                    for spec in &mut reference.specifiers {
                        let mut rename = |name: &mut String| {
                            if name.eq_ignore_ascii_case(old) {
                                *name = new.to_string();
                                changed = true;
                            }
                        };
                        match spec {
                            StructuredRefSpecifier::Column { name } => rename(name),
                            StructuredRefSpecifier::ColumnRange { start, end } => {
                                rename(start);
                                rename(end);
                            }
                            _ => {}
                        }
                    }
                    changed
                        .then(|| compute_table::structured_refs::format_structured_ref(&reference))
                }
                Self::DeleteColumn { column, .. } => reference
                    .specifiers
                    .iter()
                    .any(|spec| match spec {
                        StructuredRefSpecifier::Column { name } => {
                            name.eq_ignore_ascii_case(column)
                        }
                        StructuredRefSpecifier::ColumnRange { start, end } => {
                            start.eq_ignore_ascii_case(column) || end.eq_ignore_ascii_case(column)
                        }
                        _ => false,
                    })
                    .then(|| "#REF!".to_string()),
                Self::ConvertToRange { table, sheet_name } => Some(
                    resolved_a1(&reference, table, sheet_name, current_row)
                        .unwrap_or_else(|| "#REF!".to_string()),
                ),
            }
        })
    }
}

fn resolved_a1(
    reference: &StructuredRef,
    table: &TableDef,
    sheet_name: &str,
    current_row: Option<u32>,
) -> Option<String> {
    let ranges = compute_table::structured_refs::resolve_ranges_from_table_def(
        reference,
        table,
        current_row,
    )?;
    let qualifier = format!("'{}'!", sheet_name.replace('\'', "''"));
    let mut parts = Vec::new();
    for range in ranges {
        // Preserve contiguous column spans, and express disjoint selections as a union.
        let mut columns = range.columns.into_iter();
        let mut start = columns.next()?;
        let mut end = start;
        for next in columns.chain(std::iter::once(u32::MAX)) {
            if next == end + 1 {
                end = next;
                continue;
            }
            let first = format!(
                "${}${}",
                cell_types::col_to_letter(start),
                range.start_row + 1
            );
            let last = format!("${}${}", cell_types::col_to_letter(end), range.end_row + 1);
            parts.push(if first == last {
                format!("{qualifier}{first}")
            } else {
                format!("{qualifier}{first}:{last}")
            });
            start = next;
            end = next;
        }
    }
    match parts.len() {
        0 => None,
        1 => parts.pop(),
        _ => Some(format!("({})", parts.join(","))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn table() -> TableDef {
        TableDef {
            name: "Sales".into(),
            sheet: cell_types::SheetId::from_raw(1),
            start_row: 0,
            start_col: 1,
            end_row: 4,
            end_col: 3,
            columns: vec!["Date".into(), "Amount".into(), "Tax".into()],
            has_headers: true,
            has_totals: true,
        }
    }
    #[test]
    fn native_table_references_preserve_literals_nested_brackets_and_other_tables() {
        let rename = TableReferenceEdit::RenameTable {
            old: "Sales",
            new: "Revenue",
        };
        assert_eq!(
            rename.rewrite(
                "=\"😀 Sales[Amount]\"&SUM(sales[[#Headers],[Amount]])+Other[Amount]",
                None
            ),
            "=\"😀 Sales[Amount]\"&SUM(Revenue[[#Headers],[Amount]])+Other[Amount]"
        );
        let column = TableReferenceEdit::RenameColumn {
            table: "Sales",
            old: "Amount",
            new: "Net",
        };
        assert_eq!(
            column.rewrite(
                "Sales[@[Amount]]+Sales[[Amount]:[Tax]]+Other[Amount]",
                Some(2)
            ),
            "Sales[@Net]+Sales[[Net]:[Tax]]+Other[Amount]"
        );
        let delete = TableReferenceEdit::DeleteColumn {
            table: "Sales",
            column: "Amount",
        };
        assert_eq!(
            delete.rewrite("Sales[@Amount]+Other[Amount]+\"Sales[Amount]\"", Some(2)),
            "#REF!+Other[Amount]+\"Sales[Amount]\""
        );
        let escaped = TableReferenceEdit::RenameColumn {
            table: "Sales",
            old: "A]B",
            new: "Other",
        };
        assert_eq!(escaped.rewrite("Sales['A]]B']+1", None), "Sales[Other]+1");
    }
    #[test]
    fn native_table_references_conversion_resolves_columns_rows_and_sheet_context() {
        let table = table();
        let edit = TableReferenceEdit::ConvertToRange {
            table: &table,
            sheet_name: "O'Brien Data",
        };
        assert_eq!(
            edit.rewrite("SUM(Sales[Amount])", None),
            "SUM('O''Brien Data'!$C$2:$C$4)"
        );
        assert_eq!(
            edit.rewrite("Sales[[#Headers],[Amount]]", None),
            "'O''Brien Data'!$C$1"
        );
        assert_eq!(
            edit.rewrite("Sales[[#Totals],[Amount]:[Tax]]", None),
            "'O''Brien Data'!$C$5:$D$5"
        );
        assert_eq!(
            edit.rewrite("Sales[@Amount]", Some(2)),
            "'O''Brien Data'!$C$3"
        );
        assert_eq!(edit.rewrite("Sales[Missing]", None), "#REF!");
    }
}
