//! Workbook-level export functions.
//!
//! Extracted from `export.rs` — theme, protection, document properties,
//! workbook properties, file version, file sharing, slicer caches, and
//! parsed pivot tables.

use cell_types::SheetId;
use domain_types::{
    DocumentFormat, PersonInfo,
    domain::external_link::ExternalLink,
    domain::pivot::ParsedPivotTable,
    domain::theme::ThemeData,
    domain::workbook::{CalculationProperties, RefMode, WorkbookProtection, WorkbookWebPublishing},
};

use crate::mirror::CellMirror;
use crate::snapshot::{CalcMode, CalculationSettings};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::pivots;
use crate::storage::workbook::settings as workbook_settings;

use super::pivot_cache_reconciliation::{
    read_pivot_cache_sources, reconcile_promoted_import_cache_for_export,
};

// -------------------------------------------------------------------
// Workbook-level exports
// -------------------------------------------------------------------

/// Export the native theme.
pub(in crate::storage::engine) fn export_workbook_theme(
    stores: &EngineStores,
) -> Option<ThemeData> {
    stores.storage.metadata.theme.clone()
}

/// Export the native workbook protection object.
pub(in crate::storage::engine) fn export_workbook_protection(
    stores: &EngineStores,
) -> Option<WorkbookProtection> {
    stores.storage.metadata.protection.clone()
}

/// Export native document properties.
pub(super) fn export_document_properties(
    stores: &EngineStores,
) -> Option<domain_types::DocumentProperties> {
    stores.storage.metadata.document_properties.clone()
}

pub(super) fn export_xlsx_metadata(
    stores: &EngineStores,
) -> Option<domain_types::WorkbookMetadata> {
    stores.storage.metadata.xlsx_metadata.clone()
}

pub(super) fn export_shared_string_hints(
    stores: &EngineStores,
) -> Vec<domain_types::SharedStringHint> {
    stores.storage.metadata.shared_string_hints.clone()
}

pub(super) fn export_package_fidelity_metadata(
    stores: &EngineStores,
) -> Option<domain_types::PackageFidelityMetadata> {
    stores.storage.metadata.package_fidelity.clone()
}

pub(super) fn export_volatile_dependency_part(
    stores: &EngineStores,
) -> Option<domain_types::VolatileDependencyPackagePart> {
    stores.storage.metadata.volatile_dependency_part.clone()
}

pub(super) fn export_workbook_connections(
    stores: &EngineStores,
) -> domain_types::domain::connections::WorkbookConnectionSet {
    stores.storage.metadata.connections.clone()
}

pub(super) fn export_workbook_stylesheet(
    stores: &EngineStores,
) -> Option<domain_types::WorkbookStylesheet> {
    stores.storage.metadata.stylesheet.clone()
}

pub(super) fn export_workbook_style_palette(stores: &EngineStores) -> Vec<DocumentFormat> {
    stores
        .storage
        .metadata
        .style_palette
        .iter()
        .map(DocumentFormat::from)
        .collect()
}

pub(super) fn export_workbook_table_styles(
    stores: &EngineStores,
) -> (
    Vec<ooxml_types::styles::TableStyleDef>,
    Option<String>,
    Option<String>,
    Vec<domain_types::DxfDef>,
) {
    let default_table_style = stores.storage.metadata.imported_default_table_style.clone();
    let default_pivot_style = stores.storage.metadata.imported_default_pivot_style.clone();

    let existing_dxf_registry = stores
        .storage
        .metadata
        .stylesheet
        .as_ref()
        .map(|stylesheet| stylesheet.dxf_registry.as_slice())
        .unwrap_or_default();
    let mut next_dxf_id = existing_dxf_registry
        .iter()
        .map(|dxf| dxf.id)
        .max()
        .map_or(0, |id| id.saturating_add(1));
    let mut styles = Vec::new();
    let mut generated_dxfs = Vec::new();
    let mut custom_styles: Vec<_> = stores
        .storage
        .metadata
        .custom_table_styles
        .values()
        .collect();
    custom_styles.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    for style in custom_styles {
        let exported = style.to_ooxml_table_style(&mut next_dxf_id);
        generated_dxfs.extend(exported.dxfs);
        styles.push(exported.style);
    }

    (
        styles,
        default_table_style,
        default_pivot_style,
        generated_dxfs,
    )
}

