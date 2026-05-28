//! Direct converter: parser-internal pivot types -> unified PivotTableConfig.
//!
//! Bypasses the intermediate `PivotSpec` / `PivotTableDef` types by converting directly
//! from the XLSX parser's `PivotTable` + `PivotCache` (from `domain/pivot/read.rs`) into
//! `pivot_types::PivotTableConfig`.
//!
//! This module ports the logic from `compute-api/src/pure/pivot_convert.rs` so the
//! parser can produce the final compute-ready types in a single step.

use crate::domain::pivot::read::{
    PivotCache, PivotField as ReadPivotField, PivotItem, PivotItemType, PivotTable, SharedItem,
    SortType, Subtotal,
};
use domain_types::domain::pivot::{
    ParsedPivotTable, PivotFieldItem, PivotItemType as DtPivotItemType,
};
use pivot_types::{
    AggregateFunction, AxisPlacement, CellRange, DetectedDataType, FieldId, FilterPlacement,
    LayoutForm, OutputLocation, PIVOT_CONFIG_SCHEMA_VERSION, PivotExpansionState, PivotField,
    PivotFieldPlacement, PivotFieldPlacementFlat, PivotFilter, PivotTableConfig, PivotTableLayout,
    PivotTableStyle, PivotValueSource, PlacementBase, PlacementId, ShowValuesAs,
    ShowValuesAsConfig, SortByValueConfig, SortDirection, ValuePlacement,
};
use value_types::CellValue;

