use super::*;

#[test]
fn calc_mode_roundtrip() {
    let ooxml = ooxml_types::workbook::CalcMode::Manual;
    let domain: CalcMode = ooxml.into();
    assert_eq!(domain, CalcMode::Manual);
    let back: ooxml_types::workbook::CalcMode = domain.into();
    assert_eq!(back, ooxml_types::workbook::CalcMode::Manual);
}

#[test]
fn calc_pr_roundtrip() {
    let ooxml = ooxml_types::workbook::CalcPr {
        calc_id: Some(191029),
        calc_mode: ooxml_types::workbook::CalcMode::Manual,
        full_calc_on_load: true,
        ref_mode: ooxml_types::workbook::RefMode::R1C1,
        iterate: true,
        iterate_count: 200,
        iterate_delta: 0.01,
        full_precision: false,
        calc_completed: false,
        calc_on_save: false,
        concurrent_calc: false,
        concurrent_manual_count: Some(4),
        force_full_calc: true,
        has_explicit_iterate_count: true,
        has_explicit_iterate_delta: true,
    };
    let domain: CalculationProperties = ooxml.clone().into();
    assert_eq!(domain.iterate, true);
    assert_eq!(domain.iterate_count, 200);
    assert_eq!(domain.iterate_delta, 0.01);
    assert_eq!(domain.calc_mode, CalcMode::Manual);
    assert_eq!(domain.ref_mode, RefMode::R1C1);
    assert_eq!(domain.full_precision, false);
    assert_eq!(domain.concurrent_manual_count, Some(4));
    assert_eq!(domain.force_full_calc, true);
    assert_eq!(domain.has_explicit_iterate_count, true);
    assert_eq!(domain.has_explicit_iterate_delta, true);

    let back: ooxml_types::workbook::CalcPr = domain.into();
    assert_eq!(back.calc_id, Some(191029));
    assert_eq!(back.calc_mode, ooxml_types::workbook::CalcMode::Manual);
    assert_eq!(back.iterate_count, 200);
    assert_eq!(back.has_explicit_iterate_count, true);
    assert_eq!(back.has_explicit_iterate_delta, true);
}

#[test]
fn workbook_protection_roundtrip_all_15_fields() {
    let ooxml = ooxml_types::protection::WorkbookProtection {
        lock_structure: true,
        lock_windows: false,
        lock_revision: true,
        workbook_algorithm_name: HashAlgorithm::Sha256,
        workbook_hash_value: Some("abc123".into()),
        workbook_salt_value: Some("salt1".into()),
        workbook_spin_count: Some(100000),
        revisions_algorithm_name: HashAlgorithm::Sha512,
        revisions_hash_value: Some("def456".into()),
        revisions_salt_value: Some("salt2".into()),
        revisions_spin_count: Some(50000),
        workbook_password: Some("ABCD".into()),
        workbook_password_character_set: Some("UTF-8".into()),
        revisions_password: Some("EFGH".into()),
        revisions_password_character_set: Some("UTF-16".into()),
    };
    let domain: WorkbookProtection = ooxml.clone().into();
    assert_eq!(domain.lock_structure, true);
    assert_eq!(domain.lock_revision, true);
    assert_eq!(domain.workbook_algorithm_name, HashAlgorithm::Sha256);
    assert_eq!(domain.workbook_hash_value.as_deref(), Some("abc123"));
    assert_eq!(domain.revisions_algorithm_name, HashAlgorithm::Sha512);
    assert_eq!(domain.revisions_hash_value.as_deref(), Some("def456"));
    assert_eq!(domain.workbook_password.as_deref(), Some("ABCD"));
    assert_eq!(domain.revisions_password.as_deref(), Some("EFGH"));
    assert_eq!(
        domain.workbook_password_character_set.as_deref(),
        Some("UTF-8")
    );
    assert_eq!(
        domain.revisions_password_character_set.as_deref(),
        Some("UTF-16")
    );

    let back: ooxml_types::protection::WorkbookProtection = domain.into();
    assert_eq!(back, ooxml);
}

