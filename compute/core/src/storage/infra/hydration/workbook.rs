use std::sync::Arc;

use yrs::{Any, Map, MapPrelim, MapRef};

use domain_types::SheetData;
use domain_types::yrs_schema;

use compute_document::hex::id_to_hex;
use compute_document::schema::*;

use cell_types::SheetId;

use super::IdAllocator;

const KEY_VOLATILE_DEPENDENCY_PACKAGE_PART: &str = "volatileDependencyPackagePart";
const KEY_CUSTOM_WORKBOOK_VIEWS_XML: &str = "customWorkbookViewsXml";
const KEY_THREADED_COMMENT_PERSON_ORDER: &str = "threadedCommentPersonOrder";

// ===========================================================================
// Workbook-level hydration
// ===========================================================================

/// Hydrate named ranges into the workbook-level namedRanges map using
/// structured Y.Map entries via `yrs_schema::named_range`.
///
/// Converts parser `NamedRange` (position-keyed, `local_sheet_id` index)
/// into structured entries with allocated IDs and resolved sheet scope.
pub(super) fn hydrate_workbook_named_ranges(
    workbook: &MapRef,
    named_ranges: &[domain_types::NamedRange],
    sheet_ids: &[SheetId],
    allocator: &mut impl IdAllocator,
    txn: &mut yrs::TransactionMut,
) {
    if named_ranges.is_empty() {
        return;
    }
    // Provider Protocol lifecycle: lazy-create the named-ranges sub-map. Replaces the
    // pre-fix dependency on the eager bulk-insert at `from_snapshot` time.
    let nr_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_NAMED_RANGES);
    // Store defined names in Yrs — including hidden ones (e.g. _xlnm._FilterDatabase,
    // _xlchart.v*) and workbook-scoped broken names — so they survive the L2
    // round-trip. API/UI consumers can filter stale names at query boundaries;
    // hydration must preserve workbook state for export fidelity.
    for (idx, nr) in named_ranges.iter().enumerate() {
        // Resolve local_sheet_id (index) to a SheetId hex string for scope
        let scope: Option<String> = nr.local_sheet_id.and_then(|idx| {
            sheet_ids
                .get(idx as usize)
                .map(|sid| id_to_hex(sid.as_u128()).to_string())
        });

        // Generate a unique ID for this defined name (reuse cell ID allocator for
        // monotonic uniqueness — the ID just needs to be a unique hex string)
        let id = id_to_hex(allocator.alloc_cell_id().as_u128()).to_string();

        let raw_refers_to =
            if nr.hidden || should_preserve_defined_name_ref_opaque(&nr.name, &nr.refers_to) {
                Some(nr.refers_to.clone())
            } else {
                None
            };

        let defined_name = domain_types::DefinedName {
            id,
            name: nr.name.clone(),
            refers_to: nr.refers_to.clone(),
            raw_refers_to,
            scope: scope.clone(),
            comment: nr.comment.clone(),
            custom_menu: nr.custom_menu.clone(),
            description: nr.description.clone(),
            help: nr.help.clone(),
            status_bar: nr.status_bar.clone(),
            visible: !nr.hidden,
            order: Some(idx as u32),
            xlm: nr.xlm,
            function: nr.function,
            vb_procedure: nr.vb_procedure,
            publish_to_server: nr.publish_to_server,
            workbook_parameter: nr.workbook_parameter,
            xml_space_preserve: nr.xml_space_preserve,
            linked_range_id: None,
        };

        // Use the same key format as the named_ranges storage module
        let key = match &scope {
            Some(sheet_id) => format!("{}:{}", nr.name.to_uppercase(), sheet_id),
            None => nr.name.to_uppercase(),
        };

        let entries = yrs_schema::named_range::to_yrs_prelim(&defined_name);
        let prelim: MapPrelim = entries.into_iter().collect();
        nr_map.insert(txn, &*key, prelim);
    }
}

