use super::{date::is_weekend_serial, generate_series_values, textual::ordinal_suffix};
use crate::types::*;
use value_types::date_serial::ymd_to_serial;
use value_types::{CellValue, FiniteF64};

fn cv_num(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(v).unwrap())
}

fn cv_text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn default_pattern(pt: FillPatternType) -> FillPattern {
    FillPattern {
        pattern_type: pt,
        step: None,
        multiplier: None,
        date_unit: None,
        time_unit: None,
        start_index: None,
        prefix: None,
        num_digits: None,
        list_id: None,
    }
}

fn extract_numbers(vals: &[CellValue]) -> Vec<f64> {
    vals.iter()
        .map(|v| match v {
            CellValue::Number(f) => f.get(),
            _ => panic!("expected Number, got {:?}", v),
        })
        .collect()
}

fn extract_texts(vals: &[CellValue]) -> Vec<String> {
    vals.iter()
        .map(|v| match v {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("expected Text, got {:?}", v),
        })
        .collect()
}

fn locale() -> LocaleNames {
    LocaleNames::default()
}

// -----------------------------------------------------------------------
// Copy
// -----------------------------------------------------------------------

#[test]
fn copy_cycles_through_source() {
    let pat = default_pattern(FillPatternType::Copy);
    let src = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
    let result = generate_series_values(&pat, &src, 6, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![1.0, 2.0, 3.0, 1.0, 2.0, 3.0]);
}

#[test]
fn copy_single_value() {
    let pat = default_pattern(FillPatternType::Copy);
    let src = vec![cv_text("x")];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["x", "x", "x"]);
}

// -----------------------------------------------------------------------
// Linear
// -----------------------------------------------------------------------

#[test]
fn linear_step_2_forward() {
    let mut pat = default_pattern(FillPatternType::Linear);
    pat.step = Some(2.0);
    let src = vec![cv_num(2.0), cv_num(4.0), cv_num(6.0)];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![8.0, 10.0, 12.0]);
}

#[test]
fn linear_step_2_backward() {
    let mut pat = default_pattern(FillPatternType::Linear);
    pat.step = Some(2.0);
    let src = vec![cv_num(6.0), cv_num(4.0), cv_num(2.0)];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    // Last value is 2.0 (always uses last for linear), step=2, mult=-1
    // 2 + 2*1*(-1) = 0, 2 + 2*2*(-1) = -2, 2 + 2*3*(-1) = -4
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![0.0, -2.0, -4.0]);
}

#[test]
fn linear_default_step() {
    let pat = default_pattern(FillPatternType::Linear);
    let src = vec![cv_num(10.0)];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![11.0, 12.0, 13.0]);
}

#[test]
fn linear_fractional_step() {
    let mut pat = default_pattern(FillPatternType::Linear);
    pat.step = Some(0.5);
    let src = vec![cv_num(1.0)];
    let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![1.5, 2.0, 2.5, 3.0]);
}

// -----------------------------------------------------------------------
// Growth
// -----------------------------------------------------------------------

#[test]
fn growth_multiplier_2_forward() {
    let mut pat = default_pattern(FillPatternType::Growth);
    pat.multiplier = Some(2.0);
    let src = vec![cv_num(2.0), cv_num(4.0), cv_num(8.0)];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![16.0, 32.0, 64.0]);
}

#[test]
fn growth_multiplier_2_backward() {
    let mut pat = default_pattern(FillPatternType::Growth);
    pat.multiplier = Some(2.0);
    let src = vec![cv_num(64.0)];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![32.0, 16.0, 8.0]);
}

#[test]
fn growth_multiplier_3() {
    let mut pat = default_pattern(FillPatternType::Growth);
    pat.multiplier = Some(3.0);
    let src = vec![cv_num(1.0)];
    let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![3.0, 9.0, 27.0, 81.0]);
}

// -----------------------------------------------------------------------
// Date — Day
// -----------------------------------------------------------------------

#[test]
fn date_daily_forward() {
    // Jan 1, 2024 = serial
    let serial_jan1 = ymd_to_serial(2024, 1, 1);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Day);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial_jan1)];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2024, 1, 2));
    assert_eq!(nums[1], ymd_to_serial(2024, 1, 3));
    assert_eq!(nums[2], ymd_to_serial(2024, 1, 4));
}

