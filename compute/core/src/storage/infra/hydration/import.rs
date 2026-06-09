use yrs::{Any, Map, MapPrelim, MapRef, Transact};

use domain_types::ParseOutput;
use domain_types::domain::pivot::PivotCacheSourceDef;

use compute_document::hex::id_to_hex;
use compute_document::schema::*;
use compute_document::workbook_metadata::{
    ImportedExternalCacheRecord, ImportedExternalLinkIdentity, ImportedExternalPackageArtifact,
    PersistedLinkTarget, PersistedWorkbookLinkRecord, PersistedWorkbookLinkSourceKind,
    PersistedWorkbookMetadata, WorkbookCreationMetadata, read_workbook_metadata,
    write_imported_external_cache_record, write_imported_external_package_artifact,
    write_workbook_link_record, write_workbook_metadata,
};
use domain_types::domain::external_link::{ExternalLink, ExternalLinkType};
use workbook_types::{LinkId, WorkbookId};

use value_types::ComputeError;

use crate::storage::YrsStorage;
use crate::storage::sheet::pivots::insert_existing_pivot_if_absent_in_txn;
use crate::storage::workbook::imported_pivots::{
    ImportedPivotAssociationStatus, ImportedPivotUnsupportedReason, association_from_parsed_pivot,
    existing_promoted_import_pivot_matches, import_identity_for_parsed_pivot,
    native_imported_pivot_id, write as write_imported_pivot_association,
};

use super::data_tables::hydrate_data_table_regions_from_parse_output;
use super::imported_pivot_classification::{ImportedPivotClassification, classify_imported_pivot};
use super::sheet::{SheetIdAllocation, hydrate_sheet, hydrate_sheet_with_allocation};
use super::styles::{ImportedRangeStyle, hydrate_style_palette, hydrate_workbook_stylesheet};
use super::workbook::{
    hydrate_custom_workbook_views_xml, hydrate_package_fidelity_metadata,
    hydrate_shared_string_hints, hydrate_volatile_dependency_part, hydrate_workbook_calculation,
    hydrate_workbook_connections, hydrate_workbook_metadata, hydrate_workbook_named_ranges,
    hydrate_workbook_parsed_pivot_tables, hydrate_workbook_pivot_cache_records,
    hydrate_workbook_pivot_cache_sources, hydrate_workbook_protection,
    hydrate_workbook_root_namespaces, hydrate_workbook_slicers, hydrate_workbook_table_styles,
    hydrate_workbook_tables, hydrate_workbook_theme, hydrate_workbook_threaded_comment_persons,
    hydrate_workbook_timelines, hydrate_workbook_views, hydrate_workbook_web_publishing,
};
use super::{HydrationIdMap, IdAllocator};

// ======================================================================
// XLSX import path: hydrate_from_parse_output
// ======================================================================

impl YrsStorage {
    /// Materialize parser-owned imported external-link fidelity into workbook-owned Yrs records.
    ///
    /// The XLSX parser remains a domain parser/writer. This adapter is the import
    /// orchestration boundary that translates parsed OOXML external links into
    /// the persisted workbook link registry and imported cache maps.
    pub(crate) fn hydrate_imported_external_links(
        &mut self,
        external_links: &[ExternalLink],
    ) -> Result<(), ComputeError> {
        if external_links.is_empty() {
            return Ok(());
        }

        let mut txn = self.doc.transact_mut();
        let destination_workbook_id =
            ensure_imported_workbook_identity(&mut txn, &self.workbook, external_links)?;

        for link in external_links {
            let Some(identity) = &link.imported_identity else {
                let artifact = imported_external_package_artifact(&destination_workbook_id, link)?;
                write_imported_external_package_artifact(&mut txn, &self.workbook, &artifact)
                    .map_err(|err| ComputeError::Deserialize {
                        message: format!("imported external package artifact serialization: {err}"),
                    })?;
                continue;
            };

            let link_id = imported_excel_link_id(&destination_workbook_id, identity)?;
            let record = PersistedWorkbookLinkRecord {
                link_id,
                expected_workbook_id: None,
                target: persisted_target_for_external_link(link, identity),
                display_name: display_name_for_external_link(link, identity),
                source_kind: source_kind_for_external_link(link),
                imported_excel_identity: Some(imported_identity_from_domain(identity)),
                materialized_cache_metadata: None,
            };
            write_workbook_link_record(&mut txn, &self.workbook, &record).map_err(|err| {
                ComputeError::Deserialize {
                    message: format!("workbook link record serialization: {err}"),
                }
            })?;

            let payload_json =
                serde_json::to_string(link).map_err(|err| ComputeError::Deserialize {
                    message: format!("external link fidelity payload serialization: {err}"),
                })?;
            let cache = ImportedExternalCacheRecord {
                link_id,
                payload_kind: "domain-types.external-link".to_string(),
                payload_version: 1,
                payload_json,
            };
            write_imported_external_cache_record(&mut txn, &self.workbook, &cache).map_err(
                |err| ComputeError::Deserialize {
                    message: format!("imported external cache serialization: {err}"),
                },
            )?;
        }

        Ok(())
    }

