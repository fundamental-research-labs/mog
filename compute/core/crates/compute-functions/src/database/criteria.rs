use value_types::CellValue;

use crate::helpers::criteria::parse_criteria as parse_criterion_predicate;

use super::model::{Criteria, Database};

/// Returns true if the criteria cell should be treated as "match all" for
/// D-functions. D-functions treat blank (Null) and empty-text criteria as
/// "match every row in that column", which differs from SUMIF/COUNTIF where
/// blank means "match blank cells only".
fn is_blank_criterion(val: &CellValue) -> bool {
    match val {
        CellValue::Null => true,
        CellValue::Text(s) => s.trim().is_empty(),
        _ => false,
    }
}

/// A single pre-parsed criterion: the database column index and the predicate.
/// Built once per non-blank criteria cell, then reused for every data row.
struct ParsedCriterion {
    col_idx: usize,
    predicate: Box<dyn Fn(&CellValue) -> bool>,
}

/// Pre-parsed criteria rows. Each inner Vec is an AND-group; the outer Vec
/// represents OR-groups (multiple criteria rows).
pub(super) struct PreParsedCriteria {
    rows: Vec<Vec<ParsedCriterion>>,
    /// True when there are no effective criteria (match everything).
    match_all: bool,
}

/// Pre-parse all criteria cells into closures so we parse once, not per row.
pub(super) fn preparse_criteria(db: &Database, criteria: &Criteria) -> PreParsedCriteria {
    if criteria.conditions.is_empty()
        || (criteria.conditions.len() == 1 && criteria.conditions[0].is_empty())
    {
        return PreParsedCriteria {
            rows: Vec::new(),
            match_all: true,
        };
    }

    let mut rows = Vec::with_capacity(criteria.conditions.len());

    for crit_row in &criteria.conditions {
        let mut parsed_row = Vec::new();

        for (i, field_name) in criteria.fields.iter().enumerate() {
            let crit_val = crit_row.get(i).unwrap_or(&CellValue::Null);

            if is_blank_criterion(crit_val) {
                continue;
            }

            let col_idx = match db.headers.iter().position(|h| h == field_name) {
                Some(idx) => idx,
                None => continue,
            };

            let predicate = parse_criterion_predicate(crit_val);
            parsed_row.push(ParsedCriterion { col_idx, predicate });
        }

        rows.push(parsed_row);
    }

    PreParsedCriteria {
        rows,
        match_all: false,
    }
}

/// Check if a data row matches the pre-parsed criteria.
/// Multiple criteria columns in a row = AND.
/// Multiple criteria rows = OR.
pub(super) fn row_matches_preparsed(data_row: &[CellValue], criteria: &PreParsedCriteria) -> bool {
    if criteria.match_all {
        return true;
    }

    for parsed_row in &criteria.rows {
        let mut row_ok = true;

        for pc in parsed_row {
            let data_val = data_row.get(pc.col_idx).unwrap_or(&CellValue::Null);
            if !(pc.predicate)(data_val) {
                row_ok = false;
                break;
            }
        }

        if row_ok {
            return true;
        }
    }

    false
}
