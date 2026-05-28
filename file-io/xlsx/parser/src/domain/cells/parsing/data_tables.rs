#![allow(clippy::string_slice)]

use super::super::helpers::{FormulaExtras, parse_a1_reference, parse_cell_ref_fast};
use super::super::types::{DataTableEntry, ParseExtras};
use super::xml_text::validated_xml_text;

/// Classify a single XLSX `<f t="dataTable">` `r1` / `r2` attribute into the
/// typed `formula_types::CellRef` form.
fn parse_data_table_input_ref(s: &str) -> Option<formula_types::CellRef> {
    compute_parser::parse_a1_cell(s).map(|node| node.reference)
}

pub(super) fn push_data_table_entry(
    extras: &mut ParseExtras,
    fe: &FormulaExtras<'_>,
    cell_xml: &[u8],
) {
    let r1_str = fe.r1.map(validated_xml_text);
    let r2_str = fe.r2.map(validated_xml_text);
    let r1_typed = r1_str.as_deref().and_then(parse_data_table_input_ref);
    let r2_typed = r2_str.as_deref().and_then(parse_data_table_input_ref);
    let r1_raw = r1_typed.as_ref().and(r1_str);
    let r2_raw = r2_typed.as_ref().and(r2_str);

    let mut pushed = false;
    if let Some(ref_bytes) = fe.f_ref {
        let ref_val = validated_xml_text(ref_bytes);
        if let Some(colon) = ref_val.find(':') {
            let start_ref = &ref_val[..colon];
            let end_ref = &ref_val[colon + 1..];
            if let (Some((sr, sc)), Some((er, ec))) = (
                parse_a1_reference(start_ref.as_bytes()),
                parse_a1_reference(end_ref.as_bytes()),
            ) {
                extras.data_tables.push(DataTableEntry {
                    start_row: sr,
                    start_col: sc,
                    end_row: er,
                    end_col: ec,
                    row_input_ref: r1_typed,
                    col_input_ref: r2_typed,
                    r1: r1_raw.clone(),
                    r2: r2_raw.clone(),
                    dt2d: fe.dt2d,
                    aca: fe.aca,
                    ca: fe.ca,
                    bx: fe.bx,
                    dtr: fe.dtr,
                    del1: fe.del1,
                    del2: fe.del2,
                });
                pushed = true;
            }
        }
    }

    if !pushed {
        if let Some((cell_row, cell_col)) = parse_cell_ref_fast(cell_xml) {
            extras.data_tables.push(DataTableEntry {
                start_row: cell_row,
                start_col: cell_col,
                end_row: cell_row,
                end_col: cell_col,
                row_input_ref: r1_typed,
                col_input_ref: r2_typed,
                r1: r1_raw.clone(),
                r2: r2_raw.clone(),
                dt2d: fe.dt2d,
                aca: fe.aca,
                ca: fe.ca,
                bx: fe.bx,
                dtr: fe.dtr,
                del1: fe.del1,
                del2: fe.del2,
            });
        }
    }
}

#[cfg(test)]
mod data_table_input_ref_tests {
    use super::parse_data_table_input_ref;
    use formula_types::CellRef;

    #[test]
    fn classifies_simple_absolute_cell() {
        let r = parse_data_table_input_ref("$A$1").expect("absolute cell ref");
        match r {
            CellRef::Positional { row, col, .. } => {
                assert_eq!((row, col), (0, 0));
            }
            CellRef::Resolved(_) => panic!("expected positional"),
        }
    }

    #[test]
    fn classifies_simple_relative_cell() {
        let r = parse_data_table_input_ref("K36").expect("relative cell ref");
        match r {
            CellRef::Positional { row, col, .. } => {
                assert_eq!((row, col), (35, 10));
            }
            CellRef::Resolved(_) => panic!("expected positional"),
        }
    }

    #[test]
    fn ref_error_token_is_none() {
        assert!(parse_data_table_input_ref("#REF!").is_none());
    }

    #[test]
    fn empty_string_is_none() {
        assert!(parse_data_table_input_ref("").is_none());
    }

    #[test]
    fn range_form_is_none() {
        assert!(parse_data_table_input_ref("A1:B2").is_none());
    }

    #[test]
    fn non_ascii_does_not_panic() {
        let _ = parse_data_table_input_ref("Πλήρης_Εκτύπωση");
        let _ = parse_data_table_input_ref("'Sheet 1'!Α1");
        let _ = parse_data_table_input_ref("μμμμμμ");
        let _ = parse_data_table_input_ref("");
        let _ = parse_data_table_input_ref("\u{0}");
    }
}
