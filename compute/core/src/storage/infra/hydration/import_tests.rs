use super::*;

use domain_types::domain::analytics::{AggregateFunction, DetectedDataType};
use domain_types::domain::pivot::{
    CellRange, FieldId, OutputLocation, PIVOT_CONFIG_SCHEMA_VERSION, ParsedPivotTable, PivotField,
    PivotFieldPlacementFlat, PivotRawXmlAttribute, PivotTableConfig, PivotTableLayout,
    PivotTableOoxmlPreservation, PivotTableRelationshipPreservation, PlacementId,
    import_identity_for_parsed_pivot,
};

fn parsed_pivot_with_preservation(
    ooxml_preservation: PivotTableOoxmlPreservation,
) -> ParsedPivotTable {
    let fields = vec![
        PivotField {
            id: FieldId::from("Category"),
            name: "Category".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("Region"),
            name: "Region".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("Amount"),
            name: "Amount".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];
    let placements = vec![
        placement("Category", PivotFieldArea::Row, 0, None),
        placement("Region", PivotFieldArea::Column, 0, None),
        placement(
            "Amount",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];

    ParsedPivotTable {
        config: PivotTableConfig {
            schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
            id: "pivot-imported-test".to_string(),
            name: "PivotTable1".to_string(),
            source_sheet_id: None,
            source_sheet_name: "Data".to_string(),
            source_range: CellRange::new(0, 0, 4, 2),
            output_sheet_id: None,
            output_sheet_name: "Pivot".to_string(),
            output_location: OutputLocation { row: 0, col: 0 },
            fields,
            placements,
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
            cache_id: Some(1),
            data_on_rows: Some(false),
            ref_range: Some("A1:D4".to_string()),
            first_data_row: Some(1),
            first_header_row: Some(1),
            first_data_col: Some(1),
            rows_per_page: None,
            cols_per_page: None,
            row_items: Vec::new(),
            col_items: Vec::new(),
        },
        initial_expansion_state: None,
        ooxml_preservation,
    }
}

fn placement(
    field_id: &str,
    area: PivotFieldArea,
    position: usize,
    aggregate_function: Option<AggregateFunction>,
) -> PivotFieldPlacementFlat {
    PivotFieldPlacementFlat {
        placement_id: PlacementId::from(format!("{field_id}-{area:?}-{position}")),
        field_id: FieldId::from(field_id),
        calculated_field_id: None,
        area,
        position,
        aggregate_function,
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
        display_name: None,
        number_format: None,
        show_values_as: None,
    }
}

fn safe_fixture_root_attributes() -> Vec<PivotRawXmlAttribute> {
    [
        ("applyNumberFormats", "0"),
        ("applyBorderFormats", "0"),
        ("applyFontFormats", "0"),
        ("applyPatternFormats", "0"),
        ("applyAlignmentFormats", "0"),
        ("applyWidthHeightFormats", "1"),
        ("showDrill", "1"),
        ("showDataTips", "1"),
        ("useAutoFormatting", "1"),
        ("itemPrintTitles", "1"),
        ("createdVersion", "6"),
        ("indent", "0"),
        ("outline", "1"),
        ("outlineData", "1"),
        ("multipleFieldFilters", "0"),
    ]
    .into_iter()
    .map(|(name, value)| raw_attr(name, value))
    .collect()
}

fn raw_attr(name: &str, value: &str) -> PivotRawXmlAttribute {
    PivotRawXmlAttribute {
        name: name.to_string(),
        value: value.to_string(),
    }
}

fn preservation(
    root_attributes: Vec<PivotRawXmlAttribute>,
    relationship_consistency: Option<&str>,
) -> PivotTableOoxmlPreservation {
    PivotTableOoxmlPreservation {
        output_worksheet_part_path: Some("xl/worksheets/sheet2.xml".to_string()),
        output_worksheet_relationship_id: Some("rIdPT1".to_string()),
        definition_part_path: Some("xl/pivotTables/pivotTable1.xml".to_string()),
        root_attributes,
        relationship: relationship_consistency.map(|consistency| {
            PivotTableRelationshipPreservation {
                consistency: Some(consistency.to_string()),
                ..Default::default()
            }
        }),
        ..Default::default()
    }
}

fn local_cache_source(source_kind: PivotCacheSourceKind) -> PivotCacheSourceDef {
    PivotCacheSourceDef {
        cache_id: 1,
        source_kind,
        source_name: matches!(source_kind, PivotCacheSourceKind::LocalTableOrName)
            .then(|| "Table1".to_string()),
        source_sheet: Some("Data".to_string()),
        source_range: Some("A1:C5".to_string()),
        field_names: vec![
            "Category".to_string(),
            "Region".to_string(),
            "Amount".to_string(),
        ],
        ..Default::default()
    }
}

fn sheet_id_by_name() -> std::collections::HashMap<&'static str, cell_types::SheetId> {
    [
        ("Data", cell_types::SheetId::from_raw(1)),
        ("Pivot", cell_types::SheetId::from_raw(2)),
    ]
    .into_iter()
    .collect()
}

fn classify_with_cache(
    parsed: &ParsedPivotTable,
    cache_source: Option<&PivotCacheSourceDef>,
) -> ImportedPivotClassification {
    let import_identity = import_identity_for_parsed_pivot("Pivot_0", parsed);
    classify_imported_pivot(
        parsed,
        &import_identity,
        cache_source,
        &sheet_id_by_name(),
        parsed.config.source_sheet_name.as_str(),
        parsed.config.output_sheet_name.as_str(),
    )
}

#[test]
fn fixture_style_root_flags_and_missing_pivot_relationship_part_are_promotable() {
    let parsed = parsed_pivot_with_preservation(preservation(
        safe_fixture_root_attributes(),
        Some("missingRelationshipPart"),
    ));
    let cache_source = local_cache_source(PivotCacheSourceKind::LocalWorksheet);

    match classify_with_cache(&parsed, Some(&cache_source)) {
        ImportedPivotClassification::Promotable {
            source_sheet_id,
            output_sheet_id,
        } => {
            assert_eq!(source_sheet_id, cell_types::SheetId::from_raw(1));
            assert_eq!(output_sheet_id, cell_types::SheetId::from_raw(2));
        }
        ImportedPivotClassification::Unsupported(_) => {
            panic!("fixture-style imported pivot should promote")
        }
    }
}

#[test]
fn typed_custom_data_caption_is_promotable() {
    let mut parsed =
        parsed_pivot_with_preservation(preservation(Vec::new(), Some("relationshipDiscovered")));
    parsed.config.layout = Some(PivotTableLayout {
        data_caption: Some("Custom Values".to_string()),
        ..Default::default()
    });
    let cache_source = local_cache_source(PivotCacheSourceKind::LocalWorksheet);

    match classify_with_cache(&parsed, Some(&cache_source)) {
        ImportedPivotClassification::Promotable { .. } => {}
        ImportedPivotClassification::Unsupported(_) => {
            panic!("typed custom dataCaption should promote")
        }
    }
}

#[test]
fn unknown_root_attribute_remains_unsupported() {
    let parsed = parsed_pivot_with_preservation(preservation(
        vec![raw_attr("unsupportedPivotAttr", "1")],
        Some("relationshipDiscovered"),
    ));
    let cache_source = local_cache_source(PivotCacheSourceKind::LocalWorksheet);

    match classify_with_cache(&parsed, Some(&cache_source)) {
        ImportedPivotClassification::Unsupported(ImportedPivotUnsupportedReason::LossyOoxml) => {}
        _ => panic!("unknown root attribute should remain lossy"),
    }
}

#[test]
fn malformed_pivot_relationship_remains_unsupported() {
    let parsed = parsed_pivot_with_preservation(preservation(
        Vec::new(),
        Some("missingCacheDefinitionRelationship"),
    ));
    let cache_source = local_cache_source(PivotCacheSourceKind::LocalWorksheet);

    match classify_with_cache(&parsed, Some(&cache_source)) {
        ImportedPivotClassification::Unsupported(ImportedPivotUnsupportedReason::LossyOoxml) => {}
        _ => panic!("malformed pivot cache relationship should remain lossy"),
    }
}

#[test]
fn resolved_local_table_or_name_source_is_promotable() {
    let parsed =
        parsed_pivot_with_preservation(preservation(Vec::new(), Some("relationshipDiscovered")));
    let cache_source = local_cache_source(PivotCacheSourceKind::LocalTableOrName);

    match classify_with_cache(&parsed, Some(&cache_source)) {
        ImportedPivotClassification::Promotable { .. } => {}
        ImportedPivotClassification::Unsupported(_) => {
            panic!("resolved local table/name source should promote")
        }
    }
}

#[test]
fn unresolved_local_table_or_name_source_stays_cache_only() {
    let parsed =
        parsed_pivot_with_preservation(preservation(Vec::new(), Some("relationshipDiscovered")));
    let mut cache_source = local_cache_source(PivotCacheSourceKind::LocalTableOrName);
    cache_source.source_range = None;

    match classify_with_cache(&parsed, Some(&cache_source)) {
        ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::CacheOnlySource,
        ) => {}
        _ => panic!("unresolved local table/name source should stay cache-only"),
    }
}
