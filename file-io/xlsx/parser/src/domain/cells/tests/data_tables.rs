use crate::domain::cells::{CellData, ParseExtras, parse_worksheet_fast_with_extras};

#[test]
fn test_parse_data_table_typed_input_refs() {
    // Master-cell `<f t="dataTable" ref="..." r1="..." r2="...">` with
    // absolute A1 r1/r2 attributes — the standard XLSX shape.
    // Typed data-table input refs: r1/r2 lift to typed `Option<CellRef>` on
    // `DataTableEntry`; the body-cell `formula: String` is dropped from
    // the entry and regenerated at write time.
    let xml = br#"<worksheet><sheetData>
    <row r="2">
      <c r="B2"><f t="dataTable" ref="B2:C3" r1="$A$1" r2="$A$2" dt2D="1" dtr="1" aca="1" ca="1" bx="1" del1="1" del2="1"/><v>1</v></c>
      <c r="C2"><v>2</v></c>
    </row>
    <row r="3">
      <c r="B3"><v>3</v></c>
      <c r="C3"><v>4</v></c>
    </row>
  </sheetData></worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let _ = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    assert_eq!(extras.data_tables.len(), 1, "data table extracted");
    let dt = &extras.data_tables[0];
    assert_eq!(dt.start_row, 1);
    assert_eq!(dt.start_col, 1);
    assert_eq!(dt.end_row, 2);
    assert_eq!(dt.end_col, 2);
    assert!(dt.dt2d, "dt2D=1 attribute parsed");
    assert!(dt.dtr, "dtr=1 attribute parsed");
    assert!(dt.aca, "aca=1 attribute parsed");
    assert!(dt.ca, "ca=1 attribute parsed");
    assert!(dt.bx, "bx=1 attribute parsed");
    assert!(dt.del1, "del1=1 attribute parsed");
    assert!(dt.del2, "del2=1 attribute parsed");

    // r1 = $A$1 → row 0, col 0; r2 = $A$2 → row 1, col 0
    match dt.row_input_ref.as_ref().expect("typed r1") {
        formula_types::CellRef::Positional { row, col, .. } => {
            assert_eq!((*row, *col), (0, 0));
        }
        _ => panic!("expected Positional CellRef for r1"),
    }
    match dt.col_input_ref.as_ref().expect("typed r2") {
        formula_types::CellRef::Positional { row, col, .. } => {
            assert_eq!((*row, *col), (1, 0));
        }
        _ => panic!("expected Positional CellRef for r2"),
    }
}

#[test]
fn test_parse_data_table_ref_error_collapses_to_none() {
    // `#REF!` r1/r2 — the broken-ref case the pre-W4.b
    // `is_broken_cell_ref` shadow parser used to filter. Post-W4.b the
    // typed classifier returns `None`, scheduler later skips the entry.
    let xml = br##"<worksheet><sheetData>
    <row r="2">
      <c r="B2"><f t="dataTable" ref="B2:C3" r1="#REF!" r2="$A$2"/><v>1</v></c>
    </row>
  </sheetData></worksheet>"##;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let _ = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    assert_eq!(extras.data_tables.len(), 1);
    let dt = &extras.data_tables[0];
    assert!(
        dt.row_input_ref.is_none(),
        "r1=#REF! collapses to None at the parser boundary"
    );
    assert!(
        dt.col_input_ref.is_some(),
        "r2=$A$2 stays typed alongside the broken r1"
    );
}

#[test]
fn test_parse_data_table_unicode_does_not_panic() {
    // UTF-8 boundary incident class: byte-level shadow parsers panicked on
    // `&str[n..]` slices at non-UTF-8 boundaries. Sheet-qualified
    // refs and non-ASCII names were the trigger. Even though XLSX
    // r1/r2 attributes are normally bare-cell ASCII (e.g. `$A$1`), a
    // malformed XLSX could carry a sheet-qualified or non-ASCII string;
    // the parser must classify-or-reject without panicking.
    let xml = "<worksheet><sheetData>
    <row r=\"2\">
      <c r=\"B2\"><f t=\"dataTable\" ref=\"B2:C3\" r1=\"'Πλήρης'!A1\" r2=\"μμμ\"/><v>1</v></c>
    </row>
  </sheetData></worksheet>"
        .as_bytes();

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 10];
    let mut strings = Vec::new();
    let mut extras = ParseExtras::default();

    let _ = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut Vec::new(),
        &mut extras,
        &[],
    );

    // We don't assert the specific classification — just that nothing
    // panicked and the entry exists. Sheet-qualified shape rejects to
    // `None` (parse_a1_cell takes a single bare cell ref).
    assert_eq!(extras.data_tables.len(), 1);
    let dt = &extras.data_tables[0];
    assert!(dt.row_input_ref.is_none(), "sheet-qualified ref rejects");
    assert!(dt.col_input_ref.is_none(), "non-ASCII garbage rejects");
}
