//! Workbook settings use the same native state for API queries and XLSX export.

use compute_core::storage::engine::ComputeEngine;
use domain_types::{
    ParseOutput, SheetData,
    domain::workbook::{
        HashAlgorithm, ObjectDisplayMode, UpdateLinks, WorkbookProperties, WorkbookProtection,
        WorkbookView, WorkbookViewVisibility,
    },
};
use snapshot_types::{
    CalcMode, CalculationSettings, RustWorkbookSettingsPatch, WorkbookProtectionOptions,
    WorkbookSettings,
};
use value_types::FiniteF64;

fn fixture() -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Settings".into(),
            rows: 2,
            cols: 2,
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn import(output: &ParseOutput) -> ComputeEngine {
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(output).unwrap();
    ComputeEngine::from_xlsx_bytes(&bytes).unwrap().0
}

fn roundtrip(engine: &ComputeEngine) -> (ComputeEngine, ParseOutput) {
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let parsed = xlsx_api::parse(&bytes).unwrap().output;
    (ComputeEngine::from_xlsx_bytes(&bytes).unwrap().0, parsed)
}

#[test]
fn full_imported_workbook_metadata_survives_unrelated_settings_edits() {
    let mut source = fixture();
    source.workbook_properties = Some(WorkbookProperties {
        date1904: true,
        show_objects: ObjectDisplayMode::Placeholders,
        show_border_unselected_tables: false,
        filter_privacy: true,
        prompted_solutions: true,
        show_ink_annotation: false,
        backup_file: true,
        save_external_link_values: false,
        update_links: UpdateLinks::Always,
        code_name: Some("SettingsWorkbook".into()),
        hide_pivot_field_list: true,
        show_pivot_chart_filter: true,
        allow_refresh_query: true,
        publish_items: true,
        check_compatibility: true,
        auto_compress_pictures: false,
        refresh_all_connections: true,
        default_theme_version: Some(164011),
    });
    source.protection = Some(WorkbookProtection {
        lock_structure: true,
        lock_windows: true,
        lock_revision: true,
        workbook_algorithm_name: HashAlgorithm::Sha512,
        workbook_hash_value: Some("aGFzaA==".into()),
        workbook_salt_value: Some("c2FsdA==".into()),
        workbook_spin_count: Some(100000),
        revisions_algorithm_name: HashAlgorithm::Sha256,
        revisions_hash_value: Some("cmV2aXNpb24=".into()),
        revisions_salt_value: Some("cmV2c2FsdA==".into()),
        revisions_spin_count: Some(50000),
        workbook_password: Some("CC2A".into()),
        workbook_password_character_set: Some("UTF-8".into()),
        revisions_password: Some("ABCD".into()),
        revisions_password_character_set: Some("UTF-16".into()),
    });
    source.workbook_views = vec![WorkbookView {
        visibility: WorkbookViewVisibility::Hidden,
        minimized: true,
        show_horizontal_scroll: false,
        show_vertical_scroll: false,
        show_sheet_tabs: false,
        auto_filter_date_grouping: false,
        x_window: Some(-100),
        y_window: Some(50),
        window_width: Some(12000),
        window_height: Some(9000),
        tab_ratio: Some(350.0),
        uid: Some("{550E8400-E29B-41D4-A716-446655440000}".into()),
        ..Default::default()
    }];

    let mut engine = import(&source);
    for _ in 0..2 {
        engine
            .patch_workbook_settings(RustWorkbookSettingsPatch {
                culture: Some("ja-JP".into()),
                ..Default::default()
            })
            .unwrap();
        let settings = engine.get_workbook_settings();
        assert!(settings.date1904);
        assert!(settings.is_workbook_protected);
        assert_eq!(
            settings.workbook_protection_password_hash.as_deref(),
            Some("aGFzaA==")
        );
        let (next, exported) = roundtrip(&engine);
        assert_eq!(exported.workbook_properties, source.workbook_properties);
        assert_eq!(exported.protection, source.protection);
        assert_eq!(exported.workbook_views, source.workbook_views);
        engine = next;
    }
}

#[test]
fn settings_set_patch_and_single_key_mutations_reach_xlsx() {
    let mut engine = import(&fixture());
    let calculation = CalculationSettings {
        enable_iterative_calculation: true,
        max_iterations: 37,
        max_change: FiniteF64::must(0.00001),
        calc_mode: CalcMode::Manual,
        full_precision: false,
        r1c1_mode: true,
        full_calc_on_load: true,
        calc_completed: false,
        calc_on_save: false,
        concurrent_calc: false,
        concurrent_manual_count: Some(3),
        force_full_calc: true,
        calc_id: Some(191029),
        has_explicit_iterate_count: true,
        has_explicit_iterate_delta: true,
    };
    engine
        .set_workbook_settings(WorkbookSettings {
            date1904: true,
            is_workbook_protected: true,
            workbook_protection_password_hash: Some("CC2A".into()),
            workbook_protection_options: Some(WorkbookProtectionOptions { structure: true }),
            calculation_settings: Some(calculation.clone()),
            ..Default::default()
        })
        .unwrap();

    for _ in 0..2 {
        let (next, exported) = roundtrip(&engine);
        assert!(exported.workbook_properties.unwrap().date1904);
        let protection = exported.protection.unwrap();
        assert!(protection.lock_structure);
        assert_eq!(protection.workbook_password.as_deref(), Some("CC2A"));
        assert_eq!(protection.workbook_hash_value, None);
        // Editing calculation settings invalidates Excel's cached-engine version.
        // The XLSX writer intentionally emits calcId=0 for this state.
        let mut expected = calculation.clone();
        expected.calc_id = Some(0);
        assert_eq!(
            next.get_workbook_settings().calculation_settings,
            Some(expected)
        );
        engine = next;
    }

    engine
        .patch_workbook_settings(RustWorkbookSettingsPatch {
            date1904: Some(false),
            workbook_protection_password_hash: Some(None),
            calculation_settings: Some(Some(CalculationSettings {
                calc_mode: CalcMode::AutoNoTable,
                ..calculation.clone()
            })),
            ..Default::default()
        })
        .unwrap();
    engine
        .set_workbook_setting("isWorkbookProtected", serde_json::json!(false))
        .unwrap();
    let (next, exported) = roundtrip(&engine);
    assert!(!exported.workbook_properties.unwrap().date1904);
    assert!(
        exported
            .protection
            .as_ref()
            .is_none_or(|p| !p.lock_structure)
    );
    let settings = next.get_workbook_settings();
    assert!(!settings.is_workbook_protected);
    assert_eq!(settings.workbook_protection_password_hash, None);
    assert_eq!(
        settings.calculation_settings.unwrap().calc_mode,
        CalcMode::AutoNoTable
    );
}
