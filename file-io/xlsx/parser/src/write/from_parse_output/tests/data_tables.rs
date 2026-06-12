use super::*;

#[test]
fn data_table_regions_drive_ooxml_formula_export_with_flags() {
    let mut output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(0, 1, DomainValue::Number(FiniteF64::new(2.0).unwrap())),
            make_formula_cell(
                1,
                1,
                "TABLE($A$1,$B$1)",
                DomainValue::Number(FiniteF64::new(3.0).unwrap()),
            ),
            make_formula_cell(
                1,
                2,
                "TABLE($A$1,$B$1)",
                DomainValue::Number(FiniteF64::new(4.0).unwrap()),
            ),
        ],
        ..Default::default()
    }]);
    output.data_table_regions.push(DataTableRegion {
        sheet_index: 0,
        start_row: 1,
        start_col: 1,
        end_row: 1,
        end_col: 2,
        row_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 0,
            col: 1,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 0,
            col: 0,
        }),
        ooxml_flags: Some(DataTableOoxmlFlags {
            r1: None,
            r2: None,
            aca: true,
            ca: true,
            bx: true,
            dt2d: true,
            dtr: true,
            del1: true,
            del2: true,
        }),
    });

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f t=\"dataTable\""));
    assert!(sheet_xml.contains("ref=\"B2:C2\""));
    assert!(sheet_xml.contains("r1=\"$A$1\""));
    assert!(sheet_xml.contains("r2=\"$B$1\""));
    assert!(sheet_xml.contains("aca=\"1\""));
    assert!(sheet_xml.contains("ca=\"1\""));
    assert!(sheet_xml.contains("bx=\"1\""));
    assert!(sheet_xml.contains("dt2D=\"1\""));
    assert!(sheet_xml.contains("dtr=\"1\""));
    assert!(sheet_xml.contains("del1=\"1\""));
    assert!(sheet_xml.contains("del2=\"1\""));
}

#[test]
fn two_variable_data_table_region_without_import_sidecar_exports_dt2d() {
    let mut output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![make_formula_cell(
            2,
            2,
            "TABLE($A$2,$A$1)",
            DomainValue::Number(FiniteF64::new(300.0).unwrap()),
        )],
        ..Default::default()
    }]);
    output.data_table_regions.push(DataTableRegion {
        sheet_index: 0,
        start_row: 2,
        start_col: 2,
        end_row: 3,
        end_col: 3,
        row_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 1,
            col: 0,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 0,
            col: 0,
        }),
        ooxml_flags: None,
    });

    let sheet_xml = sheet_xml_from_output(&output);

    assert!(sheet_xml.contains("<f t=\"dataTable\""));
    assert!(sheet_xml.contains("ref=\"C3:D4\""));
    assert!(sheet_xml.contains("r1=\"$A$1\""));
    assert!(sheet_xml.contains("r2=\"$A$2\""));
    assert!(sheet_xml.contains("dt2D=\"1\""));
}

#[test]
fn one_variable_data_table_regions_without_import_sidecar_do_not_export_dt2d() {
    for (row_input_ref, col_input_ref, formula) in [
        (
            Some(CellRef::Positional {
                sheet: cell_types::SheetId::from_raw(0),
                row: 1,
                col: 0,
            }),
            None,
            "TABLE($A$2,)",
        ),
        (
            None,
            Some(CellRef::Positional {
                sheet: cell_types::SheetId::from_raw(0),
                row: 0,
                col: 0,
            }),
            "TABLE(,$A$1)",
        ),
    ] {
        let mut output = make_parse_output(vec![SheetData {
            name: "DataTable".to_string(),
            cells: vec![make_formula_cell(
                2,
                2,
                formula,
                DomainValue::Number(FiniteF64::new(300.0).unwrap()),
            )],
            ..Default::default()
        }]);
        output.data_table_regions.push(DataTableRegion {
            sheet_index: 0,
            start_row: 2,
            start_col: 2,
            end_row: 3,
            end_col: 2,
            row_input_ref,
            col_input_ref,
            ooxml_flags: None,
        });

        let sheet_xml = sheet_xml_from_output(&output);

        assert!(sheet_xml.contains("<f t=\"dataTable\""));
        assert!(!sheet_xml.contains("dt2D=\"1\""));
    }
}

#[test]
fn data_table_regions_preserve_authored_r1_r2_spelling_when_present() {
    let mut output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![make_formula_cell(
            6,
            7,
            "TABLE($C$21,$C$8)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);
    output.data_table_regions.push(DataTableRegion {
        sheet_index: 0,
        start_row: 6,
        start_col: 7,
        end_row: 10,
        end_col: 11,
        row_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 20,
            col: 2,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 7,
            col: 2,
        }),
        ooxml_flags: Some(DataTableOoxmlFlags {
            r1: Some("C8".to_string()),
            r2: Some("C21".to_string()),
            dt2d: true,
            dtr: true,
            ca: true,
            ..Default::default()
        }),
    });

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f t=\"dataTable\""));
    assert!(sheet_xml.contains("ref=\"H7:L11\""));
    assert!(sheet_xml.contains("r1=\"C8\""));
    assert!(sheet_xml.contains("r2=\"C21\""));
    assert!(!sheet_xml.contains("r1=\"$C$8\""));
    assert!(!sheet_xml.contains("r2=\"$C$21\""));
}

#[test]
fn table_formula_body_cells_export_as_cached_values_only() {
    let output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![make_formula_cell(
            6,
            8,
            "TABLE($C$21,$C$8)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<c r=\"I7\""));
    assert!(sheet_xml.contains("<v>3</v>"));
    assert!(!sheet_xml.contains("<f>TABLE("));
}
