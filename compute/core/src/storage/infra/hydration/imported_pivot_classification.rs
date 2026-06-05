use domain_types::domain::pivot::{
    ParsedPivotTable, PivotCacheSourceDef, PivotCacheSourceKind, PivotFieldArea,
    PivotRawXmlAttribute, PivotTableRelationshipPreservation,
};

use crate::storage::workbook::imported_pivots::ImportedPivotUnsupportedReason;

pub(super) enum ImportedPivotClassification {
    Promotable {
        source_sheet_id: cell_types::SheetId,
        output_sheet_id: cell_types::SheetId,
    },
    Unsupported(ImportedPivotUnsupportedReason),
}

pub(super) fn classify_imported_pivot(
    parsed: &ParsedPivotTable,
    import_identity: &str,
    cache_source: Option<&PivotCacheSourceDef>,
    sheet_id_by_name: &std::collections::HashMap<&str, cell_types::SheetId>,
    source_sheet_name: &str,
    output_sheet_name: &str,
) -> ImportedPivotClassification {
    if !is_canonical_import_identity(import_identity) {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::MissingImportIdentity,
        );
    }

    if let Some(reason) = unsupported_cache_source_reason(cache_source) {
        return ImportedPivotClassification::Unsupported(reason);
    }

    if source_sheet_name.is_empty() || source_sheet_name == "xlsx-source-sheet" {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::FallbackSourceSheet,
        );
    }

    if !source_range_metadata_is_valid(parsed, cache_source) {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::InvalidOutputRange,
        );
    }

    if !output_range_metadata_is_valid(parsed) {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::InvalidOutputRange,
        );
    }

    if fields_or_placements_have_unstable_identity(parsed, cache_source) {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::FieldCacheMismatch,
        );
    }

    if has_lossy_ooxml_preservation(parsed) {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::LossyOoxml,
        );
    }

    let Some(source_sheet_id) = sheet_id_by_name.get(source_sheet_name).copied() else {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::UnresolvedSourceSheet,
        );
    };
    let Some(output_sheet_id) = sheet_id_by_name.get(output_sheet_name).copied() else {
        return ImportedPivotClassification::Unsupported(
            ImportedPivotUnsupportedReason::UnresolvedOutputSheet,
        );
    };

    ImportedPivotClassification::Promotable {
        source_sheet_id,
        output_sheet_id,
    }
}

fn is_canonical_import_identity(import_identity: &str) -> bool {
    import_identity.starts_with("ooxml:")
}

fn unsupported_cache_source_reason(
    cache_source: Option<&PivotCacheSourceDef>,
) -> Option<ImportedPivotUnsupportedReason> {
    let Some(cache_source) = cache_source else {
        return Some(ImportedPivotUnsupportedReason::CacheOnlySource);
    };

    match cache_source.source_kind {
        PivotCacheSourceKind::LocalWorksheet | PivotCacheSourceKind::LocalTableOrName => {
            if cache_source
                .source_sheet
                .as_deref()
                .is_none_or(str::is_empty)
                || cache_source
                    .source_range
                    .as_deref()
                    .is_none_or(str::is_empty)
            {
                Some(ImportedPivotUnsupportedReason::CacheOnlySource)
            } else {
                None
            }
        }
        PivotCacheSourceKind::ExternalWorksheet | PivotCacheSourceKind::WorkbookConnection => {
            Some(ImportedPivotUnsupportedReason::ExternalSource)
        }
        PivotCacheSourceKind::Consolidation
        | PivotCacheSourceKind::Scenario
        | PivotCacheSourceKind::UnknownImported => {
            Some(ImportedPivotUnsupportedReason::CacheOnlySource)
        }
    }
}

fn source_range_metadata_is_valid(
    parsed: &ParsedPivotTable,
    cache_source: Option<&PivotCacheSourceDef>,
) -> bool {
    let Some(source_ref) = cache_source.and_then(|source| source.source_range.as_deref()) else {
        return false;
    };
    if crate::import::phantom::parse_range_ref(source_ref).is_none() {
        return false;
    }

    parsed.config.source_range.row_count() > 0 && parsed.config.source_range.col_count() > 0
}

fn output_range_metadata_is_valid(parsed: &ParsedPivotTable) -> bool {
    let Some(ref_range) = parsed.config.ref_range.as_deref() else {
        return false;
    };
    let Some((start_row, start_col, _end_row, _end_col)) =
        crate::import::phantom::parse_range_ref(ref_range)
    else {
        return false;
    };

    parsed.config.output_location.row == start_row && parsed.config.output_location.col == start_col
}