fn should_preserve_defined_name_ref_opaque(name: &str, refers_to: &str) -> bool {
    is_external_workbook_ref(refers_to)
        || name.eq_ignore_ascii_case("_xlnm._FilterDatabase")
        || matches!(
            compute_parser::ParsedExpr::classify(refers_to),
            compute_parser::ParsedExpr::BrokenRef { .. } | compute_parser::ParsedExpr::Empty
        )
}

fn is_external_workbook_ref(refers_to: &str) -> bool {
    let Some(close_bracket) = refers_to.find(']') else {
        return false;
    };
    let (before_close, after_close) = refers_to.split_at(close_bracket);
    before_close.contains('[') && after_close.contains('!')
}

#[cfg(test)]
mod tests {
    use super::{hydrate_workbook_views, should_preserve_defined_name_ref_opaque};
    use crate::storage::YrsStorage;
    use crate::storage::workbook::settings::get_settings;
    use cell_types::SheetId;
    use yrs::Transact;

    #[test]
    fn preserves_external_workbook_defined_names_as_opaque() {
        assert!(should_preserve_defined_name_ref_opaque(
            "Col_matrix",
            "'[Book.xlsx]Estimate Summary'!$D$44:$H$44"
        ));
    }

    #[test]
    fn preserves_autofilter_defined_names_as_opaque_metadata() {
        assert!(should_preserve_defined_name_ref_opaque(
            "_xlnm._FilterDatabase",
            "Sheet1!$A$5:$O$2451"
        ));
    }

    #[test]
    fn preserves_broken_defined_names_as_opaque_metadata() {
        assert!(should_preserve_defined_name_ref_opaque(
            "Pipeline",
            "Valuation!#REF!"
        ));
    }

    #[test]
    fn normal_user_defined_names_stay_structural() {
        assert!(!should_preserve_defined_name_ref_opaque(
            "SalesData",
            "Sheet1!$A$1:$B$10"
        ));
    }

    #[test]
    fn hydrate_workbook_views_seeds_selected_sheet_id_from_active_tab() {
        let storage = YrsStorage::new();
        let sheet_ids = [SheetId::from_raw(1), SheetId::from_raw(2)];
        let workbook_views = [domain_types::domain::workbook::WorkbookView {
            active_tab: 1,
            ..Default::default()
        }];

        {
            let mut txn = storage.doc().transact_mut();
            hydrate_workbook_views(
                storage.workbook_map(),
                &workbook_views,
                &sheet_ids,
                &mut txn,
            );
        }

        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert_eq!(
            settings.selected_sheet_ids,
            Some(vec![sheet_ids[1].to_uuid_string()])
        );
    }
}

/// Hydrate table definitions using structured Y.Map entries via `yrs_schema::table`.
///
/// Each table is paired with its sheet ID hex string so that canonical keys
/// (`sheetId`, `startRow`, `startCol`, `endRow`, `endCol`) are written alongside
/// the OOXML keys — enabling `from_yrs_map_to_table` to read hydrated tables.
pub(super) fn hydrate_workbook_tables(
    workbook: &MapRef,
    tables: &[(domain_types::domain::table::TableSpec, String)],
    txn: &mut yrs::TransactionMut,
) {
    if tables.is_empty() {
        return;
    }
    // Provider Protocol lifecycle: lazy-create the tables sub-map.
    let tables_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_TABLES);
    for (table, sheet_id) in tables {
        let mut entries = yrs_schema::table::to_yrs_prelim(table);

        // Add canonical-specific keys for from_yrs_map_to_table compatibility
        entries.push(("sheetId", Any::String(Arc::from(sheet_id.as_str()))));

        // Parse range_ref and add structured range keys
        if let Some((sr, sc, er, ec)) =
            domain_types::domain::table::parse_table_range_ref(&table.range_ref)
        {
            entries.push(("startRow", Any::Number(sr as f64)));
            entries.push(("startCol", Any::Number(sc as f64)));
            entries.push(("endRow", Any::Number(er as f64)));
            entries.push(("endCol", Any::Number(ec as f64)));
        }

        let table_prelim: MapPrelim = entries.into_iter().collect();
        tables_map.insert(txn, &*table.name, table_prelim);
    }
}

