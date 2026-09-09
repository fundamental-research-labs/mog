//! Imported date-group and temporal dynamic AutoFilter behavior.

use super::helpers::engine_from_parse_output_normal;
use cell_types::SheetId;
use domain_types::domain::filter::{CalendarType, DateGroupItem, DateTimeGrouping};
use domain_types::domain::table::{FilterColumnSpec, FilterSpec, TableColumnSpec, TableSpec};
use domain_types::{
    AutoFilter, FilterColumn, OoxmlFilterType, ParseOutput, SheetData,
    domain::workbook::WorkbookProperties,
};
use std::sync::Arc;
use value_types::{CellValue, DateSystem, FiniteF64, date_to_serial};

fn date_serial(year: i32, month: u32, day: u32) -> f64 {
    date_to_serial(&chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap())
}

fn date_cell(row: u32, serial: f64) -> domain_types::CellData {
    domain_types::CellData {
        row,
        col: 0,
        value: CellValue::Number(FiniteF64::must(serial)),
        ..Default::default()
    }
}

#[test]
fn imported_date_group_filter_evaluates_and_roundtrips_calendar_metadata() {
    let date_group = DateGroupItem {
        year: 2024,
        date_time_grouping: DateTimeGrouping::Year,
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDateGroups".to_string(),
            rows: 4,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_serial(2024, 1, 1) + 0.5),
                date_cell(2, date_serial(2023, 12, 31) + 0.9),
                date_cell(3, date_serial(2024, 7, 4) + 0.25),
            ],
            auto_filter: Some(AutoFilter {
                range_ref: "A1:A4".to_string(),
                columns: vec![FilterColumn {
                    col_index: 0,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: Vec::new(),
                        blanks: false,
                        calendar_type: Some(CalendarType::GregorianUs),
                        date_group_items: vec![date_group.clone()],
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    assert_eq!(
        engine.get_hidden_rows(&sheet_id),
        vec![2],
        "the date-group year criterion should exclude only the 2023 row"
    );

    let runtime_filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.filter_kind == crate::storage::sheet::filters::FilterKind::AutoFilter)
        .expect("date-group AutoFilter should hydrate");
    assert!(matches!(
        runtime_filter.column_filters.values().next(),
        Some(crate::storage::sheet::filters::ColumnFilter::Condition { .. })
    ));

    let exported = engine
        .export_to_parse_output()
        .expect("date-group export")
        .parse_output;
    let Some(OoxmlFilterType::Values {
        calendar_type,
        date_group_items,
        ..
    }) = exported.sheets[0].auto_filter.as_ref().unwrap().columns[0]
        .filter_type
        .as_ref()
    else {
        panic!("expected typed date-group values filter");
    };
    assert_eq!(*calendar_type, Some(CalendarType::GregorianUs));
    assert_eq!(date_group_items, &[date_group]);
}

fn date_group_filter_1904_fixture() -> ParseOutput {
    let date_group = DateGroupItem {
        year: 2024,
        date_time_grouping: DateTimeGrouping::Year,
        ..Default::default()
    };
    let workbook_serial = |year: i32, month: u32, day: u32| {
        date_serial(year, month, day) - DateSystem::DATE_SYSTEM_1904_OFFSET
    };
    ParseOutput {
        workbook_properties: Some(WorkbookProperties {
            date1904: true,
            ..Default::default()
        }),
        sheets: vec![SheetData {
            name: "ImportedDateGroups1904".to_string(),
            rows: 4,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, workbook_serial(2024, 1, 1) + 0.5),
                date_cell(2, workbook_serial(2023, 12, 31) + 0.9),
                date_cell(3, workbook_serial(2024, 7, 4) + 0.25),
            ],
            auto_filter: Some(AutoFilter {
                range_ref: "A1:A4".to_string(),
                columns: vec![FilterColumn {
                    col_index: 0,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: Vec::new(),
                        blanks: false,
                        calendar_type: None,
                        date_group_items: vec![date_group],
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn imported_date_group_filter_uses_1904_workbook_serials() {
    let input = date_group_filter_1904_fixture();

    let engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2]);
}

#[test]
fn deferred_1904_date_group_filters_use_workbook_epoch_before_and_after_completion() {
    let mut input = date_group_filter_1904_fixture();
    let mut remaining_sheet = input.sheets[0].clone();
    remaining_sheet.name = "RemainingDateGroups1904".to_string();
    input.sheets.push(remaining_sheet);
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&input)
        .expect("write deferred date-group workbook");
    let (mut engine, _) =
        super::super::ComputeEngine::from_snapshot(super::helpers::simple_snapshot())
            .expect("create engine");
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("import critical sheet");
    let first = SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).unwrap();
    assert_eq!(
        engine.get_hidden_rows(&first),
        vec![2],
        "critical hydration must evaluate 1904 serials before filter visibility is materialized"
    );

    engine
        .complete_deferred_hydration()
        .expect("hydrate remaining sheet");
    for sheet in engine.get_all_sheet_ids() {
        let sheet = SheetId::from_uuid_str(&sheet).unwrap();
        assert_eq!(
            engine.get_hidden_rows(&sheet),
            vec![2],
            "both the critical and remaining sheets must retain calendar filter visibility"
        );
    }
}

#[test]
fn imported_date_group_reapplies_after_date_system_toggle_and_refreshes_count() {
    let date_group = DateGroupItem {
        year: 2024,
        date_time_grouping: DateTimeGrouping::Year,
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDateGroupsToggle".to_string(),
            rows: 4,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_serial(2024, 1, 1) + 0.5),
                date_cell(2, date_serial(2023, 12, 31) + 0.9),
                date_cell(3, date_serial(2024, 7, 4) + 0.25),
            ],
            auto_filter: Some(AutoFilter {
                range_ref: "A1:A4".to_string(),
                columns: vec![FilterColumn {
                    col_index: 0,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: Vec::new(),
                        blanks: false,
                        calendar_type: None,
                        date_group_items: vec![date_group],
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let filter_id = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.filter_kind == crate::storage::sheet::filters::FilterKind::AutoFilter)
        .expect("imported worksheet filter")
        .id;
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2]);

    let mut settings = engine.get_workbook_settings();
    settings.date1904 = true;
    engine
        .set_workbook_settings(settings)
        .expect("toggle date1904");
    for (row, value) in [
        (
            1,
            date_serial(2024, 1, 1) - DateSystem::DATE_SYSTEM_1904_OFFSET + 0.5,
        ),
        (
            2,
            date_serial(2023, 12, 31) - DateSystem::DATE_SYSTEM_1904_OFFSET + 0.9,
        ),
        (
            3,
            date_serial(2024, 7, 4) - DateSystem::DATE_SYSTEM_1904_OFFSET + 0.25,
        ),
    ] {
        engine
            .set_cell_value_parsed(&sheet_id, row, 0, &value.to_string())
            .expect("rebase imported date serial");
    }

    engine
        .reapply_filter(&sheet_id, &filter_id)
        .expect("reapply date-group filter after date-system toggle");
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2]);
    let count = engine
        .get_filtered_record_count(&sheet_id, &filter_id)
        .expect("date-group record count");
    assert_eq!((count.visible, count.total), (2, 3));
}

#[test]
fn user_worksheet_filter_equal_to_stale_date_projection_is_not_recompiled() {
    let date_group = DateGroupItem {
        year: 2024,
        date_time_grouping: DateTimeGrouping::Year,
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDateGroupsUserEdit".to_string(),
            rows: 3,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_serial(2024, 1, 1) + 0.5),
                date_cell(2, date_serial(2023, 12, 31) + 0.5),
            ],
            auto_filter: Some(AutoFilter {
                range_ref: "A1:A3".to_string(),
                columns: vec![FilterColumn {
                    col_index: 0,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: Vec::new(),
                        blanks: false,
                        calendar_type: None,
                        date_group_items: vec![date_group],
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let imported = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.filter_kind == crate::storage::sheet::filters::FilterKind::AutoFilter)
        .expect("imported worksheet filter");
    let filter_id = imported.id.clone();
    let stale_projection = imported
        .column_filters
        .values()
        .next()
        .cloned()
        .expect("date-group runtime projection");

    let mut settings = engine.get_workbook_settings();
    settings.date1904 = true;
    engine
        .set_workbook_settings(settings)
        .expect("toggle date1904");

    // This is a deliberate user edit whose numeric condition happens to equal
    // the old Date1900 projection. It must remain authoritative after the
    // Date1904 refresh hook runs.
    engine
        .set_column_filter(&sheet_id, &filter_id, 0, stale_projection.clone())
        .expect("set user worksheet criterion");
    let after_edit = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("worksheet filter after edit");
    assert_eq!(
        after_edit.column_filters.values().next(),
        Some(&stale_projection),
        "a coincidentally equal user criterion must not be recompiled"
    );

    let exported = engine
        .export_to_parse_output()
        .expect("worksheet user-edit export")
        .parse_output;
    assert!(matches!(
        exported.sheets[0].auto_filter.as_ref().unwrap().columns[0]
            .filter_type
            .as_ref(),
        Some(OoxmlFilterType::Custom { .. })
    ));
}

#[test]
fn imported_temporal_dynamic_filter_evaluates_and_preserves_iso_metadata() {
    let today = crate::eval::clock::current_calendar_date();
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDynamic".to_string(),
            rows: 4,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_to_serial(&today) + 0.5),
                date_cell(
                    2,
                    date_to_serial(&(today - chrono::Duration::days(1))) + 0.5,
                ),
                date_cell(
                    3,
                    date_to_serial(&(today + chrono::Duration::days(1))) + 0.5,
                ),
            ],
            auto_filter: Some(AutoFilter {
                range_ref: "A1:A4".to_string(),
                columns: vec![FilterColumn {
                    col_index: 0,
                    filter_type: Some(OoxmlFilterType::Dynamic {
                        dynamic_type: "today".to_string(),
                        value: Some(123.0),
                        max_value: Some(456.0),
                        value_iso: Some("2026-09-09T00:00:00".to_string()),
                        max_value_iso: Some("2026-09-10T00:00:00".to_string()),
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2, 3]);

    let exported = engine
        .export_to_parse_output()
        .expect("dynamic filter export")
        .parse_output;
    let Some(OoxmlFilterType::Dynamic {
        dynamic_type,
        value,
        max_value,
        value_iso,
        max_value_iso,
    }) = exported.sheets[0].auto_filter.as_ref().unwrap().columns[0]
        .filter_type
        .as_ref()
    else {
        panic!("expected typed dynamic filter");
    };
    assert_eq!(dynamic_type, "today");
    assert_eq!(*value, Some(123.0));
    assert_eq!(*max_value, Some(456.0));
    assert_eq!(value_iso.as_deref(), Some("2026-09-09T00:00:00"));
    assert_eq!(max_value_iso.as_deref(), Some("2026-09-10T00:00:00"));
}

#[test]
fn imported_table_date_group_filter_projects_and_roundtrips_typed_metadata() {
    let date_group = DateGroupItem {
        year: 2024,
        month: Some(7),
        day: Some(4),
        date_time_grouping: DateTimeGrouping::Day,
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDateTable".to_string(),
            rows: 5,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_serial(2024, 7, 4) + 0.1),
                date_cell(2, date_serial(2024, 7, 5) + 0.1),
                date_cell(3, date_serial(2023, 7, 4) + 0.1),
                date_cell(4, date_serial(2024, 7, 4) + 0.9),
            ],
            tables: vec![numeric_table_spec(vec![FilterColumnSpec {
                col_id: 0,
                hidden_button: false,
                show_button: true,
                filter: FilterSpec::Values {
                    blank: false,
                    values: Vec::new(),
                    calendar_type: Some(CalendarType::Hijri),
                    date_group_items: vec![date_group.clone()],
                },
                ext_lst_raw: None,
            }])],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2, 3]);

    let exported = engine
        .export_to_parse_output()
        .expect("table date-group export")
        .parse_output;
    let exported_filter = &exported.sheets[0].tables[0].filter_columns[0].filter;
    let FilterSpec::Values {
        calendar_type,
        date_group_items,
        ..
    } = exported_filter
    else {
        panic!("expected typed table date-group filter");
    };
    assert_eq!(*calendar_type, Some(CalendarType::Hijri));
    assert_eq!(date_group_items, &[date_group]);
}

#[test]
fn imported_table_date_group_reapplies_after_date_system_toggle_and_refreshes_count() {
    let date_group = DateGroupItem {
        year: 2024,
        month: Some(7),
        day: Some(4),
        date_time_grouping: DateTimeGrouping::Day,
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDateTableToggle".to_string(),
            rows: 5,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_serial(2024, 7, 4) + 0.1),
                date_cell(2, date_serial(2024, 7, 5) + 0.1),
                date_cell(3, date_serial(2023, 7, 4) + 0.1),
                date_cell(4, date_serial(2024, 7, 4) + 0.9),
            ],
            tables: vec![numeric_table_spec(vec![FilterColumnSpec {
                col_id: 0,
                hidden_button: false,
                show_button: true,
                filter: FilterSpec::Values {
                    blank: false,
                    values: Vec::new(),
                    calendar_type: Some(CalendarType::Gregorian),
                    date_group_items: vec![date_group],
                },
                ext_lst_raw: None,
            }])],
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let filter_id = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("imported table filter")
        .id;
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2, 3]);

    let mut settings = engine.get_workbook_settings();
    settings.date1904 = true;
    engine
        .set_workbook_settings(settings)
        .expect("toggle date1904");
    for (row, value) in [
        (
            1,
            date_serial(2024, 7, 4) - DateSystem::DATE_SYSTEM_1904_OFFSET + 0.1,
        ),
        (
            2,
            date_serial(2024, 7, 5) - DateSystem::DATE_SYSTEM_1904_OFFSET + 0.1,
        ),
        (
            3,
            date_serial(2023, 7, 4) - DateSystem::DATE_SYSTEM_1904_OFFSET + 0.1,
        ),
        (
            4,
            date_serial(2024, 7, 4) - DateSystem::DATE_SYSTEM_1904_OFFSET + 0.9,
        ),
    ] {
        engine
            .set_cell_value_parsed(&sheet_id, row, 0, &value.to_string())
            .expect("rebase imported table date serial");
    }

    let reopened = super::helpers::rebuild_native_engine(&engine);
    assert_eq!(reopened.get_hidden_rows(&sheet_id), vec![2, 3]);
    let reopened_count = reopened
        .get_filtered_record_count(&sheet_id, &filter_id)
        .expect("reopened date-group count");
    assert_eq!((reopened_count.visible, reopened_count.total), (2, 4));

    engine
        .reapply_filter(&sheet_id, &filter_id)
        .expect("reapply table date-group filter after date-system toggle");
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2, 3]);
    let count = engine
        .get_filtered_record_count(&sheet_id, &filter_id)
        .expect("table date-group record count");
    assert_eq!((count.visible, count.total), (2, 4));
}

