use std::collections::HashMap;
use std::sync::atomic::Ordering;

use value_types::CellValue;

use super::NEXT_FILTER_ID;
use super::ooxml::{AutoFilter, FilterColumn, OoxmlFilterCondition, OoxmlFilterType};
use super::ooxml_sort::{SortCondition, SortConditionBy, SortState};
use super::range_ref::{build_range_ref, parse_range_ref};
use super::runtime::{
    ColumnFilter, DynamicFilterRule, FilterCondition, FilterKind, FilterLogic, FilterOperator,
    FilterSortState, FilterState, SortBy, SortOrder, TopBottomBy, TopBottomDirection,
};

/// Convert an OOXML `AutoFilter` to a runtime `FilterState`.
///
/// The `cell_id_resolver` maps (row, col) to a CellId string (hex).
/// Typically this comes from the grid index's posToId map.
pub fn auto_filter_to_filter_state(
    auto_filter: &AutoFilter,
    cell_id_resolver: &impl Fn(u32, u32) -> Option<String>,
) -> Option<FilterState> {
    let (start_row, start_col, end_row, end_col) = parse_range_ref(&auto_filter.range_ref)?;

    let header_start_id = cell_id_resolver(start_row, start_col)?;
    let header_end_id = cell_id_resolver(start_row, end_col)?;
    let data_end_id = cell_id_resolver(end_row, end_col)?;

    let mut column_filters = HashMap::new();
    for fc in &auto_filter.columns {
        let Some(filter_type) = &fc.filter_type else {
            continue;
        };
        let col = start_col + fc.col_index;
        if let Some(header_cell_id) = cell_id_resolver(start_row, col) {
            let cf = ooxml_filter_type_to_column_filter(filter_type);
            column_filters.insert(header_cell_id, cf);
        }
    }

    let sort_state = auto_filter
        .sort
        .as_ref()
        .and_then(|sort| sort_state_to_filter_sort_state(sort, start_row, &cell_id_resolver));

    Some(FilterState {
        id: format!("filter-{}", NEXT_FILTER_ID.fetch_add(1, Ordering::Relaxed)),
        filter_kind: FilterKind::AutoFilter,
        header_start_cell_id: header_start_id,
        header_end_cell_id: header_end_id,
        data_end_cell_id: data_end_id,
        column_filters,
        advanced_filter: None,
        sort_state,
        table_id: None,
        created_at: None,
        updated_at: None,
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    })
}

/// Convert an `OoxmlFilterType` variant to a `ColumnFilter`.
fn ooxml_filter_type_to_column_filter(ft: &OoxmlFilterType) -> ColumnFilter {
    match ft {
        OoxmlFilterType::Values { values, blanks, .. } => ColumnFilter::Values {
            values: values
                .iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect(),
            include_blanks: *blanks,
        },
        OoxmlFilterType::Top10 {
            top,
            percent,
            value,
            ..
        } => ColumnFilter::TopBottom {
            direction: if *top {
                TopBottomDirection::Top
            } else {
                TopBottomDirection::Bottom
            },
            count: *value,
            by: if *percent {
                TopBottomBy::Percent
            } else {
                TopBottomBy::Items
            },
        },
        OoxmlFilterType::Custom {
            conditions,
            and_logic,
        } => ColumnFilter::Condition {
            conditions: conditions
                .iter()
                .map(|c| FilterCondition {
                    operator: parse_ooxml_operator(&c.operator),
                    value: if matches!(c.value, CellValue::Null) {
                        None
                    } else {
                        Some(c.value.clone())
                    },
                    value2: c.value2.clone(),
                })
                .collect(),
            logic: if *and_logic {
                FilterLogic::And
            } else {
                FilterLogic::Or
            },
        },
        OoxmlFilterType::Dynamic { dynamic_type, .. } => ColumnFilter::Dynamic {
            rule: parse_dynamic_type(dynamic_type),
        },
        OoxmlFilterType::Color { dxf_id, cell_color } => ColumnFilter::Color {
            // The runtime ColumnFilter::Color predates typed OOXML preservation's typing work
            // and carries a string `color` token (a dxfId is the canonical
            // OOXML representation but the runtime hasn't been migrated yet).
            // Preserve the dxfId as a string so export can round-trip it
            // back into the typed Color variant via `format!` parsing below.
            color: dxf_id.map(|id| format!("dxf:{id}")).unwrap_or_default(),
            by_font: !*cell_color,
        },
        OoxmlFilterType::Icon { icon_set, icon_id } => ColumnFilter::Icon {
            icon_set_name: icon_set.clone().unwrap_or_default(),
            icon_index: *icon_id as u8,
        },
    }
}

