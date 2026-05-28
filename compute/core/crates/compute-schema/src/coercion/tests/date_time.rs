use super::{
    CellValueResult, SchemaType, assert_err, assert_num_result, assert_text_result, coerce, num,
    text,
};

#[test]
fn date_from_number() {
    assert_num_result(&coerce(&num(44927.0), SchemaType::Date), 44927.0);
}

#[test]
fn date_from_date_string() {
    let r = coerce(&text("2024-12-11"), SchemaType::Date);
    assert_text_result(&r, "2024-12-11");
}

#[test]
fn date_from_invalid_string() {
    assert_err(&coerce(&text("not a date"), SchemaType::Date));
}

#[test]
fn date_from_numeric_text() {
    let r = coerce(&text("44927"), SchemaType::Date);
    assert!(r.success);
    assert_num_result(&r, 44927.0);
}

#[test]
fn time_from_number() {
    assert_num_result(&coerce(&num(0.5), SchemaType::Time), 0.5);
}

#[test]
fn time_from_number_normalizes() {
    assert_num_result(&coerce(&num(1.75), SchemaType::Time), 0.75);
}

#[test]
fn time_from_24h_string() {
    let r = coerce(&text("14:30"), SchemaType::Time);
    assert_num_result(&r, 0.604166);
}

#[test]
fn time_from_12h_string() {
    let r = coerce(&text("2:30 PM"), SchemaType::Time);
    assert_num_result(&r, 0.604166);
}

#[test]
fn time_from_compact_string() {
    let r = coerce(&text("1430"), SchemaType::Time);
    assert_num_result(&r, 0.604166);
}

#[test]
fn time_midnight() {
    let r = coerce(&text("00:00"), SchemaType::Time);
    assert_num_result(&r, 0.0);
}

#[test]
fn time_from_invalid_string() {
    assert_err(&coerce(&text("not-a-time"), SchemaType::Time));
}

#[test]
fn time_negative_normalizes() {
    let r = coerce(&num(-0.25), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 0.75);
}

#[test]
fn time_wraps_past_one() {
    let r = coerce(&num(1.5), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 0.5);
}

#[test]
fn time_12am_is_midnight() {
    let r = coerce(&text("12:00 AM"), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 0.0);
}

#[test]
fn time_12pm_is_noon() {
    let r = coerce(&text("12:00 PM"), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 0.5);
}

#[test]
fn time_end_of_day() {
    let r = coerce(&text("23:59:59"), SchemaType::Time);
    assert!(r.success);
    match &r.value {
        Some(CellValueResult::Number(n)) => {
            assert!(*n > 0.999, "23:59:59 should be > 0.999, got {}", n);
            assert!(*n < 1.0, "23:59:59 should be < 1.0, got {}", n);
        }
        other => panic!("Expected Number, got {:?}", other),
    }
}

#[test]
fn time_from_am_dot_format() {
    let r = coerce(&text("2:30 a.m."), SchemaType::Time);
    assert!(r.success, "a.m. format should be recognized");
    assert_num_result(&r, 2.5 / 24.0);
}

#[test]
fn time_from_pm_dot_format() {
    let r = coerce(&text("2:30 p.m."), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 14.5 / 24.0);
}

#[test]
fn time_1_30_am() {
    let r = coerce(&text("1:30 AM"), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 1.5 / 24.0);
}

#[test]
fn time_1_30_pm() {
    let r = coerce(&text("1:30 PM"), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 13.5 / 24.0);
}

#[test]
fn time_12h_with_seconds() {
    let r = coerce(&text("2:30:45 PM"), SchemaType::Time);
    assert!(r.success);
    let expected = (14.0 + 30.0 / 60.0 + 45.0 / 3600.0) / 24.0;
    assert_num_result(&r, expected);
}

#[test]
fn time_from_numeric_text() {
    let r = coerce(&text("0.25"), SchemaType::Time);
    assert!(r.success);
    assert_num_result(&r, 0.25);
}

#[test]
fn time_compact_with_seconds() {
    let r = coerce(&text("143045"), SchemaType::Time);
    assert!(r.success);
    let expected = (14.0 + 30.0 / 60.0 + 45.0 / 3600.0) / 24.0;
    assert_num_result(&r, expected);
}
