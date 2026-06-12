use std::collections::BTreeMap;
use std::sync::Arc;

use domain_types::domain::filter::{
    DateGroupItem, FilterColumn, OoxmlFilterCondition, OoxmlFilterType,
};

use crate::storage::engine::filter_import_diagnostics::{
    unsupported_filter_import_diagnostic, upsert_import_diagnostic_phase,
};

use super::super::imported_filter_shell::build_filter_shell_metadata;
use super::*;

fn values_filter(value: &str) -> Option<OoxmlFilterType> {
    Some(OoxmlFilterType::Values {
        values: vec![value.to_string()],
        blanks: false,
        calendar_type: None,
        date_group_items: Vec::new(),
    })
}

#[test]
fn runtime_metadata_merge_preserves_imported_button_fields() {
    let mut imported = AutoFilter {
        range_ref: "A1:D12".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 1,
                filter_type: values_filter("old"),
                hidden_button: true,
                show_button: false,
                ext_lst_raw: Some("<extLst/>".to_string()),
            },
            FilterColumn {
                col_index: 2,
                filter_type: values_filter("stale"),
                ..Default::default()
            },
        ],
        sort: None,
        xr_uid: Some("{uid}".to_string()),
        ext_lst_raw: Some("<afExt/>".to_string()),
    };
    let runtime = AutoFilter {
        range_ref: "A1:E12".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 1,
                filter_type: values_filter("new"),
                ..Default::default()
            },
            FilterColumn {
                col_index: 4,
                filter_type: values_filter("added"),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    merge_runtime_auto_filter_into_imported_metadata(&mut imported, runtime);

    assert_eq!(imported.range_ref, "A1:E12");
    assert_eq!(imported.xr_uid.as_deref(), Some("{uid}"));
    assert_eq!(imported.ext_lst_raw.as_deref(), Some("<afExt/>"));
    assert_eq!(imported.columns.len(), 3);
    assert_eq!(imported.columns[0].col_index, 1);
    assert_eq!(imported.columns[0].filter_type, values_filter("new"));
    assert!(imported.columns[0].hidden_button);
    assert!(!imported.columns[0].show_button);
    assert_eq!(
        imported.columns[0].ext_lst_raw.as_deref(),
        Some("<extLst/>")
    );
    assert_eq!(imported.columns[1].col_index, 2);
    assert!(imported.columns[1].filter_type.is_none());
    assert_eq!(imported.columns[2].col_index, 4);
    assert_eq!(imported.columns[2].filter_type, values_filter("added"));
}

