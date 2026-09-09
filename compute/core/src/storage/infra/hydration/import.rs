use domain_types::ParseOutput;
use domain_types::domain::pivot::PivotCacheSourceDef;

use value_types::ComputeError;

use crate::storage::WorkbookStorage;
use crate::storage::sheet::pivots::insert_existing_pivot_if_absent;
use crate::storage::workbook::imported_pivots::{
    ImportedPivotAssociationStatus, ImportedPivotUnsupportedReason, association_from_parsed_pivot,
    existing_promoted_import_pivot_matches, import_identity_for_parsed_pivot,
    native_imported_pivot_id, write as write_imported_pivot_association,
};

use super::imported_pivot_classification::{ImportedPivotClassification, classify_imported_pivot};
use super::print_defined_names::hydrate_workbook_print_defined_names;
use super::sheet::{SheetIdAllocation, hydrate_sheet, hydrate_sheet_with_allocation};
use super::styles::{hydrate_style_palette, hydrate_workbook_stylesheet};
use super::table_styles::hydrate_custom_table_styles_from_ooxml;
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

impl WorkbookStorage {
    /// Hydrate typed native metadata and allocate identities shared with the
    /// snapshot builder. Cell values are installed in the mirror by the caller.
    #[tracing::instrument(name = "hydrate_from_parse_output", skip_all)]
    pub fn hydrate_from_parse_output(
        &mut self,
        output: &ParseOutput,
        allocator: &mut impl IdAllocator,
    ) -> Result<HydrationIdMap, ComputeError> {
        self.invalidate_cell_metadata_projection();
        self.imported_array_caches.clear();
        let _span = tracing::info_span!("hydrate_native_metadata").entered();

        let mut id_map = HydrationIdMap::default();

        // Cell properties refer to the shared imported style palette.
        hydrate_style_palette(&mut self.metadata, &output.style_palette);
        hydrate_workbook_stylesheet(&mut self.metadata, &output.workbook_stylesheet);

        for sheet_data in &output.sheets {
            let (
                sheet_id,
                sheet_cell_ids,
                sheet_identities,
                sheet_row_axis,
                sheet_col_axis,
                native_merges,
                native_auto_filter,
                native_hyperlinks,
                native_comments,
                native_floating_objects,
            ) = hydrate_sheet(
                &mut self.cell_metadata,
                sheet_data,
                &output.persons,
                allocator,
            )?;
            self.metadata.sheet_order.push(sheet_id);
            self.sheet_metadata.insert(
                sheet_id,
                crate::storage::sheet::SheetMetadata::from_import(
                    sheet_data,
                    sheet_id,
                    &sheet_row_axis,
                    &sheet_col_axis,
                    native_merges,
                    native_auto_filter,
                ),
            );
            self.sheet_metadata
                .get_mut(&sheet_id)
                .expect("sheet metadata initialized")
                .hyperlinks = native_hyperlinks;
            self.sheet_metadata
                .get_mut(&sheet_id)
                .expect("sheet metadata initialized")
                .comments = native_comments;
            self.sheet_metadata
                .get_mut(&sheet_id)
                .expect("sheet metadata initialized")
                .floating_objects = native_floating_objects;
            self.sheet_metadata
                .get_mut(&sheet_id)
                .expect("sheet metadata initialized")
                .cell_properties = super::styles::hydrate_cell_styles(
                &sheet_data.cells,
                &sheet_cell_ids,
                &Default::default(),
            );
            cache_imported_array_cells(self, sheet_id, sheet_data, &sheet_cell_ids);
            id_map.sheet_ids.push(sheet_id);
            id_map.cell_ids.push(sheet_cell_ids);
            id_map.row_axes.push(sheet_row_axis);
            id_map.col_axes.push(sheet_col_axis);
            id_map.identities.extend(
                sheet_identities
                    .into_iter()
                    .map(|(cell_id, row, col)| (sheet_id, cell_id, row, col)),
            );
        }

        // Populate workbook-level data
        hydrate_workbook_print_defined_names(
            &mut self.sheet_metadata,
            &output.named_ranges,
            &id_map.sheet_ids,
            &output.workbook_sheet_inventory,
        );
        hydrate_workbook_named_ranges(
            &mut self.metadata,
            &output.named_ranges,
            &id_map.sheet_ids,
            &output.workbook_sheet_inventory,
            allocator,
        );
        // Collect tables from all sheets, paired with their sheet IDs.
        let all_tables: Vec<_> = output
            .sheets
            .iter()
            .zip(id_map.sheet_ids.iter())
            .flat_map(|(s, sheet_id)| {
                let sheet_uuid = sheet_id.to_uuid_string();
                s.tables
                    .iter()
                    .map(move |t| (t.clone(), sheet_uuid.clone()))
            })
            .collect();
        let (imported_table_identity, canonical_tables) =
            hydrate_workbook_tables(&all_tables, allocator);
        id_map.canonical_tables = canonical_tables;
        hydrate_workbook_connections(&mut self.metadata, &output.connections);
        hydrate_workbook_root_namespaces(&mut self.metadata, &output.workbook_root_namespaces);
        hydrate_workbook_table_styles(
            &mut self.metadata,
            &output.default_table_style,
            &output.default_pivot_style,
        );
        hydrate_custom_table_styles_from_ooxml(
            &mut self.metadata,
            &output.custom_table_styles,
            &output.workbook_stylesheet,
            &output.theme,
        );
        hydrate_workbook_theme(&mut self.metadata, &output.theme);
        hydrate_workbook_protection(&mut self.metadata, &output.protection);

        // Hydrate slicers: merge per-sheet slicers with workbook-level caches
        // into typed native workbook slicer entries.
        hydrate_workbook_slicers(
            &mut self.metadata,
            &output.sheets,
            &id_map.sheet_ids,
            &output.slicer_caches,
            imported_table_identity,
            &[],
        );
        hydrate_workbook_timelines(
            &mut self.metadata,
            &output.sheets,
            &id_map.sheet_ids,
            &output.timeline_caches,
        );

        // Hydrate pivot tables at workbook level as an OOXML preservation sidecar.
        hydrate_workbook_parsed_pivot_tables(&mut self.metadata, &output.pivot_tables);
        hydrate_workbook_pivot_cache_sources(&mut self.metadata, &output.pivot_cache_sources);
        hydrate_workbook_pivot_cache_records(&mut self.metadata, &output.pivot_cache_records);

        hydrate_workbook_calculation(&mut self.metadata, &output.calculation);
        hydrate_workbook_views(
            &mut self.metadata,
            &output.workbook_views,
            &id_map.sheet_ids,
            &output.workbook_sheet_inventory,
        );
        hydrate_custom_workbook_views_xml(&mut self.metadata, &output.custom_workbook_views_xml);
        hydrate_workbook_web_publishing(&mut self.metadata, &output.web_publishing);
        hydrate_workbook_threaded_comment_persons(
            &mut self.metadata,
            &output.persons,
            output.has_persons_part,
        );
        hydrate_shared_string_hints(&mut self.metadata, &output.shared_string_hints);
        hydrate_package_fidelity_metadata(&mut self.metadata, &output.package_fidelity);
        crate::storage::workbook::sheet_inventory::hydrate(
            &mut self.metadata,
            output,
            &id_map.sheet_ids,
        );
        hydrate_volatile_dependency_part(&mut self.metadata, &output.volatile_dependency_part);
        hydrate_workbook_metadata(
            &mut self.metadata,
            &output.workbook_properties,
            &output.properties,
            &output.extended_properties,
            &output.metadata,
            &output.file_version,
            &output.file_sharing,
        );

        // Stamp schema version — import always creates a new document.

        hydrate_imported_pivots_as_native(
            self,
            &output.pivot_tables,
            &output.pivot_cache_sources,
            &output.sheets,
            &id_map.sheet_ids,
        )?;

        Ok(id_map)
    }

