//! XLSX export view-state projection tests.

use super::helpers::engine_from_parse_output_normal;
use cell_types::SheetId;
use domain_types::{ParseOutput, SheetData, SheetView, domain::workbook::WorkbookView};

#[test]
fn build_parse_output_from_yrs_projects_selected_sheets_into_workbook_views() {
    let input = ParseOutput {
        sheets: vec![
            SheetData {
                name: "First".to_string(),
                view: SheetView {
                    tab_selected: true,
                    ..Default::default()
                },
                ..Default::default()
            },
            SheetData {
                name: "Second".to_string(),
                view: SheetView {
                    tab_selected: false,
                    ..Default::default()
                },
                ..Default::default()
            },
        ],
        workbook_views: vec![WorkbookView {
            active_tab: 0,
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut engine = engine_from_parse_output_normal(&input);
    let second_sheet_id = SheetId::from_uuid_str(&engine.get_all_sheet_ids()[1])
        .expect("hydrated sheet id should be valid");
    let mut settings = engine.get_workbook_settings();
    settings.selected_sheet_ids = Some(vec![second_sheet_id.to_uuid_string()]);
    engine
        .set_workbook_settings(settings)
        .expect("selected sheet state write should succeed");

    let exported = engine.build_parse_output_from_yrs();

    assert_eq!(exported.workbook_views[0].active_tab, 1);
    assert!(!exported.sheets[0].view.tab_selected);
    assert!(exported.sheets[1].view.tab_selected);
}
