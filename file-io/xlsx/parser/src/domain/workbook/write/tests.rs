use super::attrs::sheet_state_to_xml_value;
use super::*;

#[test]
fn test_empty_workbook() {
    let writer = WorkbookWriter::new();
    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("<?xml version=\"1.0\""));
    assert!(xml.contains("<workbook"));
    assert!(xml.contains("xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\""));
    assert!(xml.contains(
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\""
    ));
    assert!(xml.contains("<sheets>"));
    assert!(xml.contains("name=\"Sheet1\""));
    assert!(xml.contains("</sheets>"));
    assert!(xml.contains("<bookViews>"));
    assert!(xml.contains("</bookViews>"));
    assert!(xml.contains("<calcPr"));
}

#[test]
fn test_single_sheet() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("MySheet", "rId1");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("name=\"MySheet\""));
    assert!(xml.contains("sheetId=\"1\""));
    assert!(xml.contains("r:id=\"rId1\""));
}

#[test]
fn test_multiple_sheets() {
    let mut writer = WorkbookWriter::new();
    writer
        .add_sheet("Sheet1", "rId1")
        .add_sheet("Data", "rId2")
        .add_sheet("Summary", "rId3");

    assert_eq!(writer.sheet_count(), 3);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("name=\"Sheet1\""));
    assert!(xml.contains("name=\"Data\""));
    assert!(xml.contains("name=\"Summary\""));
    assert!(xml.contains("sheetId=\"1\""));
    assert!(xml.contains("sheetId=\"2\""));
    assert!(xml.contains("sheetId=\"3\""));
}

#[test]
fn test_sheet_name_with_special_characters() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("Sales & Marketing <2024>", "rId1");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("name=\"Sales &amp; Marketing &lt;2024&gt;\""));
}

#[test]
fn test_hidden_sheet() {
    let mut writer = WorkbookWriter::new();
    writer
        .add_sheet("Visible", "rId1")
        .add_sheet_with_state("Hidden", "rId2", SheetState::Hidden);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("name=\"Visible\" sheetId=\"1\" r:id=\"rId1\""));
    assert!(xml.contains("name=\"Hidden\" sheetId=\"2\" state=\"hidden\" r:id=\"rId2\""));
}

#[test]
fn test_very_hidden_sheet() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet_with_state("VeryHidden", "rId1", SheetState::VeryHidden);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("state=\"veryHidden\""));
}

#[test]
fn test_defined_name_workbook_scope() {
    let mut writer = WorkbookWriter::new();
    writer
        .add_sheet("Sheet1", "rId1")
        .add_defined_name("MyRange", "Sheet1!$A$1:$D$10");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("<definedNames>"));
    assert!(xml.contains("<definedName name=\"MyRange\">Sheet1!$A$1:$D$10</definedName>"));
    assert!(xml.contains("</definedNames>"));
}

#[test]
fn test_defined_name_sheet_scope() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("Sheet1", "rId1");

    let def = DefinedNameDef::with_sheet_scope("LocalRange", "Sheet1!$A$1", 0);
    writer.add_defined_name_full(def);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("localSheetId=\"0\""));
}

#[test]
fn test_defined_name_hidden() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("Sheet1", "rId1");

    let def = DefinedNameDef {
        name: "HiddenName".to_string(),
        value: "Sheet1!$A$1".to_string(),
        hidden: true,
        ..DefinedNameDef::new("", "")
    };
    writer.add_defined_name_full(def);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("hidden=\"1\""));
}

#[test]
fn test_print_area() {
    let mut writer = WorkbookWriter::new();
    writer
        .add_sheet("Sheet1", "rId1")
        .add_print_area(0, "Sheet1!$A$1:$G$20");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("name=\"_xlnm.Print_Area\""));
    assert!(xml.contains("localSheetId=\"0\""));
    assert!(xml.contains("Sheet1!$A$1:$G$20"));
}