pub(super) fn hydrate_workbook_connections(
    workbook: &MapRef,
    connections: &domain_types::domain::connections::WorkbookConnectionSet,
    txn: &mut yrs::TransactionMut,
) {
    if connections.is_empty() {
        return;
    }
    let Some(json) = serde_json::to_string(connections).ok() else {
        return;
    };
    let map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_CONNECTIONS);
    map.insert(txn, "data", Any::String(Arc::from(json.as_str())));
}

pub(super) fn hydrate_workbook_root_namespaces(
    workbook: &MapRef,
    namespaces: &domain_types::XmlNamespaceDeclarations,
    txn: &mut yrs::TransactionMut,
) {
    if namespaces.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(namespaces) {
        let settings_map =
            crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_SETTINGS);
        settings_map.insert(
            txn,
            "workbookRootNamespaces",
            Any::String(Arc::from(json.as_str())),
        );
    }
}

pub(super) fn hydrate_workbook_table_styles(
    workbook: &MapRef,
    table_styles: &[ooxml_types::styles::TableStyleDef],
    default_table_style: &Option<String>,
    default_pivot_style: &Option<String>,
    txn: &mut yrs::TransactionMut,
) {
    if table_styles.is_empty() && default_table_style.is_none() && default_pivot_style.is_none() {
        return;
    }

    let styles_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_XLSX_TABLE_STYLES);
    if let Ok(json) = serde_json::to_string(table_styles) {
        styles_map.insert(txn, "styles", Any::String(Arc::from(json.as_str())));
    }
    if let Some(style) = default_table_style {
        styles_map.insert(
            txn,
            "defaultTableStyle",
            Any::String(Arc::from(style.as_str())),
        );
    }
    if let Some(style) = default_pivot_style {
        styles_map.insert(
            txn,
            "defaultPivotStyle",
            Any::String(Arc::from(style.as_str())),
        );
    }
}

/// Write a `ThemeData` value into the workbook-level `"theme"` map in Yrs.
///
/// This is the single source of truth for persisting theme data. Both the
/// initial XLSX hydration path and the runtime `set_theme_palette` engine
/// method delegate here so that the serialization format stays consistent.
pub fn write_theme_data_to_yrs(
    workbook: &MapRef,
    theme_data: &domain_types::domain::theme::ThemeData,
    txn: &mut yrs::TransactionMut,
) {
    if let Ok(json) = serde_json::to_string(theme_data) {
        // Provider Protocol lifecycle: lazy-create the theme sub-map.
        let theme_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_THEME);
        theme_map.insert(txn, "data", Any::String(Arc::from(json.as_str())));
    }
}

/// Hydrate theme data into the workbook-level theme map.
pub(super) fn hydrate_workbook_theme(
    workbook: &MapRef,
    theme: &Option<domain_types::domain::theme::ThemeData>,
    txn: &mut yrs::TransactionMut,
) {
    if let Some(theme_data) = theme {
        write_theme_data_to_yrs(workbook, theme_data, txn);
    }
}

/// Hydrate workbook protection using structured Y.Map entries via
/// `yrs_schema::protection`.
pub(super) fn hydrate_workbook_protection(
    workbook: &MapRef,
    protection: &Option<domain_types::domain::workbook::WorkbookProtection>,
    txn: &mut yrs::TransactionMut,
) {
    if let Some(prot) = protection {
        // Provider Protocol lifecycle: lazy-create the settings sub-map.
        let settings_map =
            crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_SETTINGS);
        // Write structured protection via yrs_schema (canonical path)
        let is_protected = prot.lock_structure || prot.lock_windows || prot.lock_revision;
        let mut entries = yrs_schema::protection::workbook_to_yrs_prelim(prot);
        entries.push((
            yrs_schema::protection::KEY_WB_IS_PROTECTED,
            Any::Bool(is_protected),
        ));
        let prot_prelim: MapPrelim = entries.into_iter().collect();
        settings_map.insert(txn, "protection", prot_prelim);
    }
}

