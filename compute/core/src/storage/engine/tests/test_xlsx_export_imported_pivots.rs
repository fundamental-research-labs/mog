//! Imported pivot XLSX export cache reconciliation tests.

use super::super::*;
use super::helpers::{archive_text, engine_from_parse_output_normal};
use domain_types::{
    ParseOutput, SheetData,
    domain::analytics::{AggregateFunction, DetectedDataType},
    domain::pivot::{
        CellRange, FieldId, OutputLocation, ParsedPivotTable, PivotCacheSourceDef,
        PivotCacheSourceKind, PivotExternalWorksheetSourceDef, PivotField, PivotFieldArea,
        PivotFieldPlacementFlat, PivotTableConfig, PivotTableOoxmlPreservation,
        PivotTableRelationshipPreservation, PlacementId, import_identity_for_parsed_pivot,
        native_imported_pivot_id,
    },
};
use std::sync::Arc;
use value_types::{CellValue, FiniteF64};

fn imported_pivot_for_export_test(
    name: &str,
    cache_id: u32,
    pivot_index: usize,
) -> ParsedPivotTable {
    let preservation = PivotTableOoxmlPreservation {
        output_worksheet_part_path: Some("xl/worksheets/sheet2.xml".to_string()),
        output_worksheet_relationship_id: Some(format!("rIdPivot{}", pivot_index + 1)),
        definition_part_path: Some(format!("xl/pivotTables/pivotTable{}.xml", pivot_index + 1)),
        relationship: Some(PivotTableRelationshipPreservation {
            part_path: Some(format!("xl/pivotTables/pivotTable{}.xml", pivot_index + 1)),
            relationship_id: Some(format!("rIdCache{}", cache_id)),
            ..Default::default()
        }),
        ..Default::default()
    };
    let mut parsed = ParsedPivotTable {
        config: PivotTableConfig {
            schema_version: 1,
            id: "temporary-imported-pivot-id".to_string(),
            name: name.to_string(),
            source_sheet_id: None,
            source_sheet_name: "Data".to_string(),
            source_range: CellRange::new(0, 0, 2, 1),
            output_sheet_id: None,
            output_sheet_name: "Pivot".to_string(),
            output_location: OutputLocation { row: 0, col: 0 },
            fields: vec![
                PivotField {
                    id: FieldId::from("Category"),
                    name: "Category".to_string(),
                    source_column: 0,
                    data_type: DetectedDataType::String,
                    ..Default::default()
                },
                PivotField {
                    id: FieldId::from("Amount"),
                    name: "Amount".to_string(),
                    source_column: 1,
                    data_type: DetectedDataType::Number,
                    ..Default::default()
                },
            ],
            placements: vec![PivotFieldPlacementFlat {
                placement_id: PlacementId::from("value-amount"),
                field_id: FieldId::from("Amount"),
                calculated_field_id: None,
                area: PivotFieldArea::Value,
                position: 0,
                aggregate_function: Some(AggregateFunction::Sum),
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
                display_name: Some("Sum of Amount".to_string()),
                number_format: None,
                show_values_as: None,
            }],
            filters: Vec::new(),
            layout: None,
            style: None,
            data_options: None,
            created_at: None,
            updated_at: None,
            calculated_fields: None,
            allow_multiple_filters_per_field: None,
            auto_format: None,
            preserve_formatting: None,
            cache_id: Some(cache_id),
            data_on_rows: None,
            ref_range: Some("A1:B3".to_string()),
            first_data_row: None,
            first_header_row: None,
            first_data_col: None,
            rows_per_page: None,
            cols_per_page: None,
            row_items: Vec::new(),
            col_items: Vec::new(),
        },
        initial_expansion_state: None,
        ooxml_preservation: preservation,
    };
    let pivot_spec_key = format!("{}_{}", parsed.config.name, pivot_index);
    let import_identity = import_identity_for_parsed_pivot(&pivot_spec_key, &parsed);
    parsed.config.id = native_imported_pivot_id(&import_identity);
    parsed
}

