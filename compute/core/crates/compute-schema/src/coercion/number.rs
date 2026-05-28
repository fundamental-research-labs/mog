use value_types::CellValue;

use crate::types::{CellValueResult, CoercionResult};

pub(super) fn coerce_to_number(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Boolean(b) => {
            CoercionResult::ok(CellValueResult::Number(if *b { 1.0 } else { 0.0 }))
        }
        CellValue::Text(s) => parse_text_as_number(s),
        _ => CoercionResult::err("Cannot coerce value to number"),
    }
}

fn parse_text_as_number(s: &str) -> CoercionResult {
    let cleaned = strip_currency_and_commas(s.trim());

    if let Some(before_pct) = cleaned.strip_suffix('%')
        && let Ok(n) = before_pct.parse::<f64>()
    {
        return CoercionResult::ok(CellValueResult::Number(n / 100.0));
    }

    match cleaned.parse::<f64>() {
        Ok(n) if n.is_finite() => CoercionResult::ok(CellValueResult::Number(n)),
        _ => CoercionResult::err(format!("Cannot parse \"{s}\" as number")),
    }
}

pub(super) fn strip_currency_and_commas(s: &str) -> String {
    s.chars()
        .filter(|c| {
            !matches!(
                c,
                '$' | '\u{20ac}'
                    | '\u{00a3}'
                    | '\u{00a5}'
                    | '\u{20b9}'
                    | '\u{20bd}'
                    | '\u{20a9}'
                    | ','
                    | ' '
            )
        })
        .collect()
}
