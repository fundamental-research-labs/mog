//! Exercise the same import-normalize-export boundary used by the workbook engine.
use compute_parser::normalize_xlsx_formula;
use domain_types::{CellData, ParseOutput, SheetData};
use value_types::CellValue;
use xlsx_parser::{XlsxArchive, parse_xlsx_to_output, write::write_xlsx_from_parse_output};

#[test]
fn normalized_future_functions_and_local_names_survive_xlsx_reopening() {
    let storage_formulas = [
        "_xlfn.CONCAT(A1,B1)",
        "_xlfn.TEXTJOIN(\",\",TRUE,A1:B1)",
        "_xlfn.MAXIFS(A1:A2,B1:B2,1)",
        "_xlfn.MINIFS(A1:A2,B1:B2,1)",
        "_xlfn.XMATCH(A1,B1:B2,-1)",
        "_xlfn.LET(_xlpm.x,10,_xlpm.x*2)",
        "_xlfn.LET(_xlpm.fn,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.fn(2))",
        "_xlfn.LAMBDA(_xlpm.x,_xlfn.LET(_xlpm.y,_xlpm.x+1,_xlpm.y))(2)",
        "_xlfn._xlws.FILTER(A1:A2,B1:B2=1)",
    ];
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: storage_formulas.len() as u32,
            cols: 1,
            cells: storage_formulas
                .iter()
                .enumerate()
                .map(|(row, formula)| CellData {
                    row: row as u32,
                    col: 0,
                    // Engine export removes the display '=' before constructing
                    // ParseOutput (services/export/cells/materialize.rs).
                    formula: Some(
                        normalize_xlsx_formula(formula)
                            .strip_prefix('=')
                            .expect("normalized formulas have a display prefix")
                            .to_owned(),
                    ),
                    value: CellValue::from(20.0),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = write_xlsx_from_parse_output(&output).expect("export XLSX");
    let archive = XlsxArchive::new(&bytes).expect("open XLSX ZIP");
    let xml = String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    for formula in storage_formulas {
        // Quotes are legal XML text and the writer preserves them verbatim.
        assert!(
            xml.contains(&format!("<f>{formula}</f>")),
            "missing storage formula {formula}: {xml}"
        );
    }
    let (reopened, _) = parse_xlsx_to_output(&bytes).expect("reopen exported XLSX");
    assert_eq!(reopened.sheets[0].cells.len(), storage_formulas.len());
    for (cell, expected) in reopened.sheets[0].cells.iter().zip(storage_formulas) {
        assert_eq!(
            normalize_xlsx_formula(cell.formula.as_deref().unwrap()),
            normalize_xlsx_formula(expected)
        );
        assert_eq!(cell.value, CellValue::from(20.0));
    }
    let again = write_xlsx_from_parse_output(&reopened).expect("second export");
    let archive = XlsxArchive::new(&again).unwrap();
    let second_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    for formula in storage_formulas {
        assert!(
            second_xml.contains(&format!("<f>{formula}</f>")),
            "second export changed {formula}: {second_xml}"
        );
    }
}