#[test]
fn book_view_roundtrip() {
    let ooxml = ooxml_types::workbook::BookView {
        visibility: ooxml_types::workbook::Visibility::Hidden,
        minimized: true,
        show_horizontal_scroll: false,
        show_vertical_scroll: false,
        show_sheet_tabs: false,
        x_window: Some(100),
        y_window: Some(200),
        window_width: Some(1920),
        window_height: Some(1080),
        tab_ratio: Some(800.0),
        first_sheet: 2,
        active_tab: 3,
        auto_filter_date_grouping: false,
        xr_uid: None,
        ext_lst: None,
    };
    let domain: WorkbookView = ooxml.into();
    assert_eq!(domain.visibility, WorkbookViewVisibility::Hidden);
    assert_eq!(domain.minimized, true);
    assert_eq!(domain.tab_ratio, Some(800.0));
    assert_eq!(domain.active_tab, 3);
    assert_eq!(domain.first_sheet, 2);
    assert_eq!(domain.x_window, Some(100));
}

#[test]
fn workbook_pr_roundtrip() {
    let ooxml = ooxml_types::workbook::WorkbookPr {
        date1904: true,
        filter_privacy: true,
        code_name: Some("ThisWorkbook".into()),
        default_theme_version: Some(166925),
        ..Default::default()
    };
    let domain: WorkbookProperties = ooxml.clone().into();
    assert_eq!(domain.date1904, true);
    assert_eq!(domain.filter_privacy, true);
    assert_eq!(domain.code_name.as_deref(), Some("ThisWorkbook"));
    assert_eq!(domain.default_theme_version, Some(166925));

    let back: ooxml_types::workbook::WorkbookPr = domain.into();
    assert_eq!(back, ooxml);
}

#[test]
fn file_version_roundtrip() {
    let ooxml = ooxml_types::workbook::FileVersion {
        app_name: Some("xl".into()),
        last_edited: Some("7".into()),
        lowest_edited: Some("6".into()),
        rup_build: Some("14420".into()),
        code_name: None,
    };
    let domain: FileVersion = ooxml.clone().into();
    let back: ooxml_types::workbook::FileVersion = domain.into();
    assert_eq!(back, ooxml);
}

#[test]
fn file_sharing_roundtrip() {
    let ooxml = ooxml_types::workbook::FileSharing {
        read_only_recommended: true,
        user_name: Some("admin".into()),
        algorithm_name: Some("SHA-512".into()),
        hash_value: Some("hash".into()),
        salt_value: Some("salt".into()),
        spin_count: Some(100000),
        reservation_password: Some("DEAD".into()),
    };
    let domain: FileSharing = ooxml.clone().into();
    let back: ooxml_types::workbook::FileSharing = domain.into();
    assert_eq!(back, ooxml);
}

#[test]
fn defaults_match_ooxml_spec() {
    let calc = CalculationProperties::default();
    assert_eq!(calc.iterate, false);
    assert_eq!(calc.iterate_count, 100);
    assert_eq!(calc.iterate_delta, 0.001);
    assert_eq!(calc.calc_mode, CalcMode::Auto);
    assert_eq!(calc.ref_mode, RefMode::A1);
    assert_eq!(calc.full_precision, true);
    assert_eq!(calc.calc_completed, true);
    assert_eq!(calc.calc_on_save, true);
    assert_eq!(calc.concurrent_calc, true);

    let view = WorkbookView::default();
    assert_eq!(view.tab_ratio, None);
    assert_eq!(view.show_horizontal_scroll, true);
    assert_eq!(view.show_sheet_tabs, true);

    let props = WorkbookProperties::default();
    assert_eq!(props.date1904, false);
    assert_eq!(props.show_objects, ObjectDisplayMode::All);
    assert_eq!(props.auto_compress_pictures, true);
    assert_eq!(props.save_external_link_values, true);
}

// ====================================================================
// Serde round-trip tests (JSON serialize → deserialize → equality)
// ====================================================================