#[test]
fn test_print_titles() {
    let mut writer = WorkbookWriter::new();
    writer
        .add_sheet("Sheet1", "rId1")
        .add_print_titles(0, "Sheet1!$1:$2");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("name=\"_xlnm.Print_Titles\""));
    assert!(xml.contains("Sheet1!$1:$2"));
}

#[test]
fn test_default_view() {
    let writer = WorkbookWriter::new();
    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("<workbookView"));
    assert!(!xml.contains("windowWidth="));
    assert!(!xml.contains("windowHeight="));
}

#[test]
fn test_custom_view() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("Sheet1", "rId1");
    writer.add_sheet("Sheet2", "rId2");

    let view = WorkbookView {
        active_tab: 1,
        first_sheet: 0,
        show_horizontal_scroll: true,
        show_vertical_scroll: true,
        show_sheet_tabs: false,
        window_width: Some(20000),
        window_height: Some(10000),
        x_window: Some(100),
        y_window: Some(50),
        ..Default::default()
    };
    writer.set_view(view);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("activeTab=\"1\""));
    assert!(xml.contains("windowWidth=\"20000\""));
    assert!(xml.contains("windowHeight=\"10000\""));
    assert!(xml.contains("xWindow=\"100\""));
    assert!(xml.contains("yWindow=\"50\""));
    assert!(xml.contains("showSheetTabs=\"0\""));
}

#[test]
fn test_default_calc_settings() {
    let writer = WorkbookWriter::new();
    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("<calcPr calcId=\"0\"/>"));
}

#[test]
fn test_manual_calc_mode() {
    let mut writer = WorkbookWriter::new();
    writer.set_calc_settings(CalcSettings {
        calc_mode: CalcMode::Manual,
        ..Default::default()
    });

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("calcMode=\"manual\""));
}

#[test]
fn test_iterative_calculation() {
    let mut writer = WorkbookWriter::new();
    writer.set_calc_settings(CalcSettings {
        calc_mode: CalcMode::Auto,
        full_calc_on_load: true,
        iterate: true,
        iterate_count: 200,
        iterate_delta: 0.01,
        ..Default::default()
    });

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("fullCalcOnLoad=\"1\""));
    assert!(xml.contains("iterate=\"1\""));
    assert!(xml.contains("iterateCount=\"200\""));
    assert!(xml.contains("iterateDelta=\"0.01\""));
}

#[test]
fn test_complete_workbook_xml() {
    let mut writer = WorkbookWriter::new();
    writer
        .add_sheet("Sheet1", "rId1")
        .add_sheet("Sheet2", "rId2")
        .add_sheet_with_state("Hidden", "rId3", SheetState::Hidden)
        .add_defined_name("MyRange", "Sheet1!$A$1:$D$10")
        .add_print_area(0, "Sheet1!$A$1:$G$20");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.starts_with("<?xml version=\"1.0\""));
    assert!(xml.contains("<workbook"));
    assert!(xml.contains("<bookViews>"));
    assert!(xml.contains("<sheets>"));
    assert!(xml.contains("<definedNames>"));
    assert!(xml.contains("<calcPr"));
    assert!(xml.contains("</workbook>"));

    let sheets_pos = xml.find("<sheets>").unwrap();
    let defined_pos = xml.find("<definedNames>").unwrap();
    assert!(sheets_pos < defined_pos);
}

#[test]
fn test_no_defined_names() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("Sheet1", "rId1");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(!xml.contains("<definedNames>"));
}

#[test]
fn test_sheet_def_new() {
    let sheet = SheetDef::new("Test", 1, "rId1");
    assert_eq!(sheet.name, "Test");
    assert_eq!(sheet.sheet_id, 1);
    assert_eq!(sheet.r_id, "rId1");
    assert_eq!(sheet.state, SheetState::Visible);
}

