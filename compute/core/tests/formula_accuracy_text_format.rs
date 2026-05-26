//! Formula accuracy tests for TEXT format strings (Issue #3: 1,491 errors).
//!
//! The core bug: `TEXT(date_serial, "mmmm")` produces `"1/1/2025"` instead
//! of `"January"`. The TEXT function delegates to `format_engine::format_number()`
//! which should detect `"mmmm"` as a datetime format and render the full month name.
//!
//! Run:
//!   cd /Users/robertyang/Code/shortcut_mono_repo/shortcut/os && \
//!     cargo test -p compute-core --test formula_accuracy_text_format
//!
//! These tests exercise `format_number` directly (the public API used by FnText)
//! as well as the full TEXT function pipeline via `FunctionRegistry::call`.

use compute_formats::format_number;

// ---------------------------------------------------------------------------
// Helper: Excel serial date computation
// ---------------------------------------------------------------------------

/// Compute an Excel serial date number from (year, month, day).
///
/// Excel uses the 1900 date system where Jan 1, 1900 = serial 1.
/// It also has the Lotus 1-2-3 bug: Feb 29, 1900 is treated as valid (serial 60),
/// so dates on or after Mar 1, 1900 are off by +1 compared to a naive calculation.
///
/// This mirrors the crate's internal `date_to_serial` from datetime.rs:
///   epoch = 1899-12-31, real_days = (date - epoch).num_days()
///   if date >= 1900-03-01 then real_days + 1 else real_days
fn excel_serial(year: i32, month: u32, day: u32) -> f64 {
    let epoch = chrono::NaiveDate::from_ymd_opt(1899, 12, 31).unwrap();
    let target = chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap();
    let real_days = (target - epoch).num_days();
    let mar1_1900 = chrono::NaiveDate::from_ymd_opt(1900, 3, 1).unwrap();
    if target >= mar1_1900 {
        (real_days + 1) as f64
    } else {
        real_days as f64
    }
}

// ---------------------------------------------------------------------------
// Test 1: format_number with "mmmm" — full month name (standalone)
// ---------------------------------------------------------------------------

