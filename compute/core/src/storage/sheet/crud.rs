//! Native sheet creation, copy, deletion, and ordering.

use std::collections::HashMap;

use cell_types::SheetId;
use compute_document::hex::{hex_to_id, id_to_hex};
use domain_types::units::CharWidth;
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::storage::WorkbookStorage;

struct SheetCreationOptions {
    default_col_width: CharWidth,
}

impl WorkbookStorage {
    fn sheet_exists(&self, sheet_id: &SheetId) -> bool {
        self.sheet_metadata.contains_key(sheet_id)
    }

    fn next_unused_sheet_id(&self, id_alloc: &cell_types::IdAllocator) -> SheetId {
        loop {
            let sheet_id = id_alloc.next_sheet_id();
            if !self.sheet_exists(&sheet_id) {
                return sheet_id;
            }
        }
    }

    // -----------------------------------------------------------------
    // High-level CRUD wrappers (used by TS bridge path + direct callers)
    // -----------------------------------------------------------------

    /// Test helper that creates a new sheet with a generated UUID.
    #[cfg(test)]
    pub(crate) fn create_sheet(
        &mut self,
        mirror: &mut CellMirror,
        name: &str,
        id_alloc: &cell_types::IdAllocator,
    ) -> Result<SheetId, ComputeError> {
        self.create_sheet_with_width(
            mirror,
            name,
            id_alloc,
            domain_types::units::DEFAULT_COL_WIDTH,
        )
    }

    /// Create a sheet using the requested default column width.
    pub(crate) fn create_sheet_with_width(
        &mut self,
        mirror: &mut CellMirror,
        name: &str,
        id_alloc: &cell_types::IdAllocator,
        default_col_width: CharWidth,
    ) -> Result<SheetId, ComputeError> {
        let sheet_id = self.next_unused_sheet_id(id_alloc);
        // Default: 100 rows x 26 cols
        self.add_sheet_with_width(
            mirror,
            sheet_id,
            name,
            100,
            26,
            SheetCreationOptions { default_col_width },
        )?;
        Ok(sheet_id)
    }

    /// Copy values and metadata with fresh sheet, axis, and cell identities.
    pub(crate) fn copy_sheet(
        &mut self,
        mirror: &mut CellMirror,
        source_id: &SheetId,
        new_name: &str,
        id_alloc: &cell_types::IdAllocator,
    ) -> Result<SheetId, ComputeError> {
        let source_hex = id_to_hex(source_id.as_u128());
        let new_id = self.next_unused_sheet_id(id_alloc);
        crate::storage::engine::history::structure::capture_new_sheet(self, new_id);

        // Native values and axes are copied with fresh identities. Compact payloads
        // share immutable memory until either sheet edits a value.
        let mut cell_id_remap: HashMap<String, String> = HashMap::new();
        let source = mirror
            .get_sheet(source_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: source_hex.to_string(),
            })?;
        let native_copy = super::copy_native::NativeSheetCopy::new(
            source,
            mirror,
            new_id,
            new_name,
            id_alloc,
            &mut cell_id_remap,
        );
        let source_pivots = super::pivots::get_all_pivots(self, source_id);

        let source_pivot_keys: Vec<_> = source_pivots
            .iter()
            .map(|pivot| (pivot.id.clone(), pivot.name.clone()))
            .collect();
        let mut copied_pivots = super::pivots::remap_pivots_for_sheet_copy(
            source_pivots,
            source_id,
            &new_id,
            new_name,
            id_alloc,
        );

        // Pivot names are workbook-wide bindings in slicer/timeline caches.
        // Repeated copies of the same source must not reuse its first copy's name.
        let mut used_pivot_names: std::collections::HashSet<String> = self
            .sheet_metadata
            .values()
            .flat_map(|sheet| sheet.pivots.values().map(|pivot| pivot.name.to_lowercase()))
            .chain(
                self.metadata
                    .pivot_specs
                    .values()
                    .map(|pivot| pivot.config.name.to_lowercase()),
            )
            .collect();
        for pivot in &mut copied_pivots {
            let base: String = pivot.name.chars().take(255).collect();
            let mut candidate = base.clone();
            let mut suffix = 2u32;
            while !used_pivot_names.insert(candidate.to_lowercase()) {
                let ending = format!(" {suffix}");
                candidate = format!(
                    "{}{}",
                    base.chars().take(255 - ending.len()).collect::<String>(),
                    ending
                );
                suffix += 1;
            }
            pivot.name = candidate;
        }

