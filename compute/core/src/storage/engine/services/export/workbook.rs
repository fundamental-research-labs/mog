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
    CellFormat, DocumentFormat, NamedRange, PersonInfo,
    domain::external_link::ExternalLink,
    domain::theme::ThemeData,
    domain::workbook::{
        CalculationProperties, RefMode, WorkbookProtection, WorkbookView, WorkbookWebPublishing,
    },
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

const KEY_STYLE_REGISTRY_NUMBER_FORMATS: &str = "numberFormats";
const KEY_STYLE_REGISTRY_FONTS: &str = "fonts";
const KEY_STYLE_REGISTRY_FILLS: &str = "fills";
const KEY_STYLE_REGISTRY_BORDERS: &str = "borders";
const KEY_STYLE_REGISTRY_CELL_STYLE_XFS: &str = "cellStyleXfs";
const KEY_STYLE_REGISTRY_CELL_XFS: &str = "cellXfs";
const KEY_STYLE_REGISTRY_NAMED_CELL_STYLES: &str = "namedCellStyles";
const KEY_STYLE_REGISTRY_DXFS: &str = "differentialFormats";
const KEY_STYLE_REGISTRY_TABLE_STYLES: &str = "tableStyles";
const KEY_THREADED_COMMENT_PERSON_ORDER: &str = "threadedCommentPersonOrder";
const KEY_STYLE_REGISTRY_INDEXED_COLORS: &str = "indexedColors";
const KEY_STYLE_REGISTRY_DEFAULT_TABLE_STYLE: &str = "defaultTableStyle";
const KEY_STYLE_REGISTRY_DEFAULT_PIVOT_STYLE: &str = "defaultPivotStyle";
const KEY_STYLE_REGISTRY_KNOWN_FONTS: &str = "knownFonts";
const KEY_STYLE_REGISTRY_ROOT_NAMESPACE_ATTRS: &str = "rootNamespaceAttrs";
const KEY_STYLE_REGISTRY_ROOT_MCE_ATTRIBUTES: &str = "rootMceAttributes";
const KEY_STYLE_REGISTRY_EXT_LST_XML: &str = "extLstXml";
const KEY_STYLE_REGISTRY_COUNT: &str = "count";
const KEY_VOLATILE_DEPENDENCY_PACKAGE_PART: &str = "volatileDependencyPackagePart";
const KEY_CUSTOM_WORKBOOK_VIEWS_XML: &str = "customWorkbookViewsXml";

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

pub(super) fn export_package_fidelity_metadata(
    stores: &EngineStores,
) -> Option<domain_types::PackageFidelityMetadata> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let fidelity_map = match workbook.get(&txn, KEY_PACKAGE_FIDELITY_METADATA) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let json_str = match fidelity_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return None,
    };

    serde_json::from_str::<domain_types::PackageFidelityMetadata>(&json_str)
        .ok()
        .filter(|metadata| !metadata.is_empty())
}

pub(super) fn export_volatile_dependency_part(
    stores: &EngineStores,
) -> Option<domain_types::VolatileDependencyPackagePart> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let part_map = match workbook.get(&txn, KEY_VOLATILE_DEPENDENCY_PACKAGE_PART) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let json_str = match part_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return None,
    };

    serde_json::from_str::<domain_types::VolatileDependencyPackagePart>(&json_str)
        .ok()
        .filter(|part| !part.bytes.is_empty())
}

pub(super) fn export_workbook_connections(
    stores: &EngineStores,
) -> domain_types::domain::connections::WorkbookConnectionSet {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let connections_map = match workbook.get(&txn, KEY_WORKBOOK_CONNECTIONS) {
        Some(Out::YMap(m)) => m,
        _ => return Default::default(),
    };

    let json_str = match connections_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return Default::default(),
    };

    serde_json::from_str::<domain_types::domain::connections::WorkbookConnectionSet>(&json_str)
        .unwrap_or_default()
}

