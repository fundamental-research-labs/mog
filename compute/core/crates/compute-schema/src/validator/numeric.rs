use value_types::CellValue;

use crate::types::SchemaType;

pub(super) fn is_numeric_type(t: SchemaType) -> bool {
    matches!(
        t,
        SchemaType::Number
            | SchemaType::Integer
            | SchemaType::Currency
            | SchemaType::Percentage
            | SchemaType::Distribution
            | SchemaType::Date
            | SchemaType::Time
    )
}

/// Extract a numeric value for constraint checking.
///
/// Schema-aware: `Date` text is parsed to an Excel serial via [`value_types::date_serial::try_parse_date`],
/// `Time` text to a fractional day via [`value_types::date_serial::try_parse_time`], so min/max bounds
/// (which are stored as serials/fractions) can compare against the user's typed value.
pub(super) fn extract_number(value: &CellValue, schema_type: SchemaType) -> Option<f64> {
    match value {
        CellValue::Number(n) => Some(n.get()),
        CellValue::Text(s) => {
            let trimmed = s.trim();
            match schema_type {
                SchemaType::Date => value_types::date_serial::try_parse_date(trimmed)
                    .ok()
                    .or_else(|| {
                        value_types::date_serial::try_parse_datetime(trimmed)
                            .ok()
                            .map(f64::floor)
                    }),
                SchemaType::Time => value_types::date_serial::try_parse_time(trimmed).ok(),
                _ => {
                    let cleaned: String = s
                        .chars()
                        .filter(|c| {
                            !matches!(
                                c,
                                '$' | '\u{20ac}'
                                    | '\u{00a3}'
                                    | '\u{00a5}'
                                    | '\u{20b9}'
                                    | '\u{20bd}'
                                    | '\u{20a9}'
                                    | '%'
                                    | ','
                            )
                        })
                        .collect();
                    let cleaned = cleaned.trim();
                    cleaned
                        .parse::<f64>()
                        .ok()
                        .map(|n| if s.contains('%') { n / 100.0 } else { n })
                }
            }
        }
        _ => None,
    }
}