fn fields_or_placements_have_unstable_identity(
    parsed: &ParsedPivotTable,
    cache_source: Option<&PivotCacheSourceDef>,
) -> bool {
    let config = &parsed.config;
    let Some(cache_source) = cache_source else {
        return true;
    };
    if config.fields.is_empty() || config.fields.len() != cache_source.field_names.len() {
        return true;
    }

    let mut field_ids = std::collections::HashSet::new();
    let mut source_columns = std::collections::HashSet::new();
    for field in &config.fields {
        if field.id.as_str().is_empty()
            || !field_ids.insert(field.id.as_str())
            || !source_columns.insert(field.source_column)
            || field.source_column as usize >= cache_source.field_names.len()
        {
            return true;
        }
        if cache_source.field_names[field.source_column as usize] != field.name {
            return true;
        }
    }

    if config.placements.is_empty() {
        return true;
    }

    let mut placement_ids = std::collections::HashSet::new();
    let mut positions_by_area: [Vec<usize>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    for placement in &config.placements {
        if placement.placement_id.as_str().is_empty()
            || !placement_ids.insert(placement.placement_id.as_str())
            || !field_ids.contains(placement.field_id.as_str())
        {
            return true;
        }
        let Some(area_index) = placement_area_index(placement.area) else {
            return true;
        };
        positions_by_area[area_index].push(placement.position);
    }

    positions_by_area.iter_mut().any(|positions| {
        positions.sort_unstable();
        positions
            .iter()
            .copied()
            .enumerate()
            .any(|(expected, actual)| expected != actual)
    })
}

fn placement_area_index(area: PivotFieldArea) -> Option<usize> {
    match area {
        PivotFieldArea::Row => Some(0),
        PivotFieldArea::Column => Some(1),
        PivotFieldArea::Value => Some(2),
        PivotFieldArea::Filter => Some(3),
        _ => None,
    }
}

fn has_lossy_ooxml_preservation(parsed: &ParsedPivotTable) -> bool {
    let preservation = &parsed.ooxml_preservation;
    if preservation
        .root_attributes
        .iter()
        .any(|attr| promoted_import_root_attribute_is_lossy(parsed, attr))
        || !preservation.children.is_empty()
        || preservation.fields.iter().any(|field| {
            !field.attributes.is_empty()
                || !field.children.is_empty()
                || field.item_attributes.iter().any(|attrs| !attrs.is_empty())
        })
        || preservation
            .row_item_attributes
            .iter()
            .any(|attrs| !attrs.is_empty())
        || preservation
            .col_item_attributes
            .iter()
            .any(|attrs| !attrs.is_empty())
    {
        return true;
    }

    promoted_import_relationship_is_lossy(preservation.relationship.as_ref())
}

fn promoted_import_root_attribute_is_lossy(
    parsed: &ParsedPivotTable,
    attr: &PivotRawXmlAttribute,
) -> bool {
    match ooxml_local_name(&attr.name) {
        "dataCaption" => attr.value != modeled_data_caption(parsed),
        "applyNumberFormats"
        | "applyBorderFormats"
        | "applyFontFormats"
        | "applyPatternFormats"
        | "applyAlignmentFormats"
        | "applyWidthHeightFormats"
        | "showDrill"
        | "showDataTips"
        | "useAutoFormatting"
        | "itemPrintTitles"
        | "outline"
        | "outlineData"
        | "multipleFieldFilters" => !is_ooxml_bool_literal(&attr.value),
        "createdVersion" => attr.value.parse::<u8>().is_err(),
        "indent" => attr.value.parse::<u32>().is_err(),
        _ => true,
    }
}

fn modeled_data_caption(parsed: &ParsedPivotTable) -> &str {
    parsed
        .config
        .layout
        .as_ref()
        .and_then(|layout| layout.data_caption.as_deref())
        .unwrap_or("Values")
}

fn promoted_import_relationship_is_lossy(
    relationship: Option<&PivotTableRelationshipPreservation>,
) -> bool {
    match relationship.and_then(|relationship| relationship.consistency.as_deref()) {
        None | Some("relationshipDiscovered") | Some("missingRelationshipPart") => false,
        Some(_) => true,
    }
}

fn is_ooxml_bool_literal(value: &str) -> bool {
    matches!(value, "0" | "1")
        || value.eq_ignore_ascii_case("true")
        || value.eq_ignore_ascii_case("false")
}

fn ooxml_local_name(name: &str) -> &str {
    name.rsplit_once(':')
        .map(|(_, local_name)| local_name)
        .unwrap_or(name)
}

#[cfg(test)]
#[path = "import_tests.rs"]
mod import_tests;
