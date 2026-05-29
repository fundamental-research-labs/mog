//! `FullParseResult` -> `ParseOutput` + `ParseDiagnostics` conversion.
//!
//! This module converts the parser's raw output into the shared domain types defined
//! in the `domain-types` crate. It is the bridge between the XLSX parser's internal
//! representation and the pipeline-wide `ParseOutput` contract.
//!
//! ## Design principles
//!
//! - **Position-keyed**: No UUIDs or CellIds — those are allocated by the hydration layer.
//! - **Style resolution**: Uses `domain_types::style_resolver::resolve_styles()` to flatten
//!   the OOXML multi-level style tables into a `Vec<DocumentFormat>` palette.
//! - **Shared string resolution**: Inlines SST references at conversion time.
//! - **Diagnostics**: Parse errors and statistics are moved into `ParseDiagnostics`.
//!
//! ## Stubbed domains
//!
//! Complex domain objects (charts, CF, validations, sparklines, slicers, etc.) are
//! stubbed with empty Vecs until export support is wired.

mod cells;
mod comments;
mod diagnostics;
mod dropped_import_diagnostics;
mod dxf_registry;
mod features;
mod media;
mod metadata;
mod package_fidelity;
mod pivot_cache_sources;
pub(crate) mod pivot_convert;
mod sheet;
mod sheet_extents;
mod styles;
mod threaded_comments;
mod workbook_metadata;
use crate::domain::workbook::read::parse_all_rels;
use crate::infra::opc::{
    REL_COMMENTS, REL_THREADED_COMMENT, REL_VML_DRAWING, resolve_relationship_target,
};
use cells::*;
use comments::build_sheet_comment_package_info;
use diagnostics::{append_import_compatibility_acknowledgements, append_object_import_diagnostics};
#[cfg(test)]
use diagnostics::{count_ooxml_smartart_diagrams, count_ooxml_wordart_text_effects};
use dropped_import_diagnostics::append_dropped_import_diagnostics;
use dxf_registry::populate_dxf_registry_owners;
use features::*;
use media::{build_binary_part_map, build_media_data_url_map};
use package_fidelity::build_package_fidelity_metadata;
use pivot_cache_sources::build_pivot_cache_sources;
use sheet::convert_sheet;
use sheet_extents::*;
use styles::*;
use threaded_comments::merge_threaded_comments;
#[cfg(test)]
use threaded_comments::threaded_candidate_ids;
use workbook_metadata::*;

use std::collections::HashMap;
use std::collections::HashSet;

use domain_types::{
    AuthoredStyleRun,
    // Round-trip types
    CalcIdProvenance,
    CalculationProperties,
    // Parse output types
    CellData,
    ColDimension,
    ColStyleEntry,
    // Domain types
    Comment,
    FrozenPane,
    Hyperlink,
    HyperlinkTargetKind,
    MergeRegion,
    // Diagnostics types
    ParseDiagnostics,
    ParseOutput,
    PersonInfo,
    RowDimension,
    RowStyleEntry,
    RowXmlHints,
    SheetData,
    SheetDimensions,
    SheetView,
    TrailingColRange,
};
use formula_types::{CellRef, RangeType};
use value_types::CellValue;

// Parser-internal imports (no re-export indirection)
use crate::output::results::{FullParseResult, FullParsedSheet};

// =============================================================================
// Public entry point
// =============================================================================