    /// Hydrate metadata using identities already assigned during compact range
    /// classification. The mirror owns the range values directly.
    #[tracing::instrument(name = "hydrate_from_parse_output_with_ranges", skip_all)]
    pub(crate) fn hydrate_from_parse_output_with_ranges(
        &mut self,
        output: &ParseOutput,
        allocations: &[SheetIdAllocation],
        ranged_positions: &[std::collections::HashSet<(u32, u32)>],
        range_style_positions: &[std::collections::HashSet<(u32, u32)>],
        allocator: &mut impl IdAllocator,
    ) -> Result<HydrationIdMap, ComputeError> {
        self.invalidate_cell_metadata_projection();
        self.imported_array_caches.clear();
        let _span = tracing::info_span!("hydrate_native_metadata_with_ranges").entered();

        let mut id_map = HydrationIdMap::default();
        tracing::info!(target: "deferred_hydration", "hydrate: style palette");
        hydrate_style_palette(&mut self.metadata, &output.style_palette);
        hydrate_workbook_stylesheet(&mut self.metadata, &output.workbook_stylesheet);
        tracing::info!(target: "deferred_hydration", "hydrate: sheets start, count={}", output.sheets.len());

        for sheet_idx in 0..output.sheets.len() {
            tracing::info!(target: "deferred_hydration", "hydrate: sheet {sheet_idx} start");
            let alloc = &allocations[sheet_idx];
            let ranged = &ranged_positions[sheet_idx];
            let range_style_positions_for_sheet = &range_style_positions[sheet_idx];
            let identities = self.hydrate_allocated_sheet(
                output,
                sheet_idx,
                alloc,
                ranged,
                range_style_positions_for_sheet,
                allocator,
            )?;
            let sheet_id = alloc.sheet_id;
            self.metadata.sheet_order.push(sheet_id);
            id_map.sheet_ids.push(sheet_id);
            id_map.cell_ids.push(alloc.cell_ids.clone());
            id_map.row_axes.push(alloc.row_axis.clone());
            id_map.col_axes.push(alloc.col_axis.clone());
            id_map.identities.extend(
                identities
                    .into_iter()
                    .map(|(cell_id, row, col)| (sheet_id, cell_id, row, col)),
            );
        }

        tracing::info!(target: "deferred_hydration", "hydrate: all sheets done, workbook-level data");
        // Workbook-level data (identical to hydrate_from_parse_output)
        hydrate_workbook_print_defined_names(
            &mut self.sheet_metadata,
            &output.named_ranges,
            &id_map.sheet_ids,
            &output.workbook_sheet_inventory,
        );
        hydrate_workbook_named_ranges(
            &mut self.metadata,
            &output.named_ranges,
            &id_map.sheet_ids,
            &output.workbook_sheet_inventory,
            allocator,
        );
        let all_tables: Vec<_> = output
            .sheets
            .iter()
            .zip(id_map.sheet_ids.iter())
            .flat_map(|(s, sheet_id)| {
                let sheet_uuid = sheet_id.to_uuid_string();
                s.tables
                    .iter()
                    .map(move |t| (t.clone(), sheet_uuid.clone()))
            })
            .collect();
        let (imported_table_identity, canonical_tables) =
            hydrate_workbook_tables(&all_tables, allocator);
        id_map.canonical_tables = canonical_tables;
        hydrate_workbook_root_namespaces(&mut self.metadata, &output.workbook_root_namespaces);
        hydrate_workbook_table_styles(
            &mut self.metadata,
            &output.default_table_style,
            &output.default_pivot_style,
        );
        hydrate_custom_table_styles_from_ooxml(
            &mut self.metadata,
            &output.custom_table_styles,
            &output.workbook_stylesheet,
            &output.theme,
        );
        hydrate_workbook_theme(&mut self.metadata, &output.theme);
        hydrate_workbook_protection(&mut self.metadata, &output.protection);
        hydrate_workbook_slicers(
            &mut self.metadata,
            &output.sheets,
            &id_map.sheet_ids,
            &output.slicer_caches,
            imported_table_identity,
            &[],
        );
        hydrate_workbook_timelines(
            &mut self.metadata,
            &output.sheets,
            &id_map.sheet_ids,
            &output.timeline_caches,
        );
        hydrate_workbook_parsed_pivot_tables(&mut self.metadata, &output.pivot_tables);
        hydrate_workbook_pivot_cache_sources(&mut self.metadata, &output.pivot_cache_sources);
        hydrate_workbook_pivot_cache_records(&mut self.metadata, &output.pivot_cache_records);
        hydrate_workbook_calculation(&mut self.metadata, &output.calculation);
        hydrate_workbook_views(
            &mut self.metadata,
            &output.workbook_views,
            &id_map.sheet_ids,
            &output.workbook_sheet_inventory,
        );
        hydrate_custom_workbook_views_xml(&mut self.metadata, &output.custom_workbook_views_xml);
        hydrate_workbook_web_publishing(&mut self.metadata, &output.web_publishing);
        hydrate_workbook_threaded_comment_persons(
            &mut self.metadata,
            &output.persons,
            output.has_persons_part,
        );
        hydrate_shared_string_hints(&mut self.metadata, &output.shared_string_hints);
        hydrate_package_fidelity_metadata(&mut self.metadata, &output.package_fidelity);
        crate::storage::workbook::sheet_inventory::hydrate(
            &mut self.metadata,
            output,
            &id_map.sheet_ids,
        );
        hydrate_volatile_dependency_part(&mut self.metadata, &output.volatile_dependency_part);
        hydrate_workbook_metadata(
            &mut self.metadata,
            &output.workbook_properties,
            &output.properties,
            &output.extended_properties,
            &output.metadata,
            &output.file_version,
            &output.file_sharing,
        );

        hydrate_imported_pivots_as_native(
            self,
            &output.pivot_tables,
            &output.pivot_cache_sources,
            &output.sheets,
            &id_map.sheet_ids,
        )?;

        Ok(id_map)
    }
    fn hydrate_allocated_sheet(
        &mut self,
        output: &ParseOutput,
        sheet_idx: usize,
        alloc: &SheetIdAllocation,
        ranged: &std::collections::HashSet<(u32, u32)>,
        range_style_positions_for_sheet: &std::collections::HashSet<(u32, u32)>,
        allocator: &mut impl IdAllocator,
    ) -> Result<Vec<(cell_types::CellId, u32, u32)>, ComputeError> {
        let sheet_data = &output.sheets[sheet_idx];
        let (
            identities,
            native_merges,
            native_auto_filter,
            native_hyperlinks,
            native_comments,
            native_floating_objects,
        ) = hydrate_sheet_with_allocation(
            &mut self.cell_metadata,
            sheet_data,
            &output.persons,
            alloc,
            ranged,
            range_style_positions_for_sheet,
            allocator,
        )?;
        tracing::info!(target: "deferred_hydration", "hydrate: sheet {sheet_idx} hydrated");

        let sheet_id = alloc.sheet_id;
        self.sheet_metadata.insert(
            sheet_id,
            crate::storage::sheet::SheetMetadata::from_import(
                sheet_data,
                sheet_id,
                &alloc.row_axis,
                &alloc.col_axis,
                native_merges,
                native_auto_filter,
            ),
        );
        self.sheet_metadata
            .get_mut(&sheet_id)
            .expect("sheet metadata initialized")
            .hyperlinks = native_hyperlinks;
        self.sheet_metadata
            .get_mut(&sheet_id)
            .expect("sheet metadata initialized")
            .comments = native_comments;
        self.sheet_metadata
            .get_mut(&sheet_id)
            .expect("sheet metadata initialized")
            .floating_objects = native_floating_objects;
        self.sheet_metadata
            .get_mut(&sheet_id)
            .expect("sheet metadata initialized")
            .cell_properties = super::styles::hydrate_cell_styles(
            &sheet_data.cells,
            &alloc.cell_ids,
            range_style_positions_for_sheet,
        );
        cache_imported_array_cells(self, sheet_id, sheet_data, &alloc.cell_ids);
        Ok(identities)
    }

