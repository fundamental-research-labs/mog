//! Type detection and field inference for pivot source data.

use std::collections::BTreeMap;

use value_types::CellValue;

use crate::types::{DetectedDataType, FieldId, PivotField};

/// Detect the data type of a single value.
fn detect_type(value: &CellValue) -> DetectedDataType {
    match value {
        CellValue::Null => DetectedDataType::Empty,
        CellValue::Error(..) => DetectedDataType::Error,
        CellValue::Boolean(_) | CellValue::Control(_) => DetectedDataType::Boolean,
        CellValue::Number(_) => DetectedDataType::Number,
        CellValue::Image(_) => DetectedDataType::String,
        CellValue::Text(s) => {
            // Try to detect dates
            // YYYY-MM-DD pattern
            if s.len() >= 10 {
                let bytes = s.as_bytes();
                if bytes.len() >= 10
                    && bytes[0..4].iter().all(u8::is_ascii_digit)
                    && bytes[4] == b'-'
                    && bytes[5..7].iter().all(u8::is_ascii_digit)
                    && bytes[7] == b'-'
                    && bytes[8..10].iter().all(u8::is_ascii_digit)
                {
                    return DetectedDataType::Date;
                }
            }
            // M/D/YYYY or MM/DD/YY pattern
            if is_us_date_format(s) {
                return DetectedDataType::Date;
            }
            DetectedDataType::String
        }
        CellValue::Array(_) => DetectedDataType::String,
    }
}

/// Check if a string matches M/D/YYYY or MM/DD/YYYY or similar US date patterns.
fn is_us_date_format(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    // Must start with 1-2 digits
    let mut i = 0;
    let len = bytes.len();
    if i >= len || !bytes[i].is_ascii_digit() {
        return false;
    }
    i += 1;
    if i < len && bytes[i].is_ascii_digit() {
        i += 1;
    }
    // Must have /
    if i >= len || bytes[i] != b'/' {
        return false;
    }
    i += 1;
    // 1-2 digits for day
    if i >= len || !bytes[i].is_ascii_digit() {
        return false;
    }
    i += 1;
    if i < len && bytes[i].is_ascii_digit() {
        i += 1;
    }
    // Must have /
    if i >= len || bytes[i] != b'/' {
        return false;
    }
    i += 1;
    // Exactly 2 or 4 digits for year
    let year_start = i;
    while i < len && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let year_len = i - year_start;
    if year_len != 2 && year_len != 4 {
        return false;
    }
    i == len
}

/// Priority for deterministic tie-breaking when two types have equal counts.
/// Lower number = higher priority.
fn type_priority(dt: &DetectedDataType) -> u8 {
    match dt {
        DetectedDataType::Number => 0,
        DetectedDataType::Date => 1,
        DetectedDataType::String => 2,
        DetectedDataType::Boolean => 3,
        DetectedDataType::Error => 4,
        DetectedDataType::Empty => 5,
        // Future-proof: non-exhaustive enum from compute-stats
        _ => 6,
    }
}

/// Infer the best data type for a column from its values.
/// Uses deterministic tie-breaking: Number > Date > String > Boolean > Error.
fn infer_column_type(values: &[CellValue]) -> DetectedDataType {
    let mut counts: BTreeMap<u8, usize> = BTreeMap::new();

    for value in values {
        let dt = detect_type(value);
        if dt != DetectedDataType::Empty {
            let key = type_priority(&dt);
            *counts.entry(key).or_insert(0) += 1;
        }
    }

    let mut max_count = 0;
    let mut dominant_key = 2u8; // default to String (priority 2)

    for (&key, &count) in &counts {
        if count > max_count || (count == max_count && key < dominant_key) {
            max_count = count;
            dominant_key = key;
        }
    }

    match dominant_key {
        0 => DetectedDataType::Number,
        1 => DetectedDataType::Date,
        3 => DetectedDataType::Boolean,
        4 => DetectedDataType::Error,
        _ => DetectedDataType::String,
    }
}

/// Detect fields from source data.
///
/// The first row is treated as headers. For each column, infers the data type
/// from the values in subsequent rows.
#[must_use]
pub fn detect_fields(data: &[Vec<CellValue>]) -> Vec<PivotField> {
    if data.is_empty() {
        return vec![];
    }

    let headers = &data[0];
    let data_rows = &data[1..];

    headers
        .iter()
        .enumerate()
        .map(|(col_index, header)| {
            let column_values: Vec<CellValue> = data_rows
                .iter()
                .map(|row| row.get(col_index).cloned().unwrap_or(CellValue::Null))
                .collect();
            let data_type = infer_column_type(&column_values);

            let name = match header {
                CellValue::Null => format!("Column {}", col_index + 1),
                other => format!("{other}"),
            };

            PivotField {
                id: FieldId::from(format!("field_{col_index}")),
                name,
                #[allow(clippy::cast_possible_truncation)] // Column index won't exceed u32::MAX
                source_column: col_index as u32,
                data_type,
                ..Default::default()
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "type_detection_tests.rs"]
mod type_detection_tests;
