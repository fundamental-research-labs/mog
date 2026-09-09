use domain_types::{CellData, ImportedCellProjectionRole, MergeRegion};

use compute_document::hex::id_to_hex;

use cell_types::CellId;

use crate::storage::{CellMetadata, CellMetadataMap};

use super::IdAllocator;
use super::form_controls::normalize_form_control_references_for_hydration;
use super::helpers::{PositionMap, get_or_create_cell_id_for_pos};
use crate::import::parse_output_to_snapshot::hyperlink_lowering::{
    HyperlinkAnchor, classify_hyperlink_anchor,
};
use domain_types::domain::hyperlink::HyperlinkTargetKind;
use formula_types::CellRef;

mod comments;
pub(super) use comments::hydrate_comments;

// ===========================================================================
// Cell hydration
// ===========================================================================

/// Allocate explicit cell identities and retain sparse OOXML metadata.
/// Native values and formulas are loaded from the corresponding workbook snapshot.
/// The position map is used by downstream feature hydration.
pub(super) fn hydrate_cells(
    cell_metadata: &mut CellMetadataMap,
    cells: &[CellData],
    allocator: &mut impl IdAllocator,
) -> (Vec<CellId>, PositionMap) {
    let mut allocated_ids = Vec::with_capacity(cells.len());
    let mut pos_map = PositionMap::with_capacity(cells.len());
    for cell in cells {
        let cell_id = allocator.alloc_cell_id();
        allocated_ids.push(cell_id);
        if cell.projection_role == ImportedCellProjectionRole::DynamicArraySpillTarget {
            continue;
        }
        let metadata = CellMetadata::from_import(cell);
        if !metadata.is_empty() {
            cell_metadata.insert(cell_id, metadata);
        }
        let cell_hex = id_to_hex(cell_id.as_u128());

        // Track position → cell_hex in memory for downstream hydration lookups
        pos_map.insert((cell.row, cell.col), cell_hex.to_string());
    }
    (allocated_ids, pos_map)
}

/// Retain preallocated identities for formulas and cell-owned metadata.
/// Values held in native ranges remain positional and do not acquire CellIds.
pub(super) fn hydrate_cells_with_ids(
    cell_metadata: &mut CellMetadataMap,
    cells: &[CellData],
    cell_ids: &[CellId],
    ranged_positions: &std::collections::HashSet<(u32, u32)>,
    range_style_positions: &std::collections::HashSet<(u32, u32)>,
    required_identity_positions: &std::collections::HashSet<(u32, u32)>,
) -> PositionMap {
    let mut pos_map = PositionMap::with_capacity(cells.len() / 2);
    for (i, cell) in cells.iter().enumerate() {
        if cell.projection_role == ImportedCellProjectionRole::DynamicArraySpillTarget {
            continue;
        }
        let metadata = CellMetadata::from_import(cell);
        let has_ooxml_metadata = !metadata.is_empty();
        if has_ooxml_metadata {
            cell_metadata.insert(cell_ids[i], metadata);
        }
        let is_empty = cell.formula.is_none() && cell.value.is_null() && cell.rich_string.is_none();
        let style_is_range_backed = range_style_positions.contains(&(cell.row, cell.col));
        let has_cell_properties = (cell.style_id.is_some() && !style_is_range_backed)
            || cell.cell_metadata_index.is_some()
            || cell.vm.is_some()
            || cell.formula_result_type.is_some()
            || cell.has_empty_cached_value
            || !cell.formula_cache_provenance.is_absent_or_unknown()
            || cell.original_sst_index.is_some()
            || cell.original_value.is_some()
            || cell.rich_string.is_some();

        // Skip truly empty cells (no value, no formula, no persisted properties).
        // Cells with properties must stay in pos_map so hydrate_cell_styles can
        // attach their compact CellProperties entry.
        let is_feature_anchor = required_identity_positions.contains(&(cell.row, cell.col));
        if is_empty && !has_cell_properties && !has_ooxml_metadata && !is_feature_anchor {
            continue;
        }

        let is_ranged = ranged_positions.contains(&(cell.row, cell.col));
        let requires_explicit_identity = !is_ranged
            || cell.formula.is_some()
            || has_cell_properties
            || has_ooxml_metadata
            || is_feature_anchor;
        if !requires_explicit_identity {
            continue;
        }

        let cell_hex = id_to_hex(cell_ids[i].as_u128());

        pos_map.insert((cell.row, cell.col), cell_hex.to_string());
    }
    pos_map
}

// ===========================================================================
// Native merge corner allocation
// ===========================================================================

