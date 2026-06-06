//! GROUP BY — hierarchical tree building.
//!
//! Builds `AggregatedNode` trees directly from source data. Unlike the pivot
//! grouper, there is no expansion state — ALL nodes are always built (full tree).
//!
//! Supports text identity grouping, date grouping, and number grouping.

use std::collections::HashMap;

use chrono::Datelike;
use value_types::CellValue;
use value_types::date_serial::serial_to_date;

use compute_stats::sort::{
    SortConfig as StatsSortConfig, compare_cell_values, sort_by_custom_order_in_place,
    sort_by_in_place,
};
use compute_stats::values::{GroupKey, cell_value_to_group_key};

use crate::error::RelationalError;
use crate::types::{
    AggregatedNode, DateGroupingKind, GroupField, GroupingStrategy, NumberGroupingKind, SortBy,
    SortDirection,
};

/// Maximum number of group nodes allowed across the entire hierarchy.
const MAX_GROUP_NODES: usize = 100_000;

/// Chronological month sort order.
const MONTH_SORT_ORDER: &[&str] = &[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// Build a group tree from source data rows.
///
/// Groups rows hierarchically by each field in `fields`, producing a tree of
/// `AggregatedNode`s. Values and subtotals are NOT computed here — that happens
/// in the aggregate pass.
///
/// # Errors
///
/// Returns `RelationalError::GroupExplosion` if the total node count exceeds
/// `MAX_GROUP_NODES`.
pub(crate) fn build_group_tree(
    data: &[Vec<CellValue>],
    indices: &[usize],
    fields: &[GroupField],
) -> Result<Vec<AggregatedNode>, RelationalError> {
    if fields.is_empty() {
        return Ok(vec![]);
    }

    let mut node_count: usize = 0;
    build_level(data, indices, 0, &[], fields, &mut node_count)
}

/// Recursive tree builder for one level of the hierarchy.
fn build_level(
    data: &[Vec<CellValue>],
    level_indices: &[usize],
    depth: usize,
    ancestor_keys: &[String],
    fields: &[GroupField],
    node_count: &mut usize,
) -> Result<Vec<AggregatedNode>, RelationalError> {
    if depth >= fields.len() {
        return Ok(vec![]);
    }

    let field = &fields[depth];
    let is_leaf_level = depth == fields.len() - 1;

    // Group row indices by the current field. Keys are structural
    // `GroupKey`s — no in-band string sentinels.
    let mut group_order: Vec<GroupKey> = Vec::new();
    let mut groups: HashMap<GroupKey, (CellValue, Vec<usize>)> = HashMap::new();

    for &index in level_indices {
        let row = &data[index];
        let raw_value = if field.column_index < row.len() {
            &row[field.column_index]
        } else {
            &CellValue::Null
        };
        let (key, display_value) = get_group_key(raw_value, field);

        match groups.entry(key.clone()) {
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                entry.get_mut().1.push(index);
            }
            std::collections::hash_map::Entry::Vacant(entry) => {
                group_order.push(key);
                entry.insert((display_value, vec![index]));
            }
        }
    }

    // Check group explosion safeguard.
    *node_count += group_order.len();
    if *node_count > MAX_GROUP_NODES {
        return Err(RelationalError::GroupExplosion {
            max: MAX_GROUP_NODES,
        });
    }

    // Build nodes.
    let mut nodes: Vec<AggregatedNode> = Vec::with_capacity(group_order.len());

    for group_key in &group_order {
        let (display_value, group_indices) = groups.get(group_key).unwrap();
        // The composite `AggregatedNode.key` is still a `String` because it
        // flows to presenter / hierarchy / web API as a path identifier.
        // Only the intermediate HashMap bucket key is structural.
        let group_key_wire = group_key.to_wire_string();
        let path_key = build_path_key(ancestor_keys, &group_key_wire);

        let parent_key = if ancestor_keys.is_empty() {
            None
        } else {
            Some(ancestor_keys.join("\x00"))
        };

        let children = if is_leaf_level {
            vec![]
        } else {
            let mut next_ancestors = ancestor_keys.to_vec();
            next_ancestors.push(group_key_wire);
            build_level(
                data,
                group_indices,
                depth + 1,
                &next_ancestors,
                fields,
                node_count,
            )?
        };

        nodes.push(AggregatedNode {
            key: path_key,
            value: display_value.clone(),
            field_id: field.id.clone(),
            depth,
            values: vec![],
            subtotal_values: None,
            row_indices: group_indices.clone(),
            children,
            parent_key,
        });
    }

    // Sort nodes by label.
    sort_nodes_in_place(&mut nodes, field);

    Ok(nodes)
}