        // A copied source has independent values, so its pivots need independent
        // OOXML caches. Leave records absent so export rebuilds them from live cells.
        let mut used_cache_ids: std::collections::HashSet<u32> = self
            .metadata
            .pivot_cache_sources
            .keys()
            .chain(self.metadata.pivot_cache_records.keys())
            .copied()
            .chain(
                self.sheet_metadata
                    .values()
                    .flat_map(|sheet| sheet.pivots.values().filter_map(|pivot| pivot.cache_id)),
            )
            .chain(
                self.metadata
                    .pivot_specs
                    .values()
                    .filter_map(|pivot| pivot.config.cache_id),
            )
            .collect();
        let mut copied_cache_ids = HashMap::new();
        for pivot in &mut copied_pivots {
            if pivot
                .source_sheet_id
                .as_deref()
                .and_then(|id| SheetId::from_uuid_str(id).ok())
                == Some(new_id)
                && let Some(original_cache_id) = pivot.cache_id
            {
                let new_cache_id =
                    *copied_cache_ids
                        .entry(original_cache_id)
                        .or_insert_with(|| {
                            let id = (1..=u32::MAX)
                                .find(|id| used_cache_ids.insert(*id))
                                .expect("pivot cache ID space exhausted");
                            id
                        });
                pivot.cache_id = Some(new_cache_id);
            }
        }

        let insert_at = self
            .metadata
            .sheet_order
            .iter()
            .position(|id| id == source_id)
            .map_or(self.metadata.sheet_order.len(), |index| index + 1);
        crate::storage::engine::history::metadata::capture_workbook_field!(self, sheet_order);
        self.metadata.sheet_order.insert(insert_at, new_id);

        let copied_cell_metadata: Vec<_> = cell_id_remap
            .iter()
            .filter_map(|(old, new)| {
                let old = cell_types::CellId::from_raw(hex_to_id(old)?);
                let new = cell_types::CellId::from_raw(hex_to_id(new)?);
                self.cell_metadata(&old)
                    .cloned()
                    .map(|metadata| (new, metadata))
            })
            .collect();
        for (id, metadata) in copied_cell_metadata {
            self.history.mark_cell_owned(id);
            self.set_cell_metadata(id, metadata);
        }
        let mut metadata = self
            .sheet_metadata
            .get(source_id)
            .cloned()
            .unwrap_or_default();
        super::comments::remap_for_copy(&mut metadata, &native_copy.cell_remap, id_alloc);
        metadata.dimensions.remap_axes(
            |id| native_copy.remap_row(id),
            |id| native_copy.remap_col(id),
        );
        metadata.cell_properties = std::mem::take(&mut metadata.cell_properties)
            .into_iter()
            .filter_map(|(id, value)| {
                native_copy
                    .cell_remap
                    .get(&id)
                    .copied()
                    .map(|new| (new, value))
            })
            .collect();
        metadata.hyperlinks.retain_mut(|link| {
            let Some(start) = native_copy.cell_remap.get(&link.start_id) else {
                return false;
            };
            link.start_id = *start;
            if let Some(end) = link.end_id.as_mut() {
                let Some(new) = native_copy.cell_remap.get(end) else {
                    return false;
                };
                *end = *new;
            }
            true
        });
        metadata.merges.retain_mut(|merge| {
            let (Some(tl), Some(br)) = (
                native_copy.cell_remap.get(&merge.top_left_id),
                native_copy.cell_remap.get(&merge.bottom_right_id),
            ) else {
                return false;
            };
            merge.top_left_id = *tl;
            merge.bottom_right_id = *br;
            true
        });
        super::filters::remap_for_copy(&mut metadata, *source_id, new_id, &cell_id_remap, id_alloc);
        metadata.column_schemas = std::mem::take(&mut metadata.column_schemas)
            .into_iter()
            .filter_map(|(id, schema)| native_copy.remap_col(id).map(|id| (id, schema)))
            .collect();
        for format in metadata.conditional_formats.values_mut() {
            format.sheet_id = new_id.to_uuid_string();
        }
        metadata.data_bindings = std::mem::take(&mut metadata.data_bindings)
            .into_values()
            .map(|mut binding| {
                binding.id = format!("binding-{:032x}", id_alloc.next_u128());
                binding.sheet_id = id_to_hex(new_id.as_u128()).to_string();
                (binding.id.clone(), binding)
            })
            .collect();
        metadata
            .floating_objects
            .remap_for_copy(new_id, &native_copy.cell_remap, id_alloc);
        native_copy.install(mirror, new_id)?;
        let pivot_copies = source_pivot_keys
            .into_iter()
            .zip(copied_pivots.iter())
            .flat_map(|((id, name), copy)| [(id, copy.clone()), (name, copy.clone())])
            .collect();
        crate::storage::workbook::slicers::copy_sheet_objects(
            self,
            source_id,
            &new_id,
            &pivot_copies,
            id_alloc,
        );
        metadata.pivots = copied_pivots
            .into_iter()
            .map(|pivot| (pivot.id.clone(), pivot))
            .collect();
        metadata.name = new_name.to_owned();
        metadata.sparklines.remap_for_copy(new_id, id_alloc);
        metadata.visibility = domain_types::SheetState::Visible;
        metadata.original_sheet_id = None;
        metadata.uid = None;
        for group in metadata
            .grouping
            .row_groups
            .iter_mut()
            .chain(metadata.grouping.column_groups.iter_mut())
        {
            group.sheet_id = id_to_hex(new_id.as_u128()).to_string();
        }
        self.sheet_metadata.insert(new_id, metadata);