/// Hydrate calculation settings into the workbook settings Y.Map.
pub(super) fn hydrate_workbook_calculation(
    workbook: &MapRef,
    calculation: &domain_types::domain::workbook::CalculationProperties,
    txn: &mut yrs::TransactionMut,
) {
    // Provider Protocol lifecycle: lazy-create the settings sub-map.
    let settings_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_SETTINGS);
    let calc_settings: crate::snapshot::CalculationSettings = calculation.clone().into();
    if let Ok(json) = serde_json::to_string(&calc_settings) {
        settings_map.insert(
            txn,
            "calculationSettings",
            Any::String(Arc::from(json.as_str())),
        );
    }
}

/// Hydrate workbook view state into workbook settings.
///
/// Workbook views are workbook-level UI state from workbook.xml (`activeTab`,
/// `firstSheet`, window geometry, tab visibility, etc.). Parser and writer both
/// model them in `ParseOutput`; L2 must persist them through Yrs so production
/// import/export does not silently reset workbook.xml to `<workbookView/>`.
pub(super) fn hydrate_workbook_views(
    workbook: &MapRef,
    workbook_views: &[domain_types::domain::workbook::WorkbookView],
    sheet_ids: &[SheetId],
    txn: &mut yrs::TransactionMut,
) {
    if workbook_views.is_empty() {
        return;
    }

    let settings_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_SETTINGS);
    if let Ok(json) = serde_json::to_string(workbook_views) {
        settings_map.insert(txn, "workbookViews", Any::String(Arc::from(json.as_str())));
    }
    if let Some(active_sheet_id) = workbook_views
        .first()
        .and_then(|view| sheet_ids.get(view.active_tab as usize))
    {
        let selected_sheet_ids = [active_sheet_id.to_uuid_string()];
        if let Ok(json) = serde_json::to_string(&selected_sheet_ids) {
            settings_map.insert(
                txn,
                "selectedSheetIds",
                Any::String(Arc::from(json.as_str())),
            );
        }
    }
}

pub(super) fn hydrate_custom_workbook_views_xml(
    workbook: &MapRef,
    custom_workbook_views_xml: &Option<Vec<u8>>,
    txn: &mut yrs::TransactionMut,
) {
    let Some(xml) = custom_workbook_views_xml else {
        return;
    };
    if xml.is_empty() {
        return;
    }

    let settings_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_SETTINGS);
    if let Ok(json) = serde_json::to_string(xml) {
        settings_map.insert(
            txn,
            KEY_CUSTOM_WORKBOOK_VIEWS_XML,
            Any::String(Arc::from(json.as_str())),
        );
    }
}

/// Hydrate workbook web publishing metadata into a workbook-level Y.Map.
pub(super) fn hydrate_workbook_web_publishing(
    workbook: &MapRef,
    web_publishing: &Option<domain_types::domain::workbook::WorkbookWebPublishing>,
    txn: &mut yrs::TransactionMut,
) {
    let Some(web_publishing) = web_publishing else {
        return;
    };

    let entries = yrs_schema::web_publishing::to_yrs_prelim(web_publishing);
    if entries.is_empty() {
        return;
    }

    let web_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WEB_PUBLISHING);
    for (key, value) in entries {
        web_map.insert(txn, key, value);
    }
}

