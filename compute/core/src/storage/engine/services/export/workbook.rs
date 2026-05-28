//! Workbook-level export functions.
//!
//! Extracted from `export.rs` — theme, protection, document properties,
//! workbook properties, file version, file sharing, slicer caches, and
//! parsed pivot tables.

use cell_types::SheetId;
use compute_document::hex::hex_to_id;
use compute_document::schema::*;
use compute_document::workbook_metadata::{
    read_imported_external_cache_records, read_workbook_link_records,
};
use domain_types::{
    NamedRange, PersonInfo,
    domain::external_link::ExternalLink,
    domain::theme::ThemeData,
    domain::workbook::{CalculationProperties, RefMode, WorkbookProtection, WorkbookView},
    yrs_schema,
};
use yrs::{Any, Map, Out, Transact};

use crate::mirror::CellMirror;
use crate::snapshot::{CalcMode, CalculationSettings};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::pivots;
use crate::storage::workbook::{
    named_ranges as workbook_named_ranges, settings as workbook_settings,
};

// -------------------------------------------------------------------
// Workbook-level exports
// -------------------------------------------------------------------

/// Export theme data from the workbook-level theme map.
pub(in crate::storage::engine) fn export_workbook_theme(
    stores: &EngineStores,
) -> Option<ThemeData> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let theme_map = match workbook.get(&txn, KEY_THEME) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let json_str = match theme_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return None,
    };

    if let Ok(theme) = serde_json::from_str::<ThemeData>(&json_str)
        && (!theme.colors.is_empty()
            || theme.major_font.is_some()
            || theme.minor_font.is_some()
            || theme.name.is_some()
            || theme.color_scheme.is_some()
            || theme.font_scheme.is_some()
            || theme.format_scheme.is_some()
            || theme.object_defaults_xml.is_some()
            || theme.extra_clr_scheme_lst_xml.is_some()
            || theme.ext_lst_xml.is_some())
    {
        return Some(theme);
    }

    // Fallback: internal format uses "color_palette" instead of "colors"
    #[derive(serde::Deserialize)]
    struct InternalTheme {
        #[serde(default)]
        color_palette: Vec<domain_types::domain::theme::ThemeColor>,
        major_font: Option<String>,
        minor_font: Option<String>,
    }

    if let Ok(internal) = serde_json::from_str::<InternalTheme>(&json_str)
        && (!internal.color_palette.is_empty()
            || internal.major_font.is_some()
            || internal.minor_font.is_some())
    {
        return Some(ThemeData {
            colors: internal.color_palette,
            major_font: internal.major_font,
            minor_font: internal.minor_font,
            name: None,
            ..ThemeData::default()
        });
    }

    None
}

/// Export workbook protection from the workbook settings map.
pub(in crate::storage::engine) fn export_workbook_protection(
    stores: &EngineStores,
) -> Option<WorkbookProtection> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let prot_map = match settings_map.get(&txn, "protection") {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    yrs_schema::protection::workbook_from_yrs_map(&prot_map, &txn)
}

/// Export document properties from the workbook-level `documentProperties` Y.Map.
pub(super) fn export_document_properties(
    stores: &EngineStores,
) -> Option<domain_types::DocumentProperties> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let props_map = match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let props = yrs_schema::doc_properties::from_yrs_map(&props_map, &txn);
    // Return None if completely empty (no fields set) to match pre-hydration behavior
    if props == domain_types::DocumentProperties::default() {
        None
    } else {
        Some(props)
    }
}

pub(super) fn export_xlsx_metadata(
    stores: &EngineStores,
) -> Option<domain_types::WorkbookMetadata> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let metadata_map = match workbook.get(&txn, KEY_XLSX_METADATA) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let json_str = match metadata_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return None,
    };

    serde_json::from_str::<domain_types::WorkbookMetadata>(&json_str)
        .ok()
        .filter(|metadata| !metadata.is_empty())
}

pub(super) fn export_shared_string_hints(
    stores: &EngineStores,
) -> Vec<domain_types::SharedStringHint> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let hints_map = match workbook.get(&txn, KEY_SHARED_STRING_HINTS) {
        Some(Out::YMap(m)) => m,
        _ => return Vec::new(),
    };

    let json_str = match hints_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return Vec::new(),
    };

    serde_json::from_str::<Vec<domain_types::SharedStringHint>>(&json_str).unwrap_or_default()
}

pub(super) fn export_pivot_cache_records(
    stores: &EngineStores,
) -> domain_types::yrs_schema::pivot_cache_records::PivotCacheRecords {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let records_map = match workbook.get(&txn, KEY_PIVOT_CACHE_RECORDS) {
        Some(Out::YMap(m)) => m,
        _ => return Default::default(),
    };

    yrs_schema::pivot_cache_records::from_yrs_map(&records_map, &txn)
}

