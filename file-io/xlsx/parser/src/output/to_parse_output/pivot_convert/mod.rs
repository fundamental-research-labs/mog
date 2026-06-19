//! Direct converter: parser-internal pivot types -> unified PivotTableConfig.
//!
//! Bypasses the intermediate `PivotSpec` / `PivotTableDef` types by converting directly
//! from the XLSX parser's `PivotTable` + `PivotCache` (from `domain/pivot/read.rs`) into
//! `pivot_types::PivotTableConfig`.
//!
//! This module ports the logic from `compute-api/src/pure/pivot_convert.rs` so the
//! parser can produce the final compute-ready types in a single step.

mod expansion;
mod fields;
mod filters;
mod layout;
mod placements;
mod sort;
mod source;
mod value_map;

use crate::domain::pivot::read::{PivotCache, PivotTable};
use domain_types::domain::pivot::{
    ImportedPivotOoxmlIdentityParts, ParsedPivotTable, PivotPageFieldDef,
    imported_pivot_ooxml_identity, native_imported_pivot_id,
};
use pivot_types::{
    CellRange, FieldId, LayoutForm, OutputLocation, PIVOT_CONFIG_SCHEMA_VERSION,
    PivotFieldPlacementFlat, PivotTableConfig, PivotTableStyle,
};
use value_types::CellValue;

use expansion::build_expansion_state_from_ooxml;
use fields::build_fields;
use filters::build_filters;
use layout::build_layout;
use placements::build_placements;
use source::{parse_output_anchor, parse_source_range};
use value_map::{convert_row_col_item, shared_item_to_cell_value};

