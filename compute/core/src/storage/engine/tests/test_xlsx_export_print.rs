use super::super::*;
use super::helpers::{engine_from_parse_output_normal, sheet_id, simple_snapshot};
use cell_types::SheetId;
use domain_types::domain::sheet::{PrintRange, PrintTitles};
use domain_types::{NamedRange, ParseOutput, SheetData, SheetDimensions};

#[test]
fn sdk_print_area_and_titles_export_as_xlsx_defined_names() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let area = PrintRange {
        start_row: 0,
        start_col: 0,
        end_row: 11,
        end_col: 3,
    };
    let titles = PrintTitles {
        repeat_rows: Some((0, 1)),
        repeat_cols: Some((0, 0)),
    };

    engine
        .set_print_area(&sid, Some(area.clone()))
        .expect("set print area");
    engine
        .set_print_titles(&sid, titles)
        .expect("set print titles");

    let exported = engine
        .export_to_parse_output()
        .expect("export parse output")
        .parse_output;

    let area_name = find_named_range(&exported, "_xlnm.Print_Area");
    assert_eq!(area_name.local_sheet_id, Some(0));
    assert_eq!(area_name.refers_to, "Sheet1!$A$1:$D$12");

    let titles_name = find_named_range(&exported, "_xlnm.Print_Titles");
    assert_eq!(titles_name.local_sheet_id, Some(0));
    assert_eq!(titles_name.refers_to, "Sheet1!$1:$2,Sheet1!$A:$A");
}

#[test]
fn imported_print_defined_names_hydrate_domain_and_export_once() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 5,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        named_ranges: vec![
            NamedRange {
                name: "_xlnm.Print_Area".to_string(),
                refers_to: "Sheet1!$A$1:$D$12".to_string(),
                local_sheet_id: Some(0),
                ..Default::default()
            },
            NamedRange {
                name: "_xlnm.Print_Titles".to_string(),
                refers_to: "Sheet1!$1:$2,Sheet1!$A:$A".to_string(),
                local_sheet_id: Some(0),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let engine = engine_from_parse_output_normal(&input);
    let sid =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");

    assert_eq!(
        engine.get_print_area(&sid),
        Some(PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 11,
            end_col: 3,
        })
    );
    assert_eq!(
        engine.get_print_titles(&sid),
        PrintTitles {
            repeat_rows: Some((0, 1)),
            repeat_cols: Some((0, 0)),
        }
    );

    let exported = engine
        .export_to_parse_output()
        .expect("export parse output")
        .parse_output;

    assert_eq!(count_named_range(&exported, "_xlnm.Print_Area"), 1);
    assert_eq!(
        find_named_range(&exported, "_xlnm.Print_Area").refers_to,
        "Sheet1!$A$1:$D$12"
    );
    assert_eq!(count_named_range(&exported, "_xlnm.Print_Titles"), 1);
    assert_eq!(
        find_named_range(&exported, "_xlnm.Print_Titles").refers_to,
        "Sheet1!$1:$2,Sheet1!$A:$A"
    );
}

fn find_named_range<'a>(output: &'a ParseOutput, name: &str) -> &'a NamedRange {
    output
        .named_ranges
        .iter()
        .find(|range| range.name == name)
        .unwrap_or_else(|| panic!("expected named range {name}"))
}

fn count_named_range(output: &ParseOutput, name: &str) -> usize {
    output
        .named_ranges
        .iter()
        .filter(|range| range.name == name)
        .count()
}
