use value_types::CellValue;

use crate::types::{CellValueResult, CoercionResult};

pub(super) fn coerce_to_time(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => {
            let frac = normalize_fractional_day(n.get());
            CoercionResult::ok(CellValueResult::Number(frac))
        }
        CellValue::Text(s) => parse_time_string(s.trim()),
        _ => CoercionResult::err("Cannot coerce value to time"),
    }
}

fn normalize_fractional_day(n: f64) -> f64 {
    let frac = n % 1.0;
    if frac < 0.0 { frac + 1.0 } else { frac }
}

fn parse_time_string(s: &str) -> CoercionResult {
    if let Some(frac) = try_parse_12h(s) {
        return CoercionResult::ok(CellValueResult::Number(frac));
    }

    if let Some(frac) = try_parse_24h(s) {
        return CoercionResult::ok(CellValueResult::Number(frac));
    }

    if let Some(frac) = try_parse_compact_time(s) {
        return CoercionResult::ok(CellValueResult::Number(frac));
    }

    if let Ok(n) = s.parse::<f64>()
        && n.is_finite()
    {
        return CoercionResult::ok(CellValueResult::Number(normalize_fractional_day(n)));
    }

    CoercionResult::err(format!("Cannot coerce \"{s}\" to time"))
}

fn try_parse_24h(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        0.0
    };
    if !(0.0..=23.0).contains(&hours)
        || !(0.0..=59.0).contains(&minutes)
        || !(0.0..60.0).contains(&seconds)
    {
        return None;
    }
    Some((hours + minutes / 60.0 + seconds / 3600.0) / 24.0)
}

fn try_parse_12h(s: &str) -> Option<f64> {
    let s_lower = s.to_ascii_lowercase();
    let trimmed = s_lower.trim();

    let (time_part, meridiem) = if trimmed.ends_with("am") || trimmed.ends_with("pm") {
        let meridiem_start = trimmed.len() - 2;
        let time_str = trimmed[..meridiem_start].trim();
        let mer = &trimmed[meridiem_start..];
        (time_str.to_string(), mer.to_string())
    } else if trimmed.ends_with("a.m.") || trimmed.ends_with("p.m.") {
        let meridiem_start = trimmed.len() - 4;
        let time_str = trimmed[..meridiem_start].trim();
        let mer = if trimmed.ends_with("a.m.") {
            "am"
        } else {
            "pm"
        };
        (time_str.to_string(), mer.to_string())
    } else {
        return None;
    };

    let parts: Vec<&str> = time_part.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let mut hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        0.0
    };

    if !(1.0..=12.0).contains(&hours)
        || !(0.0..=59.0).contains(&minutes)
        || !(0.0..60.0).contains(&seconds)
    {
        return None;
    }

    if meridiem.starts_with('p') && hours != 12.0 {
        hours += 12.0;
    } else if meridiem.starts_with('a') && hours == 12.0 {
        hours = 0.0;
    }

    Some((hours + minutes / 60.0 + seconds / 3600.0) / 24.0)
}

fn try_parse_compact_time(s: &str) -> Option<f64> {
    if s.len() != 4 && s.len() != 6 {
        return None;
    }
    if !s.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let hours: f64 = s[..2].parse().ok()?;
    let minutes: f64 = s[2..4].parse().ok()?;
    let seconds: f64 = if s.len() == 6 {
        s[4..6].parse().ok()?
    } else {
        0.0
    };
    if hours > 23.0 || minutes > 59.0 || seconds > 59.0 {
        return None;
    }
    Some((hours + minutes / 60.0 + seconds / 3600.0) / 24.0)
}