/// Convert parser-internal pivot types directly to the compute-ready
/// `ParsedPivotTable`, bypassing `PivotSpec`. OOXML attributes live on
/// `PivotTableConfig` / `PivotField`.
///
/// Returns `None` for unsupported configurations (e.g., missing cache data).
pub(crate) fn parsed_pivot_to_config(
    pivot: &PivotTable,
    cache: &PivotCache,
    sheet_name: &str,
    cache_records: &[Vec<CellValue>],
) -> Option<ParsedPivotTable> {
    let fields = build_fields(pivot, cache, cache_records);

    // -- Layout (needed for subtotal decisions) --
    let layout = build_layout(pivot);
    let is_tabular = layout
        .layout_form
        .as_ref()
        .map_or(false, |lf| matches!(lf, LayoutForm::Tabular));

    // -- Data field ID mapping for autoSortScope --
    let data_field_ids: Vec<FieldId> = pivot
        .data_fields
        .iter()
        .filter_map(|df| fields.get(df.field_index as usize).map(|f| f.id.clone()))
        .collect();

    let placements = build_placements(pivot, cache, &fields, &data_field_ids, is_tabular);

    // -- Filters --
    let filters = build_filters(pivot, &fields, cache);

    let (anchor_row, anchor_col) = parse_output_anchor(&pivot.location)?;

    // -- Source range --
    let source_range = parse_source_range(cache).unwrap_or_else(|| {
        let num_rows = cache_records.len() as u32;
        let num_cols = cache.fields.len() as u32;
        CellRange::new(0, 0, num_rows, num_cols.saturating_sub(1))
    });

    // -- IDs and names --
    let id = stable_imported_pivot_id(pivot);
    let source_sheet_name = cache
        .source_sheet
        .clone()
        .unwrap_or_else(|| "xlsx-source-sheet".to_string());

    // -- Style --
    let style = pivot.style_info.as_ref().map(|s| PivotTableStyle {
        style_name: s.name.clone(),
        show_row_headers: Some(s.show_row_headers),
        show_column_headers: Some(s.show_col_headers),
        show_row_stripes: if s.show_row_stripes { Some(true) } else { None },
        show_column_stripes: if s.show_col_stripes { Some(true) } else { None },
        show_last_column: Some(s.show_last_column),
    });

    // -- OOXML location attributes folded onto the config --
    //
    // Typed range refs: canonicalize the typed `ref_` back to A1 for the
    // `ref_range: Option<String>` field (still a String because it flows
    // through `domain_types`, which is outside W4.c scope). A missing/
    // non-positional typed ref, combined with zero offsets, elides the
    // location group entirely.
    let loc = &pivot.location;
    let ref_range_str = loc
        .ref_
        .as_ref()
        .map(|r| r.to_a1_string())
        .unwrap_or_default();
    let has_ooxml_location = !ref_range_str.is_empty()
        || loc.first_header_row != 0
        || loc.first_data_row != 0
        || loc.first_data_col != 0
        || loc.rows_per_page != 0
        || loc.cols_per_page != 0;
    let (ref_range, first_header_row, first_data_row, first_data_col, rows_per_page, cols_per_page) =
        if has_ooxml_location {
            (
                if ref_range_str.is_empty() {
                    None
                } else {
                    Some(ref_range_str)
                },
                Some(loc.first_header_row),
                Some(loc.first_data_row),
                Some(loc.first_data_col),
                (loc.rows_per_page > 0).then_some(loc.rows_per_page),
                (loc.cols_per_page > 0).then_some(loc.cols_per_page),
            )
        } else {
            (None, None, None, None, None, None)
        };

    // -- Build PivotTableConfig (unified compute + OOXML) --
    let config = PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id,
        name: pivot.name.clone(),
        source_sheet_id: None,
        source_sheet_name,
        source_range,
        output_sheet_id: None,
        output_sheet_name: sheet_name.to_string(),
        output_location: OutputLocation {
            row: anchor_row,
            col: anchor_col,
        },
        fields,
        placements: placements
            .into_iter()
            .map(PivotFieldPlacementFlat::from)
            .collect(),
        filters,
        layout: Some(layout),
        style,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id: Some(cache.id),
        data_on_rows: Some(pivot.data_on_rows),
        ref_range,
        first_data_row,
        first_header_row,
        first_data_col,
        rows_per_page,
        cols_per_page,
        row_items: pivot.row_items.iter().map(convert_row_col_item).collect(),
        col_items: pivot.col_items.iter().map(convert_row_col_item).collect(),
    };

    // Build initial expansion state from OOXML sd="0" (show_details) attributes.
    // Items with show_details=true are expanded; items with show_details=false are collapsed.
    let initial_expansion_state = build_expansion_state_from_ooxml(pivot, cache);

    let mut ooxml_preservation = pivot.ooxml_preservation.clone();
    ooxml_preservation.page_fields = pivot
        .page_fields
        .iter()
        .map(|field| PivotPageFieldDef {
            field_index: field.field_index,
            item: field.item,
            hierarchy: field.hierarchy,
            name: field.name.clone(),
            caption: field.caption.clone(),
        })
        .collect();
    ooxml_preservation.cache_source_name = cache.source_name.clone();
    ooxml_preservation.cache_shared_items = cache
        .fields
        .iter()
        .map(|field| {
            field
                .shared_items
                .iter()
                .map(shared_item_to_cell_value)
                .collect()
        })
        .collect();

    Some(ParsedPivotTable {
        config,
        initial_expansion_state,
        ooxml_preservation,
    })
}