#[test]
fn serde_roundtrip_calculation_properties_non_default() {
    let cp = CalculationProperties {
        iterate: true,
        iterate_count: 250,
        iterate_delta: 0.05,
        calc_mode: CalcMode::Manual,
        full_calc_on_load: true,
        ref_mode: RefMode::R1C1,
        full_precision: false,
        calc_completed: false,
        calc_on_save: false,
        concurrent_calc: false,
        concurrent_manual_count: Some(8),
        calc_id: Some(191029),
        force_full_calc: true,
        has_explicit_iterate_count: true,
        has_explicit_iterate_delta: true,
    };
    let json = serde_json::to_string(&cp).unwrap();
    let deserialized: CalculationProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(cp, deserialized);

    // Verify camelCase field names in JSON
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(
        v.get("iterateCount").is_some(),
        "expected camelCase iterateCount"
    );
    assert!(
        v.get("iterateDelta").is_some(),
        "expected camelCase iterateDelta"
    );
    assert!(v.get("calcMode").is_some(), "expected camelCase calcMode");
    assert!(
        v.get("fullCalcOnLoad").is_some(),
        "expected camelCase fullCalcOnLoad"
    );
    assert!(v.get("refMode").is_some(), "expected camelCase refMode");
    assert!(
        v.get("fullPrecision").is_some(),
        "expected camelCase fullPrecision"
    );
    assert!(
        v.get("concurrentManualCount").is_some(),
        "expected camelCase concurrentManualCount"
    );
    assert!(
        v.get("forceFullCalc").is_some(),
        "expected camelCase forceFullCalc"
    );
    assert!(
        v.get("hasExplicitIterateCount").is_some(),
        "expected camelCase hasExplicitIterateCount"
    );
}

#[test]
fn serde_roundtrip_workbook_protection_all_fields() {
    let wp = WorkbookProtection {
        lock_structure: true,
        lock_windows: true,
        lock_revision: true,
        workbook_algorithm_name: HashAlgorithm::Sha256,
        workbook_hash_value: Some("wb_hash_abc".into()),
        workbook_salt_value: Some("wb_salt_xyz".into()),
        workbook_spin_count: Some(100000),
        revisions_algorithm_name: HashAlgorithm::Sha512,
        revisions_hash_value: Some("rev_hash_def".into()),
        revisions_salt_value: Some("rev_salt_uvw".into()),
        revisions_spin_count: Some(50000),
        workbook_password: Some("BEEF".into()),
        workbook_password_character_set: Some("UTF-16LE".into()),
        revisions_password: Some("CAFE".into()),
        revisions_password_character_set: Some("UTF-8".into()),
    };
    let json = serde_json::to_string(&wp).unwrap();
    let deserialized: WorkbookProtection = serde_json::from_str(&json).unwrap();
    assert_eq!(wp, deserialized);

    // Verify camelCase
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("lockStructure").is_some());
    assert!(v.get("lockWindows").is_some());
    assert!(v.get("workbookAlgorithmName").is_some());
    assert!(v.get("workbookHashValue").is_some());
    assert!(v.get("revisionsAlgorithmName").is_some());
    assert!(v.get("workbookPassword").is_some());
    assert!(v.get("revisionsPasswordCharacterSet").is_some());
}

#[test]
fn serde_roundtrip_workbook_view_all_fields() {
    let wv = WorkbookView {
        active_tab: 5,
        first_sheet: 2,
        visibility: WorkbookViewVisibility::Hidden,
        minimized: true,
        show_horizontal_scroll: false,
        show_vertical_scroll: false,
        show_sheet_tabs: false,
        auto_filter_date_grouping: false,
        x_window: Some(-100),
        y_window: Some(200),
        window_width: Some(2560),
        window_height: Some(1440),
        tab_ratio: Some(800.0),
        uid: Some("{12345678-1234-1234-1234-123456789ABC}".into()),
        ext_lst_raw: None,
    };
    let json = serde_json::to_string(&wv).unwrap();
    let deserialized: WorkbookView = serde_json::from_str(&json).unwrap();
    assert_eq!(wv, deserialized);

    // Verify camelCase
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("activeTab").is_some());
    assert!(v.get("firstSheet").is_some());
    assert!(v.get("showHorizontalScroll").is_some());
    assert!(v.get("autoFilterDateGrouping").is_some());
    assert!(v.get("tabRatio").is_some());
    assert!(v.get("xWindow").is_some());
    assert!(v.get("windowWidth").is_some());
}