#[test]
fn test_format_mmmm_full_month_name() {
    // January 1, 2025 = serial 45658
    let serial = excel_serial(2025, 1, 1);
    assert_eq!(serial, 45658.0, "Serial for Jan 1, 2025 should be 45658");
    let result = format_number(serial, "mmmm");
    assert_eq!(
        result, "January",
        "TEXT(45658, \"mmmm\") should produce \"January\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 2: format_number with "mmm" — abbreviated month name
// ---------------------------------------------------------------------------

#[test]
fn test_format_mmm_abbreviated_month() {
    let serial = excel_serial(2025, 1, 1);
    let result = format_number(serial, "mmm");
    assert_eq!(
        result, "Jan",
        "TEXT(45658, \"mmm\") should produce \"Jan\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 3: format_number with "mmmmm" — first letter of month
// ---------------------------------------------------------------------------

#[test]
fn test_format_mmmmm_first_letter() {
    let serial = excel_serial(2025, 1, 1);
    let result = format_number(serial, "mmmmm");
    assert_eq!(
        result, "J",
        "TEXT(45658, \"mmmmm\") should produce \"J\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 4: "mmmm d, yyyy" composite date format
// ---------------------------------------------------------------------------

#[test]
fn test_format_mmmm_d_yyyy() {
    let serial = excel_serial(2024, 3, 15);
    assert_eq!(serial, 45366.0, "Serial for Mar 15, 2024 should be 45366");
    let result = format_number(serial, "mmmm d, yyyy");
    assert_eq!(
        result, "March 15, 2024",
        "TEXT(45366, \"mmmm d, yyyy\") should produce \"March 15, 2024\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 5: "dddd, mmmm d, yyyy" — day-of-week + month name
// ---------------------------------------------------------------------------

#[test]
fn test_format_dddd_mmmm_d_yyyy() {
    // March 15, 2024 is a Friday
    let serial = excel_serial(2024, 3, 15);
    let result = format_number(serial, "dddd, mmmm d, yyyy");
    assert_eq!(
        result, "Friday, March 15, 2024",
        "TEXT(45366, \"dddd, mmmm d, yyyy\") should produce \"Friday, March 15, 2024\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 6: "mm/dd/yyyy" — numeric month (not minute)
// ---------------------------------------------------------------------------

#[test]
fn test_format_mm_dd_yyyy() {
    let serial = excel_serial(2025, 1, 1);
    let result = format_number(serial, "mm/dd/yyyy");
    assert_eq!(
        result, "01/01/2025",
        "TEXT(45658, \"mm/dd/yyyy\") should produce \"01/01/2025\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 7: "h:mm:ss" — mm in time context should be minutes, not months
// ---------------------------------------------------------------------------

#[test]
fn test_format_h_mm_ss_minutes_not_months() {
    // 0.75 = 18:00:00
    let result = format_number(0.75, "h:mm:ss");
    assert_eq!(
        result, "18:00:00",
        "format_number(0.75, \"h:mm:ss\") should produce \"18:00:00\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 8: "mmmm" standalone — exact corpus pattern
// ---------------------------------------------------------------------------

#[test]
fn test_format_mmmm_standalone_corpus_pattern() {
    // This is the EXACT pattern from the corpus:
    //   IF(A8="","",TEXT(A8,"mmmm"))
    // where A8 contains a date serial for January 1, 2025.
    let serial = excel_serial(2025, 1, 1);
    let result = format_number(serial, "mmmm");
    assert_eq!(
        result, "January",
        "Corpus pattern: TEXT(date_serial, \"mmmm\") should produce \"January\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 9: Full TEXT function pipeline via FunctionRegistry
// ---------------------------------------------------------------------------

#[test]
fn test_text_function_pipeline_with_mmmm() {
    use compute_core::functions::FunctionRegistry;
    use value_types::CellValue;

    let registry = FunctionRegistry::new();
    let serial = excel_serial(2025, 1, 1);

    let result = registry.call(
        "TEXT",
        &[CellValue::number(serial), CellValue::Text("mmmm".into())],
    );

    assert_eq!(
        result,
        CellValue::Text("January".into()),
        "TEXT(45658, \"mmmm\") via FunctionRegistry should produce \"January\", got {:?}",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 10: All 12 months with "mmmm" format
// ---------------------------------------------------------------------------

#[test]
fn test_format_all_twelve_months_mmmm() {
    let expected_months = [
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

    for (i, expected) in expected_months.iter().enumerate() {
        let month = (i + 1) as u32;
        let serial = excel_serial(2024, month, 15);
        let result = format_number(serial, "mmmm");
        assert_eq!(
            result, *expected,
            "Month {} (serial {}): TEXT(serial, \"mmmm\") should produce \"{}\", got \"{}\"",
            month, serial, expected, result
        );
    }
}

// ---------------------------------------------------------------------------
// Test 11: All 12 months with "mmm" (abbreviated)
// ---------------------------------------------------------------------------

#[test]
fn test_format_all_twelve_months_mmm() {
    let expected_months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    for (i, expected) in expected_months.iter().enumerate() {
        let month = (i + 1) as u32;
        let serial = excel_serial(2024, month, 15);
        let result = format_number(serial, "mmm");
        assert_eq!(
            result, *expected,
            "Month {} (serial {}): TEXT(serial, \"mmm\") should produce \"{}\", got \"{}\"",
            month, serial, expected, result
        );
    }
}

// ---------------------------------------------------------------------------
// Test 12: All 12 months with "mmmmm" (first letter)
// ---------------------------------------------------------------------------

#[test]
fn test_format_all_twelve_months_mmmmm() {
    let expected_letters = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

    for (i, expected) in expected_letters.iter().enumerate() {
        let month = (i + 1) as u32;
        let serial = excel_serial(2024, month, 15);
        let result = format_number(serial, "mmmmm");
        assert_eq!(
            result, *expected,
            "Month {} (serial {}): TEXT(serial, \"mmmmm\") should produce \"{}\", got \"{}\"",
            month, serial, expected, result
        );
    }
}

// ---------------------------------------------------------------------------
// Test 13: m/mm ambiguity — month vs minute in mixed context
// ---------------------------------------------------------------------------

#[test]
fn test_m_ambiguity_month_in_date_context() {
    // "m/d/yyyy" — m should be month (no preceding h, no following s)
    let serial = excel_serial(2024, 3, 5);
    let result = format_number(serial, "m/d/yyyy");
    assert_eq!(
        result, "3/5/2024",
        "m/d/yyyy should treat m as month, got \"{}\"",
        result
    );
}

#[test]
fn test_m_ambiguity_minute_after_hour() {
    // "h:mm" — mm should be minute (preceded by h)
    let time_serial = 12.0 / 24.0 + 30.0 / 1440.0; // 12:30
    let result = format_number(time_serial, "h:mm");
    assert_eq!(
        result, "12:30",
        "h:mm should treat mm as minutes, got \"{}\"",
        result
    );
}

#[test]
fn test_m_ambiguity_minute_before_second() {
    // "mm:ss" — mm should be minute (followed by ss)
    let time_serial = 30.0 / 1440.0 + 45.0 / 86400.0; // 0:30:45
    let result = format_number(time_serial, "mm:ss");
    assert_eq!(
        result, "30:45",
        "mm:ss should treat mm as minutes, got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 14: Date format with day names
// ---------------------------------------------------------------------------

#[test]
fn test_format_ddd_abbreviated_day_name() {
    // Jan 15, 2024 is a Monday
    let serial = excel_serial(2024, 1, 15);
    let result = format_number(serial, "ddd");
    assert_eq!(
        result, "Mon",
        "TEXT(serial, \"ddd\") should produce \"Mon\", got \"{}\"",
        result
    );
}

#[test]
fn test_format_dddd_full_day_name() {
    // Jan 15, 2024 is a Monday
    let serial = excel_serial(2024, 1, 15);
    let result = format_number(serial, "dddd");
    assert_eq!(
        result, "Monday",
        "TEXT(serial, \"dddd\") should produce \"Monday\", got \"{}\"",
        result
    );
}

// ---------------------------------------------------------------------------
// Test 15: Combined date+time format with month name
// ---------------------------------------------------------------------------

#[test]
fn test_format_mmmm_with_time() {
    // March 15, 2024 at 14:30 (2:30 PM)
    let serial = excel_serial(2024, 3, 15) + 14.0 / 24.0 + 30.0 / 1440.0;
    let result = format_number(serial, "mmmm d, yyyy h:mm AM/PM");
    assert_eq!(
        result, "March 15, 2024 2:30 PM",
        "Combined date+time with mmmm should work, got \"{}\"",
        result
    );
}