pub(super) fn export_extended_document_properties(
    stores: &EngineStores,
) -> Option<domain_types::ExtendedDocumentProperties> {
    stores.storage.metadata.extended_properties.clone()
}

/// Export calculation settings from modeled workbook storage.
///
pub(super) fn export_calculation_properties(stores: &EngineStores) -> CalculationProperties {
    let settings = workbook_settings::get_calculation_settings(&stores.storage.metadata);
    calculation_properties_from_settings(&settings)
}

fn calculation_properties_from_settings(settings: &CalculationSettings) -> CalculationProperties {
    CalculationProperties {
        iterate: settings.enable_iterative_calculation,
        iterate_count: settings.max_iterations,
        iterate_delta: settings.max_change.get(),
        calc_mode: match settings.calc_mode {
            CalcMode::Auto => domain_types::domain::workbook::CalcMode::Auto,
            CalcMode::AutoNoTable => domain_types::domain::workbook::CalcMode::AutoNoTable,
            CalcMode::Manual => domain_types::domain::workbook::CalcMode::Manual,
        },
        full_calc_on_load: settings.full_calc_on_load,
        ref_mode: if settings.r1c1_mode {
            RefMode::R1C1
        } else {
            RefMode::A1
        },
        full_precision: settings.full_precision,
        calc_completed: settings.calc_completed,
        calc_on_save: settings.calc_on_save,
        concurrent_calc: settings.concurrent_calc,
        concurrent_manual_count: settings.concurrent_manual_count,
        force_full_calc: settings.force_full_calc,
        calc_id: settings.calc_id,
        has_explicit_iterate_count: settings.has_explicit_iterate_count,
        has_explicit_iterate_delta: settings.has_explicit_iterate_delta,
        ..CalculationProperties::default()
    }
}

