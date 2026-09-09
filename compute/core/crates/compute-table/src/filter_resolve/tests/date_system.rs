use crate::filter::evaluate_column_filter_with_date_system;
use crate::filter_resolve::{compute_date_range, compute_date_range_serial_with_date_system};
use crate::types::{DynamicFilter, DynamicFilterRule, FilterCriteria};
use chrono::{NaiveDate, Weekday};
use value_types::{CellValue, DateSystem, FiniteF64, date_to_serial};

fn cv_num(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}

fn evaluate_date_rule(
    rule: DynamicFilterRule,
    data: &[CellValue],
    date_system: DateSystem,
) -> Vec<u8> {
    let criteria = FilterCriteria::Dynamic(DynamicFilter { rule });
    evaluate_column_filter_with_date_system(
        &criteria,
        data,
        None,
        Some(NaiveDate::from_ymd_opt(2024, 6, 15).unwrap()),
        Some(Weekday::Sun),
        date_system,
    )
}

#[test]
fn dynamic_calendar_rules_use_workbook_serials_and_include_fractional_end_days() {
    let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
    let rules = [
        DynamicFilterRule::Today,
        DynamicFilterRule::Yesterday,
        DynamicFilterRule::Tomorrow,
        DynamicFilterRule::ThisWeek,
        DynamicFilterRule::LastWeek,
        DynamicFilterRule::NextWeek,
        DynamicFilterRule::ThisMonth,
        DynamicFilterRule::LastMonth,
        DynamicFilterRule::NextMonth,
        DynamicFilterRule::ThisQuarter,
        DynamicFilterRule::LastQuarter,
        DynamicFilterRule::NextQuarter,
        DynamicFilterRule::ThisYear,
        DynamicFilterRule::LastYear,
        DynamicFilterRule::NextYear,
    ];

    for date_system in [DateSystem::Date1900, DateSystem::Date1904] {
        for rule in rules {
            let (start, end) = compute_date_range(&rule, now, Weekday::Sun).unwrap();
            let start_serial = date_system.from_canonical_serial(date_to_serial(&start));
            let end_serial = date_system.from_canonical_serial(date_to_serial(&end));
            let next_day_serial = date_system.from_canonical_serial(date_to_serial(&end) + 1.0);
            let data = vec![
                cv_num(start_serial),
                cv_num(start_serial + 0.5),
                cv_num(end_serial + 0.5),
                cv_num(next_day_serial),
            ];

            assert_eq!(
                evaluate_date_rule(rule, &data, date_system),
                vec![1, 1, 1, 0],
                "rule {rule:?} in {date_system:?}",
            );
        }
    }
}

#[test]
fn serial_range_helper_applies_the_1904_offset() {
    let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
    let canonical = compute_date_range_serial_with_date_system(
        &DynamicFilterRule::Today,
        now,
        Weekday::Sun,
        DateSystem::Date1900,
    )
    .unwrap();
    let workbook_1904 = compute_date_range_serial_with_date_system(
        &DynamicFilterRule::Today,
        now,
        Weekday::Sun,
        DateSystem::Date1904,
    )
    .unwrap();

    assert_eq!(
        workbook_1904.0,
        canonical.0 - DateSystem::DATE_SYSTEM_1904_OFFSET
    );
    assert_eq!(
        workbook_1904.1,
        canonical.1 - DateSystem::DATE_SYSTEM_1904_OFFSET
    );
}