/// Get the structural group key for a value, applying date or number
/// grouping, and return the display value alongside.
fn get_group_key(value: &CellValue, field: &GroupField) -> (GroupKey, CellValue) {
    let display_value = match &field.grouping {
        GroupingStrategy::Identity => value.clone(),
        GroupingStrategy::Date(kind) => apply_date_grouping(value, *kind),
        GroupingStrategy::Number(config) => apply_number_grouping(value, config),
    };

    let key = cell_value_to_group_key(&display_value);
    (key, display_value)
}

/// Build a unique path key from ancestor keys and a current key.
fn build_path_key(ancestors: &[String], current: &str) -> String {
    if ancestors.is_empty() {
        current.to_string()
    } else {
        let total_len: usize =
            ancestors.iter().map(String::len).sum::<usize>() + current.len() + ancestors.len();
        let mut result = String::with_capacity(total_len);
        for (i, ancestor) in ancestors.iter().enumerate() {
            if i > 0 {
                result.push('\x00');
            }
            result.push_str(ancestor);
        }
        result.push('\x00');
        result.push_str(current);
        result
    }
}

/// Sort nodes in-place by label.
fn sort_nodes_in_place(nodes: &mut [AggregatedNode], field: &GroupField) {
    // Determine effective custom sort list.
    let month_sort_values: Option<Vec<CellValue>>;
    let effective_custom_list: Option<&[CellValue]> = if field.sort.custom_order.is_some() {
        field.sort.custom_order.as_deref()
    } else if matches!(
        field.grouping,
        GroupingStrategy::Date(DateGroupingKind::Month)
    ) {
        month_sort_values = Some(
            MONTH_SORT_ORDER
                .iter()
                .map(|s| CellValue::Text((*s).to_string().into()))
                .collect(),
        );
        month_sort_values.as_deref()
    } else {
        None
    };

    // When sorting by value, label sort acts as a tiebreaker and should always
    // be ascending (A-Z) for deterministic output. Only label-sorted fields
    // use the configured direction for label ordering.
    let stats_direction = if matches!(field.sort.sort_by, SortBy::Value { .. }) {
        compute_stats::types::SortDirection::Asc
    } else {
        match field.sort.direction {
            SortDirection::Ascending => compute_stats::types::SortDirection::Asc,
            SortDirection::Descending => compute_stats::types::SortDirection::Desc,
        }
    };

    let sort_config = StatsSortConfig {
        direction: stats_direction,
        case_sensitive: false,
        // Excel pivot tables use lexicographic (dictionary) sort, not natural sort.
        natural_sort: false,
    };

    if let Some(custom_list) = effective_custom_list {
        sort_by_custom_order_in_place(nodes, |node| node.value.clone(), custom_list, &sort_config);
    } else {
        sort_by_in_place(nodes, |node| node.value.clone(), &sort_config);
    }

    if effective_custom_list.is_none()
        && !matches!(field.sort.sort_by, SortBy::Value { .. })
        && matches!(field.sort.direction, SortDirection::Ascending)
    {
        nodes.sort_by(
            |a, b| match (a.value.is_visually_blank(), b.value.is_visually_blank()) {
                (true, true) => std::cmp::Ordering::Equal,
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                (false, false) => compare_cell_values(&a.value, &b.value, &sort_config),
            },
        );
    }
}

// ============================================================================
// Date grouping
// ============================================================================

