use domain_types::{NamedRange, SheetData};

use compute_document::hex::id_to_hex;

use cell_types::SheetId;

use super::IdAllocator;

#[derive(Debug, Clone, Default)]
pub(crate) struct ImportedTableIdentityMap {
    tables_by_ooxml_id: std::collections::HashMap<u32, ImportedTableIdentity>,
}

#[derive(Debug, Clone, Default)]
struct ImportedTableIdentity {
    stable_table_id: String,
    stable_column_ids_by_ooxml_id: std::collections::HashMap<u32, String>,
    stable_column_ids_by_source_name: std::collections::HashMap<String, String>,
    stable_column_ids_by_ordinal: std::collections::HashMap<u32, String>,
}

impl ImportedTableIdentityMap {
    fn insert_table(
        &mut self,
        imported: &domain_types::domain::table::TableSpec,
        canonical: &domain_types::domain::table::TableCatalogEntry,
    ) {
        if imported.id == 0 {
            return;
        }

        let mut identity = ImportedTableIdentity {
            stable_table_id: canonical.id.clone(),
            ..Default::default()
        };
        for (ordinal, (imported_column, canonical_column)) in imported
            .columns
            .iter()
            .zip(canonical.columns.iter())
            .enumerate()
        {
            let stable_column_id = canonical_column.id.clone();
            if imported_column.id > 0 {
                identity
                    .stable_column_ids_by_ooxml_id
                    .insert(imported_column.id, stable_column_id.clone());
            }
            identity
                .stable_column_ids_by_ordinal
                .insert(ordinal as u32, stable_column_id.clone());
            identity.insert_source_name(&imported_column.name, &stable_column_id);
            if let Some(unique_name) = imported_column.unique_name.as_deref() {
                identity.insert_source_name(unique_name, &stable_column_id);
            }
        }

        self.tables_by_ooxml_id.insert(imported.id, identity);
    }

    fn stable_table_id_for_ooxml_id(&self, ooxml_table_id: u32) -> Option<&str> {
        self.tables_by_ooxml_id
            .get(&ooxml_table_id)
            .map(|identity| identity.stable_table_id.as_str())
    }

    fn stable_column_id_for_slicer(
        &self,
        table_cache: &ooxml_types::slicers::TableSlicerCache,
        source_name: &str,
    ) -> Option<&str> {
        let identity = self.tables_by_ooxml_id.get(&table_cache.table_id)?;
        identity
            .stable_column_ids_by_ordinal
            .get(&table_cache.column)
            .or_else(|| {
                let one_based_ooxml_id = table_cache.column.saturating_add(1);
                identity
                    .stable_column_ids_by_ooxml_id
                    .get(&one_based_ooxml_id)
            })
            .or_else(|| {
                identity
                    .stable_column_ids_by_source_name
                    .get(&source_name.to_ascii_lowercase())
            })
            .map(String::as_str)
    }
}

impl ImportedTableIdentity {
    fn insert_source_name(&mut self, source_name: &str, stable_column_id: &str) {
        if source_name.is_empty() {
            return;
        }
        self.stable_column_ids_by_source_name
            .entry(source_name.to_ascii_lowercase())
            .or_insert_with(|| stable_column_id.to_string());
    }
}

// ===========================================================================
// Workbook-level hydration
// ===========================================================================

/// Hydrate named ranges into the workbook-level namedRanges map using
/// typed native entries, resolved against the imported identities at construction.
///
/// Converts parser `NamedRange` (position-keyed, `local_sheet_id` index)
/// into typed entries with allocated IDs and resolved sheet scope.
pub(super) fn hydrate_workbook_named_ranges(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    named_ranges: &[NamedRange],
    sheet_ids: &[SheetId],
    inventory: &[domain_types::WorkbookSheetPackageInfo],
    allocator: &mut impl IdAllocator,
) {
    if named_ranges.is_empty() {
        return;
    }
    // Hidden and opaque names remain authored package state for export fidelity.
    let mut inert_named_ranges = Vec::new();
    for (idx, nr) in named_ranges.iter().enumerate() {
        // OOXML localSheetId counts all workbook tabs, including inert ones.
        let scope: Option<String> = nr.local_sheet_id.and_then(|idx| {
            sheet_ids
                .get(editable_sheet_index(inventory, idx)?)
                .map(|sid| id_to_hex(sid.as_u128()).to_string())
        });

        if nr.local_sheet_id.is_some() && scope.is_none() {
            // Inert tab names have no evaluator sheet scope. Preserve their full
            // OOXML record separately instead of turning them into global names.
            inert_named_ranges.push(nr.clone());
            continue;
        }

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
            refers_to: crate::storage::workbook::named_ranges::expression_template(&nr.refers_to),
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

        crate::storage::workbook::named_ranges::upsert_named_range(metadata, &defined_name);
    }
    metadata.inert_tab_defined_names = inert_named_ranges;
}

