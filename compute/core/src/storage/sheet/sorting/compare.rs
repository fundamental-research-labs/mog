use std::cmp::Ordering;

use domain_types::CellFormat;
use domain_types::domain::filter::{ColorPosition, SortOrder};
use value_types::CellValue;

use super::types::SortConfig;

/// Get the type priority for sorting. Lower priority sorts first.
///
/// null=0, error=1, bool=2, number=3, string=4, other=5
pub(crate) fn get_type_priority(value: &CellValue) -> u8 {
    match value {
        CellValue::Null => 0,
        CellValue::Error(..) => 1,
        CellValue::Boolean(_) => 2,
        CellValue::Number(_) => 3,
        CellValue::Text(_) => 4,
        _ => 5,
    }
}

/// Natural comparison of two strings, treating embedded numeric chunks as numbers.
///
/// E.g., "Item 2" < "Item 10" (because 2 < 10).
pub(crate) fn natural_compare(a: &str, b: &str, case_sensitive: bool) -> Ordering {
    let str_a: String = if case_sensitive {
        a.to_string()
    } else {
        a.to_lowercase()
    };
    let str_b: String = if case_sensitive {
        b.to_string()
    } else {
        b.to_lowercase()
    };

    let chunks_a = split_natural_chunks(&str_a);
    let chunks_b = split_natural_chunks(&str_b);

    let max_len = chunks_a.len().max(chunks_b.len());
    for i in 0..max_len {
        let chunk_a = chunks_a.get(i).map(|s| s.as_str()).unwrap_or("");
        let chunk_b = chunks_b.get(i).map(|s| s.as_str()).unwrap_or("");

        let num_a = chunk_a.parse::<i64>();
        let num_b = chunk_b.parse::<i64>();

        match (num_a, num_b) {
            (Ok(na), Ok(nb)) => {
                let cmp = na.cmp(&nb);
                if cmp != Ordering::Equal {
                    return cmp;
                }
            }
            _ => {
                let cmp = chunk_a.cmp(chunk_b);
                if cmp != Ordering::Equal {
                    return cmp;
                }
            }
        }
    }
    Ordering::Equal
}