#[test]
fn date_daily_step_3() {
    let serial_jan1 = ymd_to_serial(2024, 1, 1);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Day);
    pat.step = Some(3.0);
    let src = vec![cv_num(serial_jan1)];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2024, 1, 4));
    assert_eq!(nums[1], ymd_to_serial(2024, 1, 7));
    assert_eq!(nums[2], ymd_to_serial(2024, 1, 10));
}

#[test]
fn date_daily_backward() {
    let serial_jan5 = ymd_to_serial(2024, 1, 5);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Day);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial_jan5)];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2024, 1, 4));
    assert_eq!(nums[1], ymd_to_serial(2024, 1, 3));
    assert_eq!(nums[2], ymd_to_serial(2024, 1, 2));
}

// -----------------------------------------------------------------------
// Date — Weekday
// -----------------------------------------------------------------------

#[test]
fn date_weekday_skips_weekend() {
    // Friday Jan 5, 2024: step=1 weekday should skip Sat/Sun and land on Mon Jan 8
    let serial_fri = ymd_to_serial(2024, 1, 5); // Friday
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Weekday);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial_fri)];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    // Next weekday after Fri = Mon Jan 8
    assert_eq!(nums[0], ymd_to_serial(2024, 1, 8));
    // Then Tue Jan 9
    assert_eq!(nums[1], ymd_to_serial(2024, 1, 9));
    // Then Wed Jan 10
    assert_eq!(nums[2], ymd_to_serial(2024, 1, 10));
}

#[test]
fn date_weekday_backward_skips_weekend() {
    // Monday Jan 8, 2024: step=1 weekday backward should skip Sat/Sun and land on Fri Jan 5
    let serial_mon = ymd_to_serial(2024, 1, 8); // Monday
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Weekday);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial_mon)];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2024, 1, 5)); // Fri
    assert_eq!(nums[1], ymd_to_serial(2024, 1, 4)); // Thu
    assert_eq!(nums[2], ymd_to_serial(2024, 1, 3)); // Wed
}

// -----------------------------------------------------------------------
// Date — Month
// -----------------------------------------------------------------------

#[test]
fn date_monthly_forward() {
    let serial_jan15 = ymd_to_serial(2024, 1, 15);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Month);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial_jan15)];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2024, 2, 15));
    assert_eq!(nums[1], ymd_to_serial(2024, 3, 15));
    assert_eq!(nums[2], ymd_to_serial(2024, 4, 15));
}

#[test]
fn date_monthly_clamps_to_month_end() {
    // Jan 31 -> Feb 28 (or 29 in leap year 2024)
    let serial_jan31 = ymd_to_serial(2024, 1, 31);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Month);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial_jan31)];
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2024, 2, 29)); // leap year
    assert_eq!(nums[1], ymd_to_serial(2024, 3, 31)); // preserves Jan 31 anchor
}

#[test]
fn date_monthly_jan31_non_leap() {
    // Jan 31, 2025 -> Feb 28 (non-leap)
    let serial = ymd_to_serial(2025, 1, 31);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Month);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial)];
    let result = generate_series_values(&pat, &src, 1, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2025, 2, 28));
}

#[test]
fn date_monthly_jan30_does_not_become_month_end_after_february() {
    let serial_jan30 = ymd_to_serial(2025, 1, 30);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Month);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial_jan30)];
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2025, 2, 28));
    assert_eq!(nums[1], ymd_to_serial(2025, 3, 30));
}

// -----------------------------------------------------------------------
// Date — Year
// -----------------------------------------------------------------------

#[test]
fn date_yearly_forward() {
    let serial = ymd_to_serial(2024, 3, 15);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Year);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial)];
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2025, 3, 15));
    assert_eq!(nums[1], ymd_to_serial(2026, 3, 15));
}

#[test]
fn date_yearly_leap_day_clamps() {
    // Feb 29, 2024 -> Feb 28, 2025 (non-leap)
    let serial = ymd_to_serial(2024, 2, 29);
    let mut pat = default_pattern(FillPatternType::Date);
    pat.date_unit = Some(DateUnit::Year);
    pat.step = Some(1.0);
    let src = vec![cv_num(serial)];
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums[0], ymd_to_serial(2025, 2, 28));
    assert_eq!(nums[1], ymd_to_serial(2026, 2, 28));
}

// -----------------------------------------------------------------------
// Time
// -----------------------------------------------------------------------