pub(super) fn editable_sheet_index(
    inventory: &[domain_types::WorkbookSheetPackageInfo],
    workbook_order: u32,
) -> Option<usize> {
    if inventory.is_empty() {
        return Some(workbook_order as usize);
    }
    inventory
        .iter()
        .find(|entry| entry.workbook_order == workbook_order)?
        .editable_sheet_index
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
    use crate::storage::WorkbookStorage;
    use crate::storage::workbook::settings::get_settings;
    use cell_types::SheetId;

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
        let mut storage = WorkbookStorage::new();
        let sheet_ids = [SheetId::from_raw(1), SheetId::from_raw(2)];
        let workbook_views = [domain_types::domain::workbook::WorkbookView {
            active_tab: 1,
            ..Default::default()
        }];

        hydrate_workbook_views(&mut storage.metadata, &workbook_views, &sheet_ids, &[]);

        let settings = get_settings(&storage.metadata);
        assert_eq!(
            settings.selected_sheet_ids,
            Some(vec![sheet_ids[1].to_uuid_string()])
        );
    }
}

/// Lower imported table metadata and stable IDs into a transient startup catalog.
pub(crate) fn hydrate_workbook_tables(
    tables: &[(domain_types::domain::table::TableSpec, String)],
    allocator: &mut impl IdAllocator,
) -> (
    ImportedTableIdentityMap,
    Vec<domain_types::domain::table::TableCatalogEntry>,
) {
    let mut table_identity = ImportedTableIdentityMap::default();
    let mut catalog = Vec::with_capacity(tables.len());
    for (table, sheet_id) in tables {
        let table_id = format!("tbl-{}", allocator.alloc_cell_id().to_uuid_string());
        let column_ids = table
            .columns
            .iter()
            .map(|_| format!("col-{}", allocator.alloc_cell_id().to_uuid_string()));
        let canonical = domain_types::domain::table::xlsx_table_spec_to_catalog_entry_with_ids(
            table, sheet_id, table_id, column_ids,
        );
        table_identity.insert_table(table, &canonical);
        catalog.push(canonical);
    }
    (table_identity, catalog)
}

pub(super) fn hydrate_workbook_connections(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    value: &domain_types::domain::connections::WorkbookConnectionSet,
) {
    metadata.connections = value.clone();
}

pub(super) fn hydrate_workbook_root_namespaces(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    namespaces: &domain_types::XmlNamespaceDeclarations,
) {
    metadata.root_namespaces = namespaces.clone();
}

pub(super) fn hydrate_workbook_table_styles(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    default_table_style: &Option<String>,
    default_pivot_style: &Option<String>,
) {
    metadata.imported_default_table_style = default_table_style.clone();
    metadata.imported_default_pivot_style = default_pivot_style.clone();
}

/// Preserve the complete workbook theme.
pub(super) fn hydrate_workbook_theme(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    value: &Option<domain_types::domain::theme::ThemeData>,
) {
    metadata.theme = value.clone();
}

/// Preserve the complete workbook protection object in native storage.
pub(super) fn hydrate_workbook_protection(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    protection: &Option<domain_types::domain::workbook::WorkbookProtection>,
) {
    metadata.settings.is_workbook_protected = protection
        .as_ref()
        .is_some_and(|p| p.lock_structure || p.lock_windows || p.lock_revision);
    metadata.protection = protection.clone();
}