/// Apply date grouping to a value.
fn apply_date_grouping(value: &CellValue, kind: DateGroupingKind) -> CellValue {
    match value {
        CellValue::Null => CellValue::Null,
        CellValue::Number(serial) => {
            if serial.is_nan() || serial.is_infinite() {
                return value.clone();
            }

            // Hour/Minute/Second: extract from fractional part.
            match kind {
                DateGroupingKind::Hour => {
                    let frac = serial.get() - serial.floor();
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let total_seconds = (frac * 86400.0).round() as u32;
                    return CellValue::number(f64::from(total_seconds / 3600));
                }
                DateGroupingKind::Minute => {
                    let frac = serial.get() - serial.floor();
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let total_seconds = (frac * 86400.0).round() as u32;
                    return CellValue::number(f64::from((total_seconds % 3600) / 60));
                }
                DateGroupingKind::Second => {
                    let frac = serial.get() - serial.floor();
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let total_seconds = (frac * 86400.0).round() as u32;
                    return CellValue::number(f64::from(total_seconds % 60));
                }
                _ => {}
            }

            if let Some(date) = serial_to_date(serial.get()) {
                match kind {
                    DateGroupingKind::Year => CellValue::number(f64::from(date.year())),
                    DateGroupingKind::Quarter => {
                        CellValue::Text(format!("Q{}", (date.month() - 1) / 3 + 1).into())
                    }
                    DateGroupingKind::Month => {
                        let month_name = match date.month() {
                            1 => "January",
                            2 => "February",
                            3 => "March",
                            4 => "April",
                            5 => "May",
                            6 => "June",
                            7 => "July",
                            8 => "August",
                            9 => "September",
                            10 => "October",
                            11 => "November",
                            12 => "December",
                            _ => unreachable!(),
                        };
                        CellValue::Text(month_name.to_string().into())
                    }
                    DateGroupingKind::Week => {
                        CellValue::Text(format!("Week {}", excel_week_number(date)).into())
                    }
                    DateGroupingKind::Day => CellValue::number(f64::from(date.day())),
                    _ => unreachable!(),
                }
            } else {
                value.clone()
            }
        }
        _ => value.clone(),
    }
}

/// Compute the Excel-style week number for a date.
fn excel_week_number(date: chrono::NaiveDate) -> u32 {
    let jan1 = chrono::NaiveDate::from_ymd_opt(date.year(), 1, 1).unwrap();
    let jan1_weekday = jan1.weekday().num_days_from_sunday();
    let day_of_year = date.ordinal();
    ((day_of_year - 1 + jan1_weekday) / 7) + 1
}

// ============================================================================
// Number grouping
// ============================================================================

/// Apply number grouping to a value.
fn apply_number_grouping(value: &CellValue, config: &NumberGroupingKind) -> CellValue {
    if !config.interval.is_finite()
        || config.interval <= 0.0
        || !config.start.is_finite()
        || !config.end.is_finite()
    {
        return value.clone();
    }
    if config.start >= config.end {
        return value.clone();
    }

    match value {
        CellValue::Number(n) => {
            let val = n.get();
            if !val.is_finite() {
                return value.clone();
            }
            let start = config.start;
            let end = config.end;
            let interval = config.interval;
            let precision = decimal_precision(interval);

            if val < start {
                return CellValue::Text(
                    format!(
                        "< {}",
                        format_grouping_number(round_to_precision(start, precision))
                    )
                    .into(),
                );
            }
            if val >= end {
                return CellValue::Text(
                    format!(
                        ">= {}",
                        format_grouping_number(round_to_precision(end, precision))
                    )
                    .into(),
                );
            }

            let raw_quotient = (val - start) / interval;
            let snap_precision = precision + 6;
            #[allow(clippy::cast_possible_truncation)]
            let bucket_index = round_to_precision(raw_quotient, snap_precision).floor() as i64;
            #[allow(clippy::cast_precision_loss)]
            let bucket_start =
                round_to_precision(start + bucket_index as f64 * interval, precision);
            let bucket_end = round_to_precision((bucket_start + interval).min(end), precision);

            let label_end = if interval.fract() == 0.0 {
                bucket_end - 1.0
            } else {
                bucket_end
            };
            CellValue::Text(
                format!(
                    "{} - {}",
                    format_grouping_number(bucket_start),
                    format_grouping_number(label_end)
                )
                .into(),
            )
        }
        _ => value.clone(),
    }
}

fn format_grouping_number(n: f64) -> String {
    #[allow(clippy::float_cmp)]
    let is_integer = n == n.trunc() && n.abs() < 1e15;
    if is_integer {
        #[allow(clippy::cast_possible_truncation)]
        let int_val = n as i64;
        format!("{int_val}")
    } else {
        format!("{n}")
    }
}

fn round_to_precision(value: f64, precision: u32) -> f64 {
    #[allow(clippy::cast_possible_wrap)]
    let factor = 10_f64.powi(precision as i32);
    (value * factor).round() / factor
}

fn decimal_precision(interval: f64) -> u32 {
    let s = format!("{interval}");
    #[allow(clippy::cast_possible_truncation)]
    s.find('.').map_or(0, |dot| (s.len() - dot - 1) as u32)
}