pub(super) fn export_extended_document_properties(
    stores: &EngineStores,
) -> Option<ooxml_types::doc_props::ExtendedProperties> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let props_map = match workbook.get(&txn, KEY_EXTENDED_DOCUMENT_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let json_str = match props_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return None,
    };

    serde_json::from_str::<ooxml_types::doc_props::ExtendedProperties>(&json_str).ok()
}

/// Export calculation settings from modeled workbook storage.
///
pub(super) fn export_calculation_properties(stores: &EngineStores) -> CalculationProperties {
    let settings = workbook_settings::get_calculation_settings(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    );
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

/// Export all modeled defined names from Yrs storage.
///
/// Hidden names are included here because they are workbook state, not UI query
/// output. Unsupported or opaque references must be present in
/// `DefinedName.raw_refers_to`; stale `RoundTripContext` skipped-name lists are
/// intentionally not consulted.
pub(super) fn export_workbook_named_ranges(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_ids: &[SheetId],
) -> Vec<NamedRange> {
    workbook_named_ranges::get_all_named_ranges(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
    .into_iter()
    .filter_map(|dn| {
        let local_sheet_id = dn.scope.as_ref().and_then(|scope_hex| {
            let raw = hex_to_id(scope_hex)?;
            let scope_sid = SheetId::from_raw(raw);
            sheet_ids
                .iter()
                .position(|sid| *sid == scope_sid)
                .map(|i| i as u32)
        });

        let refers_to = if let Some(raw_refers_to) = dn.raw_refers_to.clone() {
            raw_refers_to
        } else {
            let identity = match serde_json::from_str::<formula_types::IdentityFormula>(&dn.refers_to) {
                Ok(id) => id,
                Err(e) => {
                    tracing::warn!(
                        name = %dn.name,
                        error = %e,
                        "Yrs DefinedName.refers_to is not a valid IdentityFormula JSON and has no raw_refers_to; \
                         omitting from XLSX export. Typed formula boundary: made IdentityFormula JSON \
                         the single canonical on-disk format."
                    );
                    return None;
                }
            };

            if identity.refs.is_empty() {
                identity.template
            } else {
                let a1 = stores.compute.to_a1_display_qualified(
                    mirror,
                    &SheetId::from_raw(0),
                    &identity,
                );
                let a1 = a1.strip_prefix('=').unwrap_or(&a1);
                if a1.is_empty() {
                    dn.refers_to.clone()
                } else {
                    a1.to_string()
                }
            }
        };

        Some(NamedRange {
            name: dn.name,
            refers_to,
            local_sheet_id,
            hidden: !dn.visible,
            comment: dn.comment,
            custom_menu: dn.custom_menu,
            description: dn.description,
            help: dn.help,
            status_bar: dn.status_bar,
            xlm: dn.xlm,
            function: dn.function,
            vb_procedure: dn.vb_procedure,
            publish_to_server: dn.publish_to_server,
            workbook_parameter: dn.workbook_parameter,
            xml_space_preserve: dn.xml_space_preserve,
        })
    })
    .collect()
}

/// Export workbook properties from the `workbookSettings` Y.Map.
pub(super) fn export_workbook_properties(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::WorkbookProperties> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    // Only return Some if at least one workbook property key is present
    // (check for the date1904 key as a sentinel — it's always written during hydration)
    settings_map.get(&txn, "date1904")?;

    Some(yrs_schema::workbook_properties::from_yrs_map(
        &settings_map,
        &txn,
    ))
}

/// Export workbook views from the `workbookSettings` Y.Map.
pub(super) fn export_workbook_views(stores: &EngineStores) -> Vec<WorkbookView> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return Vec::new(),
    };

    let Some(Out::Any(Any::String(json))) = settings_map.get(&txn, "workbookViews") else {
        return Vec::new();
    };

    serde_json::from_str::<Vec<WorkbookView>>(&json).unwrap_or_default()
}

/// Export workbook-level threaded comment person identities.
pub(in crate::storage::engine) fn export_workbook_threaded_comment_persons(
    stores: &EngineStores,
) -> Vec<PersonInfo> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let persons_map = match workbook.get(&txn, KEY_THREADED_COMMENT_PERSONS) {
        Some(Out::YMap(m)) => m,
        _ => return Vec::new(),
    };

    let mut persons = Vec::new();
    for (_, value) in persons_map.iter(&txn) {
        if let Out::Any(Any::String(json)) = value {
            match serde_json::from_str::<PersonInfo>(&json) {
                Ok(person) => persons.push(person),
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to deserialize threaded comment person during export, skipping entry"
                    );
                }
            }
        }
    }
    persons.sort_by(|a, b| a.id.cmp(&b.id));
    persons
}

