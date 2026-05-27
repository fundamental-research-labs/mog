//! Conversion bridge from domain filter criteria to compute-table criteria.

use value_types::CellValue;

use super::{
    ColumnFilter, DynamicFilterRule, FilterLogic, FilterOperator, TopBottomBy, TopBottomDirection,
};

// ColumnFilter → compute_table::FilterCriteria conversion
// =============================================================================
//
// Instead of duplicating evaluation logic, we convert domain-types ColumnFilter
// to compute-table FilterCriteria and delegate evaluation to
// compute_table::filter::evaluate_column_filter.

/// Convert a `serde_json::Value` to a `CellValue`.
fn json_value_to_cell_value(v: &serde_json::Value) -> CellValue {
    match v {
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                CellValue::from(f)
            } else {
                CellValue::Null
            }
        }
        serde_json::Value::String(s) => CellValue::Text(std::sync::Arc::from(s.as_str())),
        serde_json::Value::Bool(b) => CellValue::Boolean(*b),
        serde_json::Value::Null => CellValue::Null,
        _ => CellValue::Null,
    }
}

/// Convert a domain-types `FilterOperator` to a compute-table `FilterOperator`.
///
/// The domain-types enum has AboveAverage/BelowAverage variants that don't exist
/// in compute-table (those are handled as DynamicFilterRule). This function handles
/// the 14 shared operators; AboveAverage/BelowAverage must be handled separately
/// at the `ColumnFilter` conversion level.
fn convert_filter_operator(op: &FilterOperator) -> compute_table::types::FilterOperator {
    match op {
        FilterOperator::Equals => compute_table::types::FilterOperator::Equals,
        FilterOperator::NotEquals => compute_table::types::FilterOperator::NotEquals,
        FilterOperator::GreaterThan => compute_table::types::FilterOperator::GreaterThan,
        FilterOperator::GreaterThanOrEqual => {
            compute_table::types::FilterOperator::GreaterThanOrEqual
        }
        FilterOperator::LessThan => compute_table::types::FilterOperator::LessThan,
        FilterOperator::LessThanOrEqual => compute_table::types::FilterOperator::LessThanOrEqual,
        FilterOperator::BeginsWith => compute_table::types::FilterOperator::BeginsWith,
        FilterOperator::EndsWith => compute_table::types::FilterOperator::EndsWith,
        FilterOperator::Contains => compute_table::types::FilterOperator::Contains,
        FilterOperator::NotContains => compute_table::types::FilterOperator::NotContains,
        FilterOperator::Between => compute_table::types::FilterOperator::Between,
        FilterOperator::NotBetween => compute_table::types::FilterOperator::NotBetween,
        FilterOperator::IsBlank => compute_table::types::FilterOperator::IsBlank,
        FilterOperator::IsNotBlank => compute_table::types::FilterOperator::IsNotBlank,
        // AboveAverage/BelowAverage are not compute-table FilterOperator variants.
        // They should be converted to DynamicFilter at the ColumnFilter level.
        // If we somehow reach here, fall back to IsNotBlank (passes most rows).
        FilterOperator::AboveAverage | FilterOperator::BelowAverage => {
            compute_table::types::FilterOperator::IsNotBlank
        }
    }
}

/// Convert a domain-types `DynamicFilterRule` to a compute-table `DynamicFilterRule`.
pub fn convert_dynamic_rule(rule: &DynamicFilterRule) -> compute_table::types::DynamicFilterRule {
    match rule {
        DynamicFilterRule::AboveAverage => compute_table::types::DynamicFilterRule::AboveAverage,
        DynamicFilterRule::BelowAverage => compute_table::types::DynamicFilterRule::BelowAverage,
        DynamicFilterRule::Today => compute_table::types::DynamicFilterRule::Today,
        DynamicFilterRule::Yesterday => compute_table::types::DynamicFilterRule::Yesterday,
        DynamicFilterRule::Tomorrow => compute_table::types::DynamicFilterRule::Tomorrow,
        DynamicFilterRule::ThisWeek => compute_table::types::DynamicFilterRule::ThisWeek,
        DynamicFilterRule::LastWeek => compute_table::types::DynamicFilterRule::LastWeek,
        DynamicFilterRule::NextWeek => compute_table::types::DynamicFilterRule::NextWeek,
        DynamicFilterRule::ThisMonth => compute_table::types::DynamicFilterRule::ThisMonth,
        DynamicFilterRule::LastMonth => compute_table::types::DynamicFilterRule::LastMonth,
        DynamicFilterRule::NextMonth => compute_table::types::DynamicFilterRule::NextMonth,
        DynamicFilterRule::ThisQuarter => compute_table::types::DynamicFilterRule::ThisQuarter,
        DynamicFilterRule::LastQuarter => compute_table::types::DynamicFilterRule::LastQuarter,
        DynamicFilterRule::NextQuarter => compute_table::types::DynamicFilterRule::NextQuarter,
        DynamicFilterRule::ThisYear => compute_table::types::DynamicFilterRule::ThisYear,
        DynamicFilterRule::LastYear => compute_table::types::DynamicFilterRule::LastYear,
        DynamicFilterRule::NextYear => compute_table::types::DynamicFilterRule::NextYear,
    }
}