/// Parse an OOXML operator string to FilterOperator.
fn parse_ooxml_operator(op: &str) -> FilterOperator {
    match op {
        "equal" | "equals" => FilterOperator::Equals,
        "notEqual" | "notEquals" => FilterOperator::NotEquals,
        "greaterThan" => FilterOperator::GreaterThan,
        "greaterThanOrEqual" => FilterOperator::GreaterThanOrEqual,
        "lessThan" => FilterOperator::LessThan,
        "lessThanOrEqual" => FilterOperator::LessThanOrEqual,
        "beginsWith" | "startsWith" => FilterOperator::BeginsWith,
        "endsWith" => FilterOperator::EndsWith,
        "contains" => FilterOperator::Contains,
        "notContains" => FilterOperator::NotContains,
        "between" => FilterOperator::Between,
        "notBetween" => FilterOperator::NotBetween,
        _ => FilterOperator::Equals, // fallback for unknown OOXML operators
    }
}

/// Parse a dynamic type string from OOXML to a DynamicFilterRule.
fn parse_dynamic_type(dt: &str) -> DynamicFilterRule {
    match dt {
        "aboveAverage" => DynamicFilterRule::AboveAverage,
        "belowAverage" => DynamicFilterRule::BelowAverage,
        "today" => DynamicFilterRule::Today,
        "yesterday" => DynamicFilterRule::Yesterday,
        "tomorrow" => DynamicFilterRule::Tomorrow,
        "thisWeek" => DynamicFilterRule::ThisWeek,
        "lastWeek" => DynamicFilterRule::LastWeek,
        "nextWeek" => DynamicFilterRule::NextWeek,
        "thisMonth" => DynamicFilterRule::ThisMonth,
        "lastMonth" => DynamicFilterRule::LastMonth,
        "nextMonth" => DynamicFilterRule::NextMonth,
        "thisQuarter" => DynamicFilterRule::ThisQuarter,
        "lastQuarter" => DynamicFilterRule::LastQuarter,
        "nextQuarter" => DynamicFilterRule::NextQuarter,
        "thisYear" => DynamicFilterRule::ThisYear,
        "lastYear" => DynamicFilterRule::LastYear,
        "nextYear" => DynamicFilterRule::NextYear,
        _ => DynamicFilterRule::AboveAverage, // fallback for unrecognized types
    }
}

/// Convert a runtime `FilterState` back to an OOXML `AutoFilter` for export.
///
/// The `pos_resolver` maps a CellId string (hex) to (row, col).
pub fn filter_state_to_auto_filter(
    state: &FilterState,
    pos_resolver: &impl Fn(&str) -> Option<(u32, u32)>,
) -> Option<AutoFilter> {
    let (start_row, start_col) = pos_resolver(&state.header_start_cell_id)?;
    let (end_row, end_col) = pos_resolver(&state.data_end_cell_id)?;

    let range_ref = build_range_ref(start_row, start_col, end_row, end_col);

    let mut columns: Vec<FilterColumn> = Vec::new();
    for (cell_id, cf) in &state.column_filters {
        if let Some((_, col)) = pos_resolver(cell_id) {
            let col_index = col.saturating_sub(start_col);
            let filter_type = Some(column_filter_to_ooxml_filter_type(cf));
            columns.push(FilterColumn {
                col_index,
                filter_type,
                ..Default::default()
            });
        }
    }
    columns.sort_by_key(|c| c.col_index);

    let sort = state.sort_state.as_ref().and_then(|sort| {
        filter_sort_state_to_sort_state(sort, start_row, start_col, end_row, end_col, pos_resolver)
    });

    Some(AutoFilter {
        range_ref,
        columns,
        sort,
        xr_uid: None,
        ext_lst_raw: None,
    })
}