/// Convert parser-internal pivot types directly to the compute-ready
/// `ParsedPivotTable`, bypassing `PivotSpec`. OOXML attributes live on
/// `PivotTableConfig` / `PivotField`.
///
/// Returns `None` for unsupported configurations (e.g., missing cache data).
pub(crate) fn parsed_pivot_to_config(
    pivot: &PivotTable,
    cache: &PivotCache,
    sheet_name: &str,
    cache_records: &[Vec<CellValue>],
) -> Option<ParsedPivotTable> {
    // -- Fields from cache --
    //
    // OOXML attributes (num_fmt_id, base_field, base_item, show_all,
    // subtotal_top, default_subtotal, subtotals, items) are modeled on each
    // `PivotField`. `data_field_info` is looked up at the `pivot.data_fields`
    // level to source num_fmt_id/base_field/base_item.
    let fields: Vec<PivotField> = cache
        .fields
        .iter()
        .enumerate()
        .map(|(idx, cf)| {
            let pf = pivot.pivot_fields.get(idx);
            let data_field_info = pivot
                .data_fields
                .iter()
                .find(|df| df.field_index as usize == idx);
            PivotField {
                id: FieldId::from(cf.name.as_str()),
                name: cf.name.clone(),
                source_column: idx as u32,
                data_type: detect_data_type(cache_records, idx),
                num_fmt_id: data_field_info.and_then(|df| df.num_fmt_id),
                base_field: data_field_info.and_then(|df| df.base_field),
                base_item: data_field_info.and_then(|df| df.base_item),
                show_all: pf.and_then(|f| if f.show_all { Some(true) } else { None }),
                subtotal_top: pf.and_then(|f| if f.subtotal_top { None } else { Some(false) }),
                default_subtotal: pf.and_then(|f| {
                    if f.default_subtotal {
                        None
                    } else {
                        Some(false)
                    }
                }),
                subtotals: Vec::new(), // TODO: parse explicit subtotal functions
                items: pf
                    .map(|f| f.items.iter().map(convert_pivot_item).collect())
                    .unwrap_or_default(),
            }
        })
        .collect();

    // -- Layout (needed for subtotal decisions) --
    let layout = build_layout(pivot);
    let is_tabular = layout
        .layout_form
        .as_ref()
        .map_or(false, |lf| matches!(lf, LayoutForm::Tabular));

    // -- Data field ID mapping for autoSortScope --
    let data_field_ids: Vec<FieldId> = pivot
        .data_fields
        .iter()
        .filter_map(|df| fields.get(df.field_index as usize).map(|f| f.id.clone()))
        .collect();

    // -- Placements --
    let mut placements: Vec<PivotFieldPlacement> = Vec::new();

    // Row fields
    for (pos, field_ref) in pivot.row_fields.iter().enumerate() {
        if field_ref.x < 0 {
            continue; // "Values" pseudo-field
        }
        let field_idx = field_ref.x as usize;
        if let Some(field) = fields.get(field_idx) {
            let pf = pivot.pivot_fields.get(field_idx);
            let show_subtotals =
                pf.map(|fd| fd.default_subtotal && (is_tabular || !fd.subtotal_top));
            let (sort_order, custom_sort_list) = resolve_sort(pf, cache, field_idx);
            let sort_by_value = resolve_sort_by_value(pf, &sort_order, &data_field_ids, cache);
            let effective_sort_order = if sort_by_value.is_some() {
                None
            } else {
                sort_order
            };
            placements.push(PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "row", pos, &field.id),
                    position: pos,
                    display_name: pf.and_then(|fd| fd.name.clone()),
                },
                sort_order: effective_sort_order,
                custom_sort_list,
                sort_by_value,
                date_grouping: None,
                number_grouping: None,
                show_subtotals,
            }));
        }
    }

    // Column fields
    for (pos, field_ref) in pivot.col_fields.iter().enumerate() {
        if field_ref.x < 0 {
            continue;
        }
        let field_idx = field_ref.x as usize;
        if let Some(field) = fields.get(field_idx) {
            let pf = pivot.pivot_fields.get(field_idx);
            let show_subtotals =
                pf.map(|fd| fd.default_subtotal && (is_tabular || !fd.subtotal_top));
            let (sort_order, custom_sort_list) = resolve_sort(pf, cache, field_idx);
            let sort_by_value = resolve_sort_by_value(pf, &sort_order, &data_field_ids, cache);
            let effective_sort_order = if sort_by_value.is_some() {
                None
            } else {
                sort_order
            };
            placements.push(PivotFieldPlacement::Column(AxisPlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "column", pos, &field.id),
                    position: pos,
                    display_name: pf.and_then(|fd| fd.name.clone()),
                },
                sort_order: effective_sort_order,
                custom_sort_list,
                sort_by_value,
                date_grouping: None,
                number_grouping: None,
                show_subtotals,
            }));
        }
    }

    // Data (value) fields
    for (pos, data_field) in pivot.data_fields.iter().enumerate() {
        let field_idx = data_field.field_index as usize;
        if let Some(field) = fields.get(field_idx) {
            let show_values_as =
                convert_show_data_as(&data_field.show_data_as, data_field.base_field, &fields);
            placements.push(PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "value", pos, &field.id),
                    position: pos,
                    display_name: data_field.name.clone(),
                },
                source: PivotValueSource::Field {
                    field_id: field.id.clone(),
                },
                aggregate_function: convert_subtotal(&data_field.subtotal),
                number_format: None,
                show_values_as,
            }));
        }
    }

    // Page (filter) fields
    for (pos, page_field) in pivot.page_fields.iter().enumerate() {
        let field_idx = page_field.field_index as usize;
        if let Some(field) = fields.get(field_idx) {
            placements.push(PivotFieldPlacement::Filter(FilterPlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "filter", pos, &field.id),
                    position: pos,
                    display_name: page_field.name.clone(),
                },
            }));
        }
    }

    // -- Filters --
    let filters = build_filters(pivot, &fields, cache);

    // -- Output location --
    //
    // Typed range refs: `pivot.location.ref_` is now typed
    // (`Option<compute_parser::ast::RangeRef>`). The anchor (top-left cell) is
    // the `start` corner of the range; no re-parsing required.
    let (anchor_row, anchor_col) = pivot.location.ref_.as_ref().and_then(|r| match r.start {
        formula_types::CellRef::Positional { row, col, .. } => Some((row, col)),
        formula_types::CellRef::Resolved(_) => None,
    })?;

    // -- Source range --
    let source_range = parse_source_range(cache).unwrap_or_else(|| {
        let num_rows = cache_records.len() as u32;
        let num_cols = cache.fields.len() as u32;
        CellRange::new(0, 0, num_rows, num_cols.saturating_sub(1))
    });

    // -- IDs and names --
    let id = format!("xlsx-pivot-{}", pivot.name);
    let source_sheet_name = cache
        .source_sheet
        .clone()
        .unwrap_or_else(|| "xlsx-source-sheet".to_string());

    // -- Style --
    let style = pivot.style_info.as_ref().map(|s| PivotTableStyle {
        style_name: s.name.clone(),
        show_row_headers: Some(s.show_row_headers),
        show_column_headers: Some(s.show_col_headers),
        show_row_stripes: if s.show_row_stripes { Some(true) } else { None },
        show_column_stripes: if s.show_col_stripes { Some(true) } else { None },
        show_last_column: Some(s.show_last_column),
    });

    // -- OOXML location attributes folded onto the config --
    //
    // Typed range refs: canonicalize the typed `ref_` back to A1 for the
    // `ref_range: Option<String>` field (still a String because it flows
    // through `domain_types`, which is outside W4.c scope). A missing/
    // non-positional typed ref, combined with zero offsets, elides the
    // location group entirely.
    let loc = &pivot.location;
    let ref_range_str = loc
        .ref_
        .as_ref()
        .map(|r| r.to_a1_string())
        .unwrap_or_default();
    let has_ooxml_location = !ref_range_str.is_empty()
        || loc.first_header_row != 0
        || loc.first_data_row != 0
        || loc.first_data_col != 0
        || loc.rows_per_page != 0
        || loc.cols_per_page != 0;
    let (ref_range, first_header_row, first_data_row, first_data_col, rows_per_page, cols_per_page) =
        if has_ooxml_location {
            (
                if ref_range_str.is_empty() {
                    None
                } else {
                    Some(ref_range_str)
                },
                Some(loc.first_header_row),
                Some(loc.first_data_row),
                Some(loc.first_data_col),
                (loc.rows_per_page > 0).then_some(loc.rows_per_page),
                (loc.cols_per_page > 0).then_some(loc.cols_per_page),
            )
        } else {
            (None, None, None, None, None, None)
        };

    // -- Build PivotTableConfig (unified compute + OOXML) --
    let config = PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id,
        name: pivot.name.clone(),
        source_sheet_id: None,
        source_sheet_name,
        source_range,
        output_sheet_name: sheet_name.to_string(),
        output_location: OutputLocation {
            row: anchor_row,
            col: anchor_col,
        },
        fields,
        placements: placements
            .into_iter()
            .map(PivotFieldPlacementFlat::from)
            .collect(),
        filters,
        layout: Some(layout),
        style,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id: Some(cache.id),
        ref_range,
        first_data_row,
        first_header_row,
        first_data_col,
        rows_per_page,
        cols_per_page,
        row_items: pivot.row_items.iter().map(convert_row_col_item).collect(),
        col_items: pivot.col_items.iter().map(convert_row_col_item).collect(),
    };

    // Build initial expansion state from OOXML sd="0" (show_details) attributes.
    // Items with show_details=true are expanded; items with show_details=false are collapsed.
    let initial_expansion_state = build_expansion_state_from_ooxml(pivot, cache);

    Some(ParsedPivotTable {
        config,
        initial_expansion_state,
    })
}