    /// Hydrate a Yrs document from a [`ParseOutput`] using structured Y.Maps.
    ///
    /// This is the XLSX import hydration path. It uses `yrs_schema` modules for
    /// domain objects instead of JSON blobs, and reads from `ParseOutput`
    /// instead of `ImportSnapshot`.
    ///
    /// The `IdAllocator` is used to assign UUIDs to all identity objects
    /// (sheets, cells, rows, columns).
    #[tracing::instrument(name = "hydrate_from_parse_output", skip_all)]
    pub fn hydrate_from_parse_output(
        &mut self,
        output: &ParseOutput,
        allocator: &mut impl IdAllocator,
    ) -> Result<HydrationIdMap, ComputeError> {
        let _span = tracing::info_span!("hydrate_yrs_from_parse_output").entered();
        let mut txn = self.doc.transact_mut();

        let mut id_map = HydrationIdMap::default();

        // Sheet order array — Provider Protocol lifecycle: lazy-create rather than
        // rely on the (now-removed) eager bootstrap from `YrsStorage::new`.
        // See [`YrsStorage::new`] doc-comment.
        let order_arr = self.ensure_sheet_order_array(&mut txn);

        // Write the style palette to a workbook-level Yrs map so that compact
        // cell properties (`{"s": N}`) can resolve their format at read time.
        hydrate_style_palette(&mut txn, &self.workbook, &output.style_palette);
        hydrate_workbook_stylesheet(&mut txn, &self.workbook, &output.workbook_stylesheet);
        let theme = output.theme.as_ref();
        let indexed_colors = output
            .workbook_stylesheet
            .as_ref()
            .and_then(|stylesheet| stylesheet.indexed_colors.as_ref());

        for sheet_data in &output.sheets {
            let (
                sheet_id,
                sheet_cell_ids,
                sheet_phantom_cells,
                sheet_identity_only_cells,
                sheet_row_ids,
                sheet_col_ids,
            ) = hydrate_sheet(
                &mut txn,
                &self.sheets,
                &order_arr,
                sheet_data,
                &output.style_palette,
                &output.persons,
                theme,
                indexed_colors,
                allocator,
            )?;
            id_map.sheet_ids.push(sheet_id);
            id_map.cell_ids.push(sheet_cell_ids);
            id_map.row_ids.push(sheet_row_ids);
            id_map.col_ids.push(sheet_col_ids);
            for (cell_id, row, col) in sheet_phantom_cells {
                id_map.phantom_cells.push((sheet_id, cell_id, row, col));
            }
            for (cell_id, row, col) in sheet_identity_only_cells {
                id_map
                    .identity_only_cells
                    .push((sheet_id, cell_id, row, col));
            }
        }

        // Provider Protocol lifecycle (Provider Protocol): workbook-level domain maps
        // are NOT eagerly bulk-inserted here. Eager inserts conflict with
        // independent-session replay via Map LWW. Each downstream
        // `hydrate_workbook_*` helper below ensures its own sub-map via
        // `ensure_workbook_child_map` (or a domain-specific wrapper) on
        // first write. Empty domain maps are simply absent from the doc;
        // every reader already handles `None` gracefully.

        // Populate workbook-level data
        hydrate_workbook_named_ranges(
            &self.workbook,
            &output.named_ranges,
            &id_map.sheet_ids,
            allocator,
            &mut txn,
        );
        // Collect tables from all sheets, paired with their sheet IDs.
        let all_tables: Vec<_> = output
            .sheets
            .iter()
            .zip(id_map.sheet_ids.iter())
            .flat_map(|(s, sheet_id)| {
                let sheet_hex = id_to_hex(sheet_id.as_u128());
                s.tables
                    .iter()
                    .map(move |t| (t.clone(), sheet_hex.to_string()))
            })
            .collect();
        hydrate_workbook_tables(&self.workbook, &all_tables, &mut txn);
        hydrate_workbook_connections(&self.workbook, &output.connections, &mut txn);
        hydrate_workbook_root_namespaces(
            &self.workbook,
            &output.workbook_root_namespaces,
            &mut txn,
        );
        hydrate_workbook_table_styles(
            &self.workbook,
            &output.custom_table_styles,
            &output.default_table_style,
            &output.default_pivot_style,
            &mut txn,
        );
        hydrate_workbook_theme(&self.workbook, &output.theme, &mut txn);
        hydrate_workbook_protection(&self.workbook, &output.protection, &mut txn);

        // Hydrate slicers: merge per-sheet slicers with workbook-level caches
        // into StoredSlicer entries in the workbook slicers Y.Map.
        hydrate_workbook_slicers(
            &self.workbook,
            &output.sheets,
            &id_map.sheet_ids,
            &output.slicer_caches,
            &mut txn,
        );
        hydrate_workbook_timelines(
            &self.workbook,
            &output.sheets,
            &id_map.sheet_ids,
            &output.timeline_caches,
            &mut txn,
        );

        hydrate_imported_pivots_as_native(
            &self.workbook,
            &self.sheets,
            &output.pivot_tables,
            &output.pivot_cache_sources,
            &output.sheets,
            &id_map.sheet_ids,
            &mut txn,
        )?;
        // Hydrate pivot tables at workbook level as an OOXML preservation sidecar.
        hydrate_workbook_parsed_pivot_tables(&self.workbook, &output.pivot_tables, &mut txn);
        hydrate_workbook_pivot_cache_sources(&self.workbook, &output.pivot_cache_sources, &mut txn);
        hydrate_workbook_pivot_cache_records(&self.workbook, &output.pivot_cache_records, &mut txn);

        hydrate_workbook_calculation(&self.workbook, &output.calculation, &mut txn);
        hydrate_workbook_views(
            &self.workbook,
            &output.workbook_views,
            &id_map.sheet_ids,
            &mut txn,
        );
        hydrate_custom_workbook_views_xml(
            &self.workbook,
            &output.custom_workbook_views_xml,
            &mut txn,
        );
        hydrate_workbook_web_publishing(&self.workbook, &output.web_publishing, &mut txn);
        hydrate_workbook_threaded_comment_persons(
            &self.workbook,
            &output.persons,
            output.has_persons_part,
            &mut txn,
        );
        hydrate_shared_string_hints(&self.workbook, &output.shared_string_hints, &mut txn);
        hydrate_package_fidelity_metadata(&self.workbook, &output.package_fidelity, &mut txn);
        hydrate_volatile_dependency_part(
            &self.workbook,
            &output.volatile_dependency_part,
            &mut txn,
        );
        hydrate_workbook_metadata(
            &self.workbook,
            &output.workbook_properties,
            &output.properties,
            &output.extended_properties,
            &output.metadata,
            &output.file_version,
            &output.file_sharing,
            &mut txn,
        );
        hydrate_data_table_regions_from_parse_output(&self.workbook, output, &id_map, &mut txn);

        // Stamp schema version — import always creates a new document.
        write_schema_version(&mut txn, &self.workbook);

        Ok(id_map)
    }