#[test]
fn time_quarter_day_step() {
    let mut pat = default_pattern(FillPatternType::Time);
    pat.time_unit = Some(TimeUnit::Hour);
    pat.step = Some(6.0); // 6 hours = 0.25 day
    let src = vec![cv_num(0.25)]; // 6:00 AM
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert!((nums[0] - 0.5).abs() < 1e-10);
    assert!((nums[1] - 0.75).abs() < 1e-10);
    assert!((nums[2] - 1.0).abs() < 1e-10);
}

#[test]
fn time_step_fractional_day_directly() {
    // Using step=0.25 with hour unit: 0.25 hours = 15 min
    let mut pat = default_pattern(FillPatternType::Time);
    pat.time_unit = Some(TimeUnit::Hour);
    pat.step = Some(1.0);
    let src = vec![cv_num(0.5)]; // 12:00
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    // 12:00 + 1h = 13:00 = 0.5 + 1/24
    assert!((nums[0] - (0.5 + 1.0 / 24.0)).abs() < 1e-10);
    assert!((nums[1] - (0.5 + 2.0 / 24.0)).abs() < 1e-10);
    assert!((nums[2] - (0.5 + 3.0 / 24.0)).abs() < 1e-10);
}

#[test]
fn time_minute_step() {
    let mut pat = default_pattern(FillPatternType::Time);
    pat.time_unit = Some(TimeUnit::Minute);
    pat.step = Some(30.0);
    let src = vec![cv_num(0.5)]; // 12:00
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let nums = extract_numbers(&result);
    // 12:00 + 30min = 12:30 = 0.5 + 30/1440
    assert!((nums[0] - (0.5 + 30.0 / 1440.0)).abs() < 1e-10);
    assert!((nums[1] - (0.5 + 60.0 / 1440.0)).abs() < 1e-10);
}

#[test]
fn time_backward() {
    let mut pat = default_pattern(FillPatternType::Time);
    pat.time_unit = Some(TimeUnit::Hour);
    pat.step = Some(1.0);
    let src = vec![cv_num(0.5)]; // 12:00
    let result = generate_series_values(&pat, &src, 2, -1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert!((nums[0] - (0.5 - 1.0 / 24.0)).abs() < 1e-10);
    assert!((nums[1] - (0.5 - 2.0 / 24.0)).abs() < 1e-10);
}

// -----------------------------------------------------------------------
// Weekday
// -----------------------------------------------------------------------

#[test]
fn weekday_forward() {
    let pat = default_pattern(FillPatternType::Weekday);
    let src = vec![cv_text("Monday")];
    let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(
        texts,
        vec!["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    );
}

#[test]
fn weekday_wraps_around() {
    let pat = default_pattern(FillPatternType::Weekday);
    let src = vec![cv_text("Saturday")];
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Sunday", "Monday"]);
}

#[test]
fn weekday_backward() {
    let pat = default_pattern(FillPatternType::Weekday);
    let src = vec![cv_text("Wednesday")];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Tuesday", "Monday", "Sunday"]);
}

// -----------------------------------------------------------------------
// WeekdayShort
// -----------------------------------------------------------------------

#[test]
fn weekday_short_forward() {
    let pat = default_pattern(FillPatternType::WeekdayShort);
    let src = vec![cv_text("Mon")];
    let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Tue", "Wed", "Thu", "Fri", "Sat"]);
}

#[test]
fn weekday_short_backward() {
    let pat = default_pattern(FillPatternType::WeekdayShort);
    let src = vec![cv_text("Mon")];
    let result = generate_series_values(&pat, &src, 2, -1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Sun", "Sat"]);
}

// -----------------------------------------------------------------------
// Month
// -----------------------------------------------------------------------

#[test]
fn month_forward_wraps() {
    let pat = default_pattern(FillPatternType::Month);
    let src = vec![cv_text("November")];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["December", "January", "February"]);
}

#[test]
fn month_backward() {
    let pat = default_pattern(FillPatternType::Month);
    let src = vec![cv_text("March")];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["February", "January", "December"]);
}

// -----------------------------------------------------------------------
// MonthShort
// -----------------------------------------------------------------------

#[test]
fn month_short_forward_wraps() {
    let pat = default_pattern(FillPatternType::MonthShort);
    let src = vec![cv_text("Nov")];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Dec", "Jan", "Feb"]);
}

#[test]
fn month_short_backward() {
    let pat = default_pattern(FillPatternType::MonthShort);
    let src = vec![cv_text("Feb")];
    let result = generate_series_values(&pat, &src, 2, -1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Jan", "Dec"]);
}

// -----------------------------------------------------------------------
// Quarter
// -----------------------------------------------------------------------

#[test]
fn quarter_forward_wraps() {
    let mut pat = default_pattern(FillPatternType::Quarter);
    pat.start_index = Some(2); // Q3
    let src = vec![cv_text("Q3")];
    let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Q4", "Q1", "Q2", "Q3"]);
}

#[test]
fn quarter_backward() {
    let mut pat = default_pattern(FillPatternType::Quarter);
    pat.start_index = Some(1); // Q2
    let src = vec![cv_text("Q2")];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Q1", "Q4", "Q3"]);
}

// -----------------------------------------------------------------------
// TextWithNumber
// -----------------------------------------------------------------------

#[test]
fn text_with_number_forward() {
    let mut pat = default_pattern(FillPatternType::TextWithNumber);
    pat.prefix = Some("Item".into());
    pat.step = Some(1.0);
    pat.num_digits = Some(0);
    let src = vec![cv_text("Item3")];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Item4", "Item5", "Item6"]);
}

#[test]
fn text_with_number_zero_padded() {
    let mut pat = default_pattern(FillPatternType::TextWithNumber);
    pat.prefix = Some("File".into());
    pat.step = Some(1.0);
    pat.num_digits = Some(3);
    let src = vec![cv_text("File008")];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["File009", "File010", "File011"]);
}

#[test]
fn text_with_number_backward() {
    let mut pat = default_pattern(FillPatternType::TextWithNumber);
    pat.prefix = Some("Row".into());
    pat.step = Some(1.0);
    pat.num_digits = Some(0);
    let src = vec![cv_text("Row5")];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Row4", "Row3", "Row2"]);
}

#[test]
fn text_with_number_step_2() {
    let mut pat = default_pattern(FillPatternType::TextWithNumber);
    pat.prefix = Some("V".into());
    pat.step = Some(2.0);
    pat.num_digits = Some(0);
    let src = vec![cv_text("V10")];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["V12", "V14", "V16"]);
}

// -----------------------------------------------------------------------
// Ordinal
// -----------------------------------------------------------------------

#[test]
fn ordinal_forward() {
    let mut pat = default_pattern(FillPatternType::Ordinal);
    pat.step = Some(1.0);
    let src = vec![cv_text("1st")];
    let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["2nd", "3rd", "4th", "5th", "6th"]);
}