/// Export file version from the workbook-level `fileVersion` Y.Map.
pub(super) fn export_file_version(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::FileVersion> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let fv_map = match workbook.get(&txn, KEY_FILE_VERSION) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let fv = yrs_schema::file_version::from_yrs_map(&fv_map, &txn);
    if fv == domain_types::domain::workbook::FileVersion::default() {
        None
    } else {
        Some(fv)
    }
}

/// Export file sharing from the workbook-level `fileSharing` Y.Map.
pub(super) fn export_file_sharing(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::FileSharing> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let fs_map = match workbook.get(&txn, KEY_FILE_SHARING) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let fs = yrs_schema::file_sharing::from_yrs_map(&fs_map, &txn);
    if fs == domain_types::domain::workbook::FileSharing::default() {
        None
    } else {
        Some(fs)
    }
}

/// Export workbook external links from workbook-owned imported-cache records.
///
/// The original parser `RoundTripContext.external_links` is import input only.
/// Once hydrated, the workbook link registry and imported cache map own the
/// current external-link export set.
pub(super) fn export_external_links(stores: &EngineStores) -> Vec<ExternalLink> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let live_link_ids: rustc_hash::FxHashSet<_> = read_workbook_link_records(&txn, workbook)
        .unwrap_or_default()
        .into_iter()
        .map(|record| record.link_id)
        .collect();

    let mut links: Vec<ExternalLink> = read_imported_external_cache_records(&txn, workbook)
        .unwrap_or_default()
        .into_iter()
        .filter(|record| live_link_ids.contains(&record.link_id))
        .filter(|record| {
            record.payload_kind == "domain-types.external-link" && record.payload_version == 1
        })
        .filter_map(|record| serde_json::from_str::<ExternalLink>(&record.payload_json).ok())
        .collect();

    links.sort_by_key(|link| {
        link.imported_identity
            .as_ref()
            .map(|identity| identity.excel_ordinal)
            .unwrap_or(u32::MAX)
    });
    links
}

/// Export slicer caches from the workbook-level slicers map.
pub(in crate::storage::engine) fn export_workbook_slicer_caches(
    stores: &EngineStores,
) -> Vec<ooxml_types::slicers::SlicerCacheDef> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    let mut caches = Vec::new();
    for (_, value) in slicers_map.iter(&txn) {
        if let Out::Any(Any::String(json_str)) = value {
            if let Ok(stored) =
                serde_json::from_str::<domain_types::domain::slicer::StoredSlicer>(&json_str)
            {
                caches.push(domain_types::domain::slicer::stored_slicer_to_cache_def(
                    &stored,
                ));
                continue;
            }
            match serde_json::from_str::<ooxml_types::slicers::SlicerCacheDef>(&json_str) {
                Ok(cache_def) => caches.push(cache_def),
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to deserialize slicer entry during export, skipping"
                    );
                }
            }
        }
    }
    caches
}

/// Export parsed pivot tables from workbook-level pivotSpecs map AND sheet-level
/// pivotTables maps.
///
/// Workbook-level specs (from XLSX import) take priority: if a pivot name already
/// exists in the workbook-level set, the sheet-level entry is skipped. This
/// preserves OOXML-specific metadata (styles, custom sorts, number formats) for
/// imported pivots that would be lost in a round-trip through `PivotTableConfig`.
pub(in crate::storage::engine) fn export_workbook_parsed_pivot_tables(
    stores: &EngineStores,
) -> Vec<domain_types::domain::pivot::ParsedPivotTable> {
    use domain_types::domain::pivot::ParsedPivotTable;

    let doc = stores.storage.doc();
    let sheets_ref = stores.storage.sheets();

    // 1. Collect workbook-level parsed pivot tables (from XLSX import hydration).
    let mut result: Vec<ParsedPivotTable> = Vec::new();
    {
        let txn = doc.transact();
        let workbook = stores.storage.workbook_map();
        if let Some(Out::YMap(pivot_map)) = workbook.get(&txn, KEY_PIVOT_SPECS) {
            for (_, value) in pivot_map.iter(&txn) {
                if let Out::Any(Any::String(json_str)) = value {
                    match serde_json::from_str::<ParsedPivotTable>(&json_str) {
                        Ok(pt) => result.push(pt),
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                "Failed to deserialize ParsedPivotTable during export, skipping entry"
                            );
                        }
                    }
                }
            }
        }
    }

    // 2. Collect sheet-level pivots (API-created) and merge with dedup.
    let existing_names: std::collections::HashSet<String> =
        result.iter().map(|pt| pt.config.name.clone()).collect();

    let sheet_ids = stores.storage.sheet_order();
    for sheet_id in &sheet_ids {
        let sheet_pivots = pivots::get_all_pivots(doc, sheets_ref, sheet_id);
        for config in sheet_pivots {
            if existing_names.contains(&config.name) {
                continue; // Imported pivot — keep original workbook-level spec
            }
            result.push(ParsedPivotTable {
                config,
                initial_expansion_state: None,
            });
        }
    }

    result
}