#[test]
fn user_table_filter_equal_to_stale_date_projection_is_not_recompiled() {
    let date_group = DateGroupItem {
        year: 2024,
        month: Some(7),
        day: Some(4),
        date_time_grouping: DateTimeGrouping::Day,
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDateTableUserEdit".to_string(),
            rows: 5,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_serial(2024, 7, 4) + 0.1),
                date_cell(2, date_serial(2024, 7, 5) + 0.1),
                date_cell(3, date_serial(2024, 7, 4) + 0.2),
                date_cell(4, date_serial(2024, 7, 5) + 0.2),
            ],
            tables: vec![numeric_table_spec(vec![FilterColumnSpec {
                col_id: 0,
                hidden_button: false,
                show_button: true,
                filter: FilterSpec::Values {
                    blank: false,
                    values: Vec::new(),
                    calendar_type: Some(CalendarType::Gregorian),
                    date_group_items: vec![date_group],
                },
                ext_lst_raw: None,
            }])],
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let imported = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("imported table filter");
    let filter_id = imported.id.clone();
    let stale_projection = imported
        .column_filters
        .values()
        .next()
        .cloned()
        .expect("date-group table runtime projection");

    let mut settings = engine.get_workbook_settings();
    settings.date1904 = true;
    engine
        .set_workbook_settings(settings)
        .expect("toggle date1904");

    engine
        .set_column_filter(&sheet_id, &filter_id, 0, stale_projection.clone())
        .expect("set user table criterion");
    let after_edit = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("table filter after edit");
    assert_eq!(
        after_edit.column_filters.values().next(),
        Some(&stale_projection),
        "a coincidentally equal user criterion must not be recompiled"
    );

    let table = engine
        .get_all_tables_in_sheet(&sheet_id)
        .into_iter()
        .next()
        .expect("imported table after edit");
    assert!(matches!(
        &table.filter_columns[0].filter,
        FilterSpec::Values {
            date_group_items,
            ..
        } if date_group_items.is_empty()
    ));

    let exported = engine
        .export_to_parse_output()
        .expect("table user-edit export")
        .parse_output;
    assert!(matches!(
        &exported.sheets[0].tables[0].filter_columns[0].filter,
        FilterSpec::Custom { .. }
    ));

    let bytes = engine
        .export_to_xlsx_bytes()
        .expect("export edited interval to XLSX");
    let (roundtrip, _) =
        xlsx_parser::parse_xlsx_to_output(&bytes).expect("parse edited interval XLSX");
    let reimported = engine_from_parse_output_normal(&roundtrip);
    let reimported_sheet = SheetId::from_uuid_str(&reimported.get_all_sheet_ids()[0]).unwrap();
    assert_eq!(
        reimported.get_hidden_rows(&reimported_sheet),
        engine.get_hidden_rows(&sheet_id)
    );
    let reimported_filter = reimported
        .get_filters_in_sheet(&reimported_sheet)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("reimported interval filter");
    let reimported_count = reimported
        .get_filtered_record_count(&reimported_sheet, &reimported_filter.id)
        .expect("reimported interval count");
    assert_eq!((reimported_count.visible, reimported_count.total), (2, 4));

    let replayed = super::helpers::rebuild_native_engine(&engine);
    let replayed_filter = replayed
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("replayed table filter");
    assert_eq!(
        replayed_filter.column_filters.values().next(),
        Some(&stale_projection),
        "replay must retain the coincident user predicate"
    );
    assert_eq!(
        replayed.get_hidden_rows(&sheet_id),
        engine.get_hidden_rows(&sheet_id)
    );
    let replayed_count = replayed
        .get_filtered_record_count(&sheet_id, &filter_id)
        .expect("replayed table filter count");
    let original_count = engine
        .get_filtered_record_count(&sheet_id, &filter_id)
        .expect("edited table filter count");
    assert_eq!(replayed_count, original_count);

    engine
        .clear_column_filter(&sheet_id, &filter_id, 0)
        .expect("clear edited table filter");
    let cleared_replay = super::helpers::rebuild_native_engine(&engine);
    let cleared_filter = cleared_replay
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("cleared table filter");
    assert!(cleared_filter.column_filters.is_empty());
    assert!(cleared_replay.get_hidden_rows(&sheet_id).is_empty());
    let cleared_count = cleared_replay
        .get_filtered_record_count(&sheet_id, &filter_id)
        .expect("cleared table filter count");
    assert_eq!((cleared_count.visible, cleared_count.total), (4, 4));
}

