//! Conversion bridge from domain filter criteria to compute-table criteria.

use chrono::NaiveDate;
use domain_types::domain::filter::{DateGroupItem, DateTimeGrouping};
use value_types::{CellValue, DateSystem, date_to_serial};

use super::{
    ColumnFilter, DynamicFilterRule, FilterCondition, FilterLogic, FilterOperator, TopBottomBy,
    TopBottomDirection,
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

/// Parse the closed set of temporal and numeric dynamic-filter tokens emitted
/// by OOXML. Unknown tokens stay `None` so the import shell can preserve them
/// without accidentally executing them as `aboveAverage`.
pub fn dynamic_filter_rule_from_ooxml_type(value: &str) -> Option<DynamicFilterRule> {
    Some(match value {
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
        _ => return None,
    })
}

/// Return whether all imported date-group items have a valid component set.
/// `calendarType` is deliberately absent: Office evaluates these fields using
/// the Gregorian year/month/day/time components and ignores that attribute.
pub fn date_group_items_supported(items: &[DateGroupItem]) -> bool {
    date_group_items_supported_in_date_system(items, DateSystem::Date1900)
}

/// Return whether all date-group items can be represented in a workbook date
/// system. The Excel 1900 compatibility day is valid only in the 1900 system.
pub fn date_group_items_supported_in_date_system(
    items: &[DateGroupItem],
    date_system: DateSystem,
) -> bool {
    items
        .iter()
        .all(|item| date_group_serial_bounds(item, date_system).is_some())
}

/// Convert a value filter containing date-group items to executable runtime
/// conditions. Ordinary values and blanks are joined with the date ranges using
/// the same OR semantics as OOXML `<filters>`.
pub fn values_filter_to_column_filter(
    values: &[String],
    include_blanks: bool,
    date_group_items: &[DateGroupItem],
    date_system: DateSystem,
) -> Option<ColumnFilter> {
    if date_group_items.is_empty() {
        return Some(ColumnFilter::Values {
            values: values
                .iter()
                .map(|value| serde_json::Value::String(value.clone()))
                .collect(),
            include_blanks,
        });
    }

    let mut conditions = Vec::with_capacity(
        values
            .len()
            .saturating_add(date_group_items.len())
            .saturating_add(if include_blanks { 1 } else { 0 }),
    );
    conditions.extend(values.iter().map(|value| FilterCondition {
        operator: FilterOperator::Equals,
        value: Some(CellValue::Text(value.clone().into())),
        value2: None,
    }));

    for item in date_group_items {
        let (start, end_exclusive) = date_group_serial_bounds(item, date_system)?;
        conditions.push(FilterCondition {
            operator: FilterOperator::Between,
            value: Some(CellValue::number(start)),
            value2: Some(CellValue::number(previous_float(end_exclusive)?)),
        });
    }

    if include_blanks {
        conditions.push(FilterCondition {
            operator: FilterOperator::IsBlank,
            value: None,
            value2: None,
        });
    }

    Some(ColumnFilter::Condition {
        conditions,
        logic: FilterLogic::Or,
    })
}

/// Return the workbook-relative half-open serial interval for one
/// `dateGroupItem`. The end is exclusive so fractional cell times are handled
/// exactly; callers using the condition representation convert it to the last
/// representable inclusive f64 below that boundary.
fn date_group_serial_bounds(item: &DateGroupItem, date_system: DateSystem) -> Option<(f64, f64)> {
    let year = i32::from(item.year);
    if !(1..=9_999).contains(&year)
        || item.month.is_some_and(|month| !(1..=12).contains(&month))
        || item.day.is_some_and(|day| !(1..=31).contains(&day))
        || item.hour.is_some_and(|hour| hour > 23)
        || item.minute.is_some_and(|minute| minute > 59)
        || item.second.is_some_and(|second| second > 59)
    {
        return None;
    }
    let (month, day, hour, minute, second) = match item.date_time_grouping {
        DateTimeGrouping::Year => (1, 1, 0, 0, 0),
        DateTimeGrouping::Month => (u32::from(item.month?), 1, 0, 0, 0),
        DateTimeGrouping::Day => (u32::from(item.month?), u32::from(item.day?), 0, 0, 0),
        DateTimeGrouping::Hour => (
            u32::from(item.month?),
            u32::from(item.day?),
            u32::from(item.hour?),
            0,
            0,
        ),
        DateTimeGrouping::Minute => (
            u32::from(item.month?),
            u32::from(item.day?),
            u32::from(item.hour?),
            u32::from(item.minute?),
            0,
        ),
        DateTimeGrouping::Second => (
            u32::from(item.month?),
            u32::from(item.day?),
            u32::from(item.hour?),
            u32::from(item.minute?),
            u32::from(item.second?),
        ),
    };
    let phantom_february_day = year == 1900 && month == 2 && day == 29;
    if phantom_february_day && date_system == DateSystem::Date1904 {
        // The 1904 workbook system has no representable serial for Excel's
        // 1900 compatibility day; do not turn it into a negative fake date.
        return None;
    }
    if phantom_february_day
        && !matches!(
            item.date_time_grouping,
            DateTimeGrouping::Day
                | DateTimeGrouping::Hour
                | DateTimeGrouping::Minute
                | DateTimeGrouping::Second
        )
    {
        return None;
    }
    let start_date = if phantom_february_day {
        None
    } else {
        Some(NaiveDate::from_ymd_opt(year, month, day)?)
    };
    let start_day_serial = if phantom_february_day {
        60.0
    } else {
        date_to_serial(start_date.as_ref()?)
    };
    let start_time = u64::from(hour) * 3_600 + u64::from(minute) * 60 + u64::from(second);
    // Move the integer day base into the workbook's serial system before
    // adding the fractional time. This keeps the sub-day ULP stable in the
    // 1904 system instead of adding at the larger canonical serial first and
    // subtracting 1462 afterwards.
    let workbook_day_serial = date_system.from_canonical_serial(start_day_serial);
    let start = workbook_day_serial + (start_time as f64 / 86_400.0);

    let end_serial = match item.date_time_grouping {
        DateTimeGrouping::Year => date_system.from_canonical_serial(date_to_serial(
            &NaiveDate::from_ymd_opt(year.checked_add(1)?, 1, 1)?,
        )),
        DateTimeGrouping::Month => {
            let (end_year, end_month) = if month == 12 {
                (year.checked_add(1)?, 1)
            } else {
                (year, month + 1)
            };
            date_system.from_canonical_serial(date_to_serial(&NaiveDate::from_ymd_opt(
                end_year, end_month, 1,
            )?))
        }
        DateTimeGrouping::Day => workbook_day_serial + 1.0,
        DateTimeGrouping::Hour => workbook_day_serial + ((start_time + 3_600) as f64 / 86_400.0),
        DateTimeGrouping::Minute => workbook_day_serial + ((start_time + 60) as f64 / 86_400.0),
        DateTimeGrouping::Second => workbook_day_serial + ((start_time + 1) as f64 / 86_400.0),
    };
    Some((start, end_serial))
}

/// Greatest finite IEEE-754 value strictly below `value`.
fn previous_float(value: f64) -> Option<f64> {
    if !value.is_finite() {
        return None;
    }
    if value == 0.0 {
        return Some(-f64::from_bits(1));
    }
    let bits = value.to_bits();
    let previous_bits = if value.is_sign_negative() {
        bits.checked_add(1)?
    } else {
        bits.checked_sub(1)?
    };
    Some(f64::from_bits(previous_bits))
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
            // Preserve the criterion identity; evaluation receives fresh CF icon
            // identities separately from values and formats.
            compute_table::types::FilterCriteria::Icon(compute_table::types::IconFilter {
                icon_set_name: icon_set_name.clone(),
                icon_index: *icon_index,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(
        grouping: DateTimeGrouping,
        month: Option<u16>,
        day: Option<u16>,
        hour: Option<u16>,
        minute: Option<u16>,
        second: Option<u16>,
    ) -> DateGroupItem {
        DateGroupItem {
            year: 2024,
            month,
            day,
            hour,
            minute,
            second,
            date_time_grouping: grouping,
        }
    }

    #[test]
    fn date_group_bounds_cover_all_granularities_and_1904_offset() {
        let cases = [
            item(DateTimeGrouping::Year, None, None, None, None, None),
            item(DateTimeGrouping::Month, Some(7), None, None, None, None),
            item(DateTimeGrouping::Day, Some(7), Some(4), None, None, None),
            item(
                DateTimeGrouping::Hour,
                Some(7),
                Some(4),
                Some(13),
                None,
                None,
            ),
            item(
                DateTimeGrouping::Minute,
                Some(7),
                Some(4),
                Some(13),
                Some(37),
                None,
            ),
            item(
                DateTimeGrouping::Second,
                Some(7),
                Some(4),
                Some(13),
                Some(37),
                Some(42),
            ),
        ];

        for item in cases {
            let (start_1900, end_1900) =
                date_group_serial_bounds(&item, DateSystem::Date1900).unwrap();
            let (start_1904, end_1904) =
                date_group_serial_bounds(&item, DateSystem::Date1904).unwrap();
            assert!(start_1900 < end_1900);
            assert_eq!(start_1900 - start_1904, DateSystem::DATE_SYSTEM_1904_OFFSET);
            assert_eq!(end_1900 - end_1904, DateSystem::DATE_SYSTEM_1904_OFFSET);
        }
    }

    #[test]
    fn date_group_includes_excel_1900_phantom_day_but_rejects_it_in_1904() {
        let item = DateGroupItem {
            year: 1900,
            month: Some(2),
            day: Some(29),
            date_time_grouping: DateTimeGrouping::Day,
            ..Default::default()
        };
        let (start, end) = date_group_serial_bounds(&item, DateSystem::Date1900).unwrap();
        assert_eq!(start, 60.0);
        assert_eq!(end, 61.0);
        assert!(date_group_serial_bounds(&item, DateSystem::Date1904).is_none());
    }

    #[test]
    fn invalid_date_group_components_stay_unsupported() {
        let invalid_hour = DateGroupItem {
            year: 2024,
            month: Some(7),
            day: Some(4),
            hour: Some(24),
            date_time_grouping: DateTimeGrouping::Hour,
            ..Default::default()
        };
        assert!(!date_group_items_supported(std::slice::from_ref(
            &invalid_hour
        )));
        assert!(
            values_filter_to_column_filter(
                &[],
                false,
                std::slice::from_ref(&invalid_hour),
                DateSystem::Date1900,
            )
            .is_none()
        );
    }

    #[test]
    fn date_group_values_and_blanks_use_or_conditions() {
        let item = item(DateTimeGrouping::Day, Some(7), Some(4), None, None, None);
        let ColumnFilter::Condition { conditions, logic } = values_filter_to_column_filter(
            &["literal".to_string()],
            true,
            &[item],
            DateSystem::Date1900,
        )
        .unwrap() else {
            panic!("date-group values should become conditions");
        };
        assert_eq!(logic, FilterLogic::Or);
        assert_eq!(conditions.len(), 3);
        assert_eq!(conditions[0].operator, FilterOperator::Equals);
        assert_eq!(conditions[1].operator, FilterOperator::Between);
        assert_eq!(conditions[2].operator, FilterOperator::IsBlank);
    }

    #[test]
    fn date_group_conditions_exclude_exact_end_and_include_previous_float() {
        let cases = [
            item(DateTimeGrouping::Year, None, None, None, None, None),
            item(DateTimeGrouping::Month, Some(7), None, None, None, None),
            item(DateTimeGrouping::Day, Some(7), Some(4), None, None, None),
            item(
                DateTimeGrouping::Hour,
                Some(7),
                Some(4),
                Some(23),
                None,
                None,
            ),
            item(
                DateTimeGrouping::Minute,
                Some(7),
                Some(4),
                Some(23),
                Some(59),
                None,
            ),
            item(
                DateTimeGrouping::Second,
                Some(7),
                Some(4),
                Some(23),
                Some(59),
                Some(59),
            ),
        ];

        for item in cases {
            let (start, end) = date_group_serial_bounds(&item, DateSystem::Date1900).unwrap();
            let previous = previous_float(end).unwrap();
            let filter = values_filter_to_column_filter(
                &[],
                false,
                std::slice::from_ref(&item),
                DateSystem::Date1900,
            )
            .unwrap();
            let table_filter = column_filter_to_table_criteria(&filter);
            let data = [
                CellValue::number(start),
                CellValue::number(previous),
                CellValue::number(end),
            ];
            let bitmap = compute_table::filter::evaluate_column_filter(
                &table_filter,
                &data,
                None,
                None,
                None,
            );
            assert_eq!(
                bitmap,
                vec![1, 1, 0],
                "date group: {:?}",
                item.date_time_grouping
            );
        }
    }
}

// =============================================================================