/// Hydrate workbook-level threaded comment person identities.
///
/// Threaded comments store `person_id` on each comment, but Excel resolves that
/// id through `xl/persons/person.xml`. Persist the modeled `PersonInfo` list so
/// production XLSX export can emit the person part from current workbook state.
pub(super) fn hydrate_workbook_threaded_comment_persons(
    workbook: &MapRef,
    persons: &[domain_types::domain::comment::PersonInfo],
    has_persons_part: bool,
    txn: &mut yrs::TransactionMut,
) {
    if !has_persons_part && persons.is_empty() {
        return;
    }

    workbook.insert(
        txn,
        KEY_THREADED_COMMENT_PERSONS_PART_PRESENT,
        Any::Bool(true),
    );

    if persons.is_empty() {
        return;
    }

    let persons_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_THREADED_COMMENT_PERSONS);
    let mut person_order = Vec::with_capacity(persons.len());
    for person in persons {
        person_order.push(person.id.clone());
        if let Ok(json) = serde_json::to_string(person) {
            persons_map.insert(txn, &*person.id, Any::String(Arc::from(json.as_str())));
        }
    }
    if let Ok(json) = serde_json::to_string(&person_order) {
        workbook.insert(
            txn,
            KEY_THREADED_COMMENT_PERSON_ORDER,
            Any::String(Arc::from(json.as_str())),
        );
    }
}

/// Hydrate all workbook metadata (properties, file version, file sharing) into Yrs.
///
/// - `WorkbookProperties` fields go into the existing `workbookSettings` map.
/// - `DocumentProperties` fields go into the `documentProperties` sub-map.
/// - `FileVersion` fields go into the `fileVersion` sub-map.
/// - `FileSharing` fields go into the `fileSharing` sub-map.
pub(super) fn hydrate_workbook_metadata(
    workbook: &MapRef,
    workbook_properties: &Option<domain_types::domain::workbook::WorkbookProperties>,
    document_properties: &Option<domain_types::DocumentProperties>,
    extended_properties: &Option<domain_types::ExtendedDocumentProperties>,
    xlsx_metadata: &Option<domain_types::WorkbookMetadata>,
    file_version: &Option<domain_types::domain::workbook::FileVersion>,
    file_sharing: &Option<domain_types::domain::workbook::FileSharing>,
    txn: &mut yrs::TransactionMut,
) {
    // WorkbookProperties → workbookSettings map (all 18 fields)
    // Provider Protocol lifecycle: each domain map is lazy-created via
    // `ensure_workbook_child_map` so independent-session replay merges cleanly.
    if let Some(props) = workbook_properties {
        let settings_map =
            crate::storage::ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_SETTINGS);
        for (key, value) in yrs_schema::workbook_properties::to_yrs_prelim(props) {
            settings_map.insert(txn, key, value);
        }
    }

    // DocumentProperties → documentProperties map
    if let Some(props) = document_properties {
        let doc_props_map =
            crate::storage::ensure_workbook_child_map(workbook, txn, KEY_DOCUMENT_PROPERTIES);
        for (key, value) in yrs_schema::doc_properties::to_yrs_prelim(props) {
            doc_props_map.insert(txn, key, value);
        }
    }

    if let Some(props) = extended_properties {
        let extended_props_map = crate::storage::ensure_workbook_child_map(
            workbook,
            txn,
            KEY_EXTENDED_DOCUMENT_PROPERTIES,
        );
        if let Ok(json) = serde_json::to_string(props) {
            extended_props_map.insert(txn, "data", Any::String(Arc::from(json.as_str())));
        }
    }

    if let Some(metadata) = xlsx_metadata
        && !metadata.is_empty()
    {
        let metadata_map =
            crate::storage::ensure_workbook_child_map(workbook, txn, KEY_XLSX_METADATA);
        if let Ok(json) = serde_json::to_string(metadata) {
            metadata_map.insert(txn, "data", Any::String(Arc::from(json.as_str())));
        }
    }

    // FileVersion → fileVersion map
    if let Some(fv) = file_version {
        let fv_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_FILE_VERSION);
        for (key, value) in yrs_schema::file_version::to_yrs_prelim(fv) {
            fv_map.insert(txn, key, value);
        }
    }

    // FileSharing → fileSharing map
    if let Some(fs) = file_sharing {
        let fs_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_FILE_SHARING);
        for (key, value) in yrs_schema::file_sharing::to_yrs_prelim(fs) {
            fs_map.insert(txn, key, value);
        }
    }
}