/// Convert a domain-types `ColumnFilter` to a compute-table `FilterCriteria`.
///
/// Handles the type mapping between `serde_json::Value` and `CellValue` for filter
/// values, and maps `AboveAverage`/`BelowAverage` condition operators to
/// `FilterCriteria::Dynamic` (since compute-table treats those as dynamic filters,
/// not condition operators).
pub(super) fn column_filter_to_table_criteria(
    cf: &ColumnFilter,
) -> compute_table::types::FilterCriteria {
    match cf {
        ColumnFilter::Values {
            values,
            include_blanks,
        } => compute_table::types::FilterCriteria::Values(compute_table::types::ValueFilter {
            included: values.iter().map(json_value_to_cell_value).collect(),
            include_blanks: *include_blanks,
        }),
        ColumnFilter::Condition { conditions, logic } => {
            // Check if all conditions use AboveAverage or BelowAverage — if so,
            // convert to a DynamicFilter instead. These operators don't exist in
            // compute-table's FilterOperator enum.
            if conditions.len() == 1 {
                match conditions[0].operator {
                    FilterOperator::AboveAverage => {
                        return compute_table::types::FilterCriteria::Dynamic(
                            compute_table::types::DynamicFilter {
                                rule: compute_table::types::DynamicFilterRule::AboveAverage,
                            },
                        );
                    }
                    FilterOperator::BelowAverage => {
                        return compute_table::types::FilterCriteria::Dynamic(
                            compute_table::types::DynamicFilter {
                                rule: compute_table::types::DynamicFilterRule::BelowAverage,
                            },
                        );
                    }
                    _ => {}
                }
            }

            compute_table::types::FilterCriteria::Condition(compute_table::types::ConditionFilter {
                conditions: conditions
                    .iter()
                    .map(|c| compute_table::types::TableFilterCondition {
                        operator: convert_filter_operator(&c.operator),
                        value: c.value.clone().unwrap_or(CellValue::Null),
                        value2: c.value2.clone(),
                    })
                    .collect(),
                logic: match logic {
                    FilterLogic::And => compute_table::types::FilterLogic::And,
                    FilterLogic::Or => compute_table::types::FilterLogic::Or,
                },
            })
        }
        ColumnFilter::TopBottom {
            direction,
            count,
            by,
        } => compute_table::types::FilterCriteria::TopBottom(
            compute_table::types::TableTopBottomFilter {
                direction: match direction {
                    TopBottomDirection::Top => compute_table::types::TopBottomDirection::Top,
                    TopBottomDirection::Bottom => compute_table::types::TopBottomDirection::Bottom,
                },
                count: *count,
                by: match by {
                    TopBottomBy::Items => compute_table::types::TopBottomBy::Items,
                    TopBottomBy::Percent => compute_table::types::TopBottomBy::Percent,
                    TopBottomBy::Sum => compute_table::types::TopBottomBy::Sum,
                },
            },
        ),
        ColumnFilter::Dynamic { rule } => {
            compute_table::types::FilterCriteria::Dynamic(compute_table::types::DynamicFilter {
                rule: convert_dynamic_rule(rule),
            })
        }
        ColumnFilter::Color { color, by_font } => {
            // Forward the requested hex into the table-engine criterion. The
            // engine's `evaluate_column_filter` does the per-row compare against
            // the resolved CellFormat slice that the caller materializes.
            //
            // `by_font == false` ⇒ filter by cell fill (background); the request
            // hex goes into `cell_color`. `by_font == true` ⇒ filter by font
            // color; the hex goes into `font_color`.
            let parsed = value_types::Color::from_hex(color).ok();
            compute_table::types::FilterCriteria::Color(compute_table::types::TableColorFilter {
                cell_color: if *by_font { None } else { parsed },
                font_color: if *by_font { parsed } else { None },
            })
        }
        ColumnFilter::Icon {
            icon_set_name,
            icon_index,
        } => {
            // Icon filters require CF rule context that is not available at the storage
            // level — the bridge layer performs the actual match. Forward the payload so
            // the bridge can read it from the stored FilterCriteria.
            compute_table::types::FilterCriteria::Icon(compute_table::types::IconFilter {
                icon_set_name: icon_set_name.clone(),
                icon_index: *icon_index,
            })
        }
    }
}

// =============================================================================