fn stable_imported_pivot_id(pivot: &PivotTable) -> String {
    let preservation = &pivot.ooxml_preservation;
    let relationship = preservation.relationship.as_ref();

    let definition_part_path = preservation
        .definition_part_path
        .as_deref()
        .or_else(|| relationship.and_then(|rel| rel.part_path.as_deref()));

    if let Some(import_identity) = imported_pivot_ooxml_identity(ImportedPivotOoxmlIdentityParts {
        output_worksheet_part_path: preservation.output_worksheet_part_path.as_deref(),
        output_worksheet_relationship_id: preservation.output_worksheet_relationship_id.as_deref(),
        definition_part_path,
        pivot_cache_relationship_id: relationship.and_then(|rel| rel.relationship_id.as_deref()),
        cache_id: Some(pivot.cache_id),
    }) {
        native_imported_pivot_id(&import_identity)
    } else {
        let fallback_fingerprint = format!(
            "missingImportIdentity:outputWorksheetPartPath={};worksheetRelationshipId={};definitionPartPath={};pivotCacheRelationshipId={};cacheId={}",
            preservation
                .output_worksheet_part_path
                .as_deref()
                .unwrap_or(""),
            preservation
                .output_worksheet_relationship_id
                .as_deref()
                .unwrap_or(""),
            definition_part_path.unwrap_or(""),
            relationship
                .and_then(|rel| rel.relationship_id.as_deref())
                .unwrap_or(""),
            pivot.cache_id,
        );
        format!(
            "xlsx-pivot-missing-import-identity-{:08x}",
            crc32fast::hash(fallback_fingerprint.as_bytes())
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::read::{
        CacheField, PageField, PivotField as ReadPivotField, PivotItem, PivotItemType, SharedItem,
    };
    use domain_types::domain::pivot::{
        PivotTableOoxmlPreservation, PivotTableRelationshipPreservation,
    };

    fn data_item(x: u32) -> PivotItem {
        PivotItem {
            item_type: PivotItemType::Data,
            x: Some(x),
            hidden: false,
            show_details: true,
            s: None,
        }
    }

    #[test]
    fn imported_pivot_id_uses_canonical_ooxml_identity_not_name() {
        let mut pivot = PivotTable {
            name: "Pivot A".to_string(),
            cache_id: 7,
            ooxml_preservation: PivotTableOoxmlPreservation {
                output_worksheet_part_path: Some("xl/worksheets/sheet2.xml".to_string()),
                output_worksheet_relationship_id: Some("rId5".to_string()),
                definition_part_path: Some("xl/pivotTables/pivotTable3.xml".to_string()),
                relationship: Some(PivotTableRelationshipPreservation {
                    relationship_id: Some("rId1".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        };

        let id = stable_imported_pivot_id(&pivot);
        let import_identity = imported_pivot_ooxml_identity(ImportedPivotOoxmlIdentityParts {
            output_worksheet_part_path: pivot
                .ooxml_preservation
                .output_worksheet_part_path
                .as_deref(),
            output_worksheet_relationship_id: pivot
                .ooxml_preservation
                .output_worksheet_relationship_id
                .as_deref(),
            definition_part_path: pivot.ooxml_preservation.definition_part_path.as_deref(),
            pivot_cache_relationship_id: pivot
                .ooxml_preservation
                .relationship
                .as_ref()
                .and_then(|rel| rel.relationship_id.as_deref()),
            cache_id: Some(pivot.cache_id),
        })
        .expect("import identity");
        pivot.name = "Renamed Pivot".to_string();

        assert_eq!(id, stable_imported_pivot_id(&pivot));
        assert_eq!(id, native_imported_pivot_id(&import_identity));
    }

    #[test]
    fn imported_pivot_id_missing_identity_fallback_is_not_name_based() {
        let mut pivot = PivotTable {
            name: "Pivot A".to_string(),
            cache_id: 7,
            ..Default::default()
        };

        let id = stable_imported_pivot_id(&pivot);
        pivot.name = "Renamed Pivot".to_string();

        assert_eq!(id, stable_imported_pivot_id(&pivot));
        assert!(id.starts_with("xlsx-pivot-missing-import-identity-"));
    }

    #[test]
    fn parsed_pivot_preserves_page_field_ooxml_state() {
        let pivot = PivotTable {
            name: "Pivot A".to_string(),
            cache_id: 7,
            location: crate::domain::pivot::read::PivotLocation {
                ref_: compute_parser::parse_a1_range("D4:F9"),
                ..Default::default()
            },
            page_fields: vec![PageField {
                field_index: 0,
                item: Some(1),
                hierarchy: Some(-1),
                name: Some("RegionHierarchy".to_string()),
                caption: Some("Region Caption".to_string()),
            }],
            pivot_fields: vec![ReadPivotField {
                items: vec![data_item(0), data_item(1)],
                ..Default::default()
            }],
            ..Default::default()
        };
        let cache = PivotCache {
            id: 7,
            source_ref: Some("A1:A3".to_string()),
            source_sheet: Some("Data".to_string()),
            fields: vec![CacheField {
                name: "Region".to_string(),
                shared_items: vec![
                    SharedItem::String("West".to_string()),
                    SharedItem::String("East".to_string()),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };

        let parsed = parsed_pivot_to_config(&pivot, &cache, "Pivot Sheet", &[])
            .expect("pivot should convert");

        assert_eq!(
            parsed.ooxml_preservation.page_fields,
            vec![PivotPageFieldDef {
                field_index: 0,
                item: Some(1),
                hierarchy: Some(-1),
                name: Some("RegionHierarchy".to_string()),
                caption: Some("Region Caption".to_string()),
            }]
        );
        assert_eq!(
            parsed.config.filters[0].include_values,
            Some(vec![CellValue::Text("East".into())])
        );
    }
}
