//! Worksheet semantic containers are typed `SheetData` state, not preserved XML.

use domain_types::{
    ParseOutput, SheetData, SheetDimensions, WorksheetSemanticContainers, WorksheetSemanticXml,
};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

fn semantic_xml(raw_xml: &str) -> Option<WorksheetSemanticXml> {
    Some(WorksheetSemanticXml::new(raw_xml.to_string()))
}

fn semantic_fixture() -> WorksheetSemanticContainers {
    WorksheetSemanticContainers {
        custom_sheet_views: semantic_xml(
            r#"<customSheetViews><customSheetView guid="{11111111-1111-1111-1111-111111111111}" scale="90"/></customSheetViews>"#,
        ),
        ignored_errors: semantic_xml(
            r#"<ignoredErrors><ignoredError sqref="A1:A3" numberStoredAsText="1"/></ignoredErrors>"#,
        ),
        sheet_calc_pr: semantic_xml(r#"<sheetCalcPr fullCalcOnLoad="1"/>"#),
        protected_ranges: semantic_xml(
            r#"<protectedRanges><protectedRange name="Editable" sqref="B2:C3"/></protectedRanges>"#,
        ),
        scenarios: semantic_xml(
            r#"<scenarios current="0" show="0" sqref="A1"><scenario name="Base"><inputCells r="A1" val="1"/></scenario></scenarios>"#,
        ),
        data_consolidate: semantic_xml(r#"<dataConsolidate function="sum" leftLabels="1"/>"#),
        phonetic_pr: semantic_xml(r#"<phoneticPr fontId="1" type="fullwidthKatakana"/>"#),
        smart_tags: semantic_xml(
            r#"<smartTags><cellSmartTags r="A1"><cellSmartTag type="0"/></cellSmartTags></smartTags>"#,
        ),
        cell_watches: semantic_xml(r#"<cellWatches><cellWatch r="A1"/></cellWatches>"#),
    }
}

fn make_output(containers: WorksheetSemanticContainers) -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            dimensions: SheetDimensions::default(),
            worksheet_semantic_containers: containers,
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn sheet_xml(bytes: &[u8]) -> String {
    let archive = XlsxArchive::new(bytes).expect("xlsx archive");
    String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap()
}

#[test]
fn all_worksheet_semantic_containers_round_trip_through_parse_output() {
    let original = semantic_fixture();
    let bytes = write_xlsx_from_parse_output(&make_output(original.clone())).expect("write");
    let xml = sheet_xml(&bytes);

    for tag in [
        "customSheetViews",
        "ignoredErrors",
        "sheetCalcPr",
        "protectedRanges",
        "scenarios",
        "dataConsolidate",
        "phoneticPr",
        "smartTags",
        "cellWatches",
    ] {
        assert!(xml.contains(tag), "writer omitted <{tag}> from typed state");
    }

    let (parsed, _diagnostics) = parse_xlsx_to_output(&bytes).expect("parse");
    assert_eq!(parsed.sheets[0].worksheet_semantic_containers, original);
}

#[test]
fn typed_deletion_removes_containers_from_export() {
    let bytes = write_xlsx_from_parse_output(&make_output(WorksheetSemanticContainers::default()))
        .expect("write");
    let xml = sheet_xml(&bytes);

    for tag in [
        "customSheetViews",
        "ignoredErrors",
        "sheetCalcPr",
        "protectedRanges",
        "scenarios",
        "dataConsolidate",
        "phoneticPr",
        "smartTags",
        "cellWatches",
    ] {
        assert!(
            !xml.contains(tag),
            "deleted typed <{tag}> leaked into export"
        );
    }
}