fn sort_state_to_filter_sort_state(
    sort: &SortState,
    header_row: u32,
    cell_id_resolver: &impl Fn(u32, u32) -> Option<String>,
) -> Option<FilterSortState> {
    let condition = sort.conditions.first()?;
    let (_, column, _, _) = parse_range_ref(&condition.range_ref)?;
    Some(FilterSortState {
        column_cell_id: cell_id_resolver(header_row, column)?,
        order: if condition.descending {
            SortOrder::Desc
        } else {
            SortOrder::Asc
        },
        sort_by: match condition.sort_by {
            SortConditionBy::Value => SortBy::Value,
            SortConditionBy::CellColor | SortConditionBy::FontColor => SortBy::Color,
            SortConditionBy::Icon => SortBy::Icon,
        },
    })
}

fn filter_sort_state_to_sort_state(
    sort: &FilterSortState,
    header_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    pos_resolver: &impl Fn(&str) -> Option<(u32, u32)>,
) -> Option<SortState> {
    let (_, sort_col) = pos_resolver(&sort.column_cell_id)?;
    if sort_col < start_col || sort_col > end_col {
        return None;
    }

    let data_start_row = header_row.saturating_add(1).min(end_row);
    let range_ref = build_range_ref(data_start_row, start_col, end_row, end_col);
    let condition_ref = build_range_ref(data_start_row, sort_col, end_row, sort_col);
    Some(SortState {
        range_ref,
        conditions: vec![SortCondition {
            range_ref: condition_ref,
            descending: sort.order == SortOrder::Desc,
            sort_by: match sort.sort_by {
                SortBy::Value => SortConditionBy::Value,
                // Runtime sort state collapses cell/font color. Export the
                // common cell-color token until runtime carries that distinction.
                SortBy::Color => SortConditionBy::CellColor,
                SortBy::Icon => SortConditionBy::Icon,
            },
            ..Default::default()
        }],
        ..Default::default()
    })
}

/// Convert a `ColumnFilter` back to an `OoxmlFilterType`.
pub fn column_filter_to_ooxml_filter_type(cf: &ColumnFilter) -> OoxmlFilterType {
    match cf {
        ColumnFilter::Values {
            values,
            include_blanks,
        } => OoxmlFilterType::Values {
            values: values
                .iter()
                .map(|v| match v {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b) => b.to_string(),
                    _ => String::new(),
                })
                .filter(|s| !s.is_empty())
                .collect(),
            blanks: *include_blanks,
            calendar_type: None,
            date_group_items: Vec::new(),
        },
        ColumnFilter::TopBottom {
            direction,
            count,
            by,
        } => OoxmlFilterType::Top10 {
            top: *direction == TopBottomDirection::Top,
            percent: *by == TopBottomBy::Percent,
            value: *count,
            filter_val: None,
        },
        ColumnFilter::Condition { conditions, logic } => OoxmlFilterType::Custom {
            conditions: conditions
                .iter()
                .map(|c| OoxmlFilterCondition {
                    operator: format_filter_operator(&c.operator),
                    value: c.value.clone().unwrap_or(CellValue::Null),
                    value2: c.value2.clone(),
                })
                .collect(),
            and_logic: *logic == FilterLogic::And,
        },
        ColumnFilter::Dynamic { rule } => OoxmlFilterType::Dynamic {
            dynamic_type: format_dynamic_rule(rule),
            value: None,
            max_value: None,
            value_iso: None,
            max_value_iso: None,
        },
        ColumnFilter::Color { color, by_font } => OoxmlFilterType::Color {
            // Decode the `dxf:<id>` shim used to carry the dxfId through the
            // runtime `ColumnFilter::Color` variant (see the inverse in
            // `ooxml_filter_type_to_column_filter`). Plain color strings
            // (legacy) are dropped onto `dxf_id: None` until the runtime
            // layer adopts dxfId directly.
            dxf_id: color
                .strip_prefix("dxf:")
                .and_then(|s| s.parse::<u32>().ok()),
            cell_color: !*by_font,
        },
        ColumnFilter::Icon {
            icon_set_name,
            icon_index,
        } => OoxmlFilterType::Icon {
            icon_set: if icon_set_name.is_empty() {
                None
            } else {
                Some(icon_set_name.clone())
            },
            icon_id: *icon_index as u32,
        },
    }
}