        Ok(new_id)
    }

    // -----------------------------------------------------------------
    // Low-level sheet-map + mirror lifecycle
    // -----------------------------------------------------------------

    /// Test helper that adds a sheet with `ORIGIN_USER_EDIT`.
    #[cfg(test)]
    pub(crate) fn add_sheet(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: SheetId,
        name: &str,
        rows: u32,
        cols: u32,
    ) -> Result<(), ComputeError> {
        self.add_sheet_with_width(
            mirror,
            sheet_id,
            name,
            rows,
            cols,
            SheetCreationOptions {
                default_col_width: domain_types::units::DEFAULT_COL_WIDTH,
            },
        )
    }

    fn add_sheet_with_width(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: SheetId,
        name: &str,
        rows: u32,
        cols: u32,
        options: SheetCreationOptions,
    ) -> Result<(), ComputeError> {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        if self.sheet_exists(&sheet_id) {
            return Err(ComputeError::InvalidInput {
                message: format!("Sheet already exists: {}", sheet_hex),
            });
        }

        crate::storage::engine::history::structure::capture_new_sheet(self, sheet_id);
        // Update mirror
        let snap = crate::snapshot::SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id.to_uuid_string(),
            name: name.to_string(),
            rows,
            cols,
            cells: vec![],
            ranges: vec![],
        };
        mirror.add_sheet(snap)?;
        let mut metadata = super::SheetMetadata {
            name: name.to_owned(),
            ..Default::default()
        };
        metadata.format.default_row_height = Some(domain_types::units::DEFAULT_ROW_HEIGHT.0);
        metadata.format.default_col_width = Some(options.default_col_width.0);
        self.sheet_metadata.insert(sheet_id, metadata);
        crate::storage::engine::history::metadata::capture_workbook_field!(self, sheet_order);
        self.metadata.sheet_order.push(sheet_id);

        Ok(())
    }

    /// Remove the sheet, its values, and its owned metadata.
    pub(crate) fn remove_sheet(&mut self, mirror: &mut CellMirror, sheet_id: &SheetId) {
        crate::storage::engine::history::metadata::capture_workbook_field!(self, sheet_order);
        self.metadata.sheet_order.retain(|id| id != sheet_id);
        // Update mirror
        self.cell_metadata
            .retain(|id, _| mirror.sheet_for_cell(id).as_ref() != Some(sheet_id));
        let slicers: Vec<_> = self
            .metadata
            .slicers
            .iter()
            .filter(|(_, value)| {
                SheetId::from_uuid_str(&value.sheet_id).ok().as_ref() == Some(sheet_id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in slicers {
            crate::storage::engine::history::metadata::capture_workbook_entry!(self, slicers, id);
        }
        let timelines: Vec<_> = self
            .metadata
            .timelines
            .iter()
            .filter(|(_, value)| {
                SheetId::from_uuid_str(&value.sheet_id).ok().as_ref() == Some(sheet_id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in timelines {
            crate::storage::engine::history::metadata::capture_workbook_entry!(self, timelines, id);
        }
        self.metadata.slicers.retain(|_, slicer| {
            cell_types::SheetId::from_uuid_str(&slicer.sheet_id)
                .ok()
                .as_ref()
                != Some(sheet_id)
        });
        self.metadata.timelines.retain(|_, timeline| {
            cell_types::SheetId::from_uuid_str(&timeline.sheet_id)
                .ok()
                .as_ref()
                != Some(sheet_id)
        });
        mirror.remove_sheet(sheet_id);
        self.sheet_metadata.remove(sheet_id);
    }

    /// Get the ordered list of sheet IDs.
    ///
    /// Temporarily `pub` because integration tests reach past the engine into
    /// storage for typed `Vec<SheetId>` enumeration — the engine has no typed
    /// sibling to `get_sheet_order()` yet. Once a typed `engine.sheet_ids()` API
    /// lands and those tests migrate, this should return to `pub(crate)`.
    #[doc(hidden)]
    pub fn sheet_order(&self) -> Vec<SheetId> {
        self.metadata.sheet_order.clone()
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::super::order::get_sheet_order;
    use super::super::properties::get_sheet_name;
    use super::super::test_support::{make_sheet_id, setup};
    use crate::mirror::CellMirror;
    use crate::storage::WorkbookStorage;
    use cell_types::IdAllocator;
    use value_types::ComputeError;

    #[test]
    fn test_create_sheet() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let sid = storage
            .create_sheet(&mut mirror, "My Sheet", &*crate::storage::STORAGE_ID_ALLOC)
            .unwrap();
        let order = get_sheet_order(&storage);
        assert_eq!(order.len(), 1);
        assert_eq!(order[0], sid);
        assert_eq!(get_sheet_name(&storage, &sid), Some("My Sheet".to_string()));
    }

    #[test]
    fn test_copy_sheet() {
        let (mut storage, mut mirror, sid) = setup();
        let copy_id = storage
            .copy_sheet(
                &mut mirror,
                &sid,
                "Sheet1 (2)",
                &*crate::storage::STORAGE_ID_ALLOC,
            )
            .unwrap();
        assert_ne!(copy_id, sid);

        let order = get_sheet_order(&storage);
        assert_eq!(order.len(), 2);
        // Copy should be inserted after source
        assert_eq!(order[0], sid);
        assert_eq!(order[1], copy_id);

        assert_eq!(
            get_sheet_name(&storage, &copy_id),
            Some("Sheet1 (2)".to_string())
        );
    }

    #[test]
    fn test_copy_sheet_skips_existing_allocated_id() {
        let (mut storage, mut mirror, sid) = setup();
        let alloc = IdAllocator::with_seed(1);

        let copy_id = storage
            .copy_sheet(&mut mirror, &sid, "Sheet1 (2)", &alloc)
            .unwrap();

        assert_eq!(copy_id, make_sheet_id(2));
        assert_eq!(get_sheet_order(&storage), vec![sid, copy_id]);
        assert_eq!(get_sheet_name(&storage, &sid), Some("Sheet1".to_string()));
        assert_eq!(
            get_sheet_name(&storage, &copy_id),
            Some("Sheet1 (2)".to_string())
        );
    }

    #[test]
    fn test_create_sheet_skips_existing_allocated_id() {
        let (mut storage, mut mirror, sid) = setup();
        let alloc = IdAllocator::with_seed(1);

        let created_id = storage.create_sheet(&mut mirror, "Sheet2", &alloc).unwrap();

        assert_eq!(created_id, make_sheet_id(2));
        assert_eq!(get_sheet_order(&storage), vec![sid, created_id]);
    }

    #[test]
    fn test_add_sheet_rejects_duplicate_id() {
        let (mut storage, mut mirror, sid) = setup();

        let result = storage.add_sheet(&mut mirror, sid, "Duplicate", 10, 5);

        assert!(matches!(result, Err(ComputeError::InvalidInput { .. })));
        assert_eq!(get_sheet_order(&storage), vec![sid]);
        assert_eq!(get_sheet_name(&storage, &sid), Some("Sheet1".to_string()));
    }

    #[test]
    fn test_copy_nonexistent_sheet() {
        let (mut storage, mut mirror, _sid) = setup();
        let result = storage.copy_sheet(
            &mut mirror,
            &make_sheet_id(999),
            "Copy",
            &*crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err());
    }
}