pub(super) fn hydrate_shared_string_hints(
    workbook: &MapRef,
    hints: &[domain_types::SharedStringHint],
    txn: &mut yrs::TransactionMut,
) {
    if hints.is_empty() {
        return;
    }
    let hints_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_SHARED_STRING_HINTS);
    if let Ok(json) = serde_json::to_string(hints) {
        hints_map.insert(txn, "data", Any::String(Arc::from(json.as_str())));
    }
}

pub(super) fn hydrate_package_fidelity_metadata(
    workbook: &MapRef,
    package_fidelity: &Option<domain_types::PackageFidelityMetadata>,
    txn: &mut yrs::TransactionMut,
) {
    let Some(package_fidelity) = package_fidelity else {
        return;
    };
    if package_fidelity.is_empty() {
        return;
    }
    let fidelity_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_PACKAGE_FIDELITY_METADATA);
    if let Ok(json) = serde_json::to_string(package_fidelity) {
        fidelity_map.insert(txn, "data", Any::String(Arc::from(json.as_str())));
    }
}

pub(super) fn hydrate_volatile_dependency_part(
    workbook: &MapRef,
    part: &Option<domain_types::VolatileDependencyPackagePart>,
    txn: &mut yrs::TransactionMut,
) {
    let Some(part) = part else {
        return;
    };
    if part.bytes.is_empty() {
        return;
    }
    let part_map = crate::storage::ensure_workbook_child_map(
        workbook,
        txn,
        KEY_VOLATILE_DEPENDENCY_PACKAGE_PART,
    );
    if let Ok(json) = serde_json::to_string(part) {
        part_map.insert(txn, "data", Any::String(Arc::from(json.as_str())));
    }
}

/// Hydrate slicers into the workbook-level `KEY_SLICERS` Y.Map as `StoredSlicer` JSON.
///
/// Merges per-sheet slicer definitions and anchors with workbook-level slicer
/// caches to produce canonical `StoredSlicer` entries. Each slicer is matched
/// to its cache by `cache_name == cache.name` and to its anchor by
/// `slicer.name == anchor.slicer_name`.
pub(super) fn hydrate_workbook_slicers(
    workbook: &MapRef,
    sheets: &[SheetData],
    sheet_ids: &[SheetId],
    slicer_caches: &[ooxml_types::slicers::SlicerCacheDef],
    txn: &mut yrs::TransactionMut,
) {
    // Build a lookup from cache name → cache def
    let cache_by_name: std::collections::HashMap<&str, &ooxml_types::slicers::SlicerCacheDef> =
        slicer_caches.iter().map(|c| (c.name.as_str(), c)).collect();

    // Early-return if no sheet has any slicer to hydrate; avoids creating
    // an empty `slicers` sub-map when there's nothing to write.
    if sheets.iter().all(|s| s.slicers.is_empty()) {
        return;
    }
    // Provider Protocol lifecycle: lazy-create the slicers sub-map.
    let slicers_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_SLICERS);

    for (sheet_idx, sheet) in sheets.iter().enumerate() {
        if sheet.slicers.is_empty() {
            continue;
        }

        let sheet_hex = id_to_hex(sheet_ids[sheet_idx].as_u128());

        // Build anchor lookup for this sheet: slicer_name → anchor
        let anchor_by_name: std::collections::HashMap<&str, &ooxml_types::slicers::SlicerAnchor> =
            sheet
                .slicer_anchors
                .iter()
                .map(|a| (a.slicer_name.as_str(), a))
                .collect();

        for slicer in &sheet.slicers {
            let cache = cache_by_name.get(slicer.cache.as_str()).copied();
            let anchor = anchor_by_name.get(slicer.name.as_str()).copied();

            let stored = domain_types::domain::slicer::xlsx_import_to_stored_slicer(
                slicer, cache, anchor, &sheet_hex,
            );

            // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
            let json =
                serde_json::to_string(&stored).expect("StoredSlicer serialization should not fail");
            slicers_map.insert(txn, &*stored.id, Any::String(Arc::from(json.as_str())));
        }
    }
}