/// Convert a `FullParseResult` into the shared pipeline types.
///
/// Returns:
/// - `ParseOutput`: Semantic data (cells, merges, styles, named ranges, etc.)
/// - `ParseDiagnostics`: Errors, statistics, and recalc hints
pub fn full_parse_result_to_parse_output(
    result: &FullParseResult,
) -> (ParseOutput, ParseDiagnostics) {
    // 1. Resolve styles into a flat DocumentFormat palette
    let style_input = build_style_input(&result.styles, result);
    let style_palette = domain_types::style_resolver::resolve_styles(&style_input);

    // 2. Convert sheets, collecting workbook-level items along the way
    let mut sheet_data_vec = Vec::with_capacity(result.sheets.len());
    let mut all_parsed_pivots = Vec::new();
    let mut all_data_table_regions = Vec::new();

    // Extract DXF table and theme colors for CF style resolution
    let dxfs = result
        .parsed_stylesheet
        .as_ref()
        .map(|s| s.dxfs.as_slice())
        .unwrap_or(&[]);
    let theme_colors = styles::extract_theme_color_palette(result);
    let media_data_urls = build_media_data_url_map(result);
    let binary_parts = build_binary_part_map(result);

    for (sheet_idx, sheet) in result.sheets.iter().enumerate() {
        let mut sd = convert_sheet(
            sheet,
            &result.shared_strings,
            &result.shared_strings_rich_runs,
            &result.shared_strings_phonetic_xml,
            dxfs,
            &theme_colors,
            &media_data_urls,
            &binary_parts,
            result.metadata.as_ref(),
        );
        if let Some(extensions) = result.extensions.as_ref()
            && let Some(namespaces) = extensions.sheet_namespaces.get(sheet_idx)
        {
            sd.worksheet_root_namespaces = namespaces.into();
        }
        sd.worksheet_ext_lst_xml = sheet.ext_lst_xml.clone();
        // Assign tables to each sheet (tables are per-sheet data)
        sd.tables = convert_tables(&sheet.tables);
        // Collect the ParsedPivotTable (config + ooxml sidecar) from the v2 converter
        all_parsed_pivots.extend(sheet.parsed_pivot_configs.iter().cloned());
        all_data_table_regions.extend(convert_data_tables(&sheet.data_tables, sheet_idx as u32));
        sheet_data_vec.push(sd);
    }

    // 3. Convert named ranges
    let named_ranges = convert_named_ranges(result);

    // 4. Convert theme
    let theme = convert_theme(result);

    // 5. Convert workbook protection (already domain_types::WorkbookProtection from full_parse)
    let protection = result.workbook_protection.clone();

    // 6. Convert document properties
    let properties =
        (result.doc_props_core.is_some() || result.doc_props_custom.is_some()).then(|| {
            let core = result.doc_props_core.as_ref();
            let typed_custom: Vec<_> = result
                .doc_props_custom
                .as_ref()
                .map(|custom| custom.clone())
                .unwrap_or_default();
            domain_types::DocumentProperties {
                title: core.and_then(|core| core.title.clone()),
                creator: core.and_then(|core| core.creator.clone()),
                description: core.and_then(|core| core.description.clone()),
                identifier: core.and_then(|core| core.identifier.clone()),
                language: core.and_then(|core| core.language.clone()),
                subject: core.and_then(|core| core.subject.clone()),
                created: core.and_then(|core| core.created.clone()),
                modified: core.and_then(|core| core.modified.clone()),
                last_modified_by: core.and_then(|core| core.last_modified_by.clone()),
                category: core.and_then(|core| core.category.clone()),
                keywords: core.and_then(|core| core.keywords.clone()),
                content_status: core.and_then(|core| core.content_status.clone()),
                content_type: core.and_then(|core| core.content_type.clone()),
                last_printed: core.and_then(|core| core.last_printed.clone()),
                revision: core.and_then(|core| core.revision.clone()),
                version: core.and_then(|core| core.version.clone()),
                custom: typed_custom
                    .iter()
                    .map(|prop| (prop.name.clone(), prop.value.as_legacy_string()))
                    .collect(),
                typed_custom,
            }
        });

    // 7. Calculation properties
    let calculation = result
        .calc_pr_settings
        .clone()
        .map(CalculationProperties::from)
        .unwrap_or_else(|| CalculationProperties {
            iterate: result.iterative_calc,
            iterate_count: result.max_iterations.unwrap_or(100),
            iterate_delta: result.max_change.unwrap_or(0.001),
            calc_id: result.calc_id,
            has_explicit_iterate_count: result.max_iterations.is_some(),
            has_explicit_iterate_delta: result.max_change.is_some(),
            ..Default::default()
        });

    let mut metadata = result
        .metadata
        .as_ref()
        .and_then(metadata::metadata_to_domain);
    if let Some(rich_data) = result.rich_data.clone() {
        metadata
            .get_or_insert_with(domain_types::WorkbookMetadata::default)
            .rich_data = Some(rich_data);
    }
    if let Some(raw_metadata_xml) = result.raw_metadata_xml.as_ref() {
        let metadata_for_import =
            metadata.get_or_insert_with(domain_types::WorkbookMetadata::default);
        let imported =
            imported_metadata_xml(raw_metadata_xml, metadata_for_import, &sheet_data_vec);
        metadata_for_import.imported_metadata_xml = Some(imported);
    }
    if !result.feature_properties.is_empty() {
        metadata
            .get_or_insert_with(domain_types::WorkbookMetadata::default)
            .feature_properties = result.feature_properties.clone();
    }

    // 8. Slicer caches (workbook-level) — already ooxml-types, pass through directly
    let slicer_caches = result.slicer_caches.clone();

    // 8b. Parse persons and merge threaded comments into sheet comments
    let persons = merge_threaded_comments(result, &mut sheet_data_vec);
    for sheet in &mut sheet_data_vec {
        extend_sheet_data_extent(sheet);
    }

    // 8c. Extract pivot cache records for eval-only use through the pivot conversion contract.
    let pivot_cache_records: std::collections::HashMap<u32, Vec<Vec<value_types::CellValue>>> =
        result
            .pivot_caches
            .iter()
            .filter_map(|(cache_id, parsed_cache)| {
                let rows = crate::domain::pivot::convert::resolve_cache_records(Some(parsed_cache));
                (!rows.is_empty()).then_some((*cache_id, rows))
            })
            .collect();
    let pivot_cache_sources =
        build_pivot_cache_sources(result.pivot_caches.iter(), &result.pivot_cache_packages);

    // 9. Build ParseOutput
    let workbook_stylesheet = result.parsed_stylesheet.clone().map(|stylesheet| {
        domain_types::WorkbookStylesheet::from_stylesheet(
            stylesheet,
            result.styles_root_namespace_attrs.clone(),
            result.styles_ext_lst_xml.clone(),
        )
        .with_root_mce_attributes(
            result
                .extensions
                .as_ref()
                .map(|extensions| extensions.styles_namespaces.mce_attributes().clone())
                .unwrap_or_default(),
        )
    });

    let mut parse_output = ParseOutput {
        sheets: sheet_data_vec,
        workbook_sheet_inventory: result.workbook_sheet_inventory.clone(),
        workbook_root_namespaces: result
            .extensions
            .as_ref()
            .map(|extensions| (&extensions.workbook_namespaces).into())
            .unwrap_or_default(),
        workbook_conformance: result.workbook_conformance.clone(),
        style_palette,
        workbook_stylesheet,
        package_fidelity: build_package_fidelity_metadata(result),
        shared_string_hints: Vec::new(),
        named_ranges,
        pivot_tables: all_parsed_pivots,
        pivot_cache_sources,
        pivot_cache_records,
        data_table_regions: all_data_table_regions,
        slicer_caches,
        timeline_caches: result.timeline_caches.clone(),
        custom_table_styles: result.styles.raw_table_styles.clone(),
        default_table_style: result.styles.default_table_style.clone(),
        default_pivot_style: result.styles.default_pivot_style.clone(),
        theme,
        properties,
        extended_properties: result.doc_props_app.clone(),
        protection,
        calc_id_provenance: calculation
            .calc_id
            .map(CalcIdProvenance::imported_current)
            .unwrap_or_default(),
        calculation,
        metadata,
        workbook_views: result
            .workbook_views
            .iter()
            .cloned()
            .map(domain_types::domain::workbook::WorkbookView::from)
            .collect(),
        custom_workbook_views_xml: result.custom_workbook_views_xml.clone(),
        workbook_properties: result.workbook_properties.clone(),
        file_version: result.file_version.clone(),
        file_sharing: result.file_sharing.clone(),
        web_publishing: result.web_publishing.clone(),
        external_links: result.external_links.clone(),
        connections: result.connections.clone(),
        persons,
        has_persons_part: result.raw_persons_xml.is_some(),
        volatile_dependency_part: result.volatile_dependency_part.clone(),
    };
    let _data_features = parse_output.workbook_data_features();
    populate_dxf_registry_owners(&mut parse_output);

    // 10. Build ParseDiagnostics
    let mut diagnostics = build_diagnostics(result);
    append_dropped_import_diagnostics(result, &mut diagnostics);
    append_import_compatibility_acknowledgements(&result.sheets, &mut diagnostics);
    append_object_import_diagnostics(&parse_output, &mut diagnostics);

    (parse_output, diagnostics)
}

#[cfg(test)]
mod tests;
