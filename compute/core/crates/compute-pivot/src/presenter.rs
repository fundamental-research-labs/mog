//! Presenter — converts between pivot config/result and relational query/result.
//!
//! This module is the bridge between the pivot table domain types and the
//! relational compute engine. It provides two main functions:
//!
//! - `pivot_config_to_query`: Converts `ResolvedPivotConfig` to `RelationalQuery`
//! - `query_result_to_pivot`: Converts `QueryResult` to `PivotTableResult`

use std::collections::HashMap;

use value_types::CellValue;

use compute_stats::values::{GroupKey, cell_value_to_group_key};

use compute_relational::{
    AggregateFunction as RelAggFunc, AggregatedNode, CalcExpr, CalcOp, CalculatedMeasure,
    DateGroupingKind, FilterCondition, GrandTotalConfig, GroupField, GroupingStrategy, Measure,
    NumberGroupingKind, QueryFilter, QueryResult, RelationalQuery, SortBy,
    SortConfig as RelSortConfig, SortDirection as RelSortDirection, SubtotalConfig,
    TopBottomBy as RelTopBottomBy, TopBottomFilter as RelTopBottom,
    TopBottomType as RelTopBottomType,
};

use crate::calc_field::{CalcFieldExpr, CalcFieldOp};
use crate::engine::{SUBTOTAL_SUFFIX, VALUES_FIELD_KEY};
use crate::resolved::{
    ResolvedAxisPlacement, ResolvedCalculatedField, ResolvedPivotConfig, ResolvedTopBottom,
    ResolvedValuePlacement,
};
use crate::types::{
    AggregateFunction, DateGrouping, FieldId, LayoutForm, PivotColumnHeader, PivotExpansionState,
    PivotGrandTotals, PivotHeader, PivotRenderedBounds, PivotRow, PivotTableResult, SortDirection,
    TopBottomBy, TopBottomType,
};

// ============================================================================
// Config → Query
// ============================================================================

/// Convert a `ResolvedPivotConfig` to a `RelationalQuery`.
///
/// Maps pivot domain types to the relational engine's declarative query model.
#[must_use]
pub fn pivot_config_to_query(config: &ResolvedPivotConfig) -> RelationalQuery {
    let row_fields: Vec<GroupField> = config
        .row_placements()
        .iter()
        .map(map_axis_to_group_field)
        .collect();

    let column_fields: Vec<GroupField> = config
        .column_placements()
        .iter()
        .map(map_axis_to_group_field)
        .collect();

    // Index fields by ID so we can resolve source-field names for measures.
    // The source-field name is what calculated-field formulas reference
    // (e.g., `Revenue / Cost` resolves against the source headers, not display names).
    let field_name_by_id: HashMap<&str, &str> = config
        .fields()
        .iter()
        .map(|f| (f.id.as_ref(), f.name.as_str()))
        .collect();

    let measures: Vec<Measure> = config
        .value_placements()
        .iter()
        .map(|vp| map_value_to_measure(vp, &field_name_by_id))
        .collect();

    let filters: Vec<QueryFilter> = config
        .filters()
        .iter()
        .map(|f| QueryFilter {
            field_id: f.field_id().to_string(),
            column_index: f.field_column_index(),
            include_values: f.include_values().map(<[CellValue]>::to_vec),
            exclude_values: f.exclude_values().map(<[CellValue]>::to_vec),
            condition: f.condition().map(|c| FilterCondition::Pivot(c.clone())),
            top_bottom: f.top_bottom().map(|tb| map_top_bottom(tb, config)),
            show_items_with_no_data: f.show_items_with_no_data(),
        })
        .collect();

    let calculated_measures: Vec<CalculatedMeasure> = config
        .calculated_fields()
        .iter()
        .map(map_calc_field)
        .collect();

    let subtotals = SubtotalConfig {
        enabled: config
            .row_placements()
            .iter()
            .map(ResolvedAxisPlacement::show_subtotals)
            .collect(),
    };

    // Excel suppresses column grand totals when there are no column grouping fields.
    let show_column_grand_totals =
        config.layout().show_column_grand_totals() && !config.column_placements().is_empty();

    let grand_totals = GrandTotalConfig {
        show_row: config.layout().show_row_grand_totals(),
        show_column: show_column_grand_totals,
    };

    RelationalQuery {
        row_fields,
        column_fields,
        measures,
        filters,
        calculated_measures,
        subtotals,
        grand_totals,
    }
}

// ============================================================================
// Query Result → Pivot Result
// ============================================================================