pub(super) fn hydrate_workbook_timelines(
    workbook: &MapRef,
    sheets: &[SheetData],
    sheet_ids: &[SheetId],
    timeline_caches: &[ooxml_types::timelines::TimelineCacheDef],
    txn: &mut yrs::TransactionMut,
) {
    let cache_by_name: std::collections::HashMap<&str, &ooxml_types::timelines::TimelineCacheDef> =
        timeline_caches
            .iter()
            .map(|cache| (cache.name.as_str(), cache))
            .collect();

    if sheets.iter().all(|sheet| sheet.timelines.is_empty()) {
        return;
    }

    let timelines_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_TIMELINES);
    for (sheet_idx, sheet) in sheets.iter().enumerate() {
        if sheet.timelines.is_empty() {
            continue;
        }

        let sheet_hex = id_to_hex(sheet_ids[sheet_idx].as_u128());
        let anchor_by_name: std::collections::HashMap<
            &str,
            &ooxml_types::timelines::TimelineAnchor,
        > = sheet
            .timeline_anchors
            .iter()
            .map(|anchor| (anchor.timeline_name.as_str(), anchor))
            .collect();

        for timeline in &sheet.timelines {
            let cache = cache_by_name.get(timeline.cache.as_str()).copied();
            let anchor = anchor_by_name.get(timeline.name.as_str()).copied();
            let stored = domain_types::domain::slicer::xlsx_import_to_stored_timeline(
                timeline, cache, anchor, &sheet_hex,
            );
            let json = serde_json::to_string(&stored)
                .expect("StoredTimeline serialization should not fail");
            timelines_map.insert(txn, &*stored.id, Any::String(Arc::from(json.as_str())));
        }
    }
}

/// Hydrate parsed pivot tables into the workbook-level pivotSpecs map.
/// Stores `ParsedPivotTable` (JSON-serialized) so the export path can reconstruct them.
/// TODO: Remove this — pivots will be stored per-sheet.
pub(super) fn hydrate_workbook_parsed_pivot_tables(
    workbook: &MapRef,
    pivot_tables: &[domain_types::domain::pivot::ParsedPivotTable],
    txn: &mut yrs::TransactionMut,
) {
    if pivot_tables.is_empty() {
        return;
    }
    // Provider Protocol lifecycle: lazy-create the pivot-specs sub-map.
    let pivot_map = crate::storage::ensure_workbook_child_map(workbook, txn, KEY_PIVOT_SPECS);
    for (idx, pt) in pivot_tables.iter().enumerate() {
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json =
            serde_json::to_string(pt).expect("ParsedPivotTable serialization should not fail");
        let key = format!("{}_{}", pt.config.name, idx);
        pivot_map.insert(txn, &*key, Any::String(Arc::from(json.as_str())));
    }
    // Note: PivotCacheSourceDef is no longer stored separately — cache info
    // is part of ParsedPivotTable.config (cache_id on PivotTableConfig,
    // field list on PivotTableConfig.fields — typed OOXML preservation).
}

pub(super) fn hydrate_workbook_pivot_cache_records(
    workbook: &MapRef,
    records: &domain_types::yrs_schema::pivot_cache_records::PivotCacheRecords,
    txn: &mut yrs::TransactionMut,
) {
    if records.is_empty() {
        return;
    }
    let records_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_PIVOT_CACHE_RECORDS);
    let prelim = yrs_schema::pivot_cache_records::to_yrs_prelim(records);
    for (key, value) in prelim {
        records_map.insert(txn, &*key, value);
    }
}

pub(super) fn hydrate_workbook_pivot_cache_sources(
    workbook: &MapRef,
    sources: &[domain_types::domain::pivot::PivotCacheSourceDef],
    txn: &mut yrs::TransactionMut,
) {
    if sources.is_empty() {
        return;
    }
    let sources_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_PIVOT_CACHE_SOURCES);
    let prelim = yrs_schema::pivot_cache_records::sources_to_yrs_prelim(sources);
    for (key, value) in prelim {
        sources_map.insert(txn, &*key, value);
    }
}
