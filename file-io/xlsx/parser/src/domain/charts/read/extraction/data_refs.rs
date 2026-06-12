pub(super) fn extract_num_ref_formula(
    src: &Option<ooxml_types::charts::NumDataSource>,
) -> Option<String> {
    match src.as_ref()? {
        ooxml_types::charts::NumDataSource::Ref(nr) => Some(nr.f.clone()),
        ooxml_types::charts::NumDataSource::Lit(_) => None,
    }
}

pub(super) fn extract_cat_ref_formula(
    src: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<String> {
    match src.as_ref()? {
        ooxml_types::charts::CatDataSource::StrRef(sr) => Some(sr.f.clone()),
        ooxml_types::charts::CatDataSource::NumRef(nr) => Some(nr.f.clone()),
        ooxml_types::charts::CatDataSource::MultiLvlStrRef(mr) => Some(mr.f.clone()),
        ooxml_types::charts::CatDataSource::NumLit(_)
        | ooxml_types::charts::CatDataSource::StrLit(_) => None,
    }
}

pub(super) fn reconstruct_data_range_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Option<String> {
    if cs.chart.plot_area.chart_groups.iter().any(|g| {
        matches!(
            g.chart_type,
            ooxml_types::charts::ChartType::Scatter | ooxml_types::charts::ChartType::Bubble
        )
    }) {
        return None;
    }

    let mut formulas: Vec<&str> = Vec::new();

    for g in &cs.chart.plot_area.chart_groups {
        for s in &g.series {
            if let Some(f) = extract_series_text_ref_formula_str(s.tx.as_ref()) {
                formulas.push(f);
            }
            if let Some(ref val) = s.val {
                if let Some(f) = extract_num_ref_formula_str(val) {
                    formulas.push(f);
                }
            }
            if let Some(ref cat) = s.cat {
                if let Some(f) = extract_cat_ref_formula_str(cat) {
                    formulas.push(f);
                }
            }
            if let Some(ref xv) = s.x_val {
                if let Some(f) = extract_cat_ref_formula_str(xv) {
                    formulas.push(f);
                }
            }
            if let Some(ref yv) = s.y_val {
                if let Some(f) = extract_num_ref_formula_str(yv) {
                    formulas.push(f);
                }
            }
            if let Some(ref bubble_size) = s.bubble_size {
                if let Some(f) = extract_num_ref_formula_str(bubble_size) {
                    formulas.push(f);
                }
            }
        }
    }

    synthesize_rectangular_data_range(&formulas)
}

pub(super) fn reconstruct_data_range_from_chart_groups(
    groups: &[ooxml_types::charts::ChartGroup],
) -> Option<String> {
    if groups.iter().any(|g| {
        matches!(
            g.chart_type,
            ooxml_types::charts::ChartType::Scatter | ooxml_types::charts::ChartType::Bubble
        )
    }) {
        return None;
    }

    let mut formulas: Vec<&str> = Vec::new();
    for g in groups {
        for s in &g.series {
            if let Some(f) = extract_series_text_ref_formula_str(s.tx.as_ref()) {
                formulas.push(f);
            }
            if let Some(ref val) = s.val {
                if let Some(f) = extract_num_ref_formula_str(val) {
                    formulas.push(f);
                }
            }
            if let Some(ref cat) = s.cat {
                if let Some(f) = extract_cat_ref_formula_str(cat) {
                    formulas.push(f);
                }
            }
            if let Some(ref xv) = s.x_val {
                if let Some(f) = extract_cat_ref_formula_str(xv) {
                    formulas.push(f);
                }
            }
            if let Some(ref yv) = s.y_val {
                if let Some(f) = extract_num_ref_formula_str(yv) {
                    formulas.push(f);
                }
            }
            if let Some(ref bubble_size) = s.bubble_size {
                if let Some(f) = extract_num_ref_formula_str(bubble_size) {
                    formulas.push(f);
                }
            }
        }
    }

    synthesize_rectangular_data_range(&formulas)
}

/// Reconstruct an A1-style data range from chart series references.
pub(super) fn reconstruct_data_range(
    series: &[crate::domain::charts::ChartSeries],
) -> Option<String> {
    use crate::domain::charts::series::{CatDataSource, NumDataSource};

    if series.is_empty() {
        return None;
    }

    // Collect all formula references from series
    let mut formulas = Vec::new();
    for s in series {
        if let Some(f) = extract_legacy_series_text_ref_formula_str(s.tx.as_ref()) {
            formulas.push(f);
        }
        if let Some(ref val) = s.val {
            match val {
                NumDataSource::Ref(nr) => formulas.push(nr.f.as_str()),
                NumDataSource::Lit(_) => {}
            }
        }
        if let Some(ref cat) = s.cat {
            match cat {
                CatDataSource::StrRef(sr) => formulas.push(sr.f.as_str()),
                CatDataSource::NumRef(nr) => formulas.push(nr.f.as_str()),
                _ => {}
            }
        }
        if let Some(CatDataSource::NumRef(nr)) = &s.x_val {
            formulas.push(nr.f.as_str())
        }
        if let Some(ref yv) = s.y_val {
            match yv {
                NumDataSource::Ref(nr) => formulas.push(nr.f.as_str()),
                NumDataSource::Lit(_) => {}
            }
        }
    }

    if formulas.is_empty() {
        return None;
    }

    synthesize_rectangular_data_range(&formulas)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedChartRef {
    pub(crate) sheet: Option<String>,
    pub(crate) start_row: u32,
    pub(crate) start_col: u32,
    pub(crate) end_row: u32,
    pub(crate) end_col: u32,
}

pub(crate) fn synthesize_rectangular_data_range(formulas: &[&str]) -> Option<String> {
    use std::collections::HashSet;

    if formulas.is_empty() {
        return None;
    }

    let refs: Vec<ParsedChartRef> = formulas
        .iter()
        .map(|f| parse_chart_a1_ref(f))
        .collect::<Option<_>>()?;
    let sheet = refs.first()?.sheet.clone();
    if refs.iter().any(|r| r.sheet != sheet) {
        return None;
    }

    let start_row = refs.iter().map(|r| r.start_row).min()?;
    let start_col = refs.iter().map(|r| r.start_col).min()?;
    let end_row = refs.iter().map(|r| r.end_row).max()?;
    let end_col = refs.iter().map(|r| r.end_col).max()?;

    let mut cells = HashSet::new();
    for r in &refs {
        for row in r.start_row..=r.end_row {
            for col in r.start_col..=r.end_col {
                cells.insert((row, col));
            }
        }
    }
    let rect_area = (end_row - start_row + 1) as usize * (end_col - start_col + 1) as usize;
    let missing_only_top_left =
        cells.len() + 1 == rect_area && !cells.contains(&(start_row, start_col));
    if cells.len() != rect_area && !missing_only_top_left {
        return None;
    }

    let body = format!(
        "{}{}:{}{}",
        col_to_a1(start_col),
        start_row + 1,
        col_to_a1(end_col),
        end_row + 1
    );
    Some(match sheet {
        Some(sheet) => format!("{}!{}", quote_sheet_name(&sheet), body),
        None => body,
    })
}

pub(crate) fn parse_chart_a1_ref(input: &str) -> Option<ParsedChartRef> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.contains(',') {
        return None;
    }

    let (sheet, body) = split_sheet_ref(trimmed)?;
    let (start, end) = body.split_once(':').unwrap_or((body, body));
    let (start_col, start_row) = parse_cell_ref(start)?;
    let (end_col, end_row) = parse_cell_ref(end)?;

    Some(ParsedChartRef {
        sheet,
        start_row: start_row.min(end_row),
        start_col: start_col.min(end_col),
        end_row: start_row.max(end_row),
        end_col: start_col.max(end_col),
    })
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
    for ch in input.chars().filter(|c| *c != '$') {
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
    if sheet.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        sheet.to_string()
    } else {
        format!("'{}'", sheet.replace('\'', "''"))
    }
}

fn extract_num_ref_formula_str(src: &ooxml_types::charts::NumDataSource) -> Option<&str> {
    match src {
        ooxml_types::charts::NumDataSource::Ref(nr) => Some(&nr.f),
        ooxml_types::charts::NumDataSource::Lit(_) => None,
    }
}

fn extract_cat_ref_formula_str(src: &ooxml_types::charts::CatDataSource) -> Option<&str> {
    match src {
        ooxml_types::charts::CatDataSource::StrRef(sr) => Some(&sr.f),
        ooxml_types::charts::CatDataSource::NumRef(nr) => Some(&nr.f),
        ooxml_types::charts::CatDataSource::MultiLvlStrRef(mr) => Some(&mr.f),
        ooxml_types::charts::CatDataSource::NumLit(_)
        | ooxml_types::charts::CatDataSource::StrLit(_) => None,
    }
}

fn extract_series_text_ref_formula_str(
    src: Option<&ooxml_types::charts::SeriesTextSource>,
) -> Option<&str> {
    match src? {
        ooxml_types::charts::SeriesTextSource::StrRef(sr) => {
            (!sr.f.trim().is_empty()).then_some(sr.f.as_str())
        }
        ooxml_types::charts::SeriesTextSource::Value(_) => None,
    }
}

fn extract_legacy_series_text_ref_formula_str(
    src: Option<&crate::domain::charts::series::SeriesTextSource>,
) -> Option<&str> {
    match src? {
        crate::domain::charts::series::SeriesTextSource::StrRef(sr) => {
            (!sr.f.trim().is_empty()).then_some(sr.f.as_str())
        }
        crate::domain::charts::series::SeriesTextSource::Value(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::synthesize_rectangular_data_range;

    #[test]
    fn chart_table_range_allows_omitted_top_left_category_header() {
        assert_eq!(
            synthesize_rectangular_data_range(&[
                "Sheet1!B1",
                "Sheet1!C1",
                "Sheet1!A2:A4",
                "Sheet1!B2:B4",
                "Sheet1!C2:C4",
            ])
            .as_deref(),
            Some("Sheet1!A1:C4"),
        );
    }

    #[test]
    fn sparse_chart_refs_with_other_holes_do_not_synthesize_a_range() {
        assert_eq!(
            synthesize_rectangular_data_range(&["Sheet1!B1", "Sheet1!A2:A4", "Sheet1!C2:C4"]),
            None,
        );
    }
}

// =============================================================================
// Formatting extraction helpers
// =============================================================================

// Extract ChartFormatData from optional ShapeProperties and TextBody.