/// Convert a `QueryResult` to a `PivotTableResult`.
///
/// Applies expansion state, builds column headers, flattens the row tree,
/// converts grand totals, and computes rendered bounds.
#[must_use]
pub fn query_result_to_pivot(
    result: &QueryResult,
    config: &ResolvedPivotConfig,
    expansion_state: Option<&PivotExpansionState>,
) -> PivotTableResult {
    let data_row_count = result.source_row_count;

    if result.row_tree.is_empty() && result.column_tree.is_empty() && result.measure_count == 0 {
        return PivotTableResult::empty(data_row_count, None);
    }

    // Determine expansion sets for rows and columns.
    let row_expanded_set = expansion_state.and_then(|es| {
        let set = &es.expanded_rows;
        if set.is_empty() { None } else { Some(set) }
    });
    let col_expanded_set = expansion_state.and_then(|es| {
        let set = &es.expanded_columns;
        if set.is_empty() { None } else { Some(set) }
    });

    // Build column headers from column tree (with expansion state applied).
    let column_headers = build_column_headers(
        &result.column_tree,
        config.column_placements(),
        config.value_placements(),
        col_expanded_set,
    );

    // Count visible column leaves (considering expansion state).
    let _visible_col_leaves = count_visible_leaves(&result.column_tree, col_expanded_set);

    // Flatten row tree into PivotRows.
    let show_subtotals: Vec<bool> = config
        .row_placements()
        .iter()
        .map(ResolvedAxisPlacement::show_subtotals)
        .collect();

    let is_tabular = matches!(config.layout().layout_form(), LayoutForm::Tabular);

    // Build a node map for ancestor lookups.
    let mut node_map: HashMap<String, &AggregatedNode> = HashMap::new();
    build_node_map(&result.row_tree, &mut node_map);

    // Pre-compute column remap once (avoids O(R × L²) tree walks per row).
    let col_remap = ColumnRemap::build(&result.column_tree, col_expanded_set, result.measure_count);

    let mut pivot_rows = Vec::new();
    flatten_row_tree(
        &result.row_tree,
        row_expanded_set,
        &show_subtotals,
        is_tabular,
        0,
        &mut pivot_rows,
        &col_remap,
        &node_map,
    );

    // Build grand totals (and apply calc fields to them).
    let num_visible_col_leaves = if result.column_tree.is_empty() {
        1
    } else {
        count_visible_leaves(&result.column_tree, col_expanded_set)
    };
    let grand_totals = build_grand_totals(
        &result.grand_totals,
        &pivot_rows,
        config,
        result.measure_count,
        num_visible_col_leaves,
    );

    // Compute rendered bounds.
    #[allow(clippy::cast_possible_truncation)]
    let row_header_cols = match config.layout().layout_form() {
        LayoutForm::Compact => u32::from(!config.row_placements().is_empty()),
        _ => config.row_placements().len() as u32,
    };
    // Bug C fix: derive num_data_cols from the column-axis structure, not from
    // per-row value vectors. `column_headers[0].headers[i].span` is set in
    // build_column_headers to `leaf_count * value_placements.len().max(1)`,
    // so the sum across depth-0 headers equals `leaves * max(v, 1)` —
    // exactly what the materializer needs to reserve. Stays correct when
    // measures or rows are empty.
    #[allow(clippy::cast_possible_truncation)]
    let num_data_cols = column_headers
        .first()
        .map_or(0, |ch| ch.headers.iter().map(|h| h.span).sum::<usize>())
        as u32;
    // Sub-scope B: reserve at least one header row whenever row_placements
    // is non-empty, so row-field labels at anchor_row aren't clobbered by
    // data rows when both column_placements and value_placements are empty.
    #[allow(clippy::cast_possible_truncation)]
    let col_header_rows = std::cmp::max(
        column_headers.len() as u32,
        u32::from(!config.row_placements().is_empty()),
    );
    let has_row_gt = grand_totals.row.is_some();

    #[allow(clippy::cast_possible_truncation)]
    let rendered_bounds = PivotRenderedBounds {
        first_data_row: col_header_rows,
        first_data_col: row_header_cols,
        total_rows: col_header_rows + pivot_rows.len() as u32 + u32::from(has_row_gt),
        total_cols: row_header_cols
            + num_data_cols
            + if grand_totals.column.is_some() {
                // Sub-scope A: `Some(empty)` from the framing-only fallback
                // must still reserve a 1-column header slot for the GT label.
                grand_totals
                    .grand
                    .as_ref()
                    .map_or(1, |g| g.len().max(1) as u32)
            } else {
                0
            },
        num_data_cols,
    };

    PivotTableResult {
        column_headers,
        rows: pivot_rows,
        grand_totals,
        rendered_bounds,
        source_row_count: data_row_count,
        measure_descriptors: Vec::new(),
        value_records: Vec::new(),
        errors: None,
    }
}

// ============================================================================
// Column Headers
// ============================================================================