/// Allocate both merge corners and preserve their authored order.
pub(super) fn hydrate_merges(
    pos_map: &mut PositionMap,
    merges: &[MergeRegion],
    allocator: &mut impl IdAllocator,
) -> Vec<crate::storage::sheet::merges::StoredMerge> {
    merges
        .iter()
        .enumerate()
        .map(|(order, merge)| {
            let mut anchor = |row, col| {
                let hex = pos_map
                    .entry((row, col))
                    .or_insert_with(|| id_to_hex(allocator.alloc_cell_id().as_u128()).to_string());
                CellId::from_raw(
                    compute_document::hex::hex_to_id(hex).expect("allocated CellId hex"),
                )
            };
            crate::storage::sheet::merges::StoredMerge {
                top_left_id: anchor(merge.start_row, merge.start_col),
                bottom_right_id: anchor(merge.end_row, merge.end_col),
                ord: Some(order as u32),
            }
        })
        .collect()
}

/// Preserve every authored link, including overlapping ranges and UID-only entries.
pub(super) fn hydrate_hyperlinks(
    pos_map: &mut PositionMap,
    hyperlinks: &[domain_types::domain::hyperlink::Hyperlink],
    allocator: &mut impl IdAllocator,
) -> Vec<crate::storage::sheet::hyperlinks::StoredHyperlink> {
    let position = |reference: CellRef| match reference {
        CellRef::Positional { row, col, .. } => Some((row, col)),
        CellRef::Resolved(_) => None,
    };
    hyperlinks
        .iter()
        .filter_map(|link| {
            let anchor = classify_hyperlink_anchor(&link.cell_ref)?;
            let (start, end) = match anchor {
                HyperlinkAnchor::Cell(cell) => (position(cell.reference)?, None),
                HyperlinkAnchor::Range(range) => {
                    (position(range.start)?, Some(position(range.end)?))
                }
            };
            let mut allocate = |(row, col)| {
                let hex = get_or_create_cell_id_for_pos(pos_map, row, col, allocator);
                CellId::from_raw(
                    compute_document::hex::hex_to_id(&hex).expect("allocated CellId hex"),
                )
            };
            let mut data = link.clone();
            data.cell_ref.clear();
            data.target_kind = link.target_kind.or_else(|| {
                if link.target.is_some() {
                    Some(HyperlinkTargetKind::Relationship)
                } else if link.location.is_some() {
                    Some(HyperlinkTargetKind::InlineLocation)
                } else {
                    None
                }
            });
            Some(crate::storage::sheet::hyperlinks::StoredHyperlink {
                start_id: allocate(start),
                end_id: end.map(allocate),
                data,
            })
        })
        .collect()
}

/// Install typed drawings and allocate the sparse identities required by their anchors.
pub(super) fn hydrate_floating_objects(
    pos_map: &mut PositionMap,
    sheet_id: &cell_types::SheetId,
    objects: &[domain_types::domain::floating_object::FloatingObject],
    allocator: &mut impl IdAllocator,
) -> crate::storage::sheet::floating_objects::FloatingObjectState {
    let mut state = crate::storage::sheet::floating_objects::FloatingObjectState::default();
    let object_ids: std::collections::BTreeMap<_, _> = objects
        .iter()
        .map(|object| {
            (
                object.common.id.clone(),
                sheet_unique_floating_object_id(&object.common.id, sheet_id),
            )
        })
        .collect();
    for obj in objects.iter() {
        let mut obj = obj.clone();
        obj.common.sheet_id = sheet_id.to_uuid_string();
        obj.common.id = object_ids[&obj.common.id].clone();
        if let domain_types::domain::floating_object::FloatingObjectData::Connector(data) =
            &mut obj.data
        {
            for connection in [&mut data.start_connection, &mut data.end_connection]
                .into_iter()
                .flatten()
            {
                if let Some(id) = object_ids.get(&connection.shape_id) {
                    connection.shape_id = id.clone();
                }
            }
        }
        normalize_form_control_references_for_hydration(&mut obj, pos_map, allocator);
        let anchor = &obj.common.anchor;
        let anchor_hex =
            get_or_create_cell_id_for_pos(pos_map, anchor.anchor_row, anchor.anchor_col, allocator);
        obj.common.anchor_cell_id = Some(anchor_hex);
        if let (Some(end_row), Some(end_col)) = (anchor.end_row, anchor.end_col) {
            let to_anchor_hex = get_or_create_cell_id_for_pos(pos_map, end_row, end_col, allocator);
            obj.common.to_anchor_cell_id = Some(to_anchor_hex);
        }
        state.insert(obj);
    }
    state
}