    /// Extend an already loaded workbook with the remaining parsed sheets.
    /// Workbook metadata and loaded sheet state keep their existing identities.
    pub(crate) fn hydrate_remaining_sheets(
        &mut self,
        output: &ParseOutput,
        allocations: &[SheetIdAllocation],
        ranged_positions: &[std::collections::HashSet<(u32, u32)>],
        range_style_positions: &[std::collections::HashSet<(u32, u32)>],
        loaded_sheet_index: usize,
        existing_tables: &[domain_types::domain::table::TableCatalogEntry],
        allocator: &mut impl IdAllocator,
    ) -> Result<HydrationIdMap, ComputeError> {
        self.invalidate_cell_metadata_projection();
        let mut id_map = HydrationIdMap::default();
        for (index, allocation) in allocations.iter().enumerate() {
            id_map.sheet_ids.push(allocation.sheet_id);
            id_map.cell_ids.push(allocation.cell_ids.clone());
            id_map.row_axes.push(allocation.row_axis.clone());
            id_map.col_axes.push(allocation.col_axis.clone());
            if index == loaded_sheet_index {
                continue;
            }
            let identities = self.hydrate_allocated_sheet(
                output,
                index,
                allocation,
                &ranged_positions[index],
                &range_style_positions[index],
                allocator,
            )?;
            id_map.identities.extend(
                identities
                    .into_iter()
                    .map(|(id, row, col)| (allocation.sheet_id, id, row, col)),
            );
        }
        let all_tables: Vec<_> = output
            .sheets
            .iter()
            .zip(&id_map.sheet_ids)
            .enumerate()
            .filter(|(index, _)| *index != loaded_sheet_index)
            .flat_map(|(_, (sheet, id))| {
                sheet
                    .tables
                    .iter()
                    .map(move |table| (table.clone(), id.to_uuid_string()))
            })
            .collect();
        let (table_identity, tables) = hydrate_workbook_tables(&all_tables, allocator);
        id_map.canonical_tables = tables;
        hydrate_workbook_print_defined_names(
            &mut self.sheet_metadata,
            &output.named_ranges,
            &id_map.sheet_ids,
            &output.workbook_sheet_inventory,
        );
        hydrate_workbook_slicers(
            &mut self.metadata,
            &output.sheets,
            &id_map.sheet_ids,
            &output.slicer_caches,
            table_identity,
            existing_tables,
        );
        hydrate_workbook_timelines(
            &mut self.metadata,
            &output.sheets,
            &id_map.sheet_ids,
            &output.timeline_caches,
        );
        hydrate_workbook_parsed_pivot_tables(&mut self.metadata, &output.pivot_tables);
        hydrate_workbook_pivot_cache_sources(&mut self.metadata, &output.pivot_cache_sources);
        hydrate_workbook_pivot_cache_records(&mut self.metadata, &output.pivot_cache_records);
        hydrate_imported_pivots_as_native(
            self,
            &output.pivot_tables,
            &output.pivot_cache_sources,
            &output.sheets,
            &id_map.sheet_ids,
        )?;
        Ok(id_map)
    }
}