/// Build column headers from the column tree with expansion state.
fn build_column_headers(
    column_tree: &[AggregatedNode],
    column_placements: &[ResolvedAxisPlacement],
    value_placements: &[ResolvedValuePlacement],
    expanded_set: Option<&std::collections::HashSet<String>>,
) -> Vec<PivotColumnHeader> {
    let mut headers: Vec<PivotColumnHeader> = Vec::new();

    if column_placements.is_empty() {
        // No column fields — just value headers.
        if !value_placements.is_empty() {
            headers.push(PivotColumnHeader {
                field_id: FieldId::from(VALUES_FIELD_KEY),
                headers: value_placements
                    .iter()
                    .map(|vp| {
                        let display = vp.display_name().unwrap_or("");
                        let value_str = if display.is_empty() {
                            let agg = format!("{:?}", vp.aggregate_function()).to_lowercase();
                            format!("{} of {}", agg, vp.field_id())
                        } else {
                            display.to_string()
                        };
                        PivotHeader {
                            key: format!("value_{}", vp.field_id()),
                            value: CellValue::Text(value_str.into()),
                            field_id: vp.field_id().clone(),
                            depth: 0,
                            span: 1,
                            is_expandable: false,
                            is_expanded: true,
                            is_subtotal: false,
                            is_grand_total: false,
                            parent_key: None,
                            child_keys: None,
                        }
                    })
                    .collect(),
            });
        }
        return headers;
    }

    // Build headers for each level of column hierarchy.
    for (depth, placement) in column_placements.iter().enumerate() {
        let nodes_at_depth = get_nodes_at_depth_agg(column_tree, depth, expanded_set);
        let level_headers: Vec<PivotHeader> = nodes_at_depth
            .iter()
            .map(|node| {
                let is_expanded = is_node_expanded(node, expanded_set);
                let leaf_count = if is_expanded && !node.children.is_empty() {
                    count_visible_leaves(&node.children, expanded_set)
                } else {
                    1
                };
                let span = leaf_count * value_placements.len().max(1);

                let value = if node.value == CellValue::Null {
                    CellValue::Text("(blank)".into())
                } else {
                    node.value.clone()
                };
                PivotHeader {
                    key: node.key.clone(),
                    value,
                    field_id: FieldId::from(node.field_id.clone()),
                    depth,
                    span,
                    is_expandable: !node.children.is_empty(),
                    is_expanded,
                    is_subtotal: false,
                    is_grand_total: false,
                    parent_key: node.parent_key.clone(),
                    child_keys: Some(node.children.iter().map(|c| c.key.clone()).collect()),
                }
            })
            .collect();

        headers.push(PivotColumnHeader {
            field_id: placement.field_id().clone(),
            headers: level_headers,
        });
    }

    // Add value headers if multiple value fields.
    if value_placements.len() > 1 {
        let leaves = get_visible_leaves(column_tree, expanded_set);
        let mut value_headers: Vec<PivotHeader> = Vec::new();

        for leaf in &leaves {
            for vp in value_placements {
                let display = vp.display_name().unwrap_or("");
                let value_str = if display.is_empty() {
                    format!("{:?}", vp.aggregate_function()).to_lowercase()
                } else {
                    display.to_string()
                };
                value_headers.push(PivotHeader {
                    key: format!("{}\x00value_{}", leaf.key, vp.field_id()),
                    value: CellValue::Text(value_str.into()),
                    field_id: vp.field_id().clone(),
                    depth: column_placements.len(),
                    span: 1,
                    is_expandable: false,
                    is_expanded: true,
                    is_subtotal: false,
                    is_grand_total: false,
                    parent_key: Some(leaf.key.clone()),
                    child_keys: None,
                });
            }
        }

        headers.push(PivotColumnHeader {
            field_id: FieldId::from(VALUES_FIELD_KEY),
            headers: value_headers,
        });
    }

    headers
}

// ============================================================================
// Node Map
// ============================================================================

/// Build a map from node key to node reference for the entire tree.
fn build_node_map<'a>(nodes: &'a [AggregatedNode], map: &mut HashMap<String, &'a AggregatedNode>) {
    for node in nodes {
        map.insert(node.key.clone(), node);
        if !node.children.is_empty() {
            build_node_map(&node.children, map);
        }
    }
}

/// Build the ancestor chain of `PivotHeaders` for a node by walking up `parent_key`.
fn build_ancestor_chain<'a>(
    node: &'a AggregatedNode,
    node_map: &'a HashMap<String, &'a AggregatedNode>,
    is_expanded: bool,
) -> Vec<PivotHeader> {
    // Collect ancestor chain by walking up parent_key.
    let mut chain: Vec<&AggregatedNode> = Vec::new();
    let mut cur: Option<&AggregatedNode> = Some(node);
    while let Some(cn) = cur {
        chain.push(cn);
        cur = cn
            .parent_key
            .as_ref()
            .and_then(|pk| node_map.get(pk.as_str()).copied());
    }
    chain.reverse();

    let mut headers = Vec::new();
    for (i, ancestor) in chain.iter().enumerate() {
        let is_last = i == chain.len() - 1;
        // Excel displays null/blank group values as "(blank)" in pivot tables.
        let value = if ancestor.value == CellValue::Null {
            CellValue::Text("(blank)".into())
        } else {
            ancestor.value.clone()
        };
        headers.push(PivotHeader {
            key: ancestor.key.clone(),
            value,
            field_id: FieldId::from(ancestor.field_id.clone()),
            depth: ancestor.depth,
            span: 1,
            is_expandable: !ancestor.children.is_empty(),
            is_expanded: if is_last { is_expanded } else { true },
            is_subtotal: false,
            is_grand_total: false,
            parent_key: ancestor.parent_key.clone(),
            child_keys: if is_last {
                Some(ancestor.children.iter().map(|c| c.key.clone()).collect())
            } else {
                None
            },
        });
    }

    headers
}