/// Hydrate typed calculation settings.
pub(super) fn hydrate_workbook_calculation(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    calculation: &domain_types::domain::workbook::CalculationProperties,
) {
    metadata.settings.calculation_settings = Some(calculation.clone().into());
}

/// Hydrate workbook view state into workbook settings.
///
/// Workbook views are workbook-level UI state from workbook.xml (`activeTab`,
/// `firstSheet`, window geometry, tab visibility, etc.). Parser and writer both
/// model them in `ParseOutput`; native metadata preserves them so production
/// import/export does not silently reset workbook.xml to `<workbookView/>`.
pub(super) fn hydrate_workbook_views(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    views: &[domain_types::domain::workbook::WorkbookView],
    sheet_ids: &[SheetId],
    inventory: &[domain_types::WorkbookSheetPackageInfo],
) {
    metadata.views = views.to_vec();
    metadata.settings.selected_sheet_ids = views
        .first()
        .and_then(|view| sheet_ids.get(editable_sheet_index(inventory, view.active_tab)?))
        .map(|id| vec![id.to_uuid_string()]);
}

pub(super) fn hydrate_custom_workbook_views_xml(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    xml: &Option<Vec<u8>>,
) {
    metadata.custom_views_xml = xml.clone().filter(|xml| !xml.is_empty());
}

/// Preserve workbook web publishing metadata.
pub(super) fn hydrate_workbook_web_publishing(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    value: &Option<domain_types::domain::workbook::WorkbookWebPublishing>,
) {
    metadata.web_publishing = value.clone();
}

/// Hydrate workbook-level threaded comment person identities.
///
/// Threaded comments store `person_id` on each comment, but Excel resolves that
/// id through `xl/persons/person.xml`. Persist the modeled `PersonInfo` list so
/// production XLSX export can emit the person part from current workbook state.
pub(super) fn hydrate_workbook_threaded_comment_persons(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    persons: &[domain_types::PersonInfo],
    has_persons_part: bool,
) {
    metadata.persons = persons.to_vec();
    metadata.has_persons_part = has_persons_part || !persons.is_empty();
}

/// Preserve workbook and document metadata in typed native storage.
pub(super) fn hydrate_workbook_metadata(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    workbook_properties: &Option<domain_types::domain::workbook::WorkbookProperties>,
    document_properties: &Option<domain_types::DocumentProperties>,
    extended_properties: &Option<domain_types::ExtendedDocumentProperties>,
    xlsx_metadata: &Option<domain_types::WorkbookMetadata>,
    file_version: &Option<domain_types::domain::workbook::FileVersion>,
    file_sharing: &Option<domain_types::domain::workbook::FileSharing>,
) {
    metadata.properties = workbook_properties.clone();
    metadata.document_properties = document_properties.clone();
    metadata.extended_properties = extended_properties.clone();
    metadata.xlsx_metadata = xlsx_metadata.clone();
    metadata.file_version = file_version.clone();
    metadata.file_sharing = file_sharing.clone();
}

pub(super) fn hydrate_shared_string_hints(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    value: &[domain_types::SharedStringHint],
) {
    metadata.shared_string_hints = value.to_vec();
}

pub(super) fn hydrate_package_fidelity_metadata(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    value: &Option<domain_types::PackageFidelityMetadata>,
) {
    metadata.package_fidelity = value.clone();
}

pub(super) fn hydrate_volatile_dependency_part(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    value: &Option<domain_types::VolatileDependencyPackagePart>,
) {
    metadata.volatile_dependency_part = value.clone();
}