#[test]
fn ordinal_teens() {
    let mut pat = default_pattern(FillPatternType::Ordinal);
    pat.step = Some(1.0);
    let src = vec![cv_text("9th")];
    let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["10th", "11th", "12th", "13th", "14th"]);
}

#[test]
fn ordinal_twenties() {
    let mut pat = default_pattern(FillPatternType::Ordinal);
    pat.step = Some(1.0);
    let src = vec![cv_text("20th")];
    let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["21st", "22nd", "23rd", "24th"]);
}

#[test]
fn ordinal_hundreds() {
    let mut pat = default_pattern(FillPatternType::Ordinal);
    pat.step = Some(1.0);
    let src = vec![cv_text("110th")];
    let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["111th", "112th", "113th", "114th"]);
}

#[test]
fn ordinal_backward() {
    let mut pat = default_pattern(FillPatternType::Ordinal);
    pat.step = Some(1.0);
    let src = vec![cv_text("5th")];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["4th", "3rd", "2nd"]);
}

#[test]
fn ordinal_step_10() {
    let mut pat = default_pattern(FillPatternType::Ordinal);
    pat.step = Some(10.0);
    let src = vec![cv_text("10th")];
    let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["20th", "30th", "40th"]);
}

// -----------------------------------------------------------------------
// Ordinal suffix unit tests
// -----------------------------------------------------------------------

#[test]
fn ordinal_suffix_correctness() {
    assert_eq!(ordinal_suffix(1), "st");
    assert_eq!(ordinal_suffix(2), "nd");
    assert_eq!(ordinal_suffix(3), "rd");
    assert_eq!(ordinal_suffix(4), "th");
    assert_eq!(ordinal_suffix(10), "th");
    assert_eq!(ordinal_suffix(11), "th");
    assert_eq!(ordinal_suffix(12), "th");
    assert_eq!(ordinal_suffix(13), "th");
    assert_eq!(ordinal_suffix(14), "th");
    assert_eq!(ordinal_suffix(21), "st");
    assert_eq!(ordinal_suffix(22), "nd");
    assert_eq!(ordinal_suffix(23), "rd");
    assert_eq!(ordinal_suffix(100), "th");
    assert_eq!(ordinal_suffix(101), "st");
    assert_eq!(ordinal_suffix(111), "th");
    assert_eq!(ordinal_suffix(112), "th");
    assert_eq!(ordinal_suffix(113), "th");
    assert_eq!(ordinal_suffix(121), "st");
}