// ============================================================================
// Row Tree Flattening
// ============================================================================

/// Flatten the row tree into `PivotRow`s, applying expansion state.
///
/// This is the core presenter logic — walks the `AggregatedNode` tree depth-first,
/// emitting `PivotRow` entries with the correct headers, values, and subtotals.
#[allow(clippy::too_many_arguments)]
fn flatten_row_tree<'a>(
    nodes: &'a [AggregatedNode],
    expanded_set: Option<&std::collections::HashSet<String>>,
    show_subtotals: &[bool],
    is_tabular: bool,
    depth: usize,
    result: &mut Vec<PivotRow>,
    col_remap: &ColumnRemap,
    node_map: &'a HashMap<String, &'a AggregatedNode>,
) {
    let depth_show_subtotal = show_subtotals.get(depth).copied().unwrap_or(false);

    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        let has_visible_children = is_expanded && !node.children.is_empty();

        // In tabular layout, expanded non-leaf nodes don't get their own data row.
        if is_tabular && has_visible_children {
            // Skip the group header row, but recurse into children.
            flatten_row_tree(
                &node.children,
                expanded_set,
                show_subtotals,
                is_tabular,
                depth + 1,
                result,
                col_remap,
                node_map,
            );

            // Emit subtotal after children if enabled.
            if depth_show_subtotal {
                emit_subtotal_row(node, result, col_remap, node_map);
            }
            continue;
        }

        // Build headers (ancestor chain).
        let headers = build_ancestor_chain(node, node_map, is_expanded);

        // Select the right values — remap from full column set to visible columns.
        let values = col_remap.remap(&node.values);

        result.push(PivotRow {
            key: node.key.clone(),
            headers,
            values,
            depth: node.depth,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: Some(node.row_indices.clone()),
        });

        // Recurse into children if expanded.
        if has_visible_children {
            flatten_row_tree(
                &node.children,
                expanded_set,
                show_subtotals,
                is_tabular,
                depth + 1,
                result,
                col_remap,
                node_map,
            );

            // Emit subtotal after children if enabled.
            if depth_show_subtotal {
                emit_subtotal_row(node, result, col_remap, node_map);
            }
        }
    }
}

/// Emit a subtotal row for a node.
fn emit_subtotal_row(
    node: &AggregatedNode,
    result: &mut Vec<PivotRow>,
    col_remap: &ColumnRemap,
    node_map: &HashMap<String, &AggregatedNode>,
) {
    // Build subtotal headers — ancestor chain + subtotal marker.
    // Walk up parent_key to collect ancestors.
    let mut chain: Vec<&AggregatedNode> = Vec::new();
    let mut cur: Option<&AggregatedNode> = Some(node);
    while let Some(cn) = cur {
        chain.push(cn);
        cur = cn
            .parent_key
            .as_ref()
            .and_then(|pk| node_map.get(pk.as_str()).copied());
    }
    chain.reverse();

    let mut headers = Vec::new();
    // Ancestors before the subtotal node.
    for ancestor in &chain[..chain.len().saturating_sub(1)] {
        headers.push(PivotHeader {
            key: ancestor.key.clone(),
            value: ancestor.value.clone(),
            field_id: FieldId::from(ancestor.field_id.clone()),
            depth: ancestor.depth,
            span: 1,
            is_expandable: !ancestor.children.is_empty(),
            is_expanded: true,
            is_subtotal: false,
            is_grand_total: false,
            parent_key: ancestor.parent_key.clone(),
            child_keys: None,
        });
    }

    // The subtotal header itself.
    headers.push(PivotHeader {
        key: format!("{}{}", node.key, SUBTOTAL_SUFFIX),
        value: CellValue::Text(format!("{} Total", node.value).into()),
        field_id: FieldId::from(node.field_id.clone()),
        depth: node.depth,
        span: 1,
        is_expandable: !node.children.is_empty(),
        is_expanded: true,
        is_subtotal: true,
        is_grand_total: false,
        parent_key: node.parent_key.clone(),
        child_keys: None,
    });

    // Use subtotal_values if present, otherwise use node values.
    let raw_values = node.subtotal_values.as_deref().unwrap_or(&node.values);
    let values = col_remap.remap(raw_values);

    result.push(PivotRow {
        key: format!("{}{}", node.key, SUBTOTAL_SUFFIX),
        headers,
        values,
        depth: node.depth,
        is_subtotal: true,
        is_grand_total: false,
        source_row_indices: Some(node.row_indices.clone()),
    });
}

// ============================================================================
// Grand Totals
// ============================================================================