#[test]
fn column_metadata_replace_preserves_unrelated_lossless_criteria() {
    let mut imported = AutoFilter {
        range_ref: "A1:D12".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 1,
                filter_type: values_filter("old"),
                hidden_button: true,
                show_button: false,
                ext_lst_raw: Some("<extLst/>".to_string()),
            },
            FilterColumn {
                col_index: 2,
                filter_type: values_filter("keep"),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    replace_imported_column_filter_type(&mut imported, 1, values_filter("new"));

    assert_eq!(imported.columns.len(), 2);
    assert_eq!(imported.columns[0].col_index, 1);
    assert_eq!(imported.columns[0].filter_type, values_filter("new"));
    assert!(imported.columns[0].hidden_button);
    assert!(!imported.columns[0].show_button);
    assert_eq!(
        imported.columns[0].ext_lst_raw.as_deref(),
        Some("<extLst/>")
    );
    assert_eq!(imported.columns[1].col_index, 2);
    assert_eq!(imported.columns[1].filter_type, values_filter("keep"));
}

#[test]
fn column_metadata_clear_only_removes_target_criterion() {
    let mut imported = AutoFilter {
        range_ref: "A1:D12".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 1,
                filter_type: values_filter("old"),
                hidden_button: true,
                ext_lst_raw: Some("<extLst/>".to_string()),
                ..Default::default()
            },
            FilterColumn {
                col_index: 2,
                filter_type: values_filter("keep"),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    replace_imported_column_filter_type(&mut imported, 1, None);
    replace_imported_column_filter_type(&mut imported, 8, None);

    assert_eq!(imported.columns.len(), 2);
    assert_eq!(imported.columns[0].col_index, 1);
    assert!(imported.columns[0].filter_type.is_none());
    assert!(imported.columns[0].hidden_button);
    assert_eq!(
        imported.columns[0].ext_lst_raw.as_deref(),
        Some("<extLst/>")
    );
    assert_eq!(imported.columns[1].col_index, 2);
    assert_eq!(imported.columns[1].filter_type, values_filter("keep"));
}

#[test]
fn filter_shell_metadata_classifies_unsupported_lossless_criteria() {
    let imported = AutoFilter {
        range_ref: "A1:D10".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 0,
                filter_type: Some(OoxmlFilterType::Values {
                    values: Vec::new(),
                    blanks: false,
                    calendar_type: None,
                    date_group_items: vec![DateGroupItem::default()],
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 1,
                filter_type: Some(OoxmlFilterType::Dynamic {
                    dynamic_type: "thisMonth".to_string(),
                    value: None,
                    max_value: None,
                    value_iso: None,
                    max_value_iso: None,
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 2,
                filter_type: Some(OoxmlFilterType::Custom {
                    conditions: vec![OoxmlFilterCondition {
                        operator: "notARealOperator".to_string(),
                        value: CellValue::Text(Arc::from("x")),
                        value2: None,
                    }],
                    and_logic: true,
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 3,
                filter_type: Some(OoxmlFilterType::Dynamic {
                    dynamic_type: "notARealDynamicFilter".to_string(),
                    value: None,
                    max_value: None,
                    value_iso: None,
                    max_value_iso: None,
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 4,
                filter_type: Some(OoxmlFilterType::Color {
                    dxf_id: Some(4),
                    cell_color: true,
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 5,
                filter_type: Some(OoxmlFilterType::Icon {
                    icon_set: Some("3TrafficLights1".to_string()),
                    icon_id: 1,
                }),
                ext_lst_raw: Some("<extLst/>".to_string()),
                ..Default::default()
            },
        ],
        sort: None,
        xr_uid: None,
        ext_lst_raw: Some("<autoFilterExt/>".to_string()),
    };

    let shell = build_filter_shell_metadata(Some(&imported), BTreeMap::new());

    assert_eq!(shell.capability, filters::FilterCapability::Unsupported);
    assert_eq!(
        shell.unsupported_reasons,
        vec![
            filters::ImportFilterUnsupportedReason::UnknownDynamicType,
            filters::ImportFilterUnsupportedReason::UnknownCustomOperator,
            filters::ImportFilterUnsupportedReason::DateGroupUnsupported,
            filters::ImportFilterUnsupportedReason::DynamicTemporalContextUnsupported,
            filters::ImportFilterUnsupportedReason::ColorDxfUnresolved,
            filters::ImportFilterUnsupportedReason::IconFilterUnsupported,
            filters::ImportFilterUnsupportedReason::UnknownExtension,
        ]
    );
    assert!(shell.has_active_lossless_criteria);
    assert_eq!(
        shell
            .lossless_criteria
            .iter()
            .map(|criterion| criterion.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["values", "dynamic", "custom", "dynamic", "color", "icon"]
    );
}

#[test]
fn unsupported_import_diagnostic_merges_phases_and_preserves_filter_location() {
    let mut col_id_to_header_cell_id = BTreeMap::new();
    col_id_to_header_cell_id.insert(2, "header-c".to_string());
    let binding = filters::FilterMetadataBinding {
        filter_id: "filter-1".to_string(),
        filter_kind: filters::FilterKind::AutoFilter,
        sheet_id: "sheet-1".to_string(),
        table_id: None,
        owner_path: filters::FilterMetadataOwnerPath::SheetAutoFilter {
            sheet_id: "sheet-1".to_string(),
        },
        source_key: filters::FilterMetadataSourceKey::SheetAutoFilter {
            sheet_id: "sheet-1".to_string(),
            range_ref: "A1:D12".to_string(),
        },
        range_ref: "A1:D12".to_string(),
        header_start_cell_id: "header-a".to_string(),
        header_end_cell_id: "header-d".to_string(),
        data_end_cell_id: "data-d".to_string(),
        col_id_to_header_cell_id,
        table_column_id_to_header_cell_id: BTreeMap::new(),
        shell: filters::FilterShellMetadata::default(),
        source_fingerprint: "filterMetadataBindingFingerprintV1:test".to_string(),
    };
    let diagnostic = unsupported_filter_import_diagnostic(
        &binding,
        Some(0),
        Some("Data".to_string()),
        Some(r#"{"kind":"sheetAutoFilter"}"#.to_string()),
        Some("filter-1".to_string()),
        Some(2),
        None,
        Some((0, 2)),
        vec![filters::ImportFilterUnsupportedReason::IconFilterUnsupported],
        "autoFilter".to_string(),
        domain_types::ImportFeatureKind::Worksheet,
    );
    let mut report = domain_types::ImportReport::default();

    upsert_import_diagnostic_phase(
        &mut report,
        diagnostic.clone(),
        domain_types::ImportPhase::CriticalSheet,
    );
    upsert_import_diagnostic_phase(
        &mut report,
        diagnostic,
        domain_types::ImportPhase::FullHydration,
    );

    assert_eq!(report.diagnostics.len(), 1);
    let diagnostic = &report.diagnostics[0];
    assert_eq!(
        diagnostic.import_phases,
        vec![
            domain_types::ImportPhase::CriticalSheet,
            domain_types::ImportPhase::FullHydration
        ]
    );
    assert_eq!(
        diagnostic.first_import_phase,
        Some(domain_types::ImportPhase::CriticalSheet)
    );
    let reference = diagnostic.reference.as_ref().unwrap();
    assert_eq!(reference.sheet_index, Some(0));
    assert_eq!(reference.sheet_name.as_deref(), Some("Data"));
    assert_eq!(reference.source_range.as_deref(), Some("A1:D12"));
    assert_eq!(reference.filter_col_id, Some(2));
    assert_eq!(reference.row, Some(0));
    assert_eq!(reference.col, Some(2));
    assert_eq!(reference.cell_ref.as_deref(), Some("C1"));

    let Some(domain_types::ImportDiagnosticDetails::UnsupportedFilter {
        reasons,
        filter_id,
        filter_kind,
        filter_col_id,
        resolved_col,
        ..
    }) = diagnostic.details.as_ref()
    else {
        panic!("expected unsupported filter details");
    };
    assert_eq!(
        reasons,
        &vec![filters::ImportFilterUnsupportedReason::IconFilterUnsupported]
    );
    assert_eq!(filter_id.as_deref(), Some("filter-1"));
    assert_eq!(filter_kind.as_deref(), Some("autoFilter"));
    assert_eq!(*filter_col_id, Some(2));
    assert_eq!(*resolved_col, Some(2));
}