    /// Hydrate a Yrs document using pre-allocated IDs, skipping ranged cells.
    ///
    /// This is the "Range-before-Yrs" variant. The caller has already:
    /// 1. Allocated IDs via `allocate_sheet_ids` for each sheet.
    /// 2. Built the WorkbookSnapshot and run the Range classifier.
    /// 3. Collected `ranged_positions` per sheet (cells promoted to Ranges).
    ///
    /// This method writes everything to Yrs except ranged cells (which are
    /// stored as compact Range payloads instead), then writes the Range
    /// metadata/payloads from the snapshot into the Yrs range sub-maps.
    #[tracing::instrument(name = "hydrate_from_parse_output_with_ranges", skip_all)]
    pub(crate) fn hydrate_from_parse_output_with_ranges(
        &mut self,
        output: &ParseOutput,
        allocations: &[SheetIdAllocation],
        ranged_positions: &[std::collections::HashSet<(u32, u32)>],
        range_style_positions: &[std::collections::HashSet<(u32, u32)>],
        range_data_per_sheet: &[Vec<snapshot_types::RangeData>],
        range_styles_per_sheet: &[Vec<ImportedRangeStyle>],
        allocator: &mut impl IdAllocator,
    ) -> Result<HydrationIdMap, ComputeError> {
        let _span = tracing::info_span!("hydrate_yrs_from_parse_output_with_ranges").entered();
        tracing::info!(target: "deferred_hydration", "hydrate: transact_mut");
        let mut txn = self.doc.transact_mut();
        tracing::info!(target: "deferred_hydration", "hydrate: transact_mut done");

        let mut id_map = HydrationIdMap::default();
        let order_arr = self.ensure_sheet_order_array(&mut txn);
        tracing::info!(target: "deferred_hydration", "hydrate: style palette");
        hydrate_style_palette(&mut txn, &self.workbook, &output.style_palette);
        hydrate_workbook_stylesheet(&mut txn, &self.workbook, &output.workbook_stylesheet);
        let theme = output.theme.as_ref();
        let indexed_colors = output
            .workbook_stylesheet
            .as_ref()
            .and_then(|stylesheet| stylesheet.indexed_colors.as_ref());
        tracing::info!(target: "deferred_hydration", "hydrate: sheets start, count={}", output.sheets.len());

        for (sheet_idx, sheet_data) in output.sheets.iter().enumerate() {
            tracing::info!(target: "deferred_hydration", "hydrate: sheet {sheet_idx} start");
            let alloc = &allocations[sheet_idx];
            let ranged = &ranged_positions[sheet_idx];
            let range_style_positions_for_sheet = &range_style_positions[sheet_idx];
            let range_styles = range_styles_per_sheet
                .get(sheet_idx)
                .map(Vec::as_slice)
                .unwrap_or(&[]);

            let (phantom_cells, identity_only_cells) = hydrate_sheet_with_allocation(
                &mut txn,
                &self.sheets,
                &order_arr,
                sheet_data,
                &output.style_palette,
                &output.persons,
                theme,
                indexed_colors,
                alloc,
                ranged,
                range_style_positions_for_sheet,
                range_styles,
                allocator,
            )?;
            tracing::info!(target: "deferred_hydration", "hydrate: sheet {sheet_idx} hydrated");

            // Write Range data to the sheet's canonical Yrs sub-maps.
            //
            // `hydrate_sheet_with_allocation` creates the full canonical sheet
            // schema, including empty range maps. Do not replace those maps
            // here: inserting a nested YMap and then writing through the old
            // handle in the same import transaction leaves local state looking
            // correct but can produce a replay state whose range payloads are
            // disconnected from the sheet. Use the existing maps and create
            // them only as a defensive fallback for older/corrupt documents.
            let sheet_hex = &alloc.sheet_hex;
            if let Some(yrs::Out::YMap(sheet_map)) = self.sheets.get(&txn, sheet_hex) {
                let ranges = &range_data_per_sheet[sheet_idx];
                if !ranges.is_empty() {
                    let ranges_map: MapRef = match sheet_map.get(&txn, KEY_RANGES) {
                        Some(yrs::Out::YMap(map)) => map,
                        _ => sheet_map.insert(
                            &mut txn,
                            KEY_RANGES,
                            MapPrelim::from([] as [(&str, Any); 0]),
                        ),
                    };
                    let payloads_map: MapRef = match sheet_map.get(&txn, KEY_RANGE_PAYLOADS) {
                        Some(yrs::Out::YMap(map)) => map,
                        _ => sheet_map.insert(
                            &mut txn,
                            KEY_RANGE_PAYLOADS,
                            MapPrelim::from([] as [(&str, Any); 0]),
                        ),
                    };
                    if !matches!(
                        sheet_map.get(&txn, KEY_RANGE_FORMATS),
                        Some(yrs::Out::YMap(_))
                    ) {
                        sheet_map.insert(
                            &mut txn,
                            KEY_RANGE_FORMATS,
                            MapPrelim::from([] as [(&str, Any); 0]),
                        );
                    }
                    if !matches!(
                        sheet_map.get(&txn, KEY_RANGE_BINDINGS),
                        Some(yrs::Out::YMap(_))
                    ) {
                        sheet_map.insert(
                            &mut txn,
                            KEY_RANGE_BINDINGS,
                            MapPrelim::from([] as [(&str, Any); 0]),
                        );
                    }

                    for rd in ranges {
                        let metadata = compute_document::range::RangeMetadata {
                            range_id: rd.range_id,
                            kind: rd.kind,
                            anchor: rd.anchor.clone(),
                            encoding: rd.encoding,
                            row_axis: rd.row_axis.clone(),
                            col_axis: rd.col_axis.clone(),
                            row_ids: rd.row_ids.clone(),
                            col_ids: rd.col_ids.clone(),
                        };
                        compute_document::range::write_range_to_yrs(
                            &mut txn,
                            &ranges_map,
                            &payloads_map,
                            &metadata,
                            &rd.payload,
                        );
                    }
                }
            }

            let sheet_id = alloc.sheet_id;
            id_map.sheet_ids.push(sheet_id);
            id_map.cell_ids.push(alloc.cell_ids.clone());
            id_map.row_ids.push(alloc.row_ids.clone());
            id_map.col_ids.push(alloc.col_ids.clone());
            for (cell_id, row, col) in phantom_cells {
                id_map.phantom_cells.push((sheet_id, cell_id, row, col));
            }
            for (cell_id, row, col) in identity_only_cells {
                id_map
                    .identity_only_cells
                    .push((sheet_id, cell_id, row, col));
            }
        }

        tracing::info!(target: "deferred_hydration", "hydrate: all sheets done, workbook-level data");
        // Workbook-level data (identical to hydrate_from_parse_output)
        hydrate_workbook_named_ranges(
            &self.workbook,
            &output.named_ranges,
            &id_map.sheet_ids,
            allocator,
            &mut txn,
        );
        let all_tables: Vec<_> = output
            .sheets
            .iter()
            .zip(id_map.sheet_ids.iter())
            .flat_map(|(s, sheet_id)| {
                let sheet_hex = id_to_hex(sheet_id.as_u128());
                s.tables
                    .iter()
                    .map(move |t| (t.clone(), sheet_hex.to_string()))
            })
            .collect();
        hydrate_workbook_tables(&self.workbook, &all_tables, &mut txn);
        hydrate_workbook_root_namespaces(
            &self.workbook,
            &output.workbook_root_namespaces,
            &mut txn,
        );
        hydrate_workbook_theme(&self.workbook, &output.theme, &mut txn);
        hydrate_workbook_protection(&self.workbook, &output.protection, &mut txn);
        hydrate_workbook_slicers(
            &self.workbook,
            &output.sheets,
            &id_map.sheet_ids,
            &output.slicer_caches,
            &mut txn,
        );
        hydrate_workbook_timelines(
            &self.workbook,
            &output.sheets,
            &id_map.sheet_ids,
            &output.timeline_caches,
            &mut txn,
        );
        hydrate_imported_pivots_as_native(
            &self.workbook,
            &self.sheets,
            &output.pivot_tables,
            &output.pivot_cache_sources,
            &output.sheets,
            &id_map.sheet_ids,
            &mut txn,
        )?;
        hydrate_workbook_parsed_pivot_tables(&self.workbook, &output.pivot_tables, &mut txn);
        hydrate_workbook_pivot_cache_sources(&self.workbook, &output.pivot_cache_sources, &mut txn);
        hydrate_workbook_pivot_cache_records(&self.workbook, &output.pivot_cache_records, &mut txn);
        hydrate_workbook_calculation(&self.workbook, &output.calculation, &mut txn);
        hydrate_workbook_views(
            &self.workbook,
            &output.workbook_views,
            &id_map.sheet_ids,
            &mut txn,
        );
        hydrate_custom_workbook_views_xml(
            &self.workbook,
            &output.custom_workbook_views_xml,
            &mut txn,
        );
        hydrate_workbook_web_publishing(&self.workbook, &output.web_publishing, &mut txn);
        hydrate_workbook_threaded_comment_persons(
            &self.workbook,
            &output.persons,
            output.has_persons_part,
            &mut txn,
        );
        hydrate_shared_string_hints(&self.workbook, &output.shared_string_hints, &mut txn);
        hydrate_package_fidelity_metadata(&self.workbook, &output.package_fidelity, &mut txn);
        hydrate_volatile_dependency_part(
            &self.workbook,
            &output.volatile_dependency_part,
            &mut txn,
        );
        hydrate_workbook_metadata(
            &self.workbook,
            &output.workbook_properties,
            &output.properties,
            &output.extended_properties,
            &output.metadata,
            &output.file_version,
            &output.file_sharing,
            &mut txn,
        );
        hydrate_data_table_regions_from_parse_output(&self.workbook, output, &id_map, &mut txn);

        write_schema_version(&mut txn, &self.workbook);

        Ok(id_map)
    }
}