/// Split a string into alternating numeric and non-numeric chunks.
/// E.g., "Item 10 foo" -> ["Item ", "10", " foo"]
fn split_natural_chunks(s: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut in_digit = false;

    for ch in s.chars() {
        let is_digit = ch.is_ascii_digit();
        if !current.is_empty() && is_digit != in_digit {
            chunks.push(std::mem::take(&mut current));
        }
        current.push(ch);
        in_digit = is_digit;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Compare two cell values according to the given sort config.
///
/// Comparison order:
/// - Nulls are handled according to `nulls_first`
/// - Different types: sorted by type priority (null < error < bool < number < string)
/// - Same type: compared within type (errors by string, bools by value, numbers by value,
///   strings by natural sort or lexicographic)
/// - Direction applied at the end (desc reverses)
pub(crate) fn compare_cell_values(a: &CellValue, b: &CellValue, config: &SortConfig) -> Ordering {
    if config.order.is_none() {
        return Ordering::Equal;
    }

    let a_is_null = matches!(a, CellValue::Null);
    let b_is_null = matches!(b, CellValue::Null);

    if a_is_null && b_is_null {
        return Ordering::Equal;
    }
    if a_is_null {
        return if config.nulls_first {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    if b_is_null {
        return if config.nulls_first {
            Ordering::Greater
        } else {
            Ordering::Less
        };
    }

    let priority_a = get_type_priority(a);
    let priority_b = get_type_priority(b);

    if priority_a != priority_b {
        let result = priority_a.cmp(&priority_b);
        return if config.order == Some(SortOrder::Desc) {
            result.reverse()
        } else {
            result
        };
    }

    let result = match (a, b) {
        (CellValue::Error(ea, None), CellValue::Error(eb, None)) => ea.as_str().cmp(eb.as_str()),
        (CellValue::Boolean(ba), CellValue::Boolean(bb)) => {
            // false(0) < true(1)
            match (ba, bb) {
                (false, true) => Ordering::Less,
                (true, false) => Ordering::Greater,
                _ => Ordering::Equal,
            }
        }
        (CellValue::Number(na), CellValue::Number(nb)) => {
            na.get().partial_cmp(&nb.get()).unwrap_or(Ordering::Equal)
        }
        (CellValue::Text(sa), CellValue::Text(sb)) => {
            if config.natural_sort {
                natural_compare(sa, sb, config.case_sensitive)
            } else if config.case_sensitive {
                sa.cmp(sb)
            } else {
                sa.to_lowercase().cmp(&sb.to_lowercase())
            }
        }
        _ => Ordering::Equal,
    };

    if config.order == Some(SortOrder::Desc) {
        result.reverse()
    } else {
        result
    }
}

/// Compare two cell values via a custom sort list (Excel parity).
///
/// Values present in `list` sort by their list position. Values not in
/// the list sort *after* all list members. Within "not in list", ties
/// fall through to `compare_cell_values` so the secondary natural order
/// is honoured. Direction (asc/desc) is applied last by reversing the
/// final ordering — same convention as `compare_cell_values`.
///
/// `list` membership uses `==` on the typed `CellValue`. Strings are
/// case-insensitive when `config.case_sensitive` is false; numbers
/// match by exact value.
pub(crate) fn compare_by_custom_list(
    a: &CellValue,
    b: &CellValue,
    list: &[CellValue],
    config: &SortConfig,
) -> Ordering {
    if config.order.is_none() {
        return Ordering::Equal;
    }

    let pos_a = find_in_custom_list(a, list, config.case_sensitive);
    let pos_b = find_in_custom_list(b, list, config.case_sensitive);

    let result = match (pos_a, pos_b) {
        // Both in list: order by list index.
        (Some(ia), Some(ib)) => ia.cmp(&ib),
        // Only `a` in list: a sorts before b.
        (Some(_), None) => Ordering::Less,
        // Only `b` in list: b sorts before a.
        (None, Some(_)) => Ordering::Greater,
        // Neither in list: fall through to natural-order on value. Use
        // ascending natural order regardless of direction here — the
        // outer `if config.order == Some(SortOrder::Desc)` reverses
        // both buckets uniformly. (For symmetry with `compare_by_color`,
        // this preserves the "values not in list go to the end"
        // invariant under both directions.)
        (None, None) => {
            let nat_config = SortConfig {
                order: Some(SortOrder::Asc),
                ..config.clone()
            };
            compare_cell_values(a, b, &nat_config)
        }
    };

    if config.order == Some(SortOrder::Desc) {
        result.reverse()
    } else {
        result
    }
}

fn find_in_custom_list(
    value: &CellValue,
    list: &[CellValue],
    case_sensitive: bool,
) -> Option<usize> {
    list.iter()
        .position(|item| values_match(item, value, case_sensitive))
}

fn values_match(a: &CellValue, b: &CellValue, case_sensitive: bool) -> bool {
    match (a, b) {
        (CellValue::Text(sa), CellValue::Text(sb)) => {
            if case_sensitive {
                sa == sb
            } else {
                sa.to_lowercase() == sb.to_lowercase()
            }
        }
        _ => a == b,
    }
}

/// Compare two `CellFormat`s by color match against `target` for a
/// color-mode sort.
///
/// Color comparison is case-insensitive on the hex string. A `None`
/// resolved color never matches a non-empty target.
///
/// Semantics: `Top` = matched < non-matched (matched rows go first
/// under ascending sort); `Bottom` = matched > non-matched. The caller's
/// `direction` is then applied — `Desc` reverses, so "color on top
/// descending" puts non-matched first.
///
/// Ties (both rows match or neither matches) return `Equal`. The caller
/// either advances to the next criterion in the multi-criterion loop,
/// or — if there are no further criteria — the stable sort preserves
/// the rows' original relative order. This matches Excel: a single
/// color criterion keeps within-bucket rows in their original order.
pub(crate) fn compare_by_color(
    format_a: &CellFormat,
    format_b: &CellFormat,
    target: &str,
    is_font: bool,
    position: ColorPosition,
    config: &SortConfig,
) -> Ordering {
    if config.order.is_none() {
        return Ordering::Equal;
    }

    let color_a = if is_font {
        format_a.font_color.as_deref()
    } else {
        format_a.background_color.as_deref()
    };
    let color_b = if is_font {
        format_b.font_color.as_deref()
    } else {
        format_b.background_color.as_deref()
    };

    let match_a = color_matches(color_a, target);
    let match_b = color_matches(color_b, target);

    let primary = match (match_a, match_b) {
        (true, true) | (false, false) => Ordering::Equal,
        (true, false) => match position {
            ColorPosition::Top => Ordering::Less,
            ColorPosition::Bottom => Ordering::Greater,
        },
        (false, true) => match position {
            ColorPosition::Top => Ordering::Greater,
            ColorPosition::Bottom => Ordering::Less,
        },
    };

    if config.order == Some(SortOrder::Desc) {
        primary.reverse()
    } else {
        primary
    }
}

fn color_matches(resolved: Option<&str>, target: &str) -> bool {
    match resolved {
        Some(c) => c.eq_ignore_ascii_case(target),
        None => false,
    }
}

#[cfg(test)]
#[path = "compare_tests.rs"]
mod tests;
