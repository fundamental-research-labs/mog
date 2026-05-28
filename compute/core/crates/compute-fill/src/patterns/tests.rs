use super::values::TOLERANCE;
use super::*;
use crate::types::{DateUnit, TimeUnit};
use std::sync::Arc;
use value_types::FiniteF64;
use value_types::date_serial::ymd_to_serial;

fn num(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(n).unwrap())
}

fn text(s: &str) -> CellValue {
    CellValue::Text(Arc::from(s))
}

fn locale() -> LocaleNames {
    LocaleNames::default()
}

fn no_lists() -> Vec<CustomList> {
    vec![]
}

fn detect(values: &[CellValue]) -> FillPattern {
    detect_fill_pattern(values, &no_lists(), &locale())
}

fn detect_with_lists(values: &[CellValue], lists: &[CustomList]) -> FillPattern {
    detect_fill_pattern(values, lists, &locale())
}

#[test]
fn empty_returns_copy() {
    let p = detect(&[]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn single_number_returns_copy() {
    let p = detect(&[num(5.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn single_zero_returns_copy() {
    let p = detect(&[num(0.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn single_text_returns_copy() {
    let p = detect(&[text("hello")]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn single_boolean_returns_copy() {
    let p = detect(&[CellValue::Boolean(true)]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn single_null_returns_copy() {
    let p = detect(&[CellValue::Null]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn single_ordinal_returns_ordinal() {
    let p = detect(&[text("1st")]);
    assert_eq!(p.pattern_type, FillPatternType::Ordinal);
    assert_eq!(p.step, Some(1.0));
    assert_eq!(p.start_index, Some(1));
}

#[test]
fn single_text_number_returns_text_with_number() {
    let p = detect(&[text("Item1")]);
    assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
    assert_eq!(p.prefix, Some("Item".to_string()));
    assert_eq!(p.step, Some(1.0));
}

#[test]
fn linear_ascending() {
    let p = detect(&[num(-6.0), num(-4.0), num(-2.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
    assert_eq!(p.step, Some(2.0));
}

#[test]
fn linear_descending() {
    let p = detect(&[num(-4.0), num(-7.0), num(-10.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
    assert_eq!(p.step, Some(-3.0));
}

#[test]
fn linear_two_values() {
    let p = detect(&[num(-3.0), num(-1.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
    assert_eq!(p.step, Some(2.0));
}

#[test]
fn small_integers_detected_as_date() {
    let p = detect(&[num(2.0), num(4.0), num(6.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Date);
    assert_eq!(p.date_unit, Some(DateUnit::Day));
}

#[test]
fn linear_fractional_step() {
    let p = detect(&[num(0.0), num(0.5), num(1.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
    assert!((p.step.unwrap() - 0.5).abs() < TOLERANCE);
}

#[test]
fn linear_negative_values() {
    let p = detect(&[num(-6.0), num(-3.0), num(0.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
    assert_eq!(p.step, Some(3.0));
}

#[test]
fn not_linear_inconsistent_step() {
    let p = detect(&[num(1.0), num(2.0), num(4.0)]);
    assert_ne!(p.pattern_type, FillPatternType::Linear);
}

#[test]
fn linear_constant_step_zero() {
    let p = detect(&[num(5.0), num(5.0), num(5.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
    assert_eq!(p.step, Some(0.0));
}

#[test]
fn linear_within_tolerance() {
    let p = detect(&[num(0.0), num(1.0), num(2.0 + 5e-11)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
}

#[test]
fn linear_outside_tolerance() {
    let p = detect(&[num(0.0), num(1.0), num(2.0 + 2e-10)]);
    assert_ne!(p.pattern_type, FillPatternType::Linear);
}

#[test]
fn growth_doubling() {
    let p = detect(&[num(2.0), num(4.0), num(8.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Growth);
    assert!((p.multiplier.unwrap() - 2.0).abs() < TOLERANCE);
}

#[test]
fn growth_one_third() {
    let p = detect(&[num(81.0), num(27.0), num(9.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Growth);
    assert!((p.multiplier.unwrap() - 1.0 / 3.0).abs() < TOLERANCE);
}

#[test]
fn growth_two_values() {
    let p = detect(&[num(-3.0), num(-9.0), num(-27.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Growth);
    assert!((p.multiplier.unwrap() - 3.0).abs() < TOLERANCE);
}

#[test]
fn growth_rejected_when_multiplier_one() {
    let p = detect(&[num(5.0), num(5.0), num(5.0)]);
    assert_ne!(p.pattern_type, FillPatternType::Growth);
}

#[test]
fn growth_rejected_when_zero_present() {
    let p = detect(&[num(0.0), num(1.0), num(2.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
}

#[test]
fn date_daily() {
    let s1 = ymd_to_serial(2024, 1, 1);
    let s2 = ymd_to_serial(2024, 1, 2);
    let s3 = ymd_to_serial(2024, 1, 3);
    let p = detect(&[num(s1), num(s2), num(s3)]);
    assert_eq!(p.pattern_type, FillPatternType::Date);
    assert_eq!(p.date_unit, Some(DateUnit::Day));
    assert_eq!(p.step, Some(1.0));
}

#[test]
fn date_daily_step_7() {
    let s1 = ymd_to_serial(2024, 1, 1);
    let s2 = ymd_to_serial(2024, 1, 8);
    let s3 = ymd_to_serial(2024, 1, 15);
    let p = detect(&[num(s1), num(s2), num(s3)]);
    assert_eq!(p.pattern_type, FillPatternType::Date);
    assert_eq!(p.date_unit, Some(DateUnit::Day));
    assert_eq!(p.step, Some(7.0));
}

#[test]
fn date_monthly() {
    let s1 = ymd_to_serial(2024, 1, 15);
    let s2 = ymd_to_serial(2024, 2, 15);
    let s3 = ymd_to_serial(2024, 3, 15);
    let p = detect(&[num(s1), num(s2), num(s3)]);
    assert_eq!(p.pattern_type, FillPatternType::Date);
    assert_eq!(p.date_unit, Some(DateUnit::Month));
    assert_eq!(p.step, Some(1.0));
}

#[test]
fn date_yearly() {
    let s1 = ymd_to_serial(2022, 6, 15);
    let s2 = ymd_to_serial(2023, 6, 15);
    let s3 = ymd_to_serial(2024, 6, 15);
    let p = detect(&[num(s1), num(s2), num(s3)]);
    assert_eq!(p.pattern_type, FillPatternType::Date);
    assert_eq!(p.date_unit, Some(DateUnit::Year));
    assert_eq!(p.step, Some(1.0));
}

#[test]
fn date_twelve_month_interval_is_yearly() {
    let s1 = ymd_to_serial(2019, 6, 15);
    let s2 = ymd_to_serial(2020, 6, 15);
    let s3 = ymd_to_serial(2021, 6, 15);
    let p = detect(&[num(s1), num(s2), num(s3)]);
    assert_eq!(p.pattern_type, FillPatternType::Date);
    assert_eq!(p.date_unit, Some(DateUnit::Year));
}

#[test]
fn date_not_detected_for_non_date_serials() {
    let p = detect(&[num(-5.0), num(-4.0), num(-3.0)]);
    assert_eq!(p.pattern_type, FillPatternType::Linear);
}

#[test]
fn time_hourly() {
    let p = detect(&[num(0.25), num(0.5), num(0.75)]);
    assert_eq!(p.pattern_type, FillPatternType::Time);
    assert_eq!(p.time_unit, Some(TimeUnit::Hour));
    assert_eq!(p.step, Some(6.0));
}

#[test]
fn time_thirty_minutes() {
    let half_hour = 30.0 / 1440.0;
    let p = detect(&[num(0.5), num(0.5 + half_hour)]);
    assert_eq!(p.pattern_type, FillPatternType::Time);
    assert_eq!(p.time_unit, Some(TimeUnit::Minute));
    assert_eq!(p.step, Some(30.0));
}

#[test]
fn time_not_detected_across_dates() {
    let p = detect(&[num(1.25), num(2.5)]);
    assert_ne!(p.time_unit, Some(TimeUnit::Hour));
}

#[test]
fn weekday_full() {
    let p = detect(&[text("Monday"), text("Tuesday"), text("Wednesday")]);
    assert_eq!(p.pattern_type, FillPatternType::Weekday);
    assert_eq!(p.start_index, Some(1));
}

#[test]
fn weekday_short() {
    let p = detect(&[text("Mon"), text("Tue"), text("Wed")]);
    assert_eq!(p.pattern_type, FillPatternType::WeekdayShort);
    assert_eq!(p.start_index, Some(1));
}

#[test]
fn weekday_wraps_around() {
    let p = detect(&[
        text("Friday"),
        text("Saturday"),
        text("Sunday"),
        text("Monday"),
    ]);
    assert_eq!(p.pattern_type, FillPatternType::Weekday);
    assert_eq!(p.start_index, Some(5));
}

#[test]
fn weekday_case_insensitive() {
    let p = detect(&[text("monday"), text("tuesday")]);
    assert_eq!(p.pattern_type, FillPatternType::Weekday);
}

#[test]
fn weekday_mixed_variant_rejected() {
    let p = detect(&[text("Monday"), text("Tue")]);
    assert_ne!(p.pattern_type, FillPatternType::Weekday);
    assert_ne!(p.pattern_type, FillPatternType::WeekdayShort);
}

#[test]
fn weekday_non_consecutive_rejected() {
    let p = detect(&[text("Monday"), text("Wednesday")]);
    assert_ne!(p.pattern_type, FillPatternType::Weekday);
}

#[test]
fn month_full() {
    let p = detect(&[text("January"), text("February"), text("March")]);
    assert_eq!(p.pattern_type, FillPatternType::Month);
    assert_eq!(p.start_index, Some(0));
}

#[test]
fn month_short() {
    let p = detect(&[text("Jan"), text("Feb"), text("Mar")]);
    assert_eq!(p.pattern_type, FillPatternType::MonthShort);
    assert_eq!(p.start_index, Some(0));
}

#[test]
fn month_wraps_around() {
    let p = detect(&[text("November"), text("December"), text("January")]);
    assert_eq!(p.pattern_type, FillPatternType::Month);
    assert_eq!(p.start_index, Some(10));
}

#[test]
fn month_case_insensitive() {
    let p = detect(&[text("january"), text("february")]);
    assert_eq!(p.pattern_type, FillPatternType::Month);
}

#[test]
fn month_non_consecutive_rejected() {
    let p = detect(&[text("January"), text("March")]);
    assert_ne!(p.pattern_type, FillPatternType::Month);
}

#[test]
fn quarter_basic() {
    let p = detect(&[text("Q1"), text("Q2"), text("Q3")]);
    assert_eq!(p.pattern_type, FillPatternType::Quarter);
    assert_eq!(p.start_index, Some(0));
}

#[test]
fn quarter_wraps_around() {
    let p = detect(&[text("Q3"), text("Q4"), text("Q1")]);
    assert_eq!(p.pattern_type, FillPatternType::Quarter);
    assert_eq!(p.start_index, Some(2));
}

#[test]
fn quarter_case_insensitive() {
    let p = detect(&[text("q1"), text("q2")]);
    assert_eq!(p.pattern_type, FillPatternType::Quarter);
}

#[test]
fn quarter_non_consecutive_rejected() {
    let p = detect(&[text("Q1"), text("Q3")]);
    assert_ne!(p.pattern_type, FillPatternType::Quarter);
}

#[test]
fn custom_list_basic() {
    let lists = vec![CustomList {
        id: "priority".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];
    let p = detect_with_lists(&[text("High"), text("Medium"), text("Low")], &lists);
    assert_eq!(p.pattern_type, FillPatternType::CustomList);
    assert_eq!(p.list_id, Some("priority".into()));
    assert_eq!(p.start_index, Some(0));
}

#[test]
fn custom_list_partial_match() {
    let lists = vec![CustomList {
        id: "dirs".into(),
        values: vec!["North".into(), "South".into(), "East".into(), "West".into()],
    }];
    let p = detect_with_lists(&[text("South"), text("East")], &lists);
    assert_eq!(p.pattern_type, FillPatternType::CustomList);
    assert_eq!(p.start_index, Some(1));
}

#[test]
fn custom_list_wraps_around() {
    let lists = vec![CustomList {
        id: "dirs".into(),
        values: vec!["North".into(), "South".into(), "East".into(), "West".into()],
    }];
    let p = detect_with_lists(&[text("West"), text("North")], &lists);
    assert_eq!(p.pattern_type, FillPatternType::CustomList);
    assert_eq!(p.start_index, Some(3));
}

#[test]
fn custom_list_case_insensitive() {
    let lists = vec![CustomList {
        id: "p".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];
    let p = detect_with_lists(&[text("high"), text("medium")], &lists);
    assert_eq!(p.pattern_type, FillPatternType::CustomList);
}

#[test]
fn custom_list_no_match() {
    let lists = vec![CustomList {
        id: "p".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];
    let p = detect_with_lists(&[text("Foo"), text("Bar")], &lists);
    assert_ne!(p.pattern_type, FillPatternType::CustomList);
}

#[test]
fn custom_list_preserves_original_list_id() {
    let lists = vec![CustomList {
        id: "OriginalID".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];
    let p = detect_with_lists(&[text("high"), text("medium")], &lists);
    assert_eq!(p.list_id, Some("OriginalID".into()));
}

#[test]
fn custom_list_first_match_wins() {
    let lists = vec![
        CustomList {
            id: "first".into(),
            values: vec!["A".into(), "B".into()],
        },
        CustomList {
            id: "second".into(),
            values: vec!["A".into(), "B".into()],
        },
    ];
    let p = detect_with_lists(&[text("A"), text("B")], &lists);
    assert_eq!(p.list_id, Some("first".into()));
}

#[test]
fn ordinal_basic() {
    let p = detect(&[text("1st"), text("2nd"), text("3rd")]);
    assert_eq!(p.pattern_type, FillPatternType::Ordinal);
    assert_eq!(p.start_index, Some(1));
    assert_eq!(p.step, Some(1.0));
}

#[test]
fn ordinal_step_two() {
    let p = detect(&[text("1st"), text("3rd"), text("5th")]);
    assert_eq!(p.pattern_type, FillPatternType::Ordinal);
    assert_eq!(p.step, Some(2.0));
}

#[test]
fn ordinal_with_teens() {
    let p = detect(&[text("11th"), text("12th"), text("13th")]);
    assert_eq!(p.pattern_type, FillPatternType::Ordinal);
    assert_eq!(p.start_index, Some(11));
}

#[test]
fn ordinal_wrong_suffix_rejected() {
    assert!(parse_ordinal("1nd").is_none());
}

#[test]
fn ordinal_21st_valid() {
    assert_eq!(parse_ordinal("21st"), Some(21));
}

#[test]
fn ordinal_113th_valid() {
    assert_eq!(parse_ordinal("113th"), Some(113));
}

#[test]
fn text_number_basic() {
    let p = detect(&[text("Item1"), text("Item2"), text("Item3")]);
    assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
    assert_eq!(p.prefix, Some("Item".into()));
    assert_eq!(p.step, Some(1.0));
    assert_eq!(p.num_digits, None);
}

#[test]
fn text_number_with_padding() {
    let p = detect(&[text("File001"), text("File002"), text("File003")]);
    assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
    assert_eq!(p.prefix, Some("File".into()));
    assert_eq!(p.step, Some(1.0));
    assert_eq!(p.num_digits, Some(3));
}

#[test]
fn text_number_step_two() {
    let p = detect(&[text("Row-5"), text("Row-7"), text("Row-9")]);
    assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
    assert_eq!(p.prefix, Some("Row-".into()));
    assert_eq!(p.step, Some(2.0));
}

#[test]
fn text_number_different_prefix_rejected() {
    let p = detect(&[text("Item1"), text("Thing2")]);
    assert_ne!(p.pattern_type, FillPatternType::TextWithNumber);
}

#[test]
fn text_number_no_digits_rejected() {
    let p = detect(&[text("Hello"), text("World")]);
    assert_ne!(p.pattern_type, FillPatternType::TextWithNumber);
}

#[test]
fn mixed_number_and_text_returns_copy() {
    let p = detect(&[num(1.0), text("hello")]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn mixed_number_and_boolean_returns_copy() {
    let p = detect(&[num(1.0), CellValue::Boolean(true)]);
    assert_eq!(p.pattern_type, FillPatternType::Copy);
}

#[test]
fn date_takes_priority_over_linear() {
    let s1 = ymd_to_serial(2024, 1, 1);
    let s2 = ymd_to_serial(2024, 1, 2);
    let s3 = ymd_to_serial(2024, 1, 3);
    let p = detect(&[num(s1), num(s2), num(s3)]);
    assert_eq!(p.pattern_type, FillPatternType::Date);
}

#[test]
fn time_takes_priority_over_linear() {
    let p = detect(&[num(0.25), num(0.5), num(0.75)]);
    assert_eq!(p.pattern_type, FillPatternType::Time);
}

#[test]
fn german_weekday_names() {
    let german = LocaleNames {
        weekdays: [
            "Sonntag".into(),
            "Montag".into(),
            "Dienstag".into(),
            "Mittwoch".into(),
            "Donnerstag".into(),
            "Freitag".into(),
            "Samstag".into(),
        ],
        weekdays_short: [
            "So".into(),
            "Mo".into(),
            "Di".into(),
            "Mi".into(),
            "Do".into(),
            "Fr".into(),
            "Sa".into(),
        ],
        months: LocaleNames::default().months.clone(),
        months_short: LocaleNames::default().months_short.clone(),
    };
    let values = [text("Montag"), text("Dienstag"), text("Mittwoch")];
    let p = detect_fill_pattern(&values, &no_lists(), &german);
    assert_eq!(p.pattern_type, FillPatternType::Weekday);
    assert_eq!(p.start_index, Some(1));
}

#[test]
fn french_month_names() {
    let french = LocaleNames {
        weekdays: LocaleNames::default().weekdays.clone(),
        weekdays_short: LocaleNames::default().weekdays_short.clone(),
        months: [
            "Janvier".into(),
            "Février".into(),
            "Mars".into(),
            "Avril".into(),
            "Mai".into(),
            "Juin".into(),
            "Juillet".into(),
            "Août".into(),
            "Septembre".into(),
            "Octobre".into(),
            "Novembre".into(),
            "Décembre".into(),
        ],
        months_short: [
            "Janv.".into(),
            "Févr.".into(),
            "Mars".into(),
            "Avr.".into(),
            "Mai".into(),
            "Juin".into(),
            "Juil.".into(),
            "Août".into(),
            "Sept.".into(),
            "Oct.".into(),
            "Nov.".into(),
            "Déc.".into(),
        ],
    };
    let values = [text("Janvier"), text("Février"), text("Mars")];
    let p = detect_fill_pattern(&values, &no_lists(), &french);
    assert_eq!(p.pattern_type, FillPatternType::Month);
    assert_eq!(p.start_index, Some(0));
}

#[test]
fn parse_ordinal_valid_cases() {
    assert_eq!(parse_ordinal("1st"), Some(1));
    assert_eq!(parse_ordinal("2nd"), Some(2));
    assert_eq!(parse_ordinal("3rd"), Some(3));
    assert_eq!(parse_ordinal("4th"), Some(4));
    assert_eq!(parse_ordinal("11th"), Some(11));
    assert_eq!(parse_ordinal("12th"), Some(12));
    assert_eq!(parse_ordinal("13th"), Some(13));
    assert_eq!(parse_ordinal("21st"), Some(21));
    assert_eq!(parse_ordinal("22nd"), Some(22));
    assert_eq!(parse_ordinal("23rd"), Some(23));
    assert_eq!(parse_ordinal("100th"), Some(100));
}

#[test]
fn parse_ordinal_invalid_cases() {
    assert_eq!(parse_ordinal("1nd"), None);
    assert_eq!(parse_ordinal("2st"), None);
    assert_eq!(parse_ordinal("11st"), None);
    assert_eq!(parse_ordinal("abc"), None);
    assert_eq!(parse_ordinal(""), None);
    assert_eq!(parse_ordinal("1"), None);
    assert_eq!(parse_ordinal("st"), None);
}

#[test]
fn parse_text_number_valid() {
    assert_eq!(parse_text_number("Item003"), Some(("Item".into(), 3, 3)));
    assert_eq!(parse_text_number("Row1"), Some(("Row".into(), 1, 1)));
    assert_eq!(parse_text_number("A-10"), Some(("A-".into(), 10, 2)));
    assert_eq!(parse_text_number("123"), Some(("".into(), 123, 3)));
}

#[test]
fn parse_text_number_invalid() {
    assert_eq!(parse_text_number("Hello"), None);
    assert_eq!(parse_text_number(""), None);
}

#[test]
fn find_quarter_index_valid() {
    assert_eq!(find_quarter_index("Q1"), Some(0));
    assert_eq!(find_quarter_index("Q2"), Some(1));
    assert_eq!(find_quarter_index("Q3"), Some(2));
    assert_eq!(find_quarter_index("Q4"), Some(3));
    assert_eq!(find_quarter_index("q1"), Some(0));
}

#[test]
fn find_quarter_index_invalid() {
    assert_eq!(find_quarter_index("Q5"), None);
    assert_eq!(find_quarter_index("hello"), None);
}

#[test]
fn find_weekday_index_basics() {
    let loc = locale();
    assert_eq!(find_weekday_index("Sunday", &loc), Some((0, false)));
    assert_eq!(find_weekday_index("Mon", &loc), Some((1, true)));
    assert_eq!(find_weekday_index("saturday", &loc), Some((6, false)));
    assert_eq!(find_weekday_index("xyz", &loc), None);
}

#[test]
fn find_month_index_basics() {
    let loc = locale();
    assert_eq!(find_month_index("January", &loc), Some((0, false)));
    assert_eq!(find_month_index("Dec", &loc), Some((11, true)));
    assert_eq!(find_month_index("xyz", &loc), None);
}
