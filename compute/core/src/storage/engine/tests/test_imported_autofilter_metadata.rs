//! Imported worksheet AutoFilter metadata lifecycle tests.

use super::helpers::engine_from_parse_output_normal;
use crate::snapshot::{MutationResult, RuntimeDiagnosticsOptions};
use cell_types::SheetId;
use domain_types::domain::table::{FilterColumnSpec, FilterSpec, TableColumnSpec, TableSpec};
use domain_types::{AutoFilter, FilterColumn, OoxmlFilterType, ParseOutput, SheetData};
use std::sync::Arc;
use value_types::CellValue;

#[test]
fn deleted_imported_auto_filter_does_not_export_stale_lossless_metadata() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedFilter".to_string(),
            rows: 4,
            cols: 2,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("Name")),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: CellValue::Text(Arc::from("Status")),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 1,
                    col: 0,
                    value: CellValue::Text(Arc::from("Alice")),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 1,
                    col: 1,
                    value: CellValue::Text(Arc::from("Keep")),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 2,
                    col: 0,
                    value: CellValue::Text(Arc::from("Bob")),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 2,
                    col: 1,
                    value: CellValue::Text(Arc::from("Drop")),
                    ..Default::default()
                },
            ],
            auto_filter: Some(AutoFilter {
                range_ref: "A1:B4".to_string(),
                columns: vec![FilterColumn {
                    col_index: 1,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: vec!["Keep".to_string()],
                        blanks: false,
                        calendar_type: None,
                        date_group_items: Vec::new(),
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
        .expect("imported AutoFilter should hydrate into a runtime filter")
        .id;

    engine
        .delete_filter(&sheet_id, &filter_id)
        .expect("deleting imported AutoFilter should succeed");

    let exported = engine
        .export_to_parse_output()
        .expect("export after deleting imported AutoFilter should succeed")
        .parse_output;

    assert!(
        exported.sheets[0].auto_filter.is_none(),
        "deleted imported AutoFilter metadata must not be resurrected on export"
    );
}

#[test]
fn imported_table_autofilter_materializes_runtime_table_filter() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "ImportedTableFilter".to_string(),
            rows: 4,
            cols: 2,
            cells: people_table_cells(),
            tables: vec![people_table_spec(vec![FilterColumnSpec {
                col_id: 1,
                hidden_button: false,
                show_button: true,
                filter: FilterSpec::Values {
                    blank: false,
                    values: vec!["Eng".to_string()],
                    calendar_type: None,
                    date_group_items: Vec::new(),
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
    let filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("imported table AutoFilter should materialize as a runtime TableFilter");
    let table = engine
        .get_all_tables_in_sheet(&sheet_id)
        .into_iter()
        .find(|table| table.name == "People")
        .expect("hydrated People table");
    let stable_table_id = table.id.clone();
    let stable_dept_column_id = table.columns[1].id.clone();

    assert!(stable_table_id.starts_with("tbl-"));
    assert!(stable_dept_column_id.starts_with("col-"));
    assert_eq!(filter.table_id.as_deref(), Some(stable_table_id.as_str()));
    assert_eq!(filter.column_filters.len(), 1);
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2]);

    let binding = crate::storage::sheet::filters::get_filter_metadata_binding(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        &filter.id,
    )
    .expect("imported table filter should have a metadata binding");
    assert_eq!(
        binding.filter_kind,
        crate::storage::sheet::filters::FilterKind::TableFilter
    );
    assert_eq!(binding.table_id.as_deref(), Some(stable_table_id.as_str()));
    assert_eq!(binding.range_ref, "A1:B4");
    assert_eq!(
        binding.owner_path,
        crate::storage::sheet::filters::FilterMetadataOwnerPath::TableAutoFilter {
            sheet_id: sheet_id.to_uuid_string(),
            table_id: stable_table_id.clone(),
        }
    );
    assert_eq!(
        binding
            .table_column_id_to_header_cell_id
            .get(&stable_dept_column_id),
        binding.col_id_to_header_cell_id.get(&1)
    );
    assert_eq!(
        binding.shell.capability,
        crate::storage::sheet::filters::FilterCapability::Supported
    );
    assert!(binding.shell.has_active_lossless_criteria);
    assert_eq!(binding.shell.button_metadata.len(), 2);
    assert_eq!(
        binding.shell.lossless_criteria[0]
            .table_column_id
            .as_deref(),
        Some(stable_dept_column_id.as_str())
    );
    assert_eq!(
        binding.shell.lossless_criteria[0].table_column_ordinal,
        Some(1)
    );

    let header_info = engine.get_filter_header_info(&sheet_id);
    assert_eq!(header_info.len(), 2);
    assert!(header_info.iter().all(|info| {
        info.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
            && info.table_id.as_deref() == Some(stable_table_id.as_str())
            && info.source_type
                == crate::storage::sheet::filters::FilterHeaderSourceType::TableAutoFilter
    }));
    assert!(
        header_info
            .iter()
            .any(|info| info.col == 1 && info.has_active_filter && info.button_visible)
    );
}

#[test]
fn deleting_sheet_autofilter_does_not_clear_imported_table_autofilter_metadata() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "MixedFilters".to_string(),
            rows: 4,
            cols: 2,
            cells: people_table_cells(),
            auto_filter: Some(AutoFilter {
                range_ref: "A1:B4".to_string(),
                columns: vec![FilterColumn {
                    col_index: 1,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: vec!["Eng".to_string()],
                        blanks: false,
                        calendar_type: None,
                        date_group_items: Vec::new(),
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            tables: vec![people_table_spec(vec![FilterColumnSpec {
                col_id: 1,
                hidden_button: false,
                show_button: true,
                filter: FilterSpec::Values {
                    blank: false,
                    values: vec!["Eng".to_string()],
                    calendar_type: None,
                    date_group_items: Vec::new(),
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
    let sheet_filter_id = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.filter_kind == crate::storage::sheet::filters::FilterKind::AutoFilter)
        .expect("sheet AutoFilter should materialize")
        .id;

    engine
        .delete_filter(&sheet_id, &sheet_filter_id)
        .expect("sheet AutoFilter delete should succeed");

    let remaining_filters = engine.get_filters_in_sheet(&sheet_id);
    assert!(
        remaining_filters
            .iter()
            .any(|filter| filter.filter_kind
                == crate::storage::sheet::filters::FilterKind::TableFilter),
        "sheet AutoFilter delete must not remove table AutoFilter runtime state"
    );

    let exported = engine
        .export_to_parse_output()
        .expect("export after deleting sheet AutoFilter should succeed")
        .parse_output;
    assert!(
        exported.sheets[0].auto_filter.is_none(),
        "sheet AutoFilter metadata should be removed"
    );
    assert_eq!(
        exported.sheets[0].tables[0].filter_columns.len(),
        1,
        "table AutoFilter metadata must remain isolated from sheet AutoFilter deletion"
    );
}

#[test]
fn unsupported_imported_table_autofilter_records_import_diagnostic() {
    let input = unsupported_people_table_filter_parse_output();

    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("unsupported imported table AutoFilter should still materialize a shell");
    let stable_table_id = filter
        .table_id
        .clone()
        .expect("unsupported imported table filter should use stable table id");
    assert!(stable_table_id.starts_with("tbl-"));
    assert!(
        filter.column_filters.is_empty(),
        "unsupported table shell must not fabricate runtime criteria"
    );

    let binding = crate::storage::sheet::filters::get_filter_metadata_binding(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        &filter.id,
    )
    .expect("unsupported table shell should have a metadata binding");
    assert_eq!(
        binding.shell.capability,
        crate::storage::sheet::filters::FilterCapability::Unsupported
    );
    assert_eq!(
        binding.shell.unsupported_reasons,
        vec![crate::storage::sheet::filters::ImportFilterUnsupportedReason::IconFilterUnsupported]
    );

    let mut report = domain_types::ImportReport::default();
    crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
        &mut engine.stores,
        &mut engine.mirror,
        Some(&mut report),
        domain_types::ImportPhase::FullHydration,
    );

    assert_eq!(report.diagnostics.len(), 1);
    let diagnostic = &report.diagnostics[0];
    assert_eq!(diagnostic.feature, domain_types::ImportFeatureKind::Table);
    assert_eq!(
        diagnostic.recoverability,
        domain_types::ImportRecoverability::UnsupportedPreserved
    );
    let reference = diagnostic.reference.as_ref().expect("diagnostic reference");
    assert_eq!(
        reference.sheet_name.as_deref(),
        Some("UnsupportedTableFilter")
    );
    assert_eq!(reference.source_range.as_deref(), Some("A1:B4"));
    assert_eq!(
        reference.object_id.as_deref(),
        Some(stable_table_id.as_str())
    );
    assert_eq!(reference.table_column_ordinal, Some(1));
    assert_eq!(reference.cell_ref.as_deref(), Some("B1"));

    let Some(domain_types::ImportDiagnosticDetails::UnsupportedFilter {
        reasons,
        filter_kind,
        table_column_ordinal,
        resolved_col,
        ..
    }) = diagnostic.details.as_ref()
    else {
        panic!("expected unsupported filter details");
    };
    assert_eq!(
        reasons,
        &vec![crate::storage::sheet::filters::ImportFilterUnsupportedReason::IconFilterUnsupported]
    );
    assert_eq!(filter_kind.as_deref(), Some("tableFilter"));
    assert_eq!(*table_column_ordinal, Some(1));
    assert_eq!(*resolved_col, Some(1));
}

#[test]
fn unsupported_imported_table_autofilter_runtime_diagnostics_distinguish_apply_and_reapply() {
    let input = unsupported_people_table_filter_parse_output();

    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("unsupported imported table AutoFilter should still materialize a shell");
    let filter_id = filter.id;
    let stable_table_id = filter
        .table_id
        .expect("unsupported imported table filter should use stable table id");

    let (_, apply_result) = engine
        .apply_filter(&sheet_id, &filter_id)
        .expect("apply unsupported imported filter");
    assert_unsupported_runtime_diagnostic(&apply_result, "applyFilter", "1", &stable_table_id);

    let (_, reapply_result) = engine
        .reapply_filter(&sheet_id, &filter_id)
        .expect("reapply unsupported imported filter");
    assert_unsupported_runtime_diagnostic(&reapply_result, "reapplyFilter", "2", &stable_table_id);

    let page = engine.get_runtime_diagnostics(RuntimeDiagnosticsOptions::default());
    assert_eq!(
        page.diagnostics
            .iter()
            .map(|diagnostic| (diagnostic.operation.as_str(), diagnostic.sequence.as_str()))
            .collect::<Vec<_>>(),
        vec![("applyFilter", "1"), ("reapplyFilter", "2")]
    );
}

#[test]
fn unsupported_table_autofilter_roundtrip_preserves_metadata_without_runtime_claim() {
    let input = unsupported_people_table_filter_parse_output();
    let input_bytes = xlsx_api::export_from_parse_output(&input).expect("write input xlsx");
    let (engine, _) = crate::storage::engine::YrsComputeEngine::from_xlsx_bytes(&input_bytes)
        .expect("from_xlsx_bytes");
    let sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("unsupported imported table AutoFilter should materialize a shell");
    let stable_table_id = filter
        .table_id
        .clone()
        .expect("unsupported imported table filter should use stable table id");

    assert!(
        filter.column_filters.is_empty(),
        "unsupported table filter must not fabricate executable runtime criteria"
    );
    let binding = crate::storage::sheet::filters::get_filter_metadata_binding(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        &filter.id,
    )
    .expect("unsupported table shell should have a metadata binding");
    assert_eq!(
        binding.shell.capability,
        crate::storage::sheet::filters::FilterCapability::Unsupported
    );
    assert_eq!(
        binding.shell.unsupported_reasons,
        vec![crate::storage::sheet::filters::ImportFilterUnsupportedReason::IconFilterUnsupported]
    );
    assert_eq!(binding.table_id.as_deref(), Some(stable_table_id.as_str()));
    assert_eq!(binding.shell.lossless_criteria[0].kind, "icon");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    assert_unsupported_icon_table_filter(&exported.sheets[0].tables[0]);

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _diagnostics) =
        xlsx_parser::parse_xlsx_to_output(&exported_bytes).expect("parse exported xlsx");
    assert_unsupported_icon_table_filter(&reparsed.sheets[0].tables[0]);
}

fn assert_unsupported_icon_table_filter(table: &TableSpec) {
    assert_eq!(table.name, "People");
    assert_eq!(table.range_ref, "A1:B4");
    assert_eq!(table.auto_filter_ref.as_deref(), Some("A1:B4"));
    assert_eq!(
        table.filter_columns.len(),
        1,
        "unsupported table filter metadata should remain losslessly preserved"
    );
    assert_eq!(table.filter_columns[0].col_id, 1);
    match &table.filter_columns[0].filter {
        FilterSpec::Icon { icon_set, icon_id } => {
            assert_eq!(icon_set, "3TrafficLights1");
            assert_eq!(*icon_id, Some(1));
        }
        other => panic!("expected preserved icon filter metadata, got {other:?}"),
    }
}

fn assert_unsupported_runtime_diagnostic(
    result: &MutationResult,
    operation: &str,
    sequence: &str,
    stable_table_id: &str,
) {
    assert_eq!(result.diagnostics.len(), 1);
    let diagnostic = &result.diagnostics[0];
    assert_eq!(diagnostic.code, "unsupported_filter_reapply");
    assert_eq!(diagnostic.operation, operation);
    assert_eq!(diagnostic.sequence, sequence);
    assert_eq!(diagnostic.filter_kind.as_deref(), Some("tableFilter"));
    assert_eq!(diagnostic.table_id.as_deref(), Some(stable_table_id));
    assert_eq!(diagnostic.reason.as_deref(), Some("iconFilterUnsupported"));
}

fn unsupported_people_table_filter_parse_output() -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "UnsupportedTableFilter".to_string(),
            rows: 4,
            cols: 2,
            cells: people_table_cells(),
            tables: vec![people_table_spec(vec![FilterColumnSpec {
                col_id: 1,
                hidden_button: false,
                show_button: true,
                filter: FilterSpec::Icon {
                    icon_set: "3TrafficLights1".to_string(),
                    icon_id: Some(1),
                },
                ext_lst_raw: None,
            }])],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn people_table_cells() -> Vec<domain_types::CellData> {
    [
        (0, 0, "Name"),
        (0, 1, "Dept"),
        (1, 0, "Alice"),
        (1, 1, "Eng"),
        (2, 0, "Bob"),
        (2, 1, "Sales"),
        (3, 0, "Carol"),
        (3, 1, "Eng"),
    ]
    .into_iter()
    .map(|(row, col, value)| domain_types::CellData {
        row,
        col,
        value: CellValue::Text(Arc::from(value)),
        ..Default::default()
    })
    .collect()
}

fn people_table_spec(filter_columns: Vec<FilterColumnSpec>) -> TableSpec {
    TableSpec {
        id: 1,
        name: "People".to_string(),
        display_name: "People".to_string(),
        range_ref: "A1:B4".to_string(),
        auto_filter_ref: Some("A1:B4".to_string()),
        columns: vec![
            TableColumnSpec {
                id: 1,
                name: "Name".to_string(),
                ..Default::default()
            },
            TableColumnSpec {
                id: 2,
                name: "Dept".to_string(),
                ..Default::default()
            },
        ],
        filter_columns,
        ..Default::default()
    }
}