/// Build `PivotGrandTotals` from `QueryGrandTotals`.
///
/// Also applies calculated fields to grand totals, since the relational engine's
/// grand totals are computed from raw data and don't include calc field values.
fn build_grand_totals(
    query_gt: &compute_relational::QueryGrandTotals,
    pivot_rows: &[PivotRow],
    config: &ResolvedPivotConfig,
    _measure_count: usize,
    num_column_leaves: usize,
) -> PivotGrandTotals {
    let resolved_calc_fields = config.calculated_fields();
    let has_calc_fields = !resolved_calc_fields.is_empty();
    let num_values = config.value_placements().len();

    // Build field name map for calc field evaluation.
    let field_map_for_names: HashMap<&str, &crate::types::PivotField> =
        config.fields().iter().map(|f| (f.id.as_ref(), f)).collect();

    let value_field_names: Vec<String> = if has_calc_fields {
        config
            .value_placements()
            .iter()
            .map(|vp| {
                field_map_for_names
                    .get(vp.field_id().as_ref())
                    .map(|f| f.name.clone())
                    .unwrap_or_default()
            })
            .collect()
    } else {
        vec![]
    };

    let parsed_refs: Vec<Option<&CalcFieldExpr>> = if has_calc_fields {
        resolved_calc_fields
            .iter()
            .map(|cf| Some(cf.parsed_expr()))
            .collect()
    } else {
        vec![]
    };

    // Row grand total (bottom row).
    let mut row = query_gt.row.clone();
    if has_calc_fields && let Some(ref row_gt) = row {
        row = Some(crate::engine::row_computation::apply_calc_fields_to_values(
            row_gt,
            num_column_leaves,
            num_values,
            &parsed_refs,
            &value_field_names,
        ));
    }
    // Sub-scope A: framing-only fallback when the relational engine returned
    // no value totals (measures empty) but the layout asks for a row GT and
    // there are row placements to anchor it. `Some(Vec::new())` means
    // "frame the row, no values" — the materializer writes the label and
    // reserves the slot.
    if row.is_none()
        && config.layout().show_row_grand_totals()
        && !config.row_placements().is_empty()
    {
        row = Some(Vec::new());
    }

    // Column grand totals: convert from HashMap<key, Vec> to Vec<Vec> ordered by pivot rows.
    let mut column: Option<Vec<Vec<CellValue>>> = query_gt.column.as_ref().map(|col_map| {
        pivot_rows
            .iter()
            .map(|pr| {
                // For subtotal rows, strip the suffix to look up the base key.
                let lookup_key = if pr.is_subtotal {
                    pr.key.strip_suffix(SUBTOTAL_SUFFIX).unwrap_or(&pr.key)
                } else {
                    &pr.key
                };
                col_map.get(lookup_key).cloned().unwrap_or_default()
            })
            .collect()
    });

    if has_calc_fields && let Some(ref col_gt) = column {
        let new_col_gt: Vec<Vec<CellValue>> = col_gt
            .iter()
            .map(|row_values| {
                crate::engine::row_computation::apply_calc_fields_to_values(
                    row_values,
                    1, // column grand totals have no column grouping
                    num_values,
                    &parsed_refs,
                    &value_field_names,
                )
            })
            .collect();
        column = Some(new_col_gt);
    }
    // Sub-scope A: framing-only fallback for the column GT axis. One empty
    // value vec per pivot row preserves the per-row index contract.
    if column.is_none()
        && config.layout().show_column_grand_totals()
        && !config.column_placements().is_empty()
    {
        column = Some(vec![Vec::new(); pivot_rows.len()]);
    }

    // Corner grand total.
    let mut grand = query_gt.corner.clone();
    if has_calc_fields && let Some(ref grand_gt) = grand {
        grand = Some(crate::engine::row_computation::apply_calc_fields_to_values(
            grand_gt,
            1,
            num_values,
            &parsed_refs,
            &value_field_names,
        ));
    }
    // Sub-scope A: framing-only fallback for the corner. Both axes must have
    // GT framing for the corner to make sense.
    if grand.is_none()
        && config.layout().show_row_grand_totals()
        && config.layout().show_column_grand_totals()
        && !config.row_placements().is_empty()
        && !config.column_placements().is_empty()
    {
        grand = Some(Vec::new());
    }

    // Row label.
    let row_label = Some(
        config
            .layout()
            .grand_total_caption()
            .unwrap_or("Grand Total")
            .to_string(),
    );

    PivotGrandTotals {
        row,
        column,
        grand,
        row_label,
    }
}

// ============================================================================
// Value Remapping (Full Column Set → Visible Columns)
// ============================================================================

/// Pre-computed column remap: maps visible column positions to full column positions.
///
/// Built once before the flatten loop and reused for every row, avoiding
/// repeated tree walks and O(L) position lookups per row.
struct ColumnRemap {
    /// For each visible leaf position, the index in the full leaf list.
    /// `None` means the visible leaf was not found in the full set (pad with nulls).
    visible_to_full: Vec<Option<usize>>,
    measure_count: usize,
    /// True when no remapping is needed (all leaves visible or no column grouping).
    is_identity: bool,
}