fn hydrate_imported_pivots_as_native(
    workbook: &MapRef,
    sheets: &MapRef,
    pivot_tables: &[domain_types::domain::pivot::ParsedPivotTable],
    pivot_cache_sources: &[PivotCacheSourceDef],
    sheet_data: &[domain_types::SheetData],
    sheet_ids: &[cell_types::SheetId],
    txn: &mut yrs::TransactionMut<'_>,
) -> Result<(), ComputeError> {
    if pivot_tables.is_empty() {
        return Ok(());
    }

    let sheet_id_by_name: std::collections::HashMap<&str, cell_types::SheetId> = sheet_data
        .iter()
        .zip(sheet_ids.iter())
        .map(|(sheet, sheet_id)| (sheet.name.as_str(), *sheet_id))
        .collect();
    let pivot_cache_source_by_id: std::collections::HashMap<u32, &PivotCacheSourceDef> =
        pivot_cache_sources
            .iter()
            .map(|source| (source.cache_id, source))
            .collect();

    for (index, parsed) in pivot_tables.iter().enumerate() {
        let pivot_spec_key = pivot_spec_key(parsed, index);
        let import_identity = import_identity_for_parsed_pivot(&pivot_spec_key, parsed);
        let cache_source = parsed
            .config
            .cache_id
            .and_then(|cache_id| pivot_cache_source_by_id.get(&cache_id).copied());
        let source_sheet_name = parsed.config.source_sheet_name.as_str();
        let output_sheet_name = parsed.config.output_sheet_name.as_str();

        let classification = classify_imported_pivot(
            parsed,
            import_identity.as_str(),
            cache_source,
            &sheet_id_by_name,
            source_sheet_name,
            output_sheet_name,
        );

        match classification {
            ImportedPivotClassification::Promotable {
                source_sheet_id,
                output_sheet_id,
            } => {
                let native_pivot_id = native_imported_pivot_id(&import_identity);
                let mut config = parsed.config.clone();
                config.id = native_pivot_id.clone();
                config.source_sheet_id = Some(source_sheet_id.to_uuid_string());
                config.output_sheet_id = Some(output_sheet_id.to_uuid_string());
                config.source_sheet_name = source_sheet_name.to_string();
                config.output_sheet_name = output_sheet_name.to_string();

                let inserted =
                    insert_existing_pivot_if_absent_in_txn(txn, sheets, &output_sheet_id, config)?;
                let existing_matches_import = inserted
                    || crate::storage::sheet::pivots::get_pivot_in_txn(
                        txn,
                        sheets,
                        &output_sheet_id,
                        native_pivot_id.as_str(),
                    )
                    .as_ref()
                    .is_some_and(|existing| {
                        existing_promoted_import_pivot_matches(
                            existing,
                            parsed,
                            &source_sheet_id,
                            &output_sheet_id,
                        )
                    });

                let association = if existing_matches_import {
                    association_from_parsed_pivot(
                        pivot_spec_key,
                        index as u32,
                        parsed,
                        import_identity,
                        ImportedPivotAssociationStatus::Promoted,
                        Some(native_pivot_id),
                        Some(output_sheet_id.to_uuid_string()),
                        Some(source_sheet_id.to_uuid_string()),
                        None,
                    )
                } else {
                    tracing::warn!(
                        import_identity = import_identity.as_str(),
                        native_pivot_id = native_pivot_id.as_str(),
                        "Imported pivot promotion skipped because deterministic native pivot ID is already occupied",
                    );
                    association_from_parsed_pivot(
                        pivot_spec_key,
                        index as u32,
                        parsed,
                        import_identity,
                        ImportedPivotAssociationStatus::Unsupported,
                        None,
                        Some(output_sheet_id.to_uuid_string()),
                        Some(source_sheet_id.to_uuid_string()),
                        Some(ImportedPivotUnsupportedReason::NativePivotIdCollision),
                    )
                };
                write_imported_pivot_association(txn, workbook, &association);
            }
            ImportedPivotClassification::Unsupported(reason) => {
                let association = association_from_parsed_pivot(
                    pivot_spec_key,
                    index as u32,
                    parsed,
                    import_identity,
                    ImportedPivotAssociationStatus::Unsupported,
                    None,
                    sheet_id_by_name
                        .get(output_sheet_name)
                        .map(cell_types::SheetId::to_uuid_string),
                    sheet_id_by_name
                        .get(source_sheet_name)
                        .map(cell_types::SheetId::to_uuid_string),
                    Some(reason),
                );
                write_imported_pivot_association(txn, workbook, &association);
            }
        }
    }

    Ok(())
}

