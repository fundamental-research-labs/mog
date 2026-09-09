use compute_core::storage::engine::YrsComputeEngine;
use domain_types::{CellData, ParseOutput, RowDimension, RowXmlHints, SheetData, SheetDimensions};
use value_types::{CellValue, FiniteF64};

#[test]
fn row_descent_merges_with_spans_height_and_empty_row_metadata() {
    // Cover populated and blank rows, with spans, descent alone, and height.
    let rows: Vec<_> = (0..6)
        .map(|row| RowDimension {
            row,
            height: if row >= 4 { 22.0 } else { 0.0 },
            custom_height: row >= 4,
            descent: Some(0.2 + row as f64 / 10.0),
            xml_hints: RowXmlHints {
                spans: (row % 2 == 0).then(|| "1:1".into()),
                ..Default::default()
            },
            ..Default::default()
        })
        .collect();
    let authored = ParseOutput {
        sheets: vec![SheetData {
            name: "RowMetadata".into(),
            rows: 6,
            cols: 1,
            cells: [0, 3, 4]
                .into_iter()
                .map(|row| CellData {
                    row,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(1.0)),
                    ..Default::default()
                })
                .collect(),
            dimensions: SheetDimensions {
                row_heights: rows.clone(),
                ..Default::default()
            },
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut bytes = xlsx_parser::write::write_xlsx_from_parse_output(&authored).unwrap();
    for _ in 0..2 {
        let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap();
        bytes = engine.export_to_xlsx_bytes().unwrap();
        let (parsed, _) = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap();
        let dimensions = &parsed.sheets[0].dimensions.row_heights;
        assert_eq!(dimensions.len(), rows.len());
        for expected in &rows {
            let actual = dimensions.iter().find(|r| r.row == expected.row).unwrap();
            assert_eq!(actual.descent, expected.descent, "row {}", expected.row);
            assert_eq!(actual.xml_hints.spans, expected.xml_hints.spans);
            assert_eq!(actual.height, expected.height);
        }
    }
}