impl ColumnRemap {
    /// Build the remap from column tree and expansion state.
    fn build(
        column_tree: &[AggregatedNode],
        col_expanded_set: Option<&std::collections::HashSet<String>>,
        measure_count: usize,
    ) -> Self {
        if column_tree.is_empty() || measure_count == 0 {
            return Self {
                visible_to_full: Vec::new(),
                measure_count,
                is_identity: true,
            };
        }

        let all_leaves = collect_all_leaves(column_tree);
        let visible_leaves = get_visible_leaves(column_tree, col_expanded_set);

        if all_leaves.len() == visible_leaves.len() {
            return Self {
                visible_to_full: Vec::new(),
                measure_count,
                is_identity: true,
            };
        }

        // Build key→index HashMap from all_leaves for O(1) lookup.
        let leaf_index: HashMap<&str, usize> = all_leaves
            .iter()
            .enumerate()
            .map(|(i, leaf)| (leaf.key.as_str(), i))
            .collect();

        let visible_to_full = visible_leaves
            .iter()
            .map(|v| leaf_index.get(v.key.as_str()).copied())
            .collect();

        Self {
            visible_to_full,
            measure_count,
            is_identity: false,
        }
    }

    /// Remap values from the full column set to only visible columns.
    fn remap(&self, values: &[CellValue]) -> Vec<CellValue> {
        if self.is_identity {
            return values.to_vec();
        }

        let mut result = Vec::with_capacity(self.visible_to_full.len() * self.measure_count);
        for full_idx in &self.visible_to_full {
            if let Some(idx) = full_idx {
                let start = idx * self.measure_count;
                for i in 0..self.measure_count {
                    result.push(values.get(start + i).cloned().unwrap_or(CellValue::Null));
                }
            } else {
                for _ in 0..self.measure_count {
                    result.push(CellValue::Null);
                }
            }
        }
        result
    }
}

// ============================================================================
// Expansion State Helpers
// ============================================================================

/// Structural expansion key for OOXML per-item expansion state.
///
/// Replaces the previous in-band `"{depth}\x01{leaf_key}"` splice — depth
/// and leaf are now separate typed fields instead of a string with a
/// reserved `\x01` delimiter.
///
/// The `leaf` field is a structural [`GroupKey`] so callers cannot
/// accidentally introduce a byte sequence that collides with the
/// in-band blank / array sentinels.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ExpansionKey {
    /// Hierarchy depth of the node this expansion key addresses.
    pub depth: usize,
    /// The node's leaf value, as a structural group key.
    pub leaf: GroupKey,
}

impl ExpansionKey {
    /// Render this expansion key in the legacy `"{depth}\x01{wire}"`
    /// format used by the XLSX parser and `PivotExpansionState`
    /// (serialized as `HashSet<String>` over napi / JSON).
    ///
    /// Callers that key an internal `HashSet<ExpansionKey>` should prefer
    /// comparing against the typed form. This serializer exists solely to
    /// look up into a caller-provided `HashSet<String>` that originated at
    /// a wire boundary outside the engine.
    #[must_use]
    pub fn to_wire_string(&self) -> String {
        format!("{}\x01{}", self.depth, self.leaf.to_wire_string())
    }
}

/// Check if a node is expanded based on the expansion set.
///
/// Matches the existing grouper logic:
/// - If `expansion_set` is None → all expanded
/// - If `expansion_set` is empty → all expanded (handled by caller)
/// - Otherwise → check full path key first, then fall back to the
///   depth-prefixed leaf key used by OOXML per-item expansion state.
///
/// The fallback is derived from an [`ExpansionKey`] (a typed `(depth, leaf)`
/// pair) rather than spliced inline, so the rule lives in one place.
fn is_node_expanded(
    node: &AggregatedNode,
    expanded_set: Option<&std::collections::HashSet<String>>,
) -> bool {
    expanded_set.is_none_or(|set| {
        // Check full path key first (used by web API).
        if set.contains(&node.key) {
            return true;
        }
        // Fall back to depth-prefixed leaf key for OOXML expansion state.
        // `ExpansionKey` owns the wire format so the reconstruction rule
        // is expressed structurally, not through ad-hoc string splicing.
        let expansion_key = ExpansionKey {
            depth: node.depth,
            leaf: cell_value_to_group_key(&node.value),
        };
        set.contains(&expansion_key.to_wire_string())
    })
}

/// Count visible leaves (considering expansion state).
fn count_visible_leaves(
    nodes: &[AggregatedNode],
    expanded_set: Option<&std::collections::HashSet<String>>,
) -> usize {
    let mut count = 0;
    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        if node.children.is_empty() || !is_expanded {
            count += 1;
        } else {
            count += count_visible_leaves(&node.children, expanded_set);
        }
    }
    count
}

/// Get nodes at a specific depth, respecting expansion state.
fn get_nodes_at_depth_agg<'a>(
    nodes: &'a [AggregatedNode],
    target_depth: usize,
    expanded_set: Option<&std::collections::HashSet<String>>,
) -> Vec<&'a AggregatedNode> {
    if target_depth == 0 {
        return nodes.iter().collect();
    }
    let mut result = Vec::new();
    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        if is_expanded && !node.children.is_empty() {
            result.extend(get_nodes_at_depth_agg(
                &node.children,
                target_depth - 1,
                expanded_set,
            ));
        }
    }
    result
}

