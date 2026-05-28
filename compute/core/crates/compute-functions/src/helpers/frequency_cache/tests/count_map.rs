use value_types::{CellError, CellValue};

use super::{num, text};
use crate::helpers::frequency_cache::{CountFrequencyMap, clear};

#[test]
fn test_count_basic() {
    clear();
    let values = [num(1.0), num(2.0), num(1.0), num(3.0), num(1.0)];
    let refs: Vec<&CellValue> = values.iter().collect();
    let map = CountFrequencyMap::build(&refs);
    assert_eq!(map.count(&num(1.0)), 3);
    assert_eq!(map.count(&num(2.0)), 1);
    assert_eq!(map.count(&num(3.0)), 1);
    assert_eq!(map.count(&num(4.0)), 0);
}

#[test]
fn test_count_mixed_types() {
    clear();
    let values = [
        num(1.0),
        text("hello"),
        text("HELLO"),
        CellValue::Boolean(true),
        CellValue::Null,
        CellValue::Error(CellError::Na, None),
        CellValue::Error(CellError::Na, None),
        CellValue::Error(CellError::Value, None),
    ];
    let refs: Vec<&CellValue> = values.iter().collect();
    let map = CountFrequencyMap::build(&refs);

    assert_eq!(map.count(&num(1.0)), 1);
    assert_eq!(map.count(&text("hello")), 2);
    assert_eq!(map.count(&text("Hello")), 2);
    assert_eq!(map.count(&CellValue::Boolean(true)), 1);
    assert_eq!(map.count(&CellValue::Null), 1);
    assert_eq!(map.count(&CellValue::Error(CellError::Na, None)), 2);
    assert_eq!(map.count(&CellValue::Error(CellError::Value, None)), 1);
}

#[test]
fn test_count_cross_type_text_number() {
    clear();
    let values = [text("2019"), num(2019.0), text("2019"), num(2020.0)];
    let refs: Vec<&CellValue> = values.iter().collect();
    let map = CountFrequencyMap::build(&refs);
    assert_eq!(map.count(&num(2019.0)), 3);
    assert_eq!(map.count(&text("2019")), 3);
    assert_eq!(map.count(&num(2020.0)), 1);
}

#[test]
fn test_count_empty_range() {
    clear();
    let refs: Vec<&CellValue> = vec![];
    let map = CountFrequencyMap::build(&refs);
    assert_eq!(map.count(&num(1.0)), 0);
}

#[test]
fn test_count_all_null() {
    clear();
    let values = [CellValue::Null, CellValue::Null, CellValue::Null];
    let refs: Vec<&CellValue> = values.iter().collect();
    let map = CountFrequencyMap::build(&refs);
    assert_eq!(map.count(&CellValue::Null), 3);
    assert_eq!(map.count(&num(0.0)), 0);
}