// -----------------------------------------------------------------------
// CustomList
// -----------------------------------------------------------------------

#[test]
fn custom_list_forward() {
    let mut pat = default_pattern(FillPatternType::CustomList);
    pat.list_id = Some("priority".into());
    let lists = vec![CustomList {
        id: "priority".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];
    let src = vec![cv_text("Medium")];
    let result = generate_series_values(&pat, &src, 4, 1, &locale(), &lists);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Low", "High", "Medium", "Low"]);
}

#[test]
fn custom_list_backward() {
    let mut pat = default_pattern(FillPatternType::CustomList);
    pat.list_id = Some("priority".into());
    let lists = vec![CustomList {
        id: "priority".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];
    let src = vec![cv_text("Medium")];
    let result = generate_series_values(&pat, &src, 4, -1, &locale(), &lists);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["High", "Low", "Medium", "High"]);
}

#[test]
fn custom_list_case_insensitive() {
    let mut pat = default_pattern(FillPatternType::CustomList);
    pat.list_id = Some("priority".into());
    let lists = vec![CustomList {
        id: "priority".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];
    let src = vec![cv_text("medium")]; // lowercase
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &lists);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Low", "High"]);
}

// -----------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------

#[test]
fn zero_count_returns_empty() {
    let pat = default_pattern(FillPatternType::Copy);
    let src = vec![cv_num(1.0)];
    let result = generate_series_values(&pat, &src, 0, 1, &locale(), &[]);
    assert!(result.is_empty());
}

#[test]
fn empty_source_returns_empty() {
    let pat = default_pattern(FillPatternType::Linear);
    let result = generate_series_values(&pat, &[], 5, 1, &locale(), &[]);
    assert!(result.is_empty());
}

#[test]
fn growth_backward_from_large() {
    let mut pat = default_pattern(FillPatternType::Growth);
    pat.multiplier = Some(10.0);
    let src = vec![cv_num(1000.0)];
    let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
    let nums = extract_numbers(&result);
    assert_eq!(nums, vec![100.0, 10.0, 1.0]);
}

#[test]
fn is_weekend_serial_check() {
    // Jan 1, 1900 = serial 1, which was a Monday in real life,
    // but in Excel's world serial 1 maps to 1 % 7 = 1.
    // Let's verify our weekend logic with known dates.
    // Jan 5, 2024 = Friday. Let's check its serial.
    let fri = ymd_to_serial(2024, 1, 5);
    assert!(!is_weekend_serial(fri), "Friday should not be weekend");
    let sat = ymd_to_serial(2024, 1, 6);
    assert!(is_weekend_serial(sat), "Saturday should be weekend");
    let sun = ymd_to_serial(2024, 1, 7);
    assert!(is_weekend_serial(sun), "Sunday should be weekend");
    let mon = ymd_to_serial(2024, 1, 8);
    assert!(!is_weekend_serial(mon), "Monday should not be weekend");
}

#[test]
fn weekday_case_insensitive_match() {
    let pat = default_pattern(FillPatternType::Weekday);
    let src = vec![cv_text("monday")]; // lowercase
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["Tuesday", "Wednesday"]);
}

#[test]
fn month_case_insensitive_match() {
    let pat = default_pattern(FillPatternType::Month);
    let src = vec![cv_text("january")]; // lowercase
    let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
    let texts = extract_texts(&result);
    assert_eq!(texts, vec!["February", "March"]);
}