/// Format a FilterOperator as an OOXML operator string.
fn format_filter_operator(op: &FilterOperator) -> String {
    match op {
        FilterOperator::Equals => "equal".to_string(),
        FilterOperator::NotEquals => "notEqual".to_string(),
        FilterOperator::GreaterThan => "greaterThan".to_string(),
        FilterOperator::GreaterThanOrEqual => "greaterThanOrEqual".to_string(),
        FilterOperator::LessThan => "lessThan".to_string(),
        FilterOperator::LessThanOrEqual => "lessThanOrEqual".to_string(),
        FilterOperator::BeginsWith => "beginsWith".to_string(),
        FilterOperator::EndsWith => "endsWith".to_string(),
        FilterOperator::Contains => "contains".to_string(),
        FilterOperator::NotContains => "notContains".to_string(),
        FilterOperator::Between => "between".to_string(),
        FilterOperator::NotBetween => "notBetween".to_string(),
        FilterOperator::IsBlank => "equal".to_string(), // OOXML uses blank value, not operator
        FilterOperator::IsNotBlank => "notEqual".to_string(),
        FilterOperator::AboveAverage => "equal".to_string(), // dynamic, not custom operator in OOXML
        FilterOperator::BelowAverage => "equal".to_string(),
    }
}

/// Format a DynamicFilterRule as an OOXML camelCase string.
fn format_dynamic_rule(rule: &DynamicFilterRule) -> String {
    match rule {
        DynamicFilterRule::AboveAverage => "aboveAverage".to_string(),
        DynamicFilterRule::BelowAverage => "belowAverage".to_string(),
        DynamicFilterRule::Today => "today".to_string(),
        DynamicFilterRule::Yesterday => "yesterday".to_string(),
        DynamicFilterRule::Tomorrow => "tomorrow".to_string(),
        DynamicFilterRule::ThisWeek => "thisWeek".to_string(),
        DynamicFilterRule::LastWeek => "lastWeek".to_string(),
        DynamicFilterRule::NextWeek => "nextWeek".to_string(),
        DynamicFilterRule::ThisMonth => "thisMonth".to_string(),
        DynamicFilterRule::LastMonth => "lastMonth".to_string(),
        DynamicFilterRule::NextMonth => "nextMonth".to_string(),
        DynamicFilterRule::ThisQuarter => "thisQuarter".to_string(),
        DynamicFilterRule::LastQuarter => "lastQuarter".to_string(),
        DynamicFilterRule::NextQuarter => "nextQuarter".to_string(),
        DynamicFilterRule::ThisYear => "thisYear".to_string(),
        DynamicFilterRule::LastYear => "lastYear".to_string(),
        DynamicFilterRule::NextYear => "nextYear".to_string(),
    }
}
