use super::*;

#[test]
fn test_empty_workbook() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_number_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(42.0).unwrap())),
            make_cell(0, 1, DomainValue::Number(FiniteF64::new(3.14).unwrap())),
        ],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_string_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello world")))],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_formula_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(A2:A10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn modeled_formula_metadata_decorates_current_formula_cell() {
    let mut formula_cell = make_formula_cell(
        0,
        0,
        "SUM(A2:A10)",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    formula_cell.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        r#ref: Some("A1:A1".to_string()),
        text: "SUM(A2:A10)".to_string(),
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![formula_cell],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<f t="shared" si="7" ref="A1:A1""#));
}

#[test]
fn shared_formula_range_is_preserved_when_group_matches_live_formulas() {
    let mut master = make_formula_cell(
        0,
        0,
        "A1+1",
        DomainValue::Number(FiniteF64::new(2.0).unwrap()),
    );
    master.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        r#ref: Some("A1:A2".to_string()),
        text: "A1+1".to_string(),
        ..Default::default()
    });
    let mut follower = make_formula_cell(
        1,
        0,
        "A2+1",
        DomainValue::Number(FiniteF64::new(3.0).unwrap()),
    );
    follower.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![master, follower],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<f t="shared" si="7" ref="A1:A2">A1+1</f>"#));
    assert!(sheet_xml.contains(r#"<f t="shared" si="7"/>"#));
    assert!(sheet_xml.contains(r#"<v>2</v>"#));
    assert!(sheet_xml.contains(r#"<v>3</v>"#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
    assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn array_formula_range_is_not_replayed_without_modeled_group() {
    let mut formula_cell = make_formula_cell(
        0,
        0,
        "SUM(A2:A10)",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    formula_cell.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("A1:A2".to_string()),
        text: "SUM(A2:A10)".to_string(),
        aca: true,
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![formula_cell],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(A2:A10)</f>"));
    assert!(!sheet_xml.contains(r#"t="array""#));
    assert!(!sheet_xml.contains(r#"aca="1""#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
}

#[test]
fn stale_shared_formula_range_decompacts_to_current_plain_formulas() {
    let mut master = make_formula_cell(
        0,
        0,
        "SUM(A2:A10)",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    master.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        r#ref: Some("A1:A2".to_string()),
        text: "SUM(A2:A10)".to_string(),
        ..Default::default()
    });
    let mut follower = make_formula_cell(
        1,
        0,
        "SUM(B2:B10)",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    follower.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![master, follower],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(A2:A10)</f>"));
    assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
    assert!(!sheet_xml.contains(r#"t="shared""#));
    assert!(!sheet_xml.contains(r#"si="7""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_array_formula_range_is_preserved_when_current_array_ref_matches() {
    let mut formula_cell = make_formula_cell(
        0,
        0,
        "SUM(A2:A10)",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    formula_cell.array_ref = Some("A1:A2".to_string());
    formula_cell.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("A1:A2".to_string()),
        text: "SUM(A2:A10)".to_string(),
        aca: true,
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![formula_cell],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<f ref="A1:A2" t="array" aca="1">SUM(A2:A10)</f>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_xlfn_array_formula_metadata_matches_normalized_current_formula() {
    let mut formula_cell = make_formula_cell(
        0,
        0,
        "STDEV.S(FILTER(A2:A10,B2:B10=1))",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    formula_cell.array_ref = Some("A1:A2".to_string());
    formula_cell.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("A1:A2".to_string()),
        text: "_xlfn.STDEV.S(_xlfn._xlws.FILTER(A2:A10,B2:B10=1))".to_string(),
        aca: true,
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![formula_cell],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(
        r#"<f ref="A1:A2" t="array" aca="1">_xlfn.STDEV.S(_xlfn._xlws.FILTER(A2:A10,B2:B10=1))</f>"#
    ));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn default_roundtrip_context_does_not_decorate_formula_cell() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(B2:B10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
    assert!(!sheet_xml.contains(r#"t="shared""#));
    assert!(!sheet_xml.contains(r#"si="7""#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
    assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
}

#[test]
fn stale_formula_hints_do_not_decorate_replaced_value_cell() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(42.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<f"));
    assert!(!sheet_xml.contains(r#"ca="1""#));
    assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
}

#[test]
fn stale_data_table_formula_metadata_does_not_decorate_edited_formula_cell() {
    let mut edited_formula_cell = make_formula_cell(
        0,
        0,
        "SUM(B2:B10)",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    edited_formula_cell.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::DataTable,
        r#ref: Some("A1:B2".to_string()),
        r1: Some("$A$1".to_string()),
        r2: Some("$B$1".to_string()),
        dt2d: true,
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![edited_formula_cell],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
    assert!(!sheet_xml.contains(r#"t="dataTable""#));
    assert!(!sheet_xml.contains(r#"dt2D="1""#));
}

#[test]
fn test_mixed_cell_types() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(0, 1, DomainValue::Text(Arc::from("text"))),
            make_cell(1, 0, DomainValue::Boolean(true)),
            make_cell(1, 1, DomainValue::Error(value_types::CellError::Ref, None)),
            make_cell(2, 0, DomainValue::Null),
        ],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_merges() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("merged")))],
        merges: vec![MergeRegion {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 2,
        }],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_col_widths_and_row_heights() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        dimensions: SheetDimensions {
            col_widths: vec![ColDimension {
                col: 0,
                width: 20.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            }],
            row_heights: vec![RowDimension {
                row: 0,
                height: 25.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            }],
            ..Default::default()
        },
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_frozen_pane() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        frozen_pane: Some(FrozenPane {
            rows: 1,
            cols: 0,
            top_left_cell: None,
        }),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn stale_pane_qualified_selection_is_dropped_without_current_pane() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        view: domain_types::SheetView {
            selections: vec![ooxml_types::worksheet::Selection {
                pane: Some(ooxml_types::worksheet::Pane::BottomRight),
                active_cell: Some("C3".to_string()),
                active_cell_id: None,
                sqref: Some("C3".to_string()),
            }],
            active_cell: Some("A1".to_string()),
            ..Default::default()
        },
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains(r#"pane="bottomRight""#));
    assert!(sheet_xml.contains(r#"<selection activeCell="A1" sqref="A1"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn sheet_view_selection_exports_from_modeled_state() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        view: domain_types::SheetView {
            active_cell: Some("A1".to_string()),
            sqref: Some("A1".to_string()),
            ..Default::default()
        },
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains(r#"pane="bottomRight""#));
    assert!(!sheet_xml.contains(r#"activeCell="C3""#));
    assert!(!sheet_xml.contains(r#"sqref="C3""#));
    assert!(sheet_xml.contains(r#"<selection activeCell="A1" sqref="A1"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_extra_sheet_view_pane_selection_is_dropped_without_current_pane() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        view: domain_types::SheetView {
            active_cell: Some("A1".to_string()),
            sqref: Some("A1".to_string()),
            ..Default::default()
        },
        extra_sheet_views: vec![domain_types::SheetView {
            pane: Some(domain_types::SheetPaneConfig::from_ooxml(
                &ooxml_types::worksheet::SheetPane::frozen(1, 1),
            )),
            selections: vec![ooxml_types::worksheet::Selection {
                pane: Some(ooxml_types::worksheet::Pane::BottomRight),
                active_cell: Some("C3".to_string()),
                active_cell_id: None,
                sqref: Some("C3".to_string()),
            }],
            workbook_view_id: 1,
            ..Default::default()
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<pane"));
    assert!(!sheet_xml.contains(r#"pane="bottomRight""#));
    assert!(!sheet_xml.contains(r#"activeCell="C3""#));
    assert!(!sheet_xml.contains(r#"sqref="C3""#));
    assert!(sheet_xml.contains(r#"<selection activeCell="A1" sqref="A1"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn split_pane_exports_from_typed_view_state() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        view: domain_types::SheetView {
            pane: Some(domain_types::SheetPaneConfig {
                state: domain_types::SheetPaneState::Split,
                x_split: 1200.5,
                y_split: 2400.25,
                top_left_cell: Some("C5".to_string()),
                active_pane: Some(domain_types::SheetPaneId::BottomRight),
            }),
            selections: vec![ooxml_types::worksheet::Selection {
                pane: Some(ooxml_types::worksheet::Pane::BottomRight),
                active_cell: Some("C5".to_string()),
                active_cell_id: None,
                sqref: Some("C5".to_string()),
            }],
            ..Default::default()
        },
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"state="split""#));
    assert!(sheet_xml.contains(r#"xSplit="1200.5""#));
    assert!(sheet_xml.contains(r#"ySplit="2400.25""#));
    assert!(!sheet_xml.contains(r#"state="frozen""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn extra_sheet_view_exports_from_domain_view_state() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        view: domain_types::SheetView {
            pane: Some(domain_types::SheetPaneConfig {
                state: domain_types::SheetPaneState::Split,
                x_split: 90.0,
                y_split: 0.0,
                top_left_cell: None,
                active_pane: Some(domain_types::SheetPaneId::TopRight),
            }),
            ..Default::default()
        },
        extra_sheet_views: vec![domain_types::SheetView {
            workbook_view_id: 1,
            view: Some("pageLayout".to_string()),
            pane: Some(domain_types::SheetPaneConfig {
                state: domain_types::SheetPaneState::Split,
                x_split: 90.0,
                y_split: 0.0,
                top_left_cell: None,
                active_pane: Some(domain_types::SheetPaneId::TopRight),
            }),
            ..Default::default()
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"workbookViewId="1""#));
    assert!(sheet_xml.contains(r#"view="pageLayout""#));
    assert!(sheet_xml.contains(r#"state="split""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn test_multiple_sheets() {
    let output = make_parse_output(vec![
        SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Number(FiniteF64::new(1.0).unwrap()),
            )],
            ..Default::default()
        },
        SheetData {
            name: "Sheet2".to_string(),
            cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("sheet2")))],
            ..Default::default()
        },
    ]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_styled_cells() {
    let palette = vec![
        DocumentFormat {
            font: Some(FontFormat {
                bold: Some(true),
                size: Some(14_000), // 14pt in millipoints
                color: Some("#FF0000".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        },
        DocumentFormat {
            fill: Some(FillFormat {
                background_color: Some("#00FF00".to_string()),
                pattern_type: Some("solid".to_string()),
                ..Default::default()
            }),
            number_format: Some("#,##0.00".to_string()),
            ..Default::default()
        },
    ];

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                {
                    let mut c = make_cell(0, 0, DomainValue::Number(FiniteF64::new(42.0).unwrap()));
                    c.style_id = Some(0); // palette[0] -> cellXfs[1]
                    c
                },
                {
                    let mut c =
                        make_cell(0, 1, DomainValue::Number(FiniteF64::new(1234.56).unwrap()));
                    c.style_id = Some(1); // palette[1] -> cellXfs[2]
                    c
                },
            ],
            ..Default::default()
        }],
        style_palette: palette,
        workbook_stylesheet: None,
        ..Default::default()
    };
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}