fn imported_pivot_export_parse_output(
    pivots: Vec<ParsedPivotTable>,
    cache_ids: &[u32],
) -> ParseOutput {
    let mut output = ParseOutput {
        sheets: vec![
            SheetData {
                name: "Data".to_string(),
                rows: 3,
                cols: 2,
                cells: vec![
                    domain_types::CellData {
                        row: 0,
                        col: 0,
                        value: CellValue::Text(Arc::from("Category")),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 0,
                        col: 1,
                        value: CellValue::Text(Arc::from("Amount")),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 1,
                        col: 0,
                        value: CellValue::Text(Arc::from("A")),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 1,
                        col: 1,
                        value: CellValue::Number(FiniteF64::new(42.0).unwrap()),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 2,
                        col: 0,
                        value: CellValue::Text(Arc::from("B")),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 2,
                        col: 1,
                        value: CellValue::Number(FiniteF64::new(13.0).unwrap()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            SheetData {
                name: "Pivot".to_string(),
                rows: 20,
                cols: 8,
                ..Default::default()
            },
        ],
        pivot_tables: pivots,
        ..Default::default()
    };

    for cache_id in cache_ids {
        output
            .pivot_cache_sources
            .push(domain_types::PivotCacheSourceDef {
                cache_id: *cache_id,
                workbook_ref_scope: Default::default(),
                source_kind: domain_types::domain::pivot::PivotCacheSourceKind::LocalWorksheet,
                source_name: None,
                source_sheet: Some("Data".to_string()),
                source_range: Some("A1:B3".to_string()),
                external_worksheet: None,
                field_names: vec!["Category".to_string(), "Amount".to_string()],
                shared_items: vec![
                    vec![CellValue::Text(Arc::from("A"))],
                    vec![CellValue::Number(FiniteF64::new(42.0).unwrap())],
                ],
            });
        output.pivot_cache_records.insert(
            *cache_id,
            vec![vec![
                CellValue::Text(Arc::from("A")),
                CellValue::Number(FiniteF64::new(42.0).unwrap()),
            ]],
        );
    }

    output
}

fn delete_imported_pivot_by_name(engine: &mut YrsComputeEngine, name: &str) {
    for output_sheet_id in engine.stores.storage.sheet_order() {
        if let Some(pivot_id) = engine
            .pivot_get_all(&output_sheet_id)
            .into_iter()
            .find(|pivot| pivot.name == name)
            .map(|pivot| pivot.id)
        {
            engine
                .pivot_delete(&output_sheet_id, &pivot_id)
                .expect("delete imported pivot");
            return;
        }
    }
    panic!("expected imported pivot {name}");
}

fn update_imported_pivot_by_name(
    engine: &mut YrsComputeEngine,
    name: &str,
    update: impl Fn(&mut PivotTableConfig),
) {
    for output_sheet_id in engine.stores.storage.sheet_order() {
        if let Some(mut pivot) = engine
            .pivot_get_all(&output_sheet_id)
            .into_iter()
            .find(|pivot| pivot.name == name)
        {
            let pivot_id = pivot.id.clone();
            update(&mut pivot);
            engine
                .pivot_update(&output_sheet_id, &pivot_id, pivot)
                .expect("update imported pivot");
            return;
        }
    }
    panic!("expected imported pivot {name}");
}

fn exported_pivot<'a>(output: &'a ParseOutput, name: &str) -> &'a ParsedPivotTable {
    output
        .pivot_tables
        .iter()
        .find(|pivot| pivot.config.name == name)
        .unwrap_or_else(|| panic!("expected exported pivot {name}"))
}

fn exported_cache_source(output: &ParseOutput, cache_id: u32) -> &PivotCacheSourceDef {
    output
        .pivot_cache_sources
        .iter()
        .find(|source| source.cache_id == cache_id)
        .unwrap_or_else(|| panic!("expected exported cache source {cache_id}"))
}

fn first_pivot_cache_definition_xml(bytes: &[u8]) -> String {
    archive_text(bytes, "xl/pivotCache/pivotCacheDefinition1.xml")
        .expect("pivot cache definition should be emitted")
}

fn first_pivot_cache_records_xml(bytes: &[u8]) -> String {
    archive_text(bytes, "xl/pivotCache/pivotCacheRecords1.xml")
        .expect("pivot cache records should be emitted")
}

fn assert_cache_records_contain_a_42(records_xml: &str) {
    assert!(records_xml.contains(r#"<x v="0"/><n v="42"/>"#));
}

#[test]
fn deleted_imported_pivot_filters_its_pivot_and_private_cache_on_export() {
    let input = imported_pivot_export_parse_output(
        vec![
            imported_pivot_for_export_test("PivotA", 7, 0),
            imported_pivot_for_export_test("PivotB", 8, 1),
        ],
        &[7, 8],
    );
    let mut engine = engine_from_parse_output_normal(&input);

    delete_imported_pivot_by_name(&mut engine, "PivotA");
    let exported = engine.build_parse_output_from_yrs();

    let pivot_names: Vec<_> = exported
        .pivot_tables
        .iter()
        .map(|pivot| pivot.config.name.as_str())
        .collect();
    assert_eq!(pivot_names, vec!["PivotB"]);
    assert_eq!(
        exported
            .pivot_cache_sources
            .iter()
            .map(|source| source.cache_id)
            .collect::<Vec<_>>(),
        vec![8]
    );
    assert!(!exported.pivot_cache_records.contains_key(&7));
    assert!(exported.pivot_cache_records.contains_key(&8));
}

#[test]
fn deleted_imported_pivot_keeps_shared_cache_when_another_pivot_survives() {
    let input = imported_pivot_export_parse_output(
        vec![
            imported_pivot_for_export_test("PivotA", 7, 0),
            imported_pivot_for_export_test("PivotB", 7, 1),
        ],
        &[7],
    );
    let mut engine = engine_from_parse_output_normal(&input);

    delete_imported_pivot_by_name(&mut engine, "PivotA");
    let exported = engine.build_parse_output_from_yrs();

    let pivot_names: Vec<_> = exported
        .pivot_tables
        .iter()
        .map(|pivot| pivot.config.name.as_str())
        .collect();
    assert_eq!(pivot_names, vec!["PivotB"]);
    assert_eq!(exported.pivot_cache_sources.len(), 1);
    assert_eq!(exported.pivot_cache_sources[0].cache_id, 7);
    assert!(exported.pivot_cache_records.contains_key(&7));
}

#[test]
fn promoted_imported_pivot_preserves_matching_cache_on_export() {
    let input = imported_pivot_export_parse_output(
        vec![imported_pivot_for_export_test("PivotA", 7, 0)],
        &[7],
    );
    let engine = engine_from_parse_output_normal(&input);

    let exported = engine.build_parse_output_from_yrs();

    let pivot = exported_pivot(&exported, "PivotA");
    assert_eq!(pivot.config.cache_id, Some(7));
    let source = exported_cache_source(&exported, 7);
    assert_eq!(source.source_sheet.as_deref(), Some("Data"));
    assert_eq!(source.source_range.as_deref(), Some("A1:B3"));
    assert_eq!(source.field_names, vec!["Category", "Amount"]);
    assert!(exported.pivot_cache_records.contains_key(&7));

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let definition_xml = first_pivot_cache_definition_xml(&exported_bytes);
    let records_xml = first_pivot_cache_records_xml(&exported_bytes);
    assert!(definition_xml.contains(r#"ref="A1:B3""#));
    assert!(definition_xml.contains(r#"name="Category""#));
    assert!(definition_xml.contains(r#"name="Amount""#));
    assert_cache_records_contain_a_42(&records_xml);
}

#[test]
fn promoted_imported_pivot_preserves_cache_after_source_sheet_rename() {
    let input = imported_pivot_export_parse_output(
        vec![imported_pivot_for_export_test("PivotA", 7, 0)],
        &[7],
    );
    let mut engine = engine_from_parse_output_normal(&input);
    let source_sheet_id = engine.stores.storage.sheet_order()[0];

    engine
        .rename_compute_sheet(&source_sheet_id, "RenamedData")
        .expect("rename source sheet");
    let exported = engine.build_parse_output_from_yrs();

    let pivot = exported_pivot(&exported, "PivotA");
    assert_eq!(pivot.config.cache_id, Some(7));
    assert_eq!(pivot.config.source_sheet_name, "RenamedData");
    let source = exported_cache_source(&exported, 7);
    assert_eq!(source.source_sheet.as_deref(), Some("RenamedData"));
    assert_eq!(source.source_range.as_deref(), Some("A1:B3"));
    assert!(exported.pivot_cache_records.contains_key(&7));
}

#[test]
fn promoted_imported_pivot_changed_source_range_forks_from_imported_cache() {
    let input = imported_pivot_export_parse_output(
        vec![imported_pivot_for_export_test("PivotA", 7, 0)],
        &[7],
    );
    let mut engine = engine_from_parse_output_normal(&input);

    update_imported_pivot_by_name(&mut engine, "PivotA", |pivot| {
        pivot.source_range = CellRange::new(0, 0, 1, 1);
    });
    let exported = engine.build_parse_output_from_yrs();

    let pivot = exported_pivot(&exported, "PivotA");
    let forked_cache_id = pivot.config.cache_id.expect("forked cache id");
    assert_ne!(forked_cache_id, 7);
    assert_eq!(exported.pivot_cache_sources.len(), 1);
    assert_eq!(exported.pivot_cache_sources[0].cache_id, forked_cache_id);
    assert_eq!(
        exported.pivot_cache_sources[0].source_range.as_deref(),
        Some("A1:B2")
    );
    assert!(exported.pivot_cache_records.is_empty());

    let exported_again = engine.build_parse_output_from_yrs();
    assert_eq!(
        exported_pivot(&exported_again, "PivotA").config.cache_id,
        Some(forked_cache_id),
        "forked cache id must be deterministic across exports",
    );

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let definition_xml = first_pivot_cache_definition_xml(&exported_bytes);
    let records_xml = first_pivot_cache_records_xml(&exported_bytes);
    assert!(definition_xml.contains(r#"ref="A1:B2""#));
    assert!(!definition_xml.contains(r#"ref="A1:B3""#));
    assert_cache_records_contain_a_42(&records_xml);
}

#[test]
fn promoted_imported_pivot_shared_cache_keeps_survivor_when_one_source_changes() {
    let input = imported_pivot_export_parse_output(
        vec![
            imported_pivot_for_export_test("PivotA", 7, 0),
            imported_pivot_for_export_test("PivotB", 7, 1),
        ],
        &[7],
    );
    let mut engine = engine_from_parse_output_normal(&input);

    update_imported_pivot_by_name(&mut engine, "PivotA", |pivot| {
        pivot.source_range = CellRange::new(0, 0, 1, 1);
    });
    let exported = engine.build_parse_output_from_yrs();

    let forked_cache_id = exported_pivot(&exported, "PivotA")
        .config
        .cache_id
        .expect("forked cache id");
    assert_ne!(forked_cache_id, 7);
    assert_eq!(exported_pivot(&exported, "PivotB").config.cache_id, Some(7));
    assert_eq!(exported.pivot_cache_sources.len(), 2);
    let survivor_source = exported_cache_source(&exported, 7);
    assert_eq!(survivor_source.source_range.as_deref(), Some("A1:B3"));
    let forked_source = exported_cache_source(&exported, forked_cache_id);
    assert_eq!(forked_source.source_range.as_deref(), Some("A1:B2"));
    assert!(exported.pivot_cache_records.contains_key(&7));
    assert!(!exported.pivot_cache_records.contains_key(&forked_cache_id));
}

#[test]
fn unsupported_external_imported_pivot_keeps_external_cache_source_on_export() {
    let mut input = imported_pivot_export_parse_output(
        vec![imported_pivot_for_export_test("ExternalPivot", 7, 0)],
        &[7],
    );
    input.pivot_cache_sources[0].source_kind = PivotCacheSourceKind::ExternalWorksheet;
    input.pivot_cache_sources[0].source_sheet = Some("ExternalData".to_string());
    input.pivot_cache_sources[0].external_worksheet = Some(PivotExternalWorksheetSourceDef {
        relationship_id_hint: Some("rIdExternal1".to_string()),
        relationship_type:
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath"
                .to_string(),
        target: "../external.xlsx".to_string(),
        target_mode: Some("External".to_string()),
    });

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.build_parse_output_from_yrs();

    let source = exported_cache_source(&exported, 7);
    assert_eq!(source.source_kind, PivotCacheSourceKind::ExternalWorksheet);
    assert_eq!(source.source_sheet.as_deref(), Some("ExternalData"));
    assert_eq!(source.source_range.as_deref(), Some("A1:B3"));
    assert!(source.external_worksheet.is_some());
    assert_eq!(
        exported_pivot(&exported, "ExternalPivot").config.cache_id,
        Some(7)
    );

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let definition_xml = first_pivot_cache_definition_xml(&exported_bytes);
    assert!(definition_xml.contains(r#"sheet="ExternalData""#));
    assert!(definition_xml.contains(r#"ref="A1:B3""#));
    assert!(!definition_xml.contains(r#"sheet="Data""#));
}