#[test]
fn test_defined_name_def_new() {
    let def = DefinedNameDef::new("Range", "Sheet1!$A$1");
    assert_eq!(def.name, "Range");
    assert_eq!(def.value, "Sheet1!$A$1");
    assert!(def.local_sheet_id.is_none());
    assert!(!def.hidden);
}

#[test]
fn test_sheet_state_to_xml() {
    assert_eq!(sheet_state_to_xml_value(SheetState::Visible), None);
    assert_eq!(sheet_state_to_xml_value(SheetState::Hidden), Some("hidden"));
    assert_eq!(
        sheet_state_to_xml_value(SheetState::VeryHidden),
        Some("veryHidden")
    );
}

#[test]
fn test_calc_mode_to_xml() {
    assert_eq!(CalcMode::Auto.to_ooxml(), "auto");
    assert_eq!(CalcMode::Manual.to_ooxml(), "manual");
    assert_eq!(CalcMode::AutoNoTable.to_ooxml(), "autoNoTable");
}

#[test]
fn test_unicode_sheet_name() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("\u{65E5}\u{672C}\u{8A9E}", "rId1");

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("name=\"\u{65E5}\u{672C}\u{8A9E}\""));
}

#[test]
fn test_defined_name_with_comment() {
    let mut writer = WorkbookWriter::new();
    writer.add_sheet("Sheet1", "rId1");

    let def = DefinedNameDef {
        name: "MyRange".to_string(),
        value: "Sheet1!$A$1".to_string(),
        comment: Some("This is a test range".to_string()),
        ..DefinedNameDef::new("", "")
    };
    writer.add_defined_name_full(def);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("comment=\"This is a test range\""));
}

#[test]
fn test_workbook_view_defaults() {
    let view = WorkbookView::default();
    assert_eq!(view.active_tab, 0);
    assert_eq!(view.first_sheet, 0);
    assert!(view.show_horizontal_scroll);
    assert!(view.show_vertical_scroll);
    assert!(view.show_sheet_tabs);
    assert_eq!(view.window_width, None);
    assert_eq!(view.window_height, None);
}

#[test]
fn test_calc_settings_defaults() {
    let settings = CalcSettings::default();
    assert!(settings.calc_id.is_none());
    assert_eq!(settings.calc_mode, CalcMode::Auto);
    assert!(!settings.full_calc_on_load);
    assert!(!settings.iterate);
    assert_eq!(settings.iterate_count, 100);
    assert!((settings.iterate_delta - 0.001).abs() < f64::EPSILON);
}

#[test]
fn test_calc_id_roundtrip() {
    let mut writer = WorkbookWriter::new();
    writer.set_calc_settings(CalcSettings {
        calc_id: Some(0),
        iterate_count: 200,
        iterate_delta: 0.01,
        ..Default::default()
    });

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("calcId=\"0\""));
    assert!(xml.contains("iterateCount=\"200\""));
    assert!(xml.contains("iterateDelta=\"0.01\""));
    assert!(!xml.contains("iterate=\"1\""));
}

#[test]
fn test_calc_settings_from_domain_preserves_user_calc_flags() {
    let settings = calc_settings_from_domain(&domain_types::CalculationProperties {
        calc_id: Some(191029),
        full_calc_on_load: false,
        calc_completed: true,
        force_full_calc: false,
        ..Default::default()
    });

    assert_eq!(settings.calc_id, Some(0));
    assert!(!settings.full_calc_on_load);
    assert!(settings.calc_completed);
    assert!(!settings.force_full_calc);
}

#[test]
fn test_calc_settings_from_domain_preserves_explicit_recalc_flags() {
    let settings = calc_settings_from_domain(&domain_types::CalculationProperties {
        calc_id: Some(191029),
        full_calc_on_load: true,
        calc_completed: false,
        force_full_calc: true,
        ..Default::default()
    });

    assert_eq!(settings.calc_id, Some(0));
    assert!(settings.full_calc_on_load);
    assert!(!settings.calc_completed);
    assert!(settings.force_full_calc);
}