fn cache_imported_array_cells(
    storage: &mut WorkbookStorage,
    sheet_id: cell_types::SheetId,
    sheet_data: &domain_types::SheetData,
    cell_ids: &[cell_types::CellId],
) {
    let source_ranges: Vec<_> = sheet_data
        .cells
        .iter()
        .zip(cell_ids)
        .filter(|(cell, _)| {
            cell.projection_role == domain_types::ImportedCellProjectionRole::DynamicArraySource
        })
        .filter_map(|(cell, cell_id)| {
            let array_ref = cell.array_ref.as_deref()?;
            let range = compute_parser::parse_a1_range(array_ref)?;
            let (
                formula_types::CellRef::Positional {
                    row: start_row,
                    col: start_col,
                    ..
                },
                formula_types::CellRef::Positional {
                    row: end_row,
                    col: end_col,
                    ..
                },
            ) = (range.start, range.end)
            else {
                return None;
            };
            Some((
                cell_types::SheetPos::new(cell.row, cell.col),
                *cell_id,
                cell_types::SheetPos::new(start_row.min(end_row), start_col.min(end_col)),
                cell_types::SheetPos::new(start_row.max(end_row), start_col.max(end_col)),
            ))
        })
        .collect();

    let mut claimed = std::collections::HashSet::new();
    let caches: Vec<_> = source_ranges
        .into_iter()
        .filter_map(|(source, source_id, start, end)| {
            let members: Vec<_> = sheet_data
                .cells
                .iter()
                .zip(cell_ids)
                .filter(|(cell, _)| {
                    cell.projection_role
                        == domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget
                        && cell.row >= start.row()
                        && cell.row <= end.row()
                        && cell.col >= start.col()
                        && cell.col <= end.col()
                        && claimed.insert((cell.row, cell.col))
                })
                .map(|(cell, cell_id)| (cell.clone(), *cell_id))
                .collect();
            let (cells, member_ids): (Vec<_>, Vec<_>) = members.into_iter().unzip();
            (!cells.is_empty()).then_some(crate::imported_array_cache::ImportedArrayCache {
                source,
                source_id,
                start,
                end,
                cells,
                cell_ids: member_ids,
                values_current: true,
            })
        })
        .collect();
    if caches.is_empty() {
        storage.imported_array_caches.remove(&sheet_id);
    } else {
        storage.imported_array_caches.insert(sheet_id, caches);
    }
}

fn hydrate_imported_pivots_as_native(
    storage: &mut WorkbookStorage,
    pivot_tables: &[domain_types::domain::pivot::ParsedPivotTable],
    pivot_cache_sources: &[PivotCacheSourceDef],
    sheet_data: &[domain_types::SheetData],
    sheet_ids: &[cell_types::SheetId],
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

                let inserted = insert_existing_pivot_if_absent(storage, &output_sheet_id, config)?;
                let existing_matches_import = inserted
                    || crate::storage::sheet::pivots::get_pivot(
                        storage,
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
                write_imported_pivot_association(storage, &association);
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
                write_imported_pivot_association(storage, &association);
            }
        }
    }

    Ok(())
}

fn pivot_spec_key(parsed: &domain_types::domain::pivot::ParsedPivotTable, index: usize) -> String {
    format!("{}_{}", parsed.config.name, index)
}
