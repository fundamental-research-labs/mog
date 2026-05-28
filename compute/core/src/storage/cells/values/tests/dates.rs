use super::*;

#[test]
fn test_parse_date_us_format() {
    let serial = parse_date_string("3/31/2016").unwrap();
    // 2016-03-31 should be a valid serial > 0
    assert!(serial > 0.0);
    // Verify by checking known value: Jan 1 1900 = serial 1
    let jan1_1900 = parse_date_string("1/1/1900").unwrap();
    assert!((jan1_1900 - 1.0).abs() < 0.001);
}

#[test]
fn test_parse_date_iso_format() {
    let serial = parse_date_string("2016-03-31").unwrap();
    assert!(serial > 0.0);
    // Should match the US format for same date
    let us_serial = parse_date_string("3/31/2016").unwrap();
    assert!((serial - us_serial).abs() < 0.001);
}

#[test]
fn test_parse_date_dmmy_format() {
    let serial = parse_date_string("31-Mar-2016").unwrap();
    let us_serial = parse_date_string("3/31/2016").unwrap();
    assert!((serial - us_serial).abs() < 0.001);
}

#[test]
fn test_parse_date_mmmd_format() {
    let serial = parse_date_string("Mar 31, 2016").unwrap();
    let us_serial = parse_date_string("3/31/2016").unwrap();
    assert!((serial - us_serial).abs() < 0.001);
}

#[test]
fn test_parse_date_invalid() {
    assert!(parse_date_string("").is_none());
    assert!(parse_date_string("hello").is_none());
    assert!(parse_date_string("13/32/2020").is_none()); // invalid month/day
    assert!(parse_date_string("2/30/2020").is_none()); // Feb 30 doesn't exist
    assert!(parse_date_string("2/29/2019").is_none()); // Not a leap year
}

#[test]
fn test_parse_date_leap_year() {
    assert!(parse_date_string("2/29/2020").is_some()); // 2020 is a leap year
    assert!(parse_date_string("2/29/2000").is_some()); // 2000 is a leap year
}

#[test]
fn test_parse_date_boundary_years() {
    assert!(parse_date_string("1/1/1900").is_some());
    assert!(parse_date_string("12/31/2200").is_some());
    assert!(parse_date_string("1/1/1899").is_none()); // Too early
    assert!(parse_date_string("1/1/2201").is_none()); // Too late
}

#[test]
fn test_parse_date_case_insensitive_month() {
    let serial1 = parse_date_string("31-Mar-2016").unwrap();
    let serial2 = parse_date_string("31-mar-2016").unwrap();
    let serial3 = parse_date_string("31-MAR-2016").unwrap();
    assert!((serial1 - serial2).abs() < 0.001);
    assert!((serial1 - serial3).abs() < 0.001);
}

// -----------------------------------------------------------------------
// Test: parse_input_value — dates
// -----------------------------------------------------------------------

#[test]
fn test_parse_input_value_date() {
    if let ParsedValue::Number(serial) = parse_input_value("3/31/2016", None) {
        assert!(serial > 40000.0); // Excel serial for dates in 2016
    } else {
        panic!("Expected ParsedValue::Number for date input");
    }
}