#[test]
fn serde_roundtrip_workbook_properties_date1904() {
    let wp = WorkbookProperties {
        date1904: true,
        show_objects: ObjectDisplayMode::Placeholders,
        show_border_unselected_tables: false,
        filter_privacy: true,
        prompted_solutions: true,
        show_ink_annotation: false,
        backup_file: true,
        save_external_link_values: false,
        update_links: UpdateLinks::Always,
        code_name: Some("ThisWorkbook".into()),
        hide_pivot_field_list: true,
        show_pivot_chart_filter: true,
        allow_refresh_query: true,
        publish_items: true,
        check_compatibility: true,
        auto_compress_pictures: false,
        refresh_all_connections: true,
        default_theme_version: Some(166925),
    };
    let json = serde_json::to_string(&wp).unwrap();
    let deserialized: WorkbookProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(wp, deserialized);

    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["date1904"], true);
    assert!(v.get("showObjects").is_some());
    assert!(v.get("updateLinks").is_some());
    assert!(v.get("codeName").is_some());
    assert!(v.get("defaultThemeVersion").is_some());
    assert!(v.get("autoCompressPictures").is_some());
}

#[test]
fn serde_roundtrip_file_version_all_fields() {
    let fv = FileVersion {
        app_name: Some("xl".into()),
        last_edited: Some("7".into()),
        lowest_edited: Some("6".into()),
        rup_build: Some("24430".into()),
        code_name: Some("{12345}".into()),
    };
    let json = serde_json::to_string(&fv).unwrap();
    let deserialized: FileVersion = serde_json::from_str(&json).unwrap();
    assert_eq!(fv, deserialized);

    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("appName").is_some());
    assert!(v.get("lastEdited").is_some());
    assert!(v.get("lowestEdited").is_some());
    assert!(v.get("rupBuild").is_some());
}

#[test]
fn serde_roundtrip_file_sharing_all_fields() {
    let fs = FileSharing {
        read_only_recommended: true,
        user_name: Some("admin".into()),
        reservation_password: Some("DEAD".into()),
        algorithm_name: Some("SHA-512".into()),
        hash_value: Some("hash_abc".into()),
        salt_value: Some("salt_xyz".into()),
        spin_count: Some(100000),
    };
    let json = serde_json::to_string(&fs).unwrap();
    let deserialized: FileSharing = serde_json::from_str(&json).unwrap();
    assert_eq!(fs, deserialized);

    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("readOnlyRecommended").is_some());
    assert!(v.get("userName").is_some());
    assert!(v.get("reservationPassword").is_some());
    assert!(v.get("algorithmName").is_some());
    assert!(v.get("spinCount").is_some());
}

// ====================================================================
// Default → JSON → deserialize preserves OOXML spec defaults
// ====================================================================