fn pivot_spec_key(parsed: &domain_types::domain::pivot::ParsedPivotTable, index: usize) -> String {
    format!("{}_{}", parsed.config.name, index)
}

const WORKBOOK_LINK_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x8d58d5b08e445f579b0d70f6d1f9a321);
const WORKBOOK_IMPORT_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x149c13a0b0a75c55a690c3ab8d3a3210);

fn ensure_imported_workbook_identity(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    external_links: &[ExternalLink],
) -> Result<WorkbookId, ComputeError> {
    if let Some(metadata) =
        read_workbook_metadata(txn, workbook).map_err(|err| ComputeError::Deserialize {
            message: format!("workbook identity read failed: {err}"),
        })?
    {
        return Ok(metadata.workbook_id);
    }

    let identity_seed = external_links
        .iter()
        .map(|link| {
            link.imported_identity
                .as_ref()
                .map(|identity| {
                    format!(
                        "{}:{}:{}",
                        identity.excel_ordinal, identity.workbook_rel_id, identity.part_name
                    )
                })
                .unwrap_or_else(|| format!("orphan:{}", link.id))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let workbook_id = WorkbookId::from_raw(
        uuid::Uuid::new_v5(&WORKBOOK_IMPORT_NAMESPACE, identity_seed.as_bytes()).as_u128(),
    );
    let metadata = PersistedWorkbookMetadata {
        workbook_id,
        created: WorkbookCreationMetadata {
            created_at: None,
            created_by: Some("xlsx-import".to_string()),
            imported_from: Some("xlsx".to_string()),
        },
        lineage: None,
    };
    write_workbook_metadata(txn, workbook, &metadata).map_err(|err| ComputeError::Deserialize {
        message: format!("workbook identity serialization failed: {err}"),
    })?;
    Ok(workbook_id)
}

fn imported_excel_link_id(
    destination_workbook_id: &WorkbookId,
    identity: &domain_types::domain::external_link::ImportedExternalLinkIdentity,
) -> Result<LinkId, ComputeError> {
    let name = format!(
        "{}:excel:{}:{}:{}",
        destination_workbook_id.to_uuid_string(),
        identity.excel_ordinal,
        identity.workbook_rel_id,
        identity.part_name
    );
    Ok(LinkId::from_raw(
        uuid::Uuid::new_v5(&WORKBOOK_LINK_NAMESPACE, name.as_bytes()).as_u128(),
    ))
}

fn imported_artifact_id(destination_workbook_id: &WorkbookId, part_name: &str) -> String {
    let name = format!(
        "{}:orphan-external-link:{}",
        destination_workbook_id.to_uuid_string(),
        part_name
    );
    uuid::Uuid::new_v5(&WORKBOOK_LINK_NAMESPACE, name.as_bytes()).to_string()
}

fn imported_identity_from_domain(
    identity: &domain_types::domain::external_link::ImportedExternalLinkIdentity,
) -> ImportedExternalLinkIdentity {
    ImportedExternalLinkIdentity {
        excel_ordinal: identity.excel_ordinal,
        workbook_rel_id: identity.workbook_rel_id.clone(),
        part_name: identity.part_name.clone(),
        external_book_rid: identity.external_book_rid.clone(),
        target: identity.target.clone(),
        target_mode: identity.target_mode.clone(),
    }
}

fn source_kind_for_external_link(link: &ExternalLink) -> PersistedWorkbookLinkSourceKind {
    match &link.link_type {
        ExternalLinkType::Workbook => PersistedWorkbookLinkSourceKind::ExcelWorkbook,
        ExternalLinkType::Dde { .. } => PersistedWorkbookLinkSourceKind::DdeLink,
        ExternalLinkType::Ole { .. } => PersistedWorkbookLinkSourceKind::OleLink,
    }
}

fn persisted_target_for_external_link(
    link: &ExternalLink,
    identity: &domain_types::domain::external_link::ImportedExternalLinkIdentity,
) -> PersistedLinkTarget {
    match &link.link_type {
        ExternalLinkType::Workbook => {
            let target = link
                .file_path
                .clone()
                .or_else(|| identity.target.clone())
                .unwrap_or_else(|| identity.part_name.clone());
            if target.starts_with("https://") || target.starts_with("http://") {
                PersistedLinkTarget::Url { url: target }
            } else {
                PersistedLinkTarget::OoxmlExternalPath { target }
            }
        }
        ExternalLinkType::Dde { service, topic, .. } => PersistedLinkTarget::OpaqueHostToken {
            namespace: "ooxml-dde".to_string(),
            token: stable_opaque_token(&format!("{service}\u{1f}{topic}")),
        },
        ExternalLinkType::Ole { prog_id, .. } => PersistedLinkTarget::OpaqueHostToken {
            namespace: "ooxml-ole".to_string(),
            token: stable_opaque_token(prog_id),
        },
    }
}

fn stable_opaque_token(seed: &str) -> String {
    uuid::Uuid::new_v5(&WORKBOOK_LINK_NAMESPACE, seed.as_bytes()).to_string()
}

fn display_name_for_external_link(
    link: &ExternalLink,
    identity: &domain_types::domain::external_link::ImportedExternalLinkIdentity,
) -> String {
    match &link.link_type {
        ExternalLinkType::Workbook => link
            .file_path
            .as_deref()
            .and_then(|path| path.rsplit(['/', '\\']).next())
            .filter(|name| !name.is_empty())
            .unwrap_or(identity.part_name.as_str())
            .to_string(),
        ExternalLinkType::Dde { .. } => "Unsupported DDE link".to_string(),
        ExternalLinkType::Ole { .. } => "Unsupported OLE link".to_string(),
    }
}

fn imported_external_package_artifact(
    destination_workbook_id: &WorkbookId,
    link: &ExternalLink,
) -> Result<ImportedExternalPackageArtifact, ComputeError> {
    let part_name = format!("xl/externalLinks/externalLink{}.xml", link.id);
    let payload_json = serde_json::to_string(link).map_err(|err| ComputeError::Deserialize {
        message: format!("orphan external link payload serialization: {err}"),
    })?;
    Ok(ImportedExternalPackageArtifact {
        artifact_id: imported_artifact_id(destination_workbook_id, &part_name),
        artifact_kind: "orphan-external-link".to_string(),
        part_name,
        rels_part_name: None,
        content_type: Some(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"
                .to_string(),
        ),
        payload_kind: "domain-types.external-link".to_string(),
        payload_version: 1,
        payload_json,
        rels_payload: None,
        diagnostic: "externalLink part is not referenced by workbook externalReferences"
            .to_string(),
        tombstoned: false,
    })
}
