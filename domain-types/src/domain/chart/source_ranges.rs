use super::ChartSeriesData;

pub(super) fn infer_common_category_range(series: &[ChartSeriesData]) -> Option<String> {
    let mut common: Option<&str> = None;
    for item in series {
        let categories = item.categories.as_deref()?.trim();
        if categories.is_empty() {
            return None;
        }
        match common {
            Some(existing) if existing != categories => return None,
            Some(_) => {}
            None => common = Some(categories),
        }
    }
    common.map(ToOwned::to_owned)
}

pub(super) fn infer_series_name_range(series: &[ChartSeriesData]) -> Option<String> {
    if series.is_empty() {
        return None;
    }

    let refs = series
        .iter()
        .map(|item| parse_single_cell_ref(item.name_ref.as_deref()?.trim()))
        .collect::<Option<Vec<_>>>()?;
    rectangular_ref_for_cells(&refs)
}

fn rectangular_ref_for_cells(refs: &[ParsedCellRef]) -> Option<String> {
    let first = refs.first()?;
    if refs.iter().any(|item| item.sheet != first.sheet) {
        return None;
    }

    let min_row = refs.iter().map(|item| item.row).min()?;
    let max_row = refs.iter().map(|item| item.row).max()?;
    let min_col = refs.iter().map(|item| item.col).min()?;
    let max_col = refs.iter().map(|item| item.col).max()?;
    let row_count = max_row - min_row + 1;
    let col_count = max_col - min_col + 1;
    if row_count * col_count != refs.len() as u32 {
        return None;
    }

    let body = if min_row == max_row && min_col == max_col {
        cell_ref(min_col, min_row)
    } else {
        format!(
            "{}:{}",
            cell_ref(min_col, min_row),
            cell_ref(max_col, max_row)
        )
    };
    Some(match &first.sheet {
        Some(sheet) => format!("{}!{body}", quote_sheet_name(sheet)),
        None => body,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedCellRef {
    sheet: Option<String>,
    col: u32,
    row: u32,
}

fn parse_single_cell_ref(input: &str) -> Option<ParsedCellRef> {
    if input.is_empty() || input.contains(':') || input.starts_with('=') {
        return None;
    }
    let (sheet, body) = split_sheet_ref(input)?;
    let (col, row) = parse_cell_ref(body)?;
    Some(ParsedCellRef { sheet, col, row })
}

fn split_sheet_ref(input: &str) -> Option<(Option<String>, &str)> {
    if let Some(rest) = input.strip_prefix('\'') {
        let mut sheet = String::new();
        let mut chars = rest.char_indices().peekable();
        while let Some((idx, ch)) = chars.next() {
            if ch == '\'' {
                if matches!(chars.peek(), Some((_, '\''))) {
                    sheet.push('\'');
                    chars.next();
                    continue;
                }
                let body = rest.get(idx + 1..)?.strip_prefix('!')?;
                return Some((Some(sheet), body));
            }
            sheet.push(ch);
        }
        return None;
    }

    match input.rsplit_once('!') {
        Some((sheet, body)) if !sheet.is_empty() && !body.is_empty() => {
            Some((Some(sheet.to_string()), body))
        }
        Some(_) => None,
        None => Some((None, input)),
    }
}

fn parse_cell_ref(input: &str) -> Option<(u32, u32)> {
    let mut letters = String::new();
    let mut digits = String::new();
    for ch in input.chars().filter(|ch| *ch != '$') {
        if ch.is_ascii_alphabetic() && digits.is_empty() {
            letters.push(ch.to_ascii_uppercase());
        } else if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            return None;
        }
    }
    if letters.is_empty() || digits.is_empty() {
        return None;
    }
    let row = digits.parse::<u32>().ok()?.checked_sub(1)?;
    Some((a1_col_to_index(&letters)?, row))
}

fn a1_col_to_index(letters: &str) -> Option<u32> {
    let mut col = 0u32;
    for ch in letters.bytes() {
        if !ch.is_ascii_uppercase() {
            return None;
        }
        col = col.checked_mul(26)?.checked_add((ch - b'A' + 1) as u32)?;
    }
    col.checked_sub(1)
}

fn cell_ref(col: u32, row: u32) -> String {
    format!("{}{}", col_to_a1(col), row + 1)
}

fn col_to_a1(mut col: u32) -> String {
    let mut out = String::new();
    loop {
        let rem = (col % 26) as u8;
        out.insert(0, (b'A' + rem) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    out
}

fn quote_sheet_name(sheet: &str) -> String {
    if sheet.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        sheet.to_string()
    } else {
        format!("'{}'", sheet.replace('\'', "''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(name_ref: Option<&str>, categories: Option<&str>) -> ChartSeriesData {
        ChartSeriesData {
            name: None,
            name_ref: name_ref.map(ToOwned::to_owned),
            r#type: None,
            color: None,
            stock_role: None,
            values: None,
            value_cache: None,
            value_source_kind: None,
            categories: categories.map(ToOwned::to_owned),
            x_role: None,
            category_cache: None,
            category_source_kind: None,
            category_source_type: None,
            category_levels: None,
            category_label_format: None,
            bubble_size: None,
            bubble_size_cache: None,
            bubble_size_source_kind: None,
            bubble_3d: None,
            smooth: None,
            show_lines: None,
            explosion: None,
            invert_if_negative: None,
            y_axis_index: None,
            show_markers: None,
            marker_size: None,
            marker_style: None,
            line_width: None,
            points: None,
            data_labels: None,
            trendlines: None,
            error_bars: None,
            x_error_bars: None,
            y_error_bars: None,
            idx: None,
            order: None,
            format: None,
            bar_shape: None,
            invert_color: None,
            marker_background_color: None,
            marker_foreground_color: None,
            marker_line_format: None,
            filtered: None,
            source_series_index: None,
            source_series_key: None,
            visible_order: None,
            pivot_series_key: None,
            pivot_data_field_index: None,
            projection_authority: None,
            projection_diagnostics: Vec::new(),
            show_shadow: None,
            show_connector_lines: None,
            leader_line_format: None,
            show_leader_lines: None,
            bin_options: None,
            boxwhisker_options: None,
        }
    }

    #[test]
    fn common_category_range_requires_all_series_to_match() {
        let matching = vec![
            series(Some("B1"), Some("A2:A5")),
            series(Some("C1"), Some("A2:A5")),
        ];
        assert_eq!(
            infer_common_category_range(&matching).as_deref(),
            Some("A2:A5")
        );

        let mixed = vec![
            series(Some("B1"), Some("A2:A5")),
            series(Some("C1"), Some("A3:A6")),
        ];
        assert_eq!(infer_common_category_range(&mixed), None);
    }

    #[test]
    fn series_name_range_combines_contiguous_header_cells() {
        let series = vec![
            series(Some("B1"), Some("A2:A5")),
            series(Some("C1"), Some("A2:A5")),
            series(Some("D1"), Some("A2:A5")),
        ];
        assert_eq!(infer_series_name_range(&series).as_deref(), Some("B1:D1"));
    }

    #[test]
    fn series_name_range_preserves_external_sheet_prefix() {
        let series = vec![
            series(Some("'Q1 Data'!$B$1"), Some("A2:A5")),
            series(Some("'Q1 Data'!$C$1"), Some("A2:A5")),
        ];
        assert_eq!(
            infer_series_name_range(&series).as_deref(),
            Some("'Q1 Data'!B1:C1")
        );
    }
}