/// Export the native workbook properties.
pub(super) fn export_workbook_properties(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::WorkbookProperties> {
    stores.storage.metadata.properties.clone()
}

pub(super) fn export_workbook_root_namespaces(
    stores: &EngineStores,
) -> domain_types::XmlNamespaceDeclarations {
    stores.storage.metadata.root_namespaces.clone()
}

pub(super) fn export_custom_workbook_views_xml(stores: &EngineStores) -> Option<Vec<u8>> {
    stores.storage.metadata.custom_views_xml.clone()
}

/// Export native web publishing metadata.
pub(super) fn export_workbook_web_publishing(
    stores: &EngineStores,
) -> Option<WorkbookWebPublishing> {
    stores.storage.metadata.web_publishing.clone()
}

/// Export workbook-level threaded comment person identities.
pub(in crate::storage::engine) fn export_workbook_threaded_comment_persons(
    stores: &EngineStores,
) -> Vec<PersonInfo> {
    stores.storage.metadata.persons.clone()
}

pub(in crate::storage::engine) fn export_workbook_threaded_comment_persons_part_present(
    stores: &EngineStores,
) -> bool {
    stores.storage.metadata.has_persons_part
}

/// Export native file version metadata.
pub(super) fn export_file_version(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::FileVersion> {
    stores.storage.metadata.file_version.clone()
}

/// Export native file sharing metadata.
pub(super) fn export_file_sharing(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::FileSharing> {
    stores.storage.metadata.file_sharing.clone()
}

/// Export workbook external links from workbook-owned imported-cache records.
pub(super) fn export_external_links(stores: &EngineStores) -> Vec<ExternalLink> {
    stores.storage.metadata.external_links.export()
}

pub(in crate::storage::engine) fn export_workbook_timeline_caches(
    stores: &EngineStores,
) -> Vec<ooxml_types::timelines::TimelineCacheDef> {
    let mut caches: Vec<_> = stores
        .storage
        .metadata
        .timelines
        .values()
        .filter_map(domain_types::domain::slicer::stored_timeline_to_cache_def)
        .collect();
    caches.sort_by(|left, right| left.name.cmp(&right.name));
    caches.dedup_by(|left, right| left.name == right.name);
    caches
}

/// Export parsed pivot tables from workbook-level pivotSpecs map and sheet-level
/// pivotTables maps using imported-pivot associations as the authority.
pub(in crate::storage::engine) fn export_workbook_parsed_pivot_tables(
    stores: &EngineStores,
    mirror: &CellMirror,
    default_pivot_style: Option<&str>,
) -> Vec<domain_types::domain::pivot::ParsedPivotTable> {
    let specs = read_workbook_pivot_specs(stores);
    let associations = crate::storage::workbook::imported_pivots::read_all(&stores.storage);
    let cache_sources_by_id = read_pivot_cache_sources(stores)
        .into_iter()
        .map(|source| (source.cache_id, source))
        .collect::<std::collections::HashMap<_, _>>();

    if associations.is_empty() {
        return export_workbook_parsed_pivot_tables_legacy_name_dedup(
            stores,
            mirror,
            default_pivot_style,
        );
    }

    let specs_by_key: std::collections::HashMap<String, ParsedPivotTable> = specs
        .into_iter()
        .map(|(key, _, parsed)| (key, parsed))
        .collect();

    let mut result = Vec::new();
    let mut associated_native_ids = std::collections::HashSet::new();
    for association in &associations {
        if let Some(native_pivot_id) = association.native_pivot_id.as_ref() {
            associated_native_ids.insert(native_pivot_id.clone());
        }

        match association.status {
            crate::storage::workbook::imported_pivots::ImportedPivotAssociationStatus::Deleted => {
                continue;
            }
            crate::storage::workbook::imported_pivots::ImportedPivotAssociationStatus::Unsupported => {
                if let Some(original) = specs_by_key.get(&association.pivot_spec_key) {
                    result.push(original.clone());
                }
            }
            crate::storage::workbook::imported_pivots::ImportedPivotAssociationStatus::Promoted => {
                let Some(original) = specs_by_key.get(&association.pivot_spec_key) else {
                    tracing::warn!(
                        import_identity = %association.import_identity,
                        pivot_spec_key = %association.pivot_spec_key,
                        "Promoted imported pivot association has no preservation spec; skipping export"
                    );
                    continue;
                };
                let Some(native_pivot_id) = association.native_pivot_id.as_deref() else {
                    tracing::warn!(
                        import_identity = %association.import_identity,
                        "Promoted imported pivot association has no nativePivotId; skipping export"
                    );
                    continue;
                };
                let Some(output_sheet_id) = association
                    .output_sheet_id
                    .as_deref()
                    .and_then(|value| SheetId::from_uuid_str(value).ok())
                else {
                    tracing::warn!(
                        import_identity = %association.import_identity,
                        "Promoted imported pivot association has no valid outputSheetId; skipping export"
                    );
                    continue;
                };
                let Some(live_config) = pivots::get_pivot(&stores.storage, &output_sheet_id, native_pivot_id) else {
                    tracing::warn!(
                        import_identity = %association.import_identity,
                        native_pivot_id = %native_pivot_id,
                        "Promoted imported pivot native config is missing; not resurrecting from preservation"
                    );
                    continue;
                };
                let (live_config, ooxml_preservation) =
                    reconcile_promoted_import_cache_for_export(
                        association,
                        original,
                        live_config,
                        &cache_sources_by_id,
                    );
                result.push(ParsedPivotTable {
                    config: project_live_pivot_export_metadata(
                        live_config,
                        &output_sheet_id,
                        mirror,
                        None,
                        false,
                    ),
                    initial_expansion_state: original.initial_expansion_state.clone(),
                    ooxml_preservation,
                });
            }
        }
    }

    let sheet_ids = stores.storage.sheet_order();
    for sheet_id in &sheet_ids {
        let mut sheet_pivots = pivots::get_all_pivots(&stores.storage, sheet_id);
        sheet_pivots.sort_by(|left, right| left.id.cmp(&right.id));
        for config in sheet_pivots {
            if associated_native_ids.contains(&config.id) {
                continue;
            }
            let config = project_live_pivot_export_metadata(
                config,
                sheet_id,
                mirror,
                default_pivot_style,
                true,
            );
            result.push(ParsedPivotTable {
                config,
                initial_expansion_state: None,
                ooxml_preservation: Default::default(),
            });
        }
    }

    result
}

fn export_workbook_parsed_pivot_tables_legacy_name_dedup(
    stores: &EngineStores,
    mirror: &CellMirror,
    default_pivot_style: Option<&str>,
) -> Vec<domain_types::domain::pivot::ParsedPivotTable> {
    // 1. Collect workbook-level parsed pivot tables (from XLSX import hydration).
    let mut result: Vec<ParsedPivotTable> = read_workbook_pivot_specs(stores)
        .into_iter()
        .map(|(_, _, parsed)| parsed)
        .collect();

    // 2. Collect sheet-level pivots (API-created) and merge with dedup.
    let existing_names: std::collections::HashSet<String> =
        result.iter().map(|pt| pt.config.name.clone()).collect();

    let sheet_ids = stores.storage.sheet_order();
    for sheet_id in &sheet_ids {
        let sheet_pivots = pivots::get_all_pivots(&stores.storage, sheet_id);
        for config in sheet_pivots {
            if existing_names.contains(&config.name) {
                continue; // Imported pivot — keep original workbook-level spec
            }
            let config = project_live_pivot_export_metadata(
                config,
                sheet_id,
                mirror,
                default_pivot_style,
                true,
            );
            result.push(ParsedPivotTable {
                config,
                initial_expansion_state: None,
                ooxml_preservation: Default::default(),
            });
        }
    }

    result
}

fn project_live_pivot_export_metadata(
    mut config: domain_types::domain::pivot::PivotTableConfig,
    storage_sheet_id: &SheetId,
    mirror: &CellMirror,
    default_pivot_style: Option<&str>,
    apply_default_style: bool,
) -> domain_types::domain::pivot::PivotTableConfig {
    let output_sheet_id = config
        .output_sheet_id
        .as_deref()
        .and_then(|value| SheetId::from_uuid_str(value).ok())
        .or_else(|| mirror.sheet_by_name(&config.output_sheet_name))
        .unwrap_or(*storage_sheet_id);
    if let Some(def) =
        mirror.find_pivot_table_def(&config.id, &config.name, &output_sheet_id.to_uuid_string())
        && !def.is_empty_rendered_region()
    {
        config.ref_range = Some(format!(
            "{}:{}",
            crate::range_manager::pos_to_a1(def.start_row, def.start_col),
            crate::range_manager::pos_to_a1(def.end_row, def.end_col),
        ));
        config.first_data_row = Some(def.first_data_row);
        config.first_data_col = Some(def.first_data_col);
    }

    if apply_default_style && config.style.is_none() {
        config.style = Some(domain_types::domain::pivot::PivotTableStyle {
            style_name: Some(
                default_pivot_style
                    .unwrap_or("PivotStyleLight16")
                    .to_string(),
            ),
            show_row_headers: Some(true),
            show_column_headers: Some(true),
            show_row_stripes: Some(false),
            show_column_stripes: Some(false),
            show_last_column: Some(true),
        });
    }

    config
}

fn read_workbook_pivot_specs(stores: &EngineStores) -> Vec<(String, u32, ParsedPivotTable)> {
    crate::storage::workbook::imported_pivots::read_pivot_specs(&stores.storage)
}