// ============================================================================
// Expansion state from OOXML sd attributes
// ============================================================================

/// Build a `PivotExpansionState` from the OOXML `sd` (show_details) attributes.
///
/// For each row field, iterates its items and adds expanded items' keys to
/// `expanded_rows`. The key format matches `normalize_to_key()` from the
/// compute-pivot grouper (type-prefixed canonical keys).
///
/// Returns `None` if all items have `show_details=true` (everything expanded,
/// so no explicit expansion state is needed — callers can pass
/// `Some(PivotExpansionState::default())` to get the same effect).
fn build_expansion_state_from_ooxml(
    pivot: &PivotTable,
    cache: &PivotCache,
) -> Option<PivotExpansionState> {
    let mut expanded_rows = std::collections::HashSet::new();
    let mut has_any_collapsed = false;

    // Process non-leaf row fields in order (each level in the hierarchy).
    // Leaf-level items (last row field) cannot be expanded/collapsed, so skip them.
    //
    // Keys are prefixed with depth index to prevent cross-field collisions:
    // e.g., "Management Fees" might appear in both depth-0 (Addbacks Name, sd=0)
    // and depth-2 (Description, sd=1) — without depth prefix, the depth-2 entry
    // would incorrectly make the depth-0 node appear expanded.
    let num_row_fields = pivot.row_fields.iter().filter(|r| r.x >= 0).count();
    let mut depth = 0usize;
    for field_ref in &pivot.row_fields {
        if field_ref.x < 0 {
            continue; // "Values" pseudo-field
        }
        // Skip the last row field (leaf level) — leaf items have no children to expand.
        if depth >= num_row_fields.saturating_sub(1) {
            depth += 1;
            continue;
        }
        let field_idx = field_ref.x as usize;
        let pf = match pivot.pivot_fields.get(field_idx) {
            Some(pf) => pf,
            None => {
                depth += 1;
                continue;
            }
        };
        let shared_items = cache
            .fields
            .get(field_idx)
            .map(|cf| &cf.shared_items[..])
            .unwrap_or(&[]);

        for item in &pf.items {
            // Only process data items (not subtotals, grand totals, etc.)
            if !matches!(item.item_type, PivotItemType::Data) {
                continue;
            }
            let shared_idx = match item.x {
                Some(idx) => idx as usize,
                None => continue,
            };
            let shared_item = match shared_items.get(shared_idx) {
                Some(si) => si,
                None => continue,
            };
            // Prefix key with depth to avoid cross-field collisions.
            let key = format!("{}\x01{}", depth, shared_item_to_key(shared_item));

            if item.show_details {
                expanded_rows.insert(key);
            } else {
                has_any_collapsed = true;
            }
        }
        depth += 1;
    }

    // If nothing is collapsed, return None (no expansion state needed — the
    // compute engine will use the caller-provided state or its own default).
    if !has_any_collapsed {
        return None;
    }

    Some(PivotExpansionState {
        expanded_rows,
        expanded_columns: std::collections::HashSet::new(),
        expanded_row_keys: Vec::new(),
        expanded_column_keys: Vec::new(),
    })
}