#[test]
fn dispatcher_smoke_exercises_every_pattern_type() {
    let loc = locale();
    let lists = vec![CustomList {
        id: "priority".into(),
        values: vec!["High".into(), "Medium".into(), "Low".into()],
    }];

    let mut linear = default_pattern(FillPatternType::Linear);
    linear.step = Some(1.0);
    assert_eq!(
        extract_numbers(&generate_series_values(
            &linear,
            &[cv_num(1.0)],
            1,
            1,
            &loc,
            &[]
        )),
        vec![2.0]
    );

    let mut growth = default_pattern(FillPatternType::Growth);
    growth.multiplier = Some(2.0);
    assert_eq!(
        extract_numbers(&generate_series_values(
            &growth,
            &[cv_num(2.0)],
            1,
            1,
            &loc,
            &[]
        )),
        vec![4.0]
    );

    for unit in [
        DateUnit::Day,
        DateUnit::Weekday,
        DateUnit::Month,
        DateUnit::Year,
    ] {
        let mut date = default_pattern(FillPatternType::Date);
        date.date_unit = Some(unit);
        date.step = Some(1.0);
        assert_eq!(
            generate_series_values(&date, &[cv_num(ymd_to_serial(2024, 1, 2))], 1, 1, &loc, &[])
                .len(),
            1
        );
    }

    let mut time = default_pattern(FillPatternType::Time);
    time.time_unit = Some(TimeUnit::Second);
    time.step = Some(30.0);
    assert_eq!(
        generate_series_values(&time, &[cv_num(0.5)], 1, 1, &loc, &[]).len(),
        1
    );

    assert_eq!(
        extract_texts(&generate_series_values(
            &default_pattern(FillPatternType::Weekday),
            &[cv_text("Monday")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["Tuesday"]
    );
    assert_eq!(
        extract_texts(&generate_series_values(
            &default_pattern(FillPatternType::WeekdayShort),
            &[cv_text("Mon")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["Tue"]
    );
    assert_eq!(
        extract_texts(&generate_series_values(
            &default_pattern(FillPatternType::Month),
            &[cv_text("January")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["February"]
    );
    assert_eq!(
        extract_texts(&generate_series_values(
            &default_pattern(FillPatternType::MonthShort),
            &[cv_text("Jan")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["Feb"]
    );

    let mut quarter = default_pattern(FillPatternType::Quarter);
    quarter.start_index = Some(0);
    assert_eq!(
        extract_texts(&generate_series_values(
            &quarter,
            &[cv_text("ignored")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["Q2"]
    );

    let mut text_num = default_pattern(FillPatternType::TextWithNumber);
    text_num.prefix = Some("Item".into());
    assert_eq!(
        extract_texts(&generate_series_values(
            &text_num,
            &[cv_text("Item1")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["Item2"]
    );

    assert_eq!(
        extract_texts(&generate_series_values(
            &default_pattern(FillPatternType::Ordinal),
            &[cv_text("1st")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["2nd"]
    );

    let mut custom = default_pattern(FillPatternType::CustomList);
    custom.list_id = Some("priority".into());
    assert_eq!(
        extract_texts(&generate_series_values(
            &custom,
            &[cv_text("High")],
            1,
            1,
            &loc,
            &lists
        )),
        vec!["Medium"]
    );

    assert_eq!(
        extract_texts(&generate_series_values(
            &default_pattern(FillPatternType::Copy),
            &[cv_text("x")],
            1,
            1,
            &loc,
            &[]
        )),
        vec!["x"]
    );
}

#[test]
fn rejecting_generators_fall_back_to_copy() {
    let loc = locale();
    let text_src = vec![cv_text("not-a-series"), cv_text("still-not-a-series")];
    let number_src = vec![cv_num(1.0), cv_num(2.0)];
    let lists = vec![CustomList {
        id: "priority".into(),
        values: vec!["High".into(), "Low".into()],
    }];

    for pattern_type in [
        FillPatternType::Linear,
        FillPatternType::Growth,
        FillPatternType::Date,
        FillPatternType::Time,
        FillPatternType::Weekday,
        FillPatternType::WeekdayShort,
        FillPatternType::Month,
        FillPatternType::MonthShort,
        FillPatternType::TextWithNumber,
        FillPatternType::Ordinal,
    ] {
        let numeric_family = matches!(
            &pattern_type,
            FillPatternType::Linear
                | FillPatternType::Growth
                | FillPatternType::Date
                | FillPatternType::Time
        );
        let pat = default_pattern(pattern_type);
        let src = if numeric_family {
            &text_src
        } else {
            &number_src
        };
        let result = generate_series_values(&pat, src, 3, 1, &loc, &[]);
        assert_eq!(result, vec![src[0].clone(), src[1].clone(), src[0].clone()]);
    }

    let mut custom = default_pattern(FillPatternType::CustomList);
    custom.list_id = Some("priority".into());
    let result = generate_series_values(
        &custom,
        &[cv_text("Missing"), cv_text("AlsoMissing")],
        3,
        1,
        &loc,
        &lists,
    );
    assert_eq!(
        result,
        vec![
            cv_text("Missing"),
            cv_text("AlsoMissing"),
            cv_text("Missing")
        ]
    );
}