/// Get all visible leaf nodes (considering expansion state).
fn get_visible_leaves<'a>(
    nodes: &'a [AggregatedNode],
    expanded_set: Option<&std::collections::HashSet<String>>,
) -> Vec<&'a AggregatedNode> {
    let mut leaves = Vec::new();
    collect_visible_leaves(nodes, expanded_set, &mut leaves);
    leaves
}

fn collect_visible_leaves<'a>(
    nodes: &'a [AggregatedNode],
    expanded_set: Option<&std::collections::HashSet<String>>,
    out: &mut Vec<&'a AggregatedNode>,
) {
    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        if node.children.is_empty() || !is_expanded {
            out.push(node);
        } else {
            collect_visible_leaves(&node.children, expanded_set, out);
        }
    }
}

/// Collect ALL leaf nodes (ignoring expansion state).
fn collect_all_leaves_recursive<'a>(
    nodes: &'a [AggregatedNode],
    out: &mut Vec<&'a AggregatedNode>,
) {
    for node in nodes {
        if node.children.is_empty() {
            out.push(node);
        } else {
            collect_all_leaves_recursive(&node.children, out);
        }
    }
}

fn collect_all_leaves(nodes: &[AggregatedNode]) -> Vec<&AggregatedNode> {
    let mut leaves = Vec::new();
    collect_all_leaves_recursive(nodes, &mut leaves);
    leaves
}

// ============================================================================
// Mapping Helpers: Pivot → Relational
// ============================================================================

/// Map a resolved axis placement to a relational `GroupField`.
fn map_axis_to_group_field(ap: &ResolvedAxisPlacement) -> GroupField {
    GroupField {
        id: ap.field_id().to_string(),
        column_index: ap.column_index(),
        grouping: match (ap.date_grouping(), ap.number_grouping()) {
            (Some(dg), _) => GroupingStrategy::Date(map_date_grouping(dg)),
            (_, Some(ng)) => GroupingStrategy::Number(NumberGroupingKind {
                start: ng.start,
                end: ng.end,
                interval: ng.interval,
            }),
            _ => GroupingStrategy::Identity,
        },
        sort: RelSortConfig {
            sort_by: match ap.sort_by_value() {
                Some(sbv) => SortBy::Value {
                    measure_index: sbv.value_field_index(),
                    column_key: sbv.column_key().map(String::from),
                },
                None => SortBy::Label,
            },
            // When sorting by value, use the sort-by-value order (not the field's label sort order).
            direction: match ap.sort_by_value() {
                Some(sbv) => map_sort_direction(sbv.order()),
                None => map_sort_direction(ap.sort_order()),
            },
            custom_order: ap.custom_sort_list().map(<[CellValue]>::to_vec),
        },
    }
}

/// Map a resolved value placement to a relational Measure.
///
/// `Measure.name` is set to the **source field name** (e.g. `"Revenue"`) so that
/// calculated-field formulas referencing source field names by their bare
/// identifier resolve per group inside the relational engine. The display
/// name (e.g. `"Sum of Revenue"`) is *not* used here because formulas are
/// authored against source headers, not display labels. Falls back to the
/// display name and finally the field id when no field record is found.
///
/// **table dependency work T11 — duplicate-source-field collision**: when the same
/// source field is placed multiple times in values (for example, `"Sum of Revenue"`
/// plus `"Avg of Revenue"`, both with `name = "Revenue"`), the relational
/// engine's calc-field field map inserts each measure under three keys: `col0`/
/// `col1`/... (output id, always unique), `name` (first-wins on collision —
/// `Revenue` resolves to the leftmost aggregate), and `id` (also first-wins).
/// Authors disambiguate by using `col0`/`col1`/…; the readable name remains usable
/// but maps to a deterministic single aggregate. See
/// `compute-relational/src/calc_measure.rs`.
fn map_value_to_measure(
    vp: &ResolvedValuePlacement,
    field_name_by_id: &HashMap<&str, &str>,
) -> Measure {
    let field_id = vp.field_id().to_string();
    let name = field_name_by_id
        .get(field_id.as_str())
        .map(|s| (*s).to_string())
        .or_else(|| vp.display_name().map(std::string::ToString::to_string))
        .unwrap_or_else(|| field_id.clone());
    Measure {
        id: field_id,
        name,
        column_index: vp.column_index(),
        aggregate: map_aggregate(vp.aggregate_function()),
        window: None,
    }
}

/// Map `DateGrouping` to `DateGroupingKind`.
fn map_date_grouping(dg: DateGrouping) -> DateGroupingKind {
    match dg {
        DateGrouping::Year => DateGroupingKind::Year,
        DateGrouping::Quarter => DateGroupingKind::Quarter,
        DateGrouping::Month => DateGroupingKind::Month,
        DateGrouping::Week => DateGroupingKind::Week,
        DateGrouping::Hour => DateGroupingKind::Hour,
        DateGrouping::Minute => DateGroupingKind::Minute,
        DateGrouping::Second => DateGroupingKind::Second,
        // Day is the default for unknown variants
        _ => DateGroupingKind::Day,
    }
}