/// Resolve imported slicers into typed native workbook metadata.
///
/// Merges per-sheet slicer definitions and anchors with workbook-level slicer
/// caches to produce canonical `StoredSlicer` entries. Each slicer is matched
/// to its cache by `cache_name == cache.name` and to its anchor by
/// `slicer.name == anchor.slicer_name`.
pub(super) fn hydrate_workbook_slicers(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    sheets: &[SheetData],
    sheet_ids: &[SheetId],
    slicer_caches: &[ooxml_types::slicers::SlicerCacheDef],
    mut table_identity: ImportedTableIdentityMap,
    existing_tables: &[domain_types::domain::table::TableCatalogEntry],
) {
    if sheets.iter().all(|sheet| sheet.slicers.is_empty()) {
        return;
    }
    // Deferred completion omits the loaded sheet's table parts. Its native
    // catalog still supplies the stable IDs and source filter criteria without
    // reconstructing cells or retaining another workbook snapshot.
    let existing_specs: Vec<_> = existing_tables
        .iter()
        .map(|table| {
            let spec = domain_types::domain::table::catalog_entry_to_xlsx_table_spec(table, None);
            table_identity.insert_table(&spec, table);
            spec
        })
        .collect();
    // Build a lookup from cache name → cache def
    let cache_by_name: std::collections::HashMap<&str, &ooxml_types::slicers::SlicerCacheDef> =
        slicer_caches.iter().map(|c| (c.name.as_str(), c)).collect();
    let table_by_ooxml_id: std::collections::HashMap<u32, &domain_types::domain::table::TableSpec> =
        existing_specs
            .iter()
            .chain(sheets.iter().flat_map(|sheet| sheet.tables.iter()))
            .filter_map(|table| (table.id > 0).then_some((table.id, table)))
            .collect();

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
            let source_table = cache
                .and_then(|cache| cache.table_slicer_cache.as_ref())
                .and_then(|table_cache| table_by_ooxml_id.get(&table_cache.table_id).copied());
            let source_table_id = cache
                .and_then(|cache| cache.table_slicer_cache.as_ref())
                .and_then(|table_cache| {
                    table_identity.stable_table_id_for_ooxml_id(table_cache.table_id)
                });
            let source_table_column_id = cache.and_then(|cache| {
                cache.table_slicer_cache.as_ref().and_then(|table_cache| {
                    table_identity
                        .stable_column_id_for_slicer(table_cache, cache.source_name.as_str())
                })
            });
            let table_filter_selected_values = cache
                .and_then(|cache| cache.table_slicer_cache.as_ref())
                .and_then(|table_cache| {
                    source_table.map(|table| {
                        domain_types::domain::slicer::table_filter_selected_values_for_slicer(
                            table,
                            table_cache.column,
                        )
                    })
                });
            let table_filter_selected_values = table_filter_selected_values
                .as_deref()
                .filter(|values| !values.is_empty());

            let stored = domain_types::domain::slicer::xlsx_import_to_stored_slicer(
                slicer,
                cache,
                anchor,
                domain_types::domain::slicer::XlsxSlicerImportContext {
                    sheet_id: &sheet_hex,
                    source_table_id,
                    source_table_column_id,
                    table_filter_selected_values,
                },
            );

            metadata.slicers.insert(stored.id.clone(), stored);
        }
    }
}

pub(super) fn hydrate_workbook_timelines(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    sheets: &[SheetData],
    sheet_ids: &[SheetId],
    timeline_caches: &[ooxml_types::timelines::TimelineCacheDef],
) {
    let cache_by_name: std::collections::HashMap<&str, &ooxml_types::timelines::TimelineCacheDef> =
        timeline_caches
            .iter()
            .map(|cache| (cache.name.as_str(), cache))
            .collect();

    if sheets.iter().all(|sheet| sheet.timelines.is_empty()) {
        return;
    }

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
            metadata.timelines.insert(stored.id.clone(), stored);
        }
    }
}

/// Preserve typed imported pivot definitions and cache data for XLSX export.
pub(super) fn hydrate_workbook_parsed_pivot_tables(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    pivot_tables: &[domain_types::domain::pivot::ParsedPivotTable],
) {
    metadata.pivot_specs.extend(
        pivot_tables
            .iter()
            .enumerate()
            .map(|(idx, pivot)| (format!("{}_{}", pivot.config.name, idx), pivot.clone())),
    );
}

pub(super) fn hydrate_workbook_pivot_cache_records(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    records: &domain_types::domain::pivot::PivotCacheRecords,
) {
    metadata
        .pivot_cache_records
        .extend(records.iter().map(|(id, rows)| (*id, rows.clone())));
}

pub(super) fn hydrate_workbook_pivot_cache_sources(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    sources: &[domain_types::domain::pivot::PivotCacheSourceDef],
) {
    metadata.pivot_cache_sources.extend(
        sources
            .iter()
            .map(|source| (source.cache_id, source.clone())),
    );
}