#[test]
fn imported_table_temporal_dynamic_filter_projects_and_roundtrips_metadata() {
    let today = crate::eval::clock::current_calendar_date();
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedDynamicTable".to_string(),
            rows: 5,
            cols: 1,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("When")),
                    ..Default::default()
                },
                date_cell(1, date_to_serial(&today) + 0.5),
                date_cell(
                    2,
                    date_to_serial(&(today - chrono::Duration::days(1))) + 0.5,
                ),
                date_cell(
                    3,
                    date_to_serial(&(today + chrono::Duration::days(1))) + 0.5,
                ),
                date_cell(4, date_to_serial(&today) + 0.75),
            ],
            tables: vec![numeric_table_spec(vec![FilterColumnSpec {
                col_id: 0,
                hidden_button: false,
                show_button: true,
                filter: FilterSpec::Dynamic {
                    kind: "today".to_string(),
                    val: Some(321.0),
                    max_val: Some(654.0),
                    val_iso: Some("2026-09-09T00:00:00".to_string()),
                    max_val_iso: Some("2026-09-10T00:00:00".to_string()),
                },
                ext_lst_raw: None,
            }])],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2, 3]);

    let exported = engine
        .export_to_parse_output()
        .expect("table dynamic export")
        .parse_output;
    let FilterSpec::Dynamic {
        kind,
        val,
        max_val,
        val_iso,
        max_val_iso,
    } = &exported.sheets[0].tables[0].filter_columns[0].filter
    else {
        panic!("expected typed table dynamic filter");
    };
    assert_eq!(kind, "today");
    assert_eq!(*val, Some(321.0));
    assert_eq!(*max_val, Some(654.0));
    assert_eq!(val_iso.as_deref(), Some("2026-09-09T00:00:00"));
    assert_eq!(max_val_iso.as_deref(), Some("2026-09-10T00:00:00"));
}

fn numeric_table_spec(filter_columns: Vec<FilterColumnSpec>) -> TableSpec {
    TableSpec {
        id: 2,
        name: "NumericDates".to_string(),
        display_name: "NumericDates".to_string(),
        range_ref: "A1:A5".to_string(),
        auto_filter_ref: Some("A1:A5".to_string()),
        columns: vec![TableColumnSpec {
            id: 1,
            name: "When".to_string(),
            ..Default::default()
        }],
        filter_columns,
        ..Default::default()
    }
}