fn sheet_unique_floating_object_id(id: &str, sheet_id: &cell_types::SheetId) -> String {
    if is_parser_local_floating_object_id(id) {
        format!("{}-{}", id, sheet_id.to_uuid_string())
    } else {
        id.to_string()
    }
}

fn is_parser_local_floating_object_id(id: &str) -> bool {
    let suffix = if let Some(rest) = id.strip_prefix("fobj-fc-") {
        rest
    } else if let Some(rest) = id.strip_prefix("fobj-ole-") {
        rest
    } else if let Some(rest) = id.strip_prefix("fobj-conn-") {
        rest
    } else if let Some(rest) = id.strip_prefix("chart-import-") {
        rest
    } else if let Some(rest) = id.strip_prefix("fobj-") {
        rest
    } else {
        return false;
    };
    !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellValue;

    fn cell(row: u32, col: u32, value: CellValue) -> CellData {
        CellData {
            row,
            col,
            value,
            ..CellData::default()
        }
    }

    #[test]
    fn ranged_value_cells_stay_out_of_pos_map() {
        let cells = vec![cell(0, 0, CellValue::from(1.0))];
        let cell_ids = vec![CellId::from_raw(1)];
        let ranged_positions = std::collections::HashSet::from([(0, 0)]);

        let range_style_positions = std::collections::HashSet::new();
        let pos_map = hydrate_cells_with_ids(
            &mut CellMetadataMap::default(),
            &cells,
            &cell_ids,
            &ranged_positions,
            &range_style_positions,
            &std::collections::HashSet::new(),
        );

        assert!(pos_map.is_empty());
    }

    #[test]
    fn ranged_styled_cells_keep_explicit_identity_for_style_hydration() {
        let mut styled = cell(4, 2, CellValue::from(9.0));
        styled.style_id = Some(7);
        let cells = vec![styled];
        let cell_ids = vec![CellId::from_raw(0xA)];
        let ranged_positions = std::collections::HashSet::from([(4, 2)]);

        let range_style_positions = std::collections::HashSet::new();
        let pos_map = hydrate_cells_with_ids(
            &mut CellMetadataMap::default(),
            &cells,
            &cell_ids,
            &ranged_positions,
            &range_style_positions,
            &std::collections::HashSet::new(),
        );

        assert_eq!(pos_map.get(&(4, 2)), Some(&id_to_hex(0xA).to_string()));
    }

    #[test]
    fn ranged_feature_anchors_preserve_allocated_ids_without_value_overlays() {
        let cells = vec![cell(4, 2, CellValue::from(9.0))];
        let cell_ids = vec![CellId::from_raw(0xA)];
        let ranged_positions = std::collections::HashSet::from([(4, 2)]);
        let mut metadata = CellMetadataMap::default();
        let pos_map = hydrate_cells_with_ids(
            &mut metadata,
            &cells,
            &cell_ids,
            &ranged_positions,
            &std::collections::HashSet::new(),
            &ranged_positions,
        );
        assert_eq!(pos_map.get(&(4, 2)), Some(&id_to_hex(0xA).to_string()));
        assert!(metadata.is_empty());
    }

    #[test]
    fn parser_local_floating_object_ids_are_sheet_unique() {
        let sheet_id = cell_types::SheetId::from_raw(0x12);

        assert_eq!(
            sheet_unique_floating_object_id("fobj-0", &sheet_id),
            format!("fobj-0-{}", sheet_id.to_uuid_string())
        );
        assert_eq!(
            sheet_unique_floating_object_id("fobj-fc-4", &sheet_id),
            format!("fobj-fc-4-{}", sheet_id.to_uuid_string())
        );
        assert_eq!(
            sheet_unique_floating_object_id("chart-import-0", &sheet_id),
            format!("chart-import-0-{}", sheet_id.to_uuid_string())
        );
    }

    #[test]
    fn globally_unique_floating_object_ids_are_preserved() {
        let sheet_id = cell_types::SheetId::from_raw(0x12);

        assert_eq!(
            sheet_unique_floating_object_id("fobj-1780000000000-a", &sheet_id),
            "fobj-1780000000000-a"
        );
        assert_eq!(
            sheet_unique_floating_object_id("chart-import-alpha", &sheet_id),
            "chart-import-alpha"
        );
    }
}

/// Resolve an imported AutoFilter against the allocated native header identities.
pub(super) fn hydrate_auto_filter(
    pos_map: &PositionMap,
    auto_filter: &Option<domain_types::domain::filter::AutoFilter>,
) -> Option<domain_types::domain::filter::FilterState> {
    domain_types::domain::filter::auto_filter_to_filter_state(auto_filter.as_ref()?, &|row, col| {
        pos_map.get(&(row, col)).cloned()
    })
}
