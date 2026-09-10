//! Legacy reference results intersect at the caller; value arrays have no origin.
use super::super::ComputeEngine;
use super::helpers::cell_value_at;
use domain_types::domain::table::{TableColumnSpec, TableSpec};
use domain_types::{
    CellData, CellMetadataBlock, CellMetadataRecord, FutureMetadataBlock, FutureMetadataGroup,
    MetadataType, NamedRange, ParseOutput, SheetData, WorkbookMetadata,
};
use ooxml_types::worksheet::{CellFormula, CellFormulaType};
use value_types::{CellError, CellValue};

fn workbook() -> Vec<u8> {
    let mut data_cells = vec![
        CellData {
            row: 0,
            col: 0,
            value: CellValue::from("Name"),
            ..Default::default()
        },
        CellData {
            row: 0,
            col: 1,
            value: CellValue::from("Number"),
            ..Default::default()
        },
    ];
    for (row, text) in [(1, "one"), (2, "two"), (3, "three")] {
        data_cells.push(CellData {
            row,
            col: 0,
            value: CellValue::from(text),
            ..Default::default()
        });
        data_cells.push(CellData {
            row,
            col: 1,
            value: CellValue::from(row as f64),
            ..Default::default()
        });
        data_cells.push(CellData {
            row,
            col: 2,
            value: CellValue::from(row as f64 * 100.0),
            ..Default::default()
        });
    }
    for (col, value) in [(2, 10.0), (3, 20.0), (4, 30.0)] {
        data_cells.push(CellData {
            row: 0,
            col,
            value: CellValue::from(value),
            ..Default::default()
        });
    }
    let mut formulas = Vec::new();
    for (row, col, formula) in [
        (1, 0, r"\_Prime.1[Name]"),
        (2, 0, r"\_Prime.1[Name]"),
        (2, 2, "Data!A2:A4"),
        (2, 3, "Names"),
        (2, 4, "NamesFormula"),
        (2, 5, "ConstantName"),
        (2, 6, "ArrayName"),
        (2, 7, "INDEX({7;8},0)"),
        (2, 8, "INDEX(Data!A2:A4,0)"),
        (2, 9, "OFFSET(Data!A2,0,0,3,1)"),
        (2, 10, "INDIRECT(\"Data!A2:A4\")"),
        (2, 13, "ROW(Data!A2:A4)"),
        (2, 14, "Data!B2:B4+10"),
        (2, 15, r"@\_Prime.1[Name]"),
        (2, 16, "SINGLE(Names)"),
        (5, 3, "Data!C1:E1"),
        (6, 6, "Data!C1:E1"),
        (7, 2, "Data!A2:A4"),
        (7, 3, "Names"),
        (7, 4, r"\_Prime.1[Name]"),
        (7, 13, "{7;8}"),
        (7, 14, "SINGLE({7;8})"),
        (2, 18, "[0]!Names"),
        (2, 19, "SINGLE(INDEX(Data!A2:A4,0))"),
        (8, 0, "INDEX(Data!A2:A4,-1)"),
        (8, 1, "INDEX(Data!A2:A4,4294967297)"),
    ] {
        // Deliberately stale cache: expected values must come from geometry.
        formulas.push(CellData {
            row,
            col,
            formula: Some(formula.into()),
            value: CellValue::from(999.0),
            ..Default::default()
        });
    }
    for (row, col, range, dynamic) in [
        (2, 11, "L3:L5", true),
        (2, 12, "M3:M5", false),
        (7, 11, "L8:L10", true),
        (7, 12, "M8:M8", false),
    ] {
        formulas.push(CellData {
            row,
            col,
            formula: Some(r"\_Prime.1[Name]".into()),
            value: CellValue::from(999.0),
            array_ref: Some(range.into()),
            cell_metadata_index: dynamic.then_some(1),
            cell_formula: Some(CellFormula {
                t: CellFormulaType::Array,
                r#ref: Some(range.into()),
                text: r"\_Prime.1[Name]".into(),
                ..Default::default()
            }),
            ..Default::default()
        });
    }
    let input = ParseOutput {
        sheets: vec![
            SheetData {
                name: "Data".into(),
                rows: 10,
                cols: 5,
                cells: data_cells,
                tables: vec![TableSpec {
                    id: 1,
                    name: r"\_Prime.1".into(),
                    display_name: r"\_Prime.1".into(),
                    range_ref: "A1:B4".into(),
                    columns: ["Name", "Number"]
                        .into_iter()
                        .enumerate()
                        .map(|(i, name)| TableColumnSpec {
                            id: i as u32 + 1,
                            name: name.into(),
                            ..Default::default()
                        })
                        .collect(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            SheetData {
                name: "Formulas".into(),
                rows: 12,
                cols: 20,
                cells: formulas,
                ..Default::default()
            },
        ],
        named_ranges: [
            ("Names", "Data!$A$2:$A$4"),
            ("NamesFormula", "OFFSET(Data!$A$2,0,0,3,1)"),
            ("ConstantName", "42"),
            ("ArrayName", "{7;8}"),
        ]
        .into_iter()
        .map(|(name, refers_to)| NamedRange {
            name: name.into(),
            refers_to: refers_to.into(),
            ..Default::default()
        })
        .collect(),
        metadata: Some(WorkbookMetadata {
            metadata_types: vec![MetadataType {
                name: "XLDAPR".into(),
                cell_meta: true,
                ..Default::default()
            }],
            future_metadata: vec![FutureMetadataGroup {
                name: "XLDAPR".into(),
                blocks: vec![FutureMetadataBlock {
                    raw_xml: concat!(
                        r#"<extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}">"#,
                        r#"<xda:dynamicArrayProperties xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray" fDynamic="1" fCollapsed="0"/>"#,
                        "</ext></extLst>"
                    ).into(),
                }],
            }],
            cell_metadata: vec![CellMetadataBlock {
                records: vec![CellMetadataRecord { t: 1, v: 0 }],
            }],
            ..Default::default()
        }),
        ..Default::default()
    };
    xlsx_parser::write::write_xlsx_from_parse_output(&input).unwrap()
}

fn assert_results(engine: &ComputeEngine, second_name: &str) {
    let sheet = engine.storage().sheet_order()[1];
    for col in [0, 2, 3, 4, 8, 9, 10, 15, 16, 18, 19] {
        assert_eq!(
            cell_value_at(engine, &sheet, 2, col),
            CellValue::from(second_name),
            "row3 col{col}"
        );
    }
    assert_eq!(cell_value_at(engine, &sheet, 1, 0), CellValue::from("one"));
    for (row, col, expected) in [
        (2, 5, 42.0),
        (2, 6, 7.0),
        (2, 7, 7.0),
        (2, 13, 2.0),
        (2, 14, 11.0),
        (5, 3, 20.0),
        (7, 13, 7.0),
        (7, 14, 7.0),
    ] {
        assert_eq!(
            cell_value_at(engine, &sheet, row, col),
            CellValue::from(expected),
            "row{row} col{col}"
        );
    }
    for (row, col) in [(6, 6), (7, 2), (7, 3), (7, 4)] {
        assert!(
            matches!(
                cell_value_at(engine, &sheet, row, col),
                CellValue::Error(CellError::Value, _)
            ),
            "outside intersection row{row} col{col}"
        );
    }
    for (start_row, col) in [(2, 11), (2, 12), (7, 11)] {
        for (offset, expected) in ["one", second_name, "three"].into_iter().enumerate() {
            assert_eq!(
                cell_value_at(engine, &sheet, start_row + offset as u32, col),
                CellValue::from(expected)
            );
        }
    }
    assert_eq!(
        cell_value_at(engine, &sheet, 7, 12),
        CellValue::from("one"),
        "single-cell CSE remains a value-array projection"
    );
    assert_eq!(
        cell_value_at(engine, &sheet, 3, 13),
        CellValue::Null,
        "computed legacy value arrays do not spill"
    );
    for col in [0, 1] {
        assert!(
            matches!(cell_value_at(engine, &sheet, 8, col), CellValue::Error(..)),
            "invalid INDEX offset must remain an error without coordinate overflow"
        );
    }
}

#[test]
fn legacy_reference_intersection_preserves_geometry_and_formula_modes() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    engine.recalculate().unwrap();
    assert_results(&engine, "two");
    engine.rebuild_compute_core().unwrap();
    assert_results(&engine, "two");
    let data_sheet = engine.storage().sheet_order()[0];
    engine
        .set_cell_value_parsed(&data_sheet, 2, 0, "changed")
        .unwrap();
    assert_results(&engine, "changed");
    let (mut reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&engine.export_to_xlsx_bytes().unwrap()).unwrap();
    reloaded.recalculate().unwrap();
    assert_results(&reloaded, "changed");
}