pub(super) fn export_workbook_stylesheet(
    stores: &EngineStores,
) -> Option<domain_types::WorkbookStylesheet> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    match workbook.get(&txn, KEY_WORKBOOK_STYLESHEET) {
        Some(Out::Any(Any::String(json))) => {
            serde_json::from_str::<domain_types::WorkbookStylesheet>(&json)
                .ok()
                .map(|stylesheet| stylesheet.normalized())
        }
        Some(Out::YMap(map)) => Some(domain_types::WorkbookStylesheet {
            number_formats: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_NUMBER_FORMATS),
            fonts: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_FONTS),
            fills: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_FILLS),
            borders: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_BORDERS),
            cell_style_xfs: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_CELL_STYLE_XFS),
            cell_xfs: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_CELL_XFS),
            named_cell_styles: read_style_registry_vec(
                &txn,
                &map,
                KEY_STYLE_REGISTRY_NAMED_CELL_STYLES,
            ),
            differential_formats: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_DXFS),
            table_styles: read_style_registry_vec(&txn, &map, KEY_STYLE_REGISTRY_TABLE_STYLES),
            indexed_colors: read_style_registry_value(
                &txn,
                &map,
                KEY_STYLE_REGISTRY_INDEXED_COLORS,
            ),
            default_table_style: read_style_registry_value(
                &txn,
                &map,
                KEY_STYLE_REGISTRY_DEFAULT_TABLE_STYLE,
            ),
            default_pivot_style: read_style_registry_value(
                &txn,
                &map,
                KEY_STYLE_REGISTRY_DEFAULT_PIVOT_STYLE,
            ),
            known_fonts: matches!(
                map.get(&txn, KEY_STYLE_REGISTRY_KNOWN_FONTS),
                Some(Out::Any(Any::Bool(true)))
            ),
            root_namespace_attrs: read_style_registry_vec(
                &txn,
                &map,
                KEY_STYLE_REGISTRY_ROOT_NAMESPACE_ATTRS,
            ),
            root_mce_attributes: read_style_registry_value(
                &txn,
                &map,
                KEY_STYLE_REGISTRY_ROOT_MCE_ATTRIBUTES,
            )
            .unwrap_or_default(),
            ext_lst_xml: read_style_registry_value(&txn, &map, KEY_STYLE_REGISTRY_EXT_LST_XML),
            dxf_registry: export_dxf_registry_from_txn(&txn, &workbook),
            stylesheet: ooxml_types::styles::Stylesheet::default(),
        }),
        _ => None,
    }
}

pub(super) fn export_workbook_style_palette(stores: &EngineStores) -> Vec<DocumentFormat> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let palette_map = match workbook.get(&txn, KEY_STYLE_PALETTE) {
        Some(Out::YMap(map)) => map,
        _ => return Vec::new(),
    };

    let mut values = Vec::new();
    for index in 0..palette_map.len(&txn) {
        let Some(Out::Any(Any::String(json))) = palette_map.get(&txn, &*index.to_string()) else {
            continue;
        };
        let Ok(cell_format) = serde_json::from_str::<CellFormat>(&json) else {
            continue;
        };
        values.push(DocumentFormat::from(&cell_format));
    }
    values
}

fn export_dxf_registry_from_txn(
    txn: &yrs::Transaction,
    workbook: &yrs::MapRef,
) -> Vec<domain_types::DxfDef> {
    let map = match workbook.get(txn, KEY_DXF_REGISTRY) {
        Some(Out::YMap(map)) => map,
        _ => return Vec::new(),
    };

    let mut entries = Vec::new();
    for entry in map.iter(txn) {
        let (key, value) = entry;
        if key == KEY_STYLE_REGISTRY_COUNT {
            continue;
        }
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        if let Ok(dxf) = serde_json::from_str::<domain_types::DxfDef>(&json) {
            entries.push(dxf);
        }
    }
    entries.sort_by_key(|dxf| dxf.id);
    entries
}

fn read_style_registry_vec<T: for<'de> serde::Deserialize<'de>>(
    txn: &yrs::Transaction,
    parent: &yrs::MapRef,
    key: &str,
) -> Vec<T> {
    let map = match parent.get(txn, key) {
        Some(Out::YMap(map)) => map,
        _ => return Vec::new(),
    };

    let count = match map.get(txn, KEY_STYLE_REGISTRY_COUNT) {
        Some(Out::Any(Any::Number(count))) if count.is_finite() && count > 0.0 => count as usize,
        _ => 0,
    };
    let mut values = Vec::with_capacity(count);
    for index in 0..count {
        let Some(Out::Any(Any::String(json))) = map.get(txn, &*index.to_string()) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<T>(&json) {
            values.push(value);
        }
    }
    values
}

fn read_style_registry_value<T: for<'de> serde::Deserialize<'de>>(
    txn: &yrs::Transaction,
    parent: &yrs::MapRef,
    key: &str,
) -> Option<T> {
    let json = match parent.get(txn, key) {
        Some(Out::Any(Any::String(json))) => json,
        _ => return None,
    };
    serde_json::from_str::<T>(&json).ok()
}

pub(super) fn export_workbook_table_styles(
    stores: &EngineStores,
) -> (
    Vec<ooxml_types::styles::TableStyleDef>,
    Option<String>,
    Option<String>,
) {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let mut styles = Vec::<ooxml_types::styles::TableStyleDef>::new();
    let mut default_table_style = None;
    let mut default_pivot_style = None;

    if let Some(Out::YMap(styles_map)) = workbook.get(&txn, KEY_XLSX_TABLE_STYLES) {
        if let Some(Out::Any(Any::String(json))) = styles_map.get(&txn, "styles") {
            styles = serde_json::from_str::<Vec<ooxml_types::styles::TableStyleDef>>(&json)
                .unwrap_or_default();
        }
        if let Some(Out::Any(Any::String(value))) = styles_map.get(&txn, "defaultTableStyle") {
            default_table_style = Some(value.to_string());
        }
        if let Some(Out::Any(Any::String(value))) = styles_map.get(&txn, "defaultPivotStyle") {
            default_pivot_style = Some(value.to_string());
        }
    }

    let mut existing_names: std::collections::HashSet<String> = styles
        .iter()
        .map(|style| style.name.to_lowercase())
        .collect();
    for style in stores.custom_table_styles.values() {
        if existing_names.insert(style.name.to_lowercase()) {
            styles.push(ooxml_types::styles::TableStyleDef {
                name: style.name.clone(),
                pivot: Some(false),
                table: Some(true),
                count: Some(0),
                elements: Vec::new(),
                xr_uid: None,
            });
        }
    }
    styles.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    (styles, default_table_style, default_pivot_style)
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

pub(super) fn export_pivot_cache_sources(
    stores: &EngineStores,
) -> Vec<domain_types::domain::pivot::PivotCacheSourceDef> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let sources_map = match workbook.get(&txn, KEY_PIVOT_CACHE_SOURCES) {
        Some(Out::YMap(m)) => m,
        _ => return Default::default(),
    };

    yrs_schema::pivot_cache_records::sources_from_yrs_map(&sources_map, &txn)
}