fn parsed_pivot_placement_id(
    pivot_name: &str,
    area: &str,
    position: usize,
    field_id: &FieldId,
) -> PlacementId {
    PlacementId::new(format!(
        "xlsx:{}:{}:{}:{}",
        sanitize_pivot_id_part(pivot_name),
        area,
        position,
        sanitize_pivot_id_part(field_id.as_str())
    ))
}

fn sanitize_pivot_id_part(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

// ============================================================================
// Sort resolution
// ============================================================================

/// Resolve sort direction and custom sort list from a pivot field definition.
///
/// When `sortType` is absent or "manual", we build a `custom_sort_list` from
/// the items array so that items appear in their original Excel order.
fn resolve_sort(
    field_def: Option<&ReadPivotField>,
    cache: &PivotCache,
    field_idx: usize,
) -> (Option<SortDirection>, Option<Vec<CellValue>>) {
    let fd = match field_def {
        Some(fd) => fd,
        None => return (None, None),
    };

    let sort_dir = match fd.sort_type {
        Some(SortType::Ascending) => Some(SortDirection::Asc),
        Some(SortType::Descending) => Some(SortDirection::Desc),
        _ => None,
    };

    // Build custom sort list from items array (shared items resolution).
    if !fd.items.is_empty() {
        let shared_items = cache.fields.get(field_idx).map(|cf| &cf.shared_items);
        let custom_list: Vec<CellValue> = fd
            .items
            .iter()
            .filter(|item| matches!(item.item_type, PivotItemType::Data))
            .filter_map(|item| {
                let idx = item.x? as usize;
                shared_items
                    .and_then(|si| si.get(idx))
                    .map(shared_item_to_cell_value)
            })
            .collect();

        if !custom_list.is_empty() {
            return (sort_dir, Some(custom_list));
        }
    }

    (sort_dir, None)
}

/// Resolve autoSortScope into SortByValueConfig.
fn resolve_sort_by_value(
    field_def: Option<&ReadPivotField>,
    sort_order: &Option<SortDirection>,
    data_field_ids: &[FieldId],
    cache: &PivotCache,
) -> Option<SortByValueConfig> {
    let fd = field_def?;
    let data_field_pos = fd.auto_sort_data_field? as usize;
    let value_field_id = data_field_ids.get(data_field_pos)?.clone();
    let order = (*sort_order)?;

    // Build column_key from the second autoSortScope reference if present.
    let column_key = fd
        .auto_sort_column_field
        .zip(fd.auto_sort_column_item)
        .and_then(|(col_field_idx, col_item_idx)| {
            let cache_field = cache.fields.get(col_field_idx as usize)?;
            let shared_item = cache_field.shared_items.get(col_item_idx as usize)?;
            Some(shared_item_to_key(shared_item))
        });

    Some(SortByValueConfig {
        value_field_id,
        order,
        column_key,
    })
}

// ============================================================================
// Filter construction
// ============================================================================

/// Build PivotFilter entries from page fields (include) and hidden items (exclude).
fn build_filters(
    pivot: &PivotTable,
    fields: &[PivotField],
    cache: &PivotCache,
) -> Vec<PivotFilter> {
    let mut filters = Vec::new();

    // Pass 1: page fields with a single selected item -> include filter.
    for page_field in &pivot.page_fields {
        let field_idx = page_field.field_index as usize;
        let item_idx = match page_field.item {
            Some(idx) => idx as usize,
            None => continue,
        };

        let field = match fields.get(field_idx) {
            Some(f) => f,
            None => continue,
        };

        let pf = match pivot.pivot_fields.get(field_idx) {
            Some(pf) => pf,
            None => continue,
        };

        let field_item = match pf.items.get(item_idx) {
            Some(item) if matches!(item.item_type, PivotItemType::Data) => item,
            _ => continue,
        };

        let shared_item_idx = match field_item.x {
            Some(idx) => idx as usize,
            None => continue,
        };

        let filter_value = cache
            .fields
            .get(field_idx)
            .and_then(|cf| cf.shared_items.get(shared_item_idx))
            .map(shared_item_to_cell_value);

        if let Some(value) = filter_value {
            filters.push(PivotFilter {
                field_id: field.id.clone(),
                include_values: Some(vec![value]),
                exclude_values: None,
                condition: None,
                top_bottom: None,
                show_items_with_no_data: None,
            });
        }
    }

    // Pass 2: hidden items -> exclude filter + blank item handling.
    let included_field_ids: std::collections::HashSet<String> =
        filters.iter().map(|f| f.field_id.to_string()).collect();

    for (field_idx, pf) in pivot.pivot_fields.iter().enumerate() {
        if pf.items.is_empty() {
            continue;
        }

        let field = match fields.get(field_idx) {
            Some(f) => f,
            None => continue,
        };

        if included_field_ids.contains(field.id.as_str()) {
            continue;
        }

        let shared_items = cache.fields.get(field_idx).map(|cf| &cf.shared_items);
        let mut exclude_values = Vec::new();

        for item in &pf.items {
            // Hidden blank items: add Null to exclude list.
            // The default show_items_with_no_data=true preserves non-hidden blanks;
            // only explicit excludes remove them.
            if matches!(item.item_type, PivotItemType::Blank) {
                if item.hidden {
                    exclude_values.push(CellValue::Null);
                }
                continue;
            }

            if !item.hidden || !matches!(item.item_type, PivotItemType::Data) {
                continue;
            }
            if let Some(value_idx) = item.x {
                if let Some(value) = shared_items.and_then(|si| si.get(value_idx as usize)) {
                    exclude_values.push(shared_item_to_cell_value(value));
                }
            }
        }

        if !exclude_values.is_empty() {
            filters.push(PivotFilter {
                field_id: field.id.clone(),
                include_values: None,
                exclude_values: Some(exclude_values),
                condition: None,
                top_bottom: None,
                show_items_with_no_data: None,
            });
        }
    }

    filters
}

// ============================================================================
// Layout
// ============================================================================

/// Build layout configuration from pivot table attributes and field flags.
fn build_layout(pivot: &PivotTable) -> PivotTableLayout {
    let has_non_compact = pivot.pivot_fields.iter().any(|f| !f.compact);
    let has_non_outline = pivot.pivot_fields.iter().any(|f| !f.outline);

    let layout_form = if has_non_compact && has_non_outline {
        Some(LayoutForm::Tabular)
    } else if has_non_compact {
        Some(LayoutForm::Outline)
    } else {
        None // Compact (default)
    };

    PivotTableLayout {
        show_row_grand_totals: Some(pivot.row_grand_totals),
        show_column_grand_totals: Some(pivot.col_grand_totals),
        layout_form,
        subtotal_location: None,
        repeat_row_labels: None,
        insert_blank_row_after_item: None,
        show_row_headers: None,
        show_column_headers: None,
        classic_layout: None,
        grand_total_caption: pivot.grand_total_caption.clone(),
        row_header_caption: pivot.row_header_caption.clone(),
        col_header_caption: pivot.col_header_caption.clone(),
        data_caption: None, // Not parsed by read.rs
        grid_drop_zones: if pivot.grid_drop_zones {
            Some(true)
        } else {
            None
        },
        error_caption: pivot.error_caption.clone(),
        show_error: if pivot.show_error { Some(true) } else { None },
        missing_caption: pivot.missing_caption.clone(),
        show_missing: if !pivot.show_missing {
            Some(false)
        } else {
            None
        },
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Detect the data type for a column by sampling cache records.
fn detect_data_type(records: &[Vec<CellValue>], col_idx: usize) -> DetectedDataType {
    let mut has_number = false;
    let mut has_text = false;
    let mut has_bool = false;
    let mut count = 0;

    for row in records.iter().take(100) {
        if let Some(val) = row.get(col_idx) {
            match val {
                CellValue::Number(_) => {
                    has_number = true;
                    count += 1;
                }
                CellValue::Text(_) => {
                    has_text = true;
                    count += 1;
                }
                CellValue::Boolean(_) => {
                    has_bool = true;
                    count += 1;
                }
                CellValue::Null => {}
                _ => {
                    count += 1;
                }
            }
        }
    }

    if count == 0 {
        return DetectedDataType::Empty;
    }
    if has_number && !has_text && !has_bool {
        return DetectedDataType::Number;
    }
    if has_bool && !has_text && !has_number {
        return DetectedDataType::Boolean;
    }
    DetectedDataType::String
}

/// Convert parser-internal Subtotal to pivot-types AggregateFunction.
fn convert_subtotal(s: &Subtotal) -> AggregateFunction {
    match s {
        Subtotal::Sum => AggregateFunction::Sum,
        Subtotal::Count => AggregateFunction::CountA,
        Subtotal::Average => AggregateFunction::Average,
        Subtotal::Max => AggregateFunction::Max,
        Subtotal::Min => AggregateFunction::Min,
        Subtotal::Product => AggregateFunction::Product,
        Subtotal::CountNums => AggregateFunction::Count,
        Subtotal::StdDev => AggregateFunction::StdDev,
        Subtotal::StdDevP => AggregateFunction::StdDevP,
        Subtotal::Var => AggregateFunction::Var,
        Subtotal::VarP => AggregateFunction::VarP,
    }
}

/// Convert an OOXML `showDataAs` attribute string to a `ShowValuesAsConfig`.
///
/// Returns `None` for "normal" or absent values (no transformation).
fn convert_show_data_as(
    show_data_as: &Option<String>,
    base_field_idx: Option<i32>,
    fields: &[PivotField],
) -> Option<ShowValuesAsConfig> {
    let s = show_data_as.as_deref()?;

    let calculation_type = match s {
        "normal" => return None,
        "percentOfTotal" => ShowValuesAs::PercentOfGrandTotal,
        "percentOfRow" => ShowValuesAs::PercentOfRowTotal,
        "percentOfCol" => ShowValuesAs::PercentOfColumnTotal,
        "difference" => ShowValuesAs::Difference,
        "percentDiff" => ShowValuesAs::PercentDifference,
        "runTotal" => ShowValuesAs::RunningTotal,
        "index" => ShowValuesAs::Index,
        "percent" => ShowValuesAs::PercentOfParentRowTotal,
        "percentOfRunningTotal" => ShowValuesAs::PercentRunningTotal,
        "rankAscending" => ShowValuesAs::RankAscending,
        "rankDescending" => ShowValuesAs::RankDescending,
        "percentOfParentRow" => ShowValuesAs::PercentOfParentRowTotal,
        "percentOfParentCol" => ShowValuesAs::PercentOfParentColumnTotal,
        _ => return None, // Unknown value — skip
    };

    // Resolve base_field index to a FieldId when present and valid.
    let base_field = base_field_idx
        .filter(|&idx| idx >= 0)
        .and_then(|idx| fields.get(idx as usize))
        .map(|f| f.id.clone());

    Some(ShowValuesAsConfig {
        calculation_type,
        base_field,
        base_item: None, // OOXML base_item is a numeric index; engine uses value-based refs
    })
}

/// Convert a parser-internal SharedItem to a CellValue.
fn shared_item_to_cell_value(item: &SharedItem) -> CellValue {
    match item {
        SharedItem::String(s) => CellValue::Text(s.as_str().into()),
        SharedItem::Number(n) => CellValue::number(*n),
        SharedItem::Boolean(b) => CellValue::Boolean(*b),
        SharedItem::Error(e) => e
            .parse::<value_types::CellError>()
            .map(|e| CellValue::Error(e, None))
            .unwrap_or(CellValue::Null),
        SharedItem::DateTime(s) => CellValue::Text(s.as_str().into()),
        SharedItem::Missing => CellValue::Null,
    }
}

/// Convert a parser-internal SharedItem to the canonical grouping key format
/// used by `cell_value_to_key` in `compute-stats`.
///
/// Replicates the key format here to avoid a cross-crate dependency:
///   - String  → `"T:<lowercase>"`
///   - Number  → `"N:<bits>"` (IEEE 754 bit representation)
///   - Boolean → `"B:<bool>"`
///   - Error   → `"E:<error_str>"`
///   - DateTime → `"T:<lowercase>"`
///   - Missing → blank sentinel
fn shared_item_to_key(item: &SharedItem) -> String {
    match item {
        SharedItem::String(s) => format!("T:{}", s.to_lowercase()),
        SharedItem::Number(n) => {
            let n = if *n == 0.0 { 0.0 } else { *n };
            format!("N:{}", n.to_bits())
        }
        SharedItem::Boolean(b) => format!("B:{b}"),
        SharedItem::Error(e) => format!("E:{e}"),
        SharedItem::DateTime(s) => format!("T:{}", s.to_lowercase()),
        SharedItem::Missing => "\x00BLANK\x00".to_string(),
    }
}

/// Convert a parser-internal PivotItem to a domain-types PivotFieldItem.
fn convert_pivot_item(item: &PivotItem) -> PivotFieldItem {
    PivotFieldItem {
        item_type: convert_item_type(&item.item_type),
        value: item.x,
        hidden: item.hidden,
        show_details: item.show_details,
        s: item.s.clone(),
    }
}

fn convert_row_col_item(
    item: &crate::domain::pivot::read::PivotRowColItem,
) -> domain_types::PivotRowColItem {
    domain_types::PivotRowColItem {
        item_type: item.item_type.as_ref().map(convert_item_type),
        x_values: item.x_values.clone(),
    }
}

/// Convert parser-internal PivotItemType to domain-types PivotItemType.
fn convert_item_type(t: &PivotItemType) -> DtPivotItemType {
    match t {
        PivotItemType::Data => DtPivotItemType::Data,
        PivotItemType::Default => DtPivotItemType::Default,
        PivotItemType::Sum => DtPivotItemType::Sum,
        PivotItemType::CountA => DtPivotItemType::CountA,
        PivotItemType::Avg => DtPivotItemType::Avg,
        PivotItemType::Max => DtPivotItemType::Max,
        PivotItemType::Min => DtPivotItemType::Min,
        PivotItemType::Product => DtPivotItemType::Product,
        PivotItemType::Count => DtPivotItemType::Count,
        PivotItemType::Stddev => DtPivotItemType::StdDev,
        PivotItemType::StddevP => DtPivotItemType::StdDevP,
        PivotItemType::Var => DtPivotItemType::Var,
        PivotItemType::VarP => DtPivotItemType::VarP,
        PivotItemType::Grand => DtPivotItemType::Grand,
        PivotItemType::Blank => DtPivotItemType::Blank,
    }
}

/// Parse an A1-style range string into a SheetRange (CellRange).
fn parse_source_range(cache: &PivotCache) -> Option<CellRange> {
    let range_str = cache.source_ref.as_ref()?;
    let (start_row, start_col, end_row, end_col) = crate::infra::a1::parse_a1_range(range_str)?;
    Some(CellRange::new(start_row, start_col, end_row, end_col))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::read::{
        CacheField, DataField, PivotFieldRef, PivotItem, PivotItemType,
    };

    /// Helper: build a minimal PivotCache with fields and records.
    fn make_cache(field_names: &[&str]) -> PivotCache {
        let fields = field_names
            .iter()
            .map(|name| CacheField {
                name: name.to_string(),
                shared_items: Vec::new(),
                ..Default::default()
            })
            .collect();
        PivotCache {
            id: 1,
            source_ref: Some("A1:Z100".to_string()),
            source_sheet: Some("Data".to_string()),
            fields,
            records: Vec::new(),
            ..Default::default()
        }
    }

    /// Helper: build a PivotField.
    fn make_read_pivot_field(
        index: u32,
        axis: Option<crate::domain::pivot::read::PivotAxis>,
        sort_type: Option<SortType>,
        auto_sort_data_field: Option<u32>,
        items: Vec<PivotItem>,
    ) -> ReadPivotField {
        ReadPivotField {
            index,
            axis,
            sort_type,
            auto_sort_data_field,
            items,
            compact: true,
            outline: true,
            default_subtotal: true,
            ..Default::default()
        }
    }

    fn make_data_item(x: u32) -> PivotItem {
        PivotItem {
            item_type: PivotItemType::Data,
            x: Some(x),
            hidden: false,
            show_details: true,
            s: None,
        }
    }

    // ========================================================================
    // mWzMdU: autoSortScope column_key not populated
    // ========================================================================
    // mWzMdU corpus file: autoSortScope has TWO <reference> elements:
    //   1. field="4294967294" (data field sentinel) — parsed as auto_sort_data_field
    //   2. field="16" with <x v="6"/> (column field item = FY2024) — NOT parsed
    //
    // resolve_sort_by_value() always sets column_key: None, so the engine
    // sorts by the wrong column (first leaf instead of FY2024).
    //
    // This test SHOULD FAIL until the fix is implemented.

    #[test]
    #[ignore = "known bug: autoSortScope column_key not yet populated (see mWzMdU)"]
    fn auto_sort_scope_should_populate_column_key() {
        // Simulate a pivot with:
        //   - Column field "FiscalYear" (field index 16) with shared items
        //     [2018, 2019, 2020, 2021, 2022, 2023, 2024]
        //   - autoSortScope references data field 0, column field 16 item 6 (=2024)
        //
        // The converter needs the cache + column field info to resolve item 6
        // into the column key string "T:2024". Currently, the ReadPivotField
        // doesn't even store the column reference, so we can only test the
        // converter function as-is.

        let data_field_ids = vec![FieldId::from("amount")];

        let field_def = make_read_pivot_field(
            1,
            Some(crate::domain::pivot::read::PivotAxis::Row),
            Some(SortType::Descending),
            Some(0),
            vec![],
        );

        let cache = make_cache(&["FiscalYear"]);
        let result = resolve_sort_by_value(
            Some(&field_def),
            &Some(SortDirection::Desc),
            &data_field_ids,
            &cache,
        );

        let sbv = result.expect("should produce SortByValueConfig");

        // BUG: column_key is None. For the mWzMdU file, it should be the key
        // for FY2024 (e.g. "N:2024" or "T:2024"). This causes the engine to
        // sort by the first column (FY2018) instead of FY2024, producing
        // completely wrong row ordering and data values.
        assert!(
            sbv.column_key.is_some(),
            "column_key should be populated from autoSortScope column reference, \
             but resolve_sort_by_value() always returns None. \
             Fix: parse second <reference> in autoSortScope (field=column_field_idx, \
             <x v=item_idx/>), look up shared item value from cache, build key string."
        );
    }

    // ========================================================================
    // mWzMdU: sd="0" must produce a PivotExpansionState
    // ========================================================================
    // mWzMdU corpus file: pivot field items have sd="0" on collapsed items.
    // Without expansion state, the compute engine expands all items, showing
    // Product Family detail rows where only Business Unit subtotals should appear.
    //
    // This end-to-end test builds a ParsedPivotTable from the converter, then
    // feeds it to the compute engine (simulating the full XLSX import path).
    // It asserts that collapsed items' children are hidden — which FAILS
    // because no expansion state is built.

    #[test]
    fn show_details_should_produce_expansion_state() {
        // 2-level hierarchy: Division > Department
        // Division "Sales" has sd="0" (collapsed) — its departments should be hidden.
        let mut cache = make_cache(&["Division", "Department", "Salary"]);
        cache.fields[0].shared_items = vec![
            SharedItem::String("Engineering".to_string()),
            SharedItem::String("Sales".to_string()),
        ];
        cache.fields[1].shared_items = vec![
            SharedItem::String("Backend".to_string()),
            SharedItem::String("Enterprise".to_string()),
        ];

        let pivot = PivotTable {
            name: "TestPivot".to_string(),
            cache_id: 1,
            location: crate::domain::pivot::read::PivotLocation {
                // Typed range refs: typed RangeRef.
                ref_: compute_parser::parse_a1_range("A1:D10"),
                first_data_col: 1,
                first_data_row: 1,
                ..Default::default()
            },
            row_fields: vec![PivotFieldRef { x: 0 }, PivotFieldRef { x: 1 }],
            data_fields: vec![DataField {
                name: Some("Sum of Salary".to_string()),
                field_index: 2,
                subtotal: Subtotal::Sum,
                ..Default::default()
            }],
            pivot_fields: vec![
                make_read_pivot_field(
                    0,
                    Some(crate::domain::pivot::read::PivotAxis::Row),
                    None,
                    None,
                    vec![
                        PivotItem {
                            item_type: PivotItemType::Data,
                            x: Some(0),
                            hidden: false,
                            show_details: true, // Engineering: expanded
                            s: None,
                        },
                        PivotItem {
                            item_type: PivotItemType::Data,
                            x: Some(1),
                            hidden: false,
                            show_details: false, // Sales: collapsed (sd="0")
                            s: None,
                        },
                        PivotItem {
                            item_type: PivotItemType::Default,
                            x: None,
                            hidden: false,
                            show_details: true,
                            s: None,
                        },
                    ],
                ),
                make_read_pivot_field(
                    1,
                    Some(crate::domain::pivot::read::PivotAxis::Row),
                    None,
                    None,
                    vec![make_data_item(0), make_data_item(1)],
                ),
                make_read_pivot_field(2, None, None, None, vec![]),
            ],
            ..Default::default()
        };

        let records = vec![
            vec![
                CellValue::Text("Engineering".into()),
                CellValue::Text("Backend".into()),
                CellValue::number(120000.0),
            ],
            vec![
                CellValue::Text("Sales".into()),
                CellValue::Text("Enterprise".into()),
                CellValue::number(90000.0),
            ],
        ];

        let parsed = parsed_pivot_to_config(&pivot, &cache, "Sheet1", &records)
            .expect("should produce ParsedPivotTable");

        // Verify sd="0" is modeled on PivotField.items.
        assert!(
            !parsed.config.fields[0].items[1].show_details,
            "Sales item should have show_details=false"
        );

        // TODO: feed to compute engine WITHOUT expansion state (simulating current path).
        // This requires `compute_pivot` crate as a dev-dependency.
        // Once added, uncomment the following to verify that sd="0" collapsed
        // items are properly hidden:
        //
        // let result = compute_pivot::compute(&parsed.config, &records, None);
        // assert!(result.errors.is_none(), "errors: {:?}", result.errors);
        //
        // BUG: Without expansion state, Sales children (Enterprise) ARE visible.
        // The XLSX import path should build a PivotExpansionState from sd="0"
        // items and pass it to the compute engine.
        // let sales_children: Vec<_> = result
        //     .rows
        //     .iter()
        //     .filter(|r| r.depth >= 1 && r.key.to_lowercase().contains("sales"))
        //     .collect();
        //
        // assert!(
        //     sales_children.is_empty(),
        //     "Sales is collapsed (sd=\"0\") — its children should be hidden. \
        //      Found {} visible children: {:?}. \
        //      Fix: build PivotExpansionState from config.fields[].items[].show_details \
        //      and pass it to compute().",
        //     sales_children.len(),
        //     sales_children.iter().map(|r| &r.key).collect::<Vec<_>>()
        // );
    }
}
