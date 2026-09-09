use domain_types::SheetData;

use compute_document::hex::id_to_hex;

use cell_types::{AxisIdentityStore, CellId, ColId, RowId, SheetId};
use value_types::ComputeError;

mod allocation;
mod grid_index;
mod identity;

pub(crate) use allocation::{allocate_sheet_ids, allocate_sheet_ids_with_previous_allocation};
pub(crate) use identity::SheetIdAllocation;

use super::IdAllocator;
use super::features::{
    hydrate_auto_filter, hydrate_cells, hydrate_cells_with_ids, hydrate_comments,
    hydrate_floating_objects, hydrate_hyperlinks, hydrate_merges,
};
use grid_index::collect_identity_cells;
use identity::{
    allocate_missing_anchored_identities, insert_missing_anchored_identities, sheet_identity_extent,
};

#[allow(clippy::type_complexity)]
pub(crate) fn hydrate_sheet(
    cell_metadata: &mut crate::storage::CellMetadataMap,
    sheet: &SheetData,
    persons: &[domain_types::domain::comment::PersonInfo],
    allocator: &mut impl IdAllocator,
) -> Result<
    (
        SheetId,
        Vec<CellId>,
        Vec<(CellId, u32, u32)>,
        AxisIdentityStore<RowId>,
        AxisIdentityStore<ColId>,
        Vec<crate::storage::sheet::merges::StoredMerge>,
        Option<domain_types::domain::filter::FilterState>,
        Vec<crate::storage::sheet::hyperlinks::StoredHyperlink>,
        Vec<crate::storage::sheet::comments::StoredComment>,
        crate::storage::sheet::floating_objects::FloatingObjectState,
    ),
    ComputeError,
> {
    // 1. Allocate SheetId
    let sheet_id = allocator.alloc_sheet_id();
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    let (identity_rows, identity_cols) = sheet_identity_extent(sheet);

    let row_axis = allocator.alloc_row_axis(identity_rows);
    let col_axis = allocator.alloc_col_axis(identity_cols);

    // Register authored cells and sparse metadata anchors in one identity map.
    let (cell_ids, mut pos_map) = hydrate_cells(cell_metadata, &sheet.cells, allocator);

    // Allocate native merge corner identities.
    let native_merges = hydrate_merges(&mut pos_map, &sheet.merges, allocator);

    // Native hyperlink anchors and OOXML metadata.
    let native_hyperlinks = hydrate_hyperlinks(&mut pos_map, &sheet.hyperlinks, allocator);

    let anchored_identities = allocate_missing_anchored_identities(sheet, &pos_map, allocator);
    insert_missing_anchored_identities(&mut pos_map, &anchored_identities);

    let native_comments = hydrate_comments(&pos_map, &sheet.comments, persons);

    let native_auto_filter = hydrate_auto_filter(&pos_map, &sheet.auto_filter);

    let chart_fos: Vec<domain_types::domain::floating_object::FloatingObject> = sheet
        .charts
        .iter()
        .enumerate()
        .map(|(i, chart)| chart.to_floating_object(&sheet_hex, i))
        .collect();

    let mut all_floating_objects = sheet.floating_objects.clone();
    all_floating_objects.extend(chart_fos);
    let native_floating_objects =
        hydrate_floating_objects(&mut pos_map, &sheet_id, &all_floating_objects, allocator);

    let identities = collect_identity_cells(
        &pos_map,
        &sheet.cells,
        &cell_ids,
        &std::collections::HashSet::new(),
    );

    Ok((
        sheet_id,
        cell_ids,
        identities,
        row_axis,
        col_axis,
        native_merges,
        native_auto_filter,
        native_hyperlinks,
        native_comments,
        native_floating_objects,
    ))
}

#[allow(clippy::type_complexity)]
pub(crate) fn hydrate_sheet_with_allocation(
    cell_metadata: &mut crate::storage::CellMetadataMap,
    sheet: &SheetData,
    persons: &[domain_types::domain::comment::PersonInfo],
    alloc: &SheetIdAllocation,
    ranged_positions: &std::collections::HashSet<(u32, u32)>,
    range_style_positions: &std::collections::HashSet<(u32, u32)>,
    allocator: &mut impl IdAllocator,
) -> Result<
    (
        Vec<(CellId, u32, u32)>,
        Vec<crate::storage::sheet::merges::StoredMerge>,
        Option<domain_types::domain::filter::FilterState>,
        Vec<crate::storage::sheet::hyperlinks::StoredHyperlink>,
        Vec<crate::storage::sheet::comments::StoredComment>,
        crate::storage::sheet::floating_objects::FloatingObjectState,
    ),
    ComputeError,
> {
    let sheet_hex = &alloc.sheet_hex;

    let required_identity_positions = crate::import::parse_output_to_snapshot::anchor_collection::collect_identity_required_anchors(sheet).into_keys().collect();
    // Preserve sparse feature anchors even when their values use native ranges.
    let mut pos_map = hydrate_cells_with_ids(
        cell_metadata,
        &sheet.cells,
        &alloc.cell_ids,
        ranged_positions,
        range_style_positions,
        &required_identity_positions,
    );

    insert_missing_anchored_identities(&mut pos_map, &alloc.identity_only_cells);

    let native_merges = hydrate_merges(&mut pos_map, &sheet.merges, allocator);

    let native_hyperlinks = hydrate_hyperlinks(&mut pos_map, &sheet.hyperlinks, allocator);
    let native_comments = hydrate_comments(&pos_map, &sheet.comments, persons);

    let native_auto_filter = hydrate_auto_filter(&pos_map, &sheet.auto_filter);
    let chart_fos: Vec<domain_types::domain::floating_object::FloatingObject> = sheet
        .charts
        .iter()
        .enumerate()
        .map(|(i, chart)| chart.to_floating_object(sheet_hex, i))
        .collect();
    let mut all_floating_objects = sheet.floating_objects.clone();
    all_floating_objects.extend(chart_fos);
    let native_floating_objects = hydrate_floating_objects(
        &mut pos_map,
        &alloc.sheet_id,
        &all_floating_objects,
        allocator,
    );

    // Export value-free identities discovered by metadata hydration.
    let identities =
        collect_identity_cells(&pos_map, &sheet.cells, &alloc.cell_ids, ranged_positions);

    Ok((
        identities,
        native_merges,
        native_auto_filter,
        native_hyperlinks,
        native_comments,
        native_floating_objects,
    ))
}
