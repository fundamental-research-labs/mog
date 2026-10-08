use compute_core::storage::engine::ComputeEngine;
use value_types::CellValue;
use xlsx_parser::write::ZipWriter;
const NAMES: &[&str] = &[
    "RD",
    "Single",
    "FV",
    "CNMTM",
    "LET_WF",
    "LAMBDA_WF",
    "ARRAYTEXT_WF",
];
fn input(names: &[&str], ns: &str, flags: &str, sheet_flags: &str, missing: bool) -> Vec<u8> {
    let mut z = ZipWriter::new();
    z.add_file("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#.to_vec());
    z.add_file("_rels/.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_vec());
    z.add_file("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.to_vec());
    let features = names
        .iter()
        .map(|n| format!(r#"<p:feature name="microsoft.com:{n}"/>"#))
        .collect::<String>();
    let defined_names = if flags.contains("calcId=\"127\"") {
        "<definedNames><definedName name=\"UnusedVolatile\">OFFSET(#REF!,0,0,COUNTA(#REF!)-1)</definedName></definedNames>"
    } else {
        ""
    };
    z.add_file("xl/workbook.xml",format!(r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>{defined_names}<calcPr calcOnSave="1" {flags}/><extLst><ext uri="{{B58B0392-4F1F-4190-BB64-5DF3571DCE5F}}" xmlns:p="{ns}"><p:calcFeatures>{features}</p:calcFeatures></ext></extLst></workbook>"#).into_bytes());
    let formula_flags = if flags.contains("calcId=\"124\"") {
        " ca=\"1\""
    } else {
        ""
    };
    let cache = if missing { "" } else { "<v>99</v>" };
    let volatile = if flags.contains("calcId=\"123\"") || flags.contains("calcId=\"127\"") {
        "<c r=\"D1\"><v>0.25</v></c><c r=\"E1\"><v>0.5</v></c>"
    } else {
        "<c r=\"D1\"><f>RAND()</f><v>0.25</v></c><c r=\"E1\"><f>D1*2</f><v>0.5</v></c>"
    };
    if flags.contains("calcId=\"124\"") {
        z.add_file("xl/worksheets/sheet1.xml", br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1"><f ca="1">1+1</f><v>42</v></c><c r="B1"><f>1+2</f><v>99</v></c></row><row r="2"><c r="A2"><f>A1*2</f><v>84</v></c><c r="B2" t="str"><f>IFERROR(1/0,&quot;&quot;)</f><v/></c></row></sheetData></worksheet>"#.to_vec());
    } else {
        z.add_file("xl/worksheets/sheet1.xml",format!(r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E1"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f{formula_flags}>CUSTOMFUNC(2)</f><v>42</v></c><c r="C1"><f>A1*2</f>{cache}</c>{volatile}</row></sheetData>{sheet_flags}</worksheet>"#).into_bytes());
    }
    z.finish().unwrap()
}
const NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures";
#[test]
fn ordinary_profile_preserves_unrelated_caches_refreshes_volatile_and_explicit_full_still_runs() {
    let (mut e, _) = ComputeEngine::from_xlsx_bytes(&input(NAMES, NS, "", "", false)).unwrap();
    let s = *e.cell_store().sheet_ids().next().unwrap();
    assert!(e.recalculate_compatible_import().unwrap());
    assert_eq!(e.get_cell_value(&s, 0, 1), CellValue::number(42.));
    assert_eq!(e.get_cell_value(&s, 0, 2), CellValue::number(99.));
    assert_ne!(e.get_cell_value(&s, 0, 3), CellValue::number(0.25));
    let d = e.get_cell_value(&s, 0, 3).as_number().unwrap();
    assert_eq!(e.get_cell_value(&s, 0, 4), CellValue::number(d * 2.));
    assert!(e.recalculate_compatible_import().unwrap());
    assert_eq!(e.get_cell_value(&s, 0, 2), CellValue::number(99.));
    e.recalculate().unwrap();
    assert_eq!(e.get_cell_value(&s, 0, 2), CellValue::number(2.));
    assert!(matches!(e.get_cell_value(&s, 0, 1), CellValue::Error(..)));
}
#[test]
fn incompatible_or_incomplete_imports_never_reuse_caches() {
    for (names, ns, flags, sheet, missing) in [
        (&NAMES[..1], NS, "", "", false),
        (&NAMES[1..], NS, "", "", false),
        (NAMES, "urn:lookalike", "", "", false),
        (NAMES, NS, "forceFullCalc=\"1\"", "", false),
        (NAMES, NS, "fullCalcOnLoad=\"1\"", "", false),
        (NAMES, NS, "calcMode=\"manual\"", "", false),
        (NAMES, NS, "", "<sheetCalcPr fullCalcOnLoad=\"1\"/>", false),
        (NAMES, NS, "", "", true),
    ] {
        let (mut e, _) =
            ComputeEngine::from_xlsx_bytes(&input(names, ns, flags, sheet, missing)).unwrap();
        assert!(
            !e.recalculate_compatible_import().unwrap(),
            "{names:?} {flags} {sheet}"
        );
    }
    let mut names = NAMES.to_vec();
    names.push("UNKNOWN");
    let (mut e, _) = ComputeEngine::from_xlsx_bytes(&input(&names, NS, "", "", false)).unwrap();
    assert!(e.recalculate_compatible_import().unwrap());
}

#[test]
fn nonvolatile_ordinary_then_full_and_mutation_guards() {
    let bytes = input(NAMES, NS, "calcId=\"123\"", "", false);
    let (mut e, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let s = *e.cell_store().sheet_ids().next().unwrap();
    assert!(e.recalculate_compatible_import().unwrap());
    assert_eq!(e.get_cell_value(&s, 0, 2), CellValue::number(99.));
    e.recalculate().unwrap();
    assert_eq!(e.get_cell_value(&s, 0, 2), CellValue::number(2.));
    let (mut e, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    assert!(e.recalculate_compatible_import().unwrap());
    e.set_char_code_page(10000).unwrap();
    assert!(!e.recalculate_compatible_import().unwrap());
    let (mut e, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let s = *e.cell_store().sheet_ids().next().unwrap();
    assert!(e.recalculate_compatible_import().unwrap());
    e.set_cell_value_parsed(&s, 0, 0, "3").unwrap();
    assert!(!e.recalculate_compatible_import().unwrap());
    e.recalculate().unwrap();
    assert_eq!(e.get_cell_value(&s, 0, 2), CellValue::number(6.));
}

#[test]
fn feature_parser_rejects_foreign_hierarchy_and_duplicate_profiles() {
    use xlsx_parser::domain::workbook::read::parse_calculation_features as parse;
    let profile = format!(
        r#"<p:calcFeatures xmlns:p="{NS}"><p:feature name="microsoft.com:RD"/></p:calcFeatures>"#
    );
    let ext = format!(r#"<ext uri="{{B58B0392-4F1F-4190-BB64-5DF3571DCE5F}}">{profile}</ext>"#);
    let doc = |s: &str| {
        format!(
            r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{s}</workbook>"#
        )
    };
    assert!(parse(doc(&format!("<extLst>{ext}</extLst>")).as_bytes()).is_some());
    assert!(parse(doc(&ext).as_bytes()).is_none());
    assert!(parse(doc(&format!("<extLst>{ext}{ext}</extLst>")).as_bytes()).is_none());
    assert!(parse(doc(&format!("<extLst/><other>{ext}</other>")).as_bytes()).is_none());
    assert!(
        parse(
            doc(&format!("<extLst>{ext}</extLst>"))
                .replace("workbook", "other")
                .as_bytes()
        )
        .is_none()
    );
    let foreign = ext.replace("<ext ", "<ext xmlns=\"urn:evil\" ");
    assert!(parse(doc(&format!("<extLst>{foreign}</extLst>")).as_bytes()).is_none());
    assert!(parse(doc(&format!("<extLst xmlns=\"urn:evil\">{ext}</extLst>")).as_bytes()).is_none());
}

#[test]
fn per_formula_force_refresh_does_not_invalidate_unflagged_import_dependents() {
    // Same formulas/caches as the frozen Excel ca-selective ordinary/Full probe.
    let (mut e, _) =
        ComputeEngine::from_xlsx_bytes(&input(NAMES, NS, "calcId=\"124\"", "", false)).unwrap();
    let s = *e.cell_store().sheet_ids().next().unwrap();
    assert!(e.recalculate_compatible_import().unwrap());
    assert_eq!(e.get_cell_value(&s, 0, 0), CellValue::number(2.));
    assert_eq!(e.get_cell_value(&s, 1, 0), CellValue::number(84.));
    assert_eq!(e.get_cell_value(&s, 0, 1), CellValue::number(99.));
    assert_eq!(e.get_cell_value(&s, 1, 1), CellValue::Text("".into()));
    assert!(e.recalculate_compatible_import().unwrap());
    assert_eq!(e.get_cell_value(&s, 1, 0), CellValue::number(84.));
    e.recalculate().unwrap();
    assert_eq!(e.get_cell_value(&s, 0, 0), CellValue::number(2.));
    assert_eq!(e.get_cell_value(&s, 1, 0), CellValue::number(4.));
    assert_eq!(e.get_cell_value(&s, 0, 1), CellValue::number(3.));
    assert_eq!(e.get_cell_value(&s, 1, 1), CellValue::Text("".into()));
}

#[test]
fn unused_volatile_defined_name_does_not_recalculate_unrelated_caches() {
    let (mut e, _) =
        ComputeEngine::from_xlsx_bytes(&input(NAMES, NS, "calcId=\"127\"", "", false)).unwrap();
    let s = *e.cell_store().sheet_ids().next().unwrap();
    assert!(e.recalculate_compatible_import().unwrap());
    assert_eq!(e.get_cell_value(&s, 0, 1), CellValue::number(42.));
    assert_eq!(e.get_cell_value(&s, 0, 2), CellValue::number(99.));
}