#[test]
fn default_calc_props_serde_roundtrip() {
    let original = CalculationProperties::default();
    let json = serde_json::to_string(&original).unwrap();
    let deserialized: CalculationProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn default_workbook_protection_serde_roundtrip() {
    let original = WorkbookProtection::default();
    let json = serde_json::to_string(&original).unwrap();
    let deserialized: WorkbookProtection = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn default_workbook_view_serde_roundtrip() {
    let original = WorkbookView::default();
    let json = serde_json::to_string(&original).unwrap();
    let deserialized: WorkbookView = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn default_workbook_properties_serde_roundtrip() {
    let original = WorkbookProperties::default();
    let json = serde_json::to_string(&original).unwrap();
    let deserialized: WorkbookProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn default_file_version_serde_roundtrip() {
    let original = FileVersion::default();
    let json = serde_json::to_string(&original).unwrap();
    let deserialized: FileVersion = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn default_file_sharing_serde_roundtrip() {
    let original = FileSharing::default();
    let json = serde_json::to_string(&original).unwrap();
    let deserialized: FileSharing = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

// ====================================================================
// Partial JSON deserialization (forward compatibility / #[serde(default)])
// ====================================================================

#[test]
fn partial_json_file_version_empty() {
    // FileVersion has all Option fields with #[serde(default)] — empty JSON works
    let json = r#"{}"#;
    let fv: FileVersion = serde_json::from_str(json).unwrap();
    assert_eq!(fv, FileVersion::default());
}

#[test]
fn partial_json_file_version_some_fields() {
    let json = r#"{"appName": "xl", "rupBuild": "14420"}"#;
    let fv: FileVersion = serde_json::from_str(json).unwrap();
    assert_eq!(fv.app_name.as_deref(), Some("xl"));
    assert_eq!(fv.rup_build.as_deref(), Some("14420"));
    assert_eq!(fv.last_edited, None);
    assert_eq!(fv.lowest_edited, None);
    assert_eq!(fv.code_name, None);
}

#[test]
fn partial_json_workbook_protection_optional_fields_omitted() {
    // WorkbookProtection uses skip_serializing_if for Option fields.
    // Serialize a default (all Nones) then deserialize — the optional fields
    // should not be present in JSON, and deserialization should still work.
    let original = WorkbookProtection::default();
    let json = serde_json::to_string(&original).unwrap();
    // Verify optional fields are NOT in the JSON (skip_serializing_if)
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(
        v.get("workbookHashValue").is_none(),
        "None fields should be skipped"
    );
    assert!(v.get("workbookSaltValue").is_none());
    assert!(v.get("workbookSpinCount").is_none());
    assert!(v.get("revisionsPassword").is_none());
    // Deserialize back
    let deserialized: WorkbookProtection = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn partial_json_workbook_view_optional_fields_omitted() {
    // WorkbookView default has uid=None which is skip_serializing_if
    let original = WorkbookView::default();
    let json = serde_json::to_string(&original).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("uid").is_none(), "uid=None should be skipped");
    let deserialized: WorkbookView = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn partial_json_file_sharing_optional_fields_omitted() {
    // FileSharing default has most fields as None
    let original = FileSharing::default();
    let json = serde_json::to_string(&original).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("userName").is_none(), "None fields should be skipped");
    assert!(v.get("algorithmName").is_none());
    assert!(v.get("hashValue").is_none());
    assert!(v.get("saltValue").is_none());
    assert!(v.get("spinCount").is_none());
    let deserialized: FileSharing = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn partial_json_workbook_properties_optional_fields_omitted() {
    let original = WorkbookProperties::default();
    let json = serde_json::to_string(&original).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(
        v.get("codeName").is_none(),
        "codeName=None should be skipped"
    );
    assert!(
        v.get("defaultThemeVersion").is_none(),
        "defaultThemeVersion=None should be skipped"
    );
    let deserialized: WorkbookProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn workbook_web_publishing_optional_fields_omitted() {
    let original = WorkbookWebPublishing::default();
    let json = serde_json::to_string(&original).unwrap();
    assert_eq!(json, "{}");

    let deserialized: WorkbookWebPublishing = serde_json::from_str(&json).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn workbook_web_publishing_target_screen_size_roundtrip() {
    let web_publishing = WorkbookWebPublishing {
        css: Some(true),
        thicket: Some(false),
        long_file_names: Some(true),
        vml: Some(false),
        allow_png: Some(true),
        target_screen_size: Some(ooxml_types::web_publish::TargetScreenSize::Size1280x1024),
        dpi: Some(144),
        code_page: Some(65001),
        character_set: Some("UTF-8".to_string()),
    };

    let json = serde_json::to_string(&web_publishing).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("longFileNames").is_some());
    assert!(v.get("allowPng").is_some());
    assert!(v.get("targetScreenSize").is_some());

    let deserialized: WorkbookWebPublishing = serde_json::from_str(&json).unwrap();
    assert_eq!(web_publishing, deserialized);
}

#[test]
fn mog_workbook_identity_metadata_new_sets_contract_fields() {
    let workbook_id = WorkbookId("workbook-1".into());
    let metadata = MogWorkbookIdentityMetadata::new(workbook_id.clone());

    assert_eq!(MOG_WORKBOOK_ID_CUSTOM_PROPERTY, "MogWorkbookId");
    assert_eq!(
        MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA,
        "https://schemas.mog.com/workbook-identity/1"
    );
    assert_eq!(
        MOG_WORKBOOK_ID_CUSTOM_XML_REL_TYPE,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
    );
    assert_eq!(metadata.schema, MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA);
    assert_eq!(metadata.version, 1);
    assert_eq!(metadata.workbook_id, workbook_id);
    assert_eq!(metadata.created_at, None);
    assert_eq!(metadata.lineage, None);

    let json = serde_json::to_string(&metadata).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("workbookId").is_some());
    assert!(v.get("createdAt").is_none());
    assert!(v.get("lineage").is_none());
}

// ====================================================================
// Enum serde: verify camelCase string representation
// ====================================================================

#[test]
fn enum_serde_calc_mode() {
    assert_eq!(serde_json::to_string(&CalcMode::Auto).unwrap(), r#""auto""#);
    assert_eq!(
        serde_json::to_string(&CalcMode::AutoNoTable).unwrap(),
        r#""autoNoTable""#
    );
    assert_eq!(
        serde_json::to_string(&CalcMode::Manual).unwrap(),
        r#""manual""#
    );

    // Deserialize back
    assert_eq!(
        serde_json::from_str::<CalcMode>(r#""auto""#).unwrap(),
        CalcMode::Auto
    );
    assert_eq!(
        serde_json::from_str::<CalcMode>(r#""autoNoTable""#).unwrap(),
        CalcMode::AutoNoTable
    );
    assert_eq!(
        serde_json::from_str::<CalcMode>(r#""manual""#).unwrap(),
        CalcMode::Manual
    );
}

#[test]
fn enum_serde_ref_mode() {
    // Note: camelCase of A1 is "a1", R1C1 is "r1C1"
    let a1_json = serde_json::to_string(&RefMode::A1).unwrap();
    let r1c1_json = serde_json::to_string(&RefMode::R1C1).unwrap();

    // Roundtrip is the important thing
    assert_eq!(
        serde_json::from_str::<RefMode>(&a1_json).unwrap(),
        RefMode::A1
    );
    assert_eq!(
        serde_json::from_str::<RefMode>(&r1c1_json).unwrap(),
        RefMode::R1C1
    );
}

#[test]
fn enum_serde_object_display_mode() {
    assert_eq!(
        serde_json::to_string(&ObjectDisplayMode::All).unwrap(),
        r#""all""#
    );
    assert_eq!(
        serde_json::to_string(&ObjectDisplayMode::Placeholders).unwrap(),
        r#""placeholders""#
    );
    assert_eq!(
        serde_json::to_string(&ObjectDisplayMode::None).unwrap(),
        r#""none""#
    );

    assert_eq!(
        serde_json::from_str::<ObjectDisplayMode>(r#""all""#).unwrap(),
        ObjectDisplayMode::All
    );
    assert_eq!(
        serde_json::from_str::<ObjectDisplayMode>(r#""placeholders""#).unwrap(),
        ObjectDisplayMode::Placeholders
    );
    assert_eq!(
        serde_json::from_str::<ObjectDisplayMode>(r#""none""#).unwrap(),
        ObjectDisplayMode::None
    );
}

#[test]
fn enum_serde_update_links() {
    assert_eq!(
        serde_json::to_string(&UpdateLinks::UserSet).unwrap(),
        r#""userSet""#
    );
    assert_eq!(
        serde_json::to_string(&UpdateLinks::Never).unwrap(),
        r#""never""#
    );
    assert_eq!(
        serde_json::to_string(&UpdateLinks::Always).unwrap(),
        r#""always""#
    );

    assert_eq!(
        serde_json::from_str::<UpdateLinks>(r#""userSet""#).unwrap(),
        UpdateLinks::UserSet
    );
    assert_eq!(
        serde_json::from_str::<UpdateLinks>(r#""never""#).unwrap(),
        UpdateLinks::Never
    );
    assert_eq!(
        serde_json::from_str::<UpdateLinks>(r#""always""#).unwrap(),
        UpdateLinks::Always
    );
}

#[test]
fn enum_serde_workbook_view_visibility() {
    assert_eq!(
        serde_json::to_string(&WorkbookViewVisibility::Visible).unwrap(),
        r#""visible""#
    );
    assert_eq!(
        serde_json::to_string(&WorkbookViewVisibility::Hidden).unwrap(),
        r#""hidden""#
    );
    assert_eq!(
        serde_json::to_string(&WorkbookViewVisibility::VeryHidden).unwrap(),
        r#""veryHidden""#
    );

    assert_eq!(
        serde_json::from_str::<WorkbookViewVisibility>(r#""visible""#).unwrap(),
        WorkbookViewVisibility::Visible
    );
    assert_eq!(
        serde_json::from_str::<WorkbookViewVisibility>(r#""hidden""#).unwrap(),
        WorkbookViewVisibility::Hidden
    );
    assert_eq!(
        serde_json::from_str::<WorkbookViewVisibility>(r#""veryHidden""#).unwrap(),
        WorkbookViewVisibility::VeryHidden
    );
}