/// Map `SortDirection` (Asc/Desc) to relational `SortDirection` (Ascending/Descending).
fn map_sort_direction(sd: SortDirection) -> RelSortDirection {
    match sd {
        SortDirection::Desc => RelSortDirection::Descending,
        // Ascending is the default for unknown variants
        _ => RelSortDirection::Ascending,
    }
}

/// Map pivot `AggregateFunction` to relational `AggregateFunction`.
fn map_aggregate(af: AggregateFunction) -> RelAggFunc {
    match af {
        AggregateFunction::Count | AggregateFunction::CountUnique => RelAggFunc::Count,
        AggregateFunction::CountA => RelAggFunc::CountNums,
        AggregateFunction::Average => RelAggFunc::Average,
        AggregateFunction::Min => RelAggFunc::Min,
        AggregateFunction::Max => RelAggFunc::Max,
        AggregateFunction::Product => RelAggFunc::Product,
        AggregateFunction::StdDev => RelAggFunc::StdDev,
        AggregateFunction::StdDevP => RelAggFunc::StdDevP,
        AggregateFunction::Var => RelAggFunc::Var,
        AggregateFunction::VarP => RelAggFunc::VarP,
        // Sum is the default for unknown variants
        _ => RelAggFunc::Sum,
    }
}

/// Map a `ResolvedTopBottom` to a relational `TopBottomFilter`.
fn map_top_bottom(tb: &ResolvedTopBottom, _config: &ResolvedPivotConfig) -> RelTopBottom {
    RelTopBottom {
        filter_type: match tb.filter_type() {
            TopBottomType::Bottom => RelTopBottomType::Bottom,
            // Top is the default for unknown variants
            _ => RelTopBottomType::Top,
        },
        n: tb.n(),
        by: match tb.by() {
            TopBottomBy::Items => RelTopBottomBy::Items,
            TopBottomBy::Percent => RelTopBottomBy::Percent,
            TopBottomBy::Sum => RelTopBottomBy::Sum,
            // Count is the default for unknown variants
            _ => RelTopBottomBy::Count,
        },
        measure_index: tb.value_field_index(),
    }
}

/// Map a `ResolvedCalculatedField` to a relational `CalculatedMeasure`.
fn map_calc_field(cf: &ResolvedCalculatedField) -> CalculatedMeasure {
    CalculatedMeasure {
        id: cf.field_id().to_string(),
        name: cf.name().to_string(),
        formula: cf.formula().to_string(),
        parsed_expr: Some(map_calc_expr(cf.parsed_expr())),
    }
}

/// Map `CalcFieldExpr` to relational `CalcExpr`.
fn map_calc_expr(expr: &CalcFieldExpr) -> CalcExpr {
    match expr {
        CalcFieldExpr::Number(n) => CalcExpr::Number(*n),
        CalcFieldExpr::FieldRef(name) => CalcExpr::Field(name.clone()),
        CalcFieldExpr::BinaryOp { op, left, right } => CalcExpr::BinaryOp {
            op: match op {
                CalcFieldOp::Add => CalcOp::Add,
                CalcFieldOp::Sub => CalcOp::Sub,
                CalcFieldOp::Mul => CalcOp::Mul,
                CalcFieldOp::Div => CalcOp::Div,
            },
            left: Box::new(map_calc_expr(left)),
            right: Box::new(map_calc_expr(right)),
        },
        CalcFieldExpr::Negate(inner) => CalcExpr::UnaryNeg(Box::new(map_calc_expr(inner))),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod expansion_key_tests {
    use super::*;

    #[test]
    fn expansion_key_wire_string_matches_legacy_format() {
        // The legacy splice was format!("{}\x01{}", depth, cell_value_to_key(value)).
        // ExpansionKey::to_wire_string() must produce byte-identical output so
        // the HashSet<String> lookup against XLSX-parser-written keys still hits.
        let k_text = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Text("A".into())),
        };
        assert_eq!(k_text.to_wire_string(), "0\x01T:a");

        let k_blank = ExpansionKey {
            depth: 1,
            leaf: cell_value_to_group_key(&CellValue::Null),
        };
        assert_eq!(k_blank.to_wire_string(), "1\x01\x00BLANK\x00");

        let k_num = ExpansionKey {
            depth: 2,
            leaf: cell_value_to_group_key(&CellValue::number(42.0)),
        };
        // Number keys use bit form, so just check shape.
        assert!(k_num.to_wire_string().starts_with("2\x01N:"));
    }

    #[test]
    fn expansion_key_text_with_blank_sentinel_distinct_from_blank() {
        // Regression: literal text "\x00BLANK\x00" must not collide with the
        // blank expansion key at the same depth.
        let blank = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Null),
        };
        let text_sentinel = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Text("\x00BLANK\x00".into())),
        };
        assert_ne!(blank, text_sentinel);
    }

    #[test]
    fn expansion_key_differs_across_depth() {
        let k0 = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Text("x".into())),
        };
        let k1 = ExpansionKey {
            depth: 1,
            leaf: cell_value_to_group_key(&CellValue::Text("x".into())),
        };
        assert_ne!(k0, k1);
        assert_ne!(k0.to_wire_string(), k1.to_wire_string());
    }
}