pub(super) fn export_extended_document_properties(
    stores: &EngineStores,
) -> Option<domain_types::ExtendedDocumentProperties> {
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

    serde_json::from_str::<domain_types::ExtendedDocumentProperties>(&json_str).ok()
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
/// `DefinedName.raw_refers_to`.
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
            function_group_id: None,
            shortcut_key: None,
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

pub(super) fn export_workbook_root_namespaces(
    stores: &EngineStores,
) -> domain_types::XmlNamespaceDeclarations {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return Default::default(),
    };

    let Some(Out::Any(Any::String(json))) = settings_map.get(&txn, "workbookRootNamespaces") else {
        return Default::default();
    };

    serde_json::from_str::<domain_types::XmlNamespaceDeclarations>(&json).unwrap_or_default()
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

pub(super) fn export_custom_workbook_views_xml(stores: &EngineStores) -> Option<Vec<u8>> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let Some(Out::Any(Any::String(json))) = settings_map.get(&txn, KEY_CUSTOM_WORKBOOK_VIEWS_XML)
    else {
        return None;
    };

    serde_json::from_str::<Vec<u8>>(&json).ok()
}

/// Export workbook web publishing metadata from the workbook-level Y.Map.
pub(super) fn export_workbook_web_publishing(
    stores: &EngineStores,
) -> Option<WorkbookWebPublishing> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let web_map = match workbook.get(&txn, KEY_WEB_PUBLISHING) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let web_publishing = yrs_schema::web_publishing::from_yrs_map(&web_map, &txn);
    if web_publishing == WorkbookWebPublishing::default() {
        None
    } else {
        Some(web_publishing)
    }
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
    let imported_order = workbook
        .get(&txn, KEY_THREADED_COMMENT_PERSON_ORDER)
        .and_then(|value| match value {
            Out::Any(Any::String(json)) => serde_json::from_str::<Vec<String>>(&json).ok(),
            _ => None,
        })
        .unwrap_or_default();
    let imported_rank: std::collections::HashMap<&str, usize> = imported_order
        .iter()
        .enumerate()
        .map(|(idx, id)| (id.as_str(), idx))
        .collect();
    persons.sort_by(|a, b| {
        imported_rank
            .get(a.id.as_str())
            .copied()
            .unwrap_or(usize::MAX)
            .cmp(
                &imported_rank
                    .get(b.id.as_str())
                    .copied()
                    .unwrap_or(usize::MAX),
            )
            .then_with(|| a.id.cmp(&b.id))
    });
    persons
}

pub(in crate::storage::engine) fn export_workbook_threaded_comment_persons_part_present(
    stores: &EngineStores,
) -> bool {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    matches!(
        workbook.get(&txn, KEY_THREADED_COMMENT_PERSONS_PART_PRESENT),
        Some(Out::Any(Any::Bool(true)))
    )
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

pub(in crate::storage::engine) fn export_workbook_timeline_caches(
    stores: &EngineStores,
) -> Vec<ooxml_types::timelines::TimelineCacheDef> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let timelines_map = match workbook.get(&txn, KEY_TIMELINES) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    let mut caches = Vec::new();
    for (_, value) in timelines_map.iter(&txn) {
        if let Out::Any(Any::String(json_str)) = value
            && let Ok(stored) =
                serde_json::from_str::<domain_types::domain::slicer::StoredTimeline>(&json_str)
            && let Some(cache) = domain_types::domain::slicer::stored_timeline_to_cache_def(&stored)
        {
            caches.push(cache);
        }
    }
    caches.sort_by(|left, right| left.name.cmp(&right.name));
    caches.dedup_by(|left, right| left.name == right.name);
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
            let mut entries: Vec<_> = pivot_map.iter(&txn).collect();
            entries.sort_by(|(left, _), (right, _)| {
                pivot_spec_order_key(left.as_ref()).cmp(&pivot_spec_order_key(right.as_ref()))
            });
            for (_, value) in entries {
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
                ooxml_preservation: Default::default(),
            });
        }
    }

    result
}

fn pivot_spec_order_key(key: &str) -> (u32, &str) {
    key.rsplit_once('_')
        .and_then(|(prefix, suffix)| suffix.parse::<u32>().ok().map(|idx| (idx, prefix)))
        .unwrap_or((u32::MAX, key))
}
