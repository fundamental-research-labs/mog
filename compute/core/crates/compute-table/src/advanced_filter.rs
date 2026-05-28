//! Pure Advanced Filter criteria evaluation.
//!
//! The evaluator implements Excel's DNF criteria shape: criteria rows are ORed,
//! non-empty cells within one criteria row are ANDed, and repeated criteria
//! headers compose multiple predicates for the same list column.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use value_types::{CellError, CellValue};

use crate::compare::{cell_value_key, cell_values_equal, compare_values, type_rank};

/// Source list values for Advanced Filter evaluation.
///
/// `headers` are the list headers. `rows` are data rows only; if the caller has
/// a rectangular list range that includes the header row, use
/// [`AdvancedFilterTable::from_range_with_header`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdvancedFilterTable {
    /// List header labels, one per source column.
    pub headers: Vec<String>,
    /// Source list data rows, excluding the header row.
    pub rows: Vec<Vec<CellValue>>,
}

impl AdvancedFilterTable {
    /// Build a table from already-separated headers and data rows.
    #[must_use]
    pub fn new(headers: Vec<String>, rows: Vec<Vec<CellValue>>) -> Self {
        Self { headers, rows }
    }

    /// Build a table from a rectangular range whose first row is the header row.
    ///
    /// # Errors
    ///
    /// Returns [`AdvancedFilterError::MissingListHeader`] when the range has no
    /// header row.
    pub fn from_range_with_header(range: Vec<Vec<CellValue>>) -> Result<Self, AdvancedFilterError> {
        let mut rows = range.into_iter();
        let headers = rows
            .next()
            .ok_or(AdvancedFilterError::MissingListHeader)?
            .iter()
            .map(header_text)
            .collect();

        Ok(Self {
            headers,
            rows: rows.collect(),
        })
    }
}

/// One criteria cell with optional authoritative formula metadata.
///
/// Formula criteria are intentionally not evaluated by this first pure engine.
/// Callers that can see the formula store should set `is_formula` for criteria
/// cells backed by formulas; the evaluator then returns a typed unsupported
/// error instead of treating the displayed value as literal text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdvancedFilterCriteriaCell {
    /// Display/computed criteria value.
    pub value: CellValue,
    /// Whether this criteria cell is backed by a stored formula.
    #[serde(default)]
    pub is_formula: bool,
}

impl AdvancedFilterCriteriaCell {
    /// Build a literal criteria cell.
    #[must_use]
    pub fn literal(value: CellValue) -> Self {
        Self {
            value,
            is_formula: false,
        }
    }

    /// Build a formula-backed criteria cell.
    #[must_use]
    pub fn formula(value: CellValue) -> Self {
        Self {
            value,
            is_formula: true,
        }
    }
}

impl From<CellValue> for AdvancedFilterCriteriaCell {
    fn from(value: CellValue) -> Self {
        Self::literal(value)
    }
}

/// Advanced Filter criteria range values.
///
/// `headers` are the first row of the criteria range. `rows` are the criteria
/// rows below that header row.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdvancedFilterCriteria {
    /// Criteria header labels, matched case-insensitively against list headers.
    pub headers: Vec<String>,
    /// Criteria rows below the header row.
    pub rows: Vec<Vec<AdvancedFilterCriteriaCell>>,
}

impl AdvancedFilterCriteria {
    /// Build criteria from already-separated headers and criteria rows.
    #[must_use]
    pub fn new(headers: Vec<String>, rows: Vec<Vec<AdvancedFilterCriteriaCell>>) -> Self {
        Self { headers, rows }
    }

    /// Build criteria from a rectangular range whose first row is the header row.
    ///
    /// # Errors
    ///
    /// Returns [`AdvancedFilterError::MissingCriteriaHeader`] when the range has
    /// no header row.
    pub fn from_range_with_header(range: Vec<Vec<CellValue>>) -> Result<Self, AdvancedFilterError> {
        let mut rows = range.into_iter();
        let headers = rows
            .next()
            .ok_or(AdvancedFilterError::MissingCriteriaHeader)?
            .iter()
            .map(header_text)
            .collect();
        let rows = rows
            .map(|row| {
                row.into_iter()
                    .map(AdvancedFilterCriteriaCell::literal)
                    .collect()
            })
            .collect();

        Ok(Self { headers, rows })
    }
}

/// Options controlling Advanced Filter evaluation.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdvancedFilterOptions {
    /// When true, only the first matching row for each full source row tuple is
    /// included.
    #[serde(default)]
    pub unique_records_only: bool,
}

/// Per-source-row Advanced Filter result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdvancedFilterRowResult {
    /// Zero-based index into [`AdvancedFilterTable::rows`].
    pub source_row_index: usize,
    /// Whether the row matched the criteria before unique-record dedupe.
    pub matches_criteria: bool,
    /// Whether this row was removed by unique-record dedupe.
    pub is_duplicate: bool,
    /// Final inclusion decision after criteria and unique-record dedupe.
    pub included: bool,
}

/// Typed Advanced Filter evaluation errors.
#[derive(Clone, Debug, Error, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdvancedFilterError {
    /// The list range did not include a header row.
    #[error("advanced filter list range must include a header row")]
    MissingListHeader,
    /// The criteria range did not include a header row.
    #[error("advanced filter criteria range must include a header row")]
    MissingCriteriaHeader,
    /// A source row width did not match the header width.
    #[error(
        "advanced filter source row {row_index} has {actual_columns} columns, expected {expected_columns}"
    )]
    SourceRowWidthMismatch {
        /// Zero-based index into source data rows.
        row_index: usize,
        /// Expected number of columns from the list header row.
        expected_columns: usize,
        /// Actual number of columns in the source row.
        actual_columns: usize,
    },
    /// A non-empty criteria cell referred to a header not present in the list.
    #[error("advanced filter criteria header '{header}' at column {criteria_column} was not found")]
    UnknownCriteriaHeader {
        /// Criteria header text.
        header: String,
        /// Zero-based criteria column index.
        criteria_column: usize,
    },
    /// Formula criteria are detected but not implemented by the pure evaluator.
    #[error(
        "advanced filter formula criteria at row {criteria_row}, column {criteria_column} are not supported"
    )]
    UnsupportedFormulaCriteria {
        /// Zero-based index into criteria data rows.
        criteria_row: usize,
        /// Zero-based criteria column index.
        criteria_column: usize,
    },
}

/// Evaluate Advanced Filter criteria against source list rows.
///
/// Passing `None` for `criteria`, or passing criteria with no active condition
/// cells, means every source row matches before unique-record dedupe.
///
/// # Errors
///
/// Returns typed errors for malformed list rows, unknown criteria headers, and
/// formula-backed criteria cells.
pub fn evaluate_advanced_filter(
    table: &AdvancedFilterTable,
    criteria: Option<&AdvancedFilterCriteria>,
    options: &AdvancedFilterOptions,
) -> Result<Vec<AdvancedFilterRowResult>, AdvancedFilterError> {
    validate_table(table)?;

    let criteria_rows = match criteria {
        Some(criteria) => parse_criteria(criteria, &table.headers)?,
        None => Vec::new(),
    };
    let has_criteria = !criteria_rows.is_empty();
    let mut seen_rows = HashSet::new();
    let mut results = Vec::with_capacity(table.rows.len());

    for (source_row_index, row) in table.rows.iter().enumerate() {
        let matches_criteria = !has_criteria
            || criteria_rows
                .iter()
                .any(|criteria_row| criteria_row_matches(row, criteria_row));
        let is_duplicate = if matches_criteria && options.unique_records_only {
            !seen_rows.insert(row_tuple_key(row))
        } else {
            false
        };
        let included = matches_criteria && !is_duplicate;
        results.push(AdvancedFilterRowResult {
            source_row_index,
            matches_criteria,
            is_duplicate,
            included,
        });
    }

    Ok(results)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParsedCriteriaRow {
    conditions: Vec<ParsedCondition>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParsedCondition {
    column_index: usize,
    predicate: CriteriaPredicate,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CriteriaPredicate {
    Blank,
    NonBlank,
    Compare {
        operator: CriteriaOperator,
        operand: CriteriaOperand,
    },
    Wildcard {
        operator: CriteriaOperator,
        pattern: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CriteriaOperator {
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CriteriaOperand {
    Value(CellValue),
    Text(String),
}

fn validate_table(table: &AdvancedFilterTable) -> Result<(), AdvancedFilterError> {
    for (row_index, row) in table.rows.iter().enumerate() {
        if row.len() != table.headers.len() {
            return Err(AdvancedFilterError::SourceRowWidthMismatch {
                row_index,
                expected_columns: table.headers.len(),
                actual_columns: row.len(),
            });
        }
    }
    Ok(())
}

fn parse_criteria(
    criteria: &AdvancedFilterCriteria,
    list_headers: &[String],
) -> Result<Vec<ParsedCriteriaRow>, AdvancedFilterError> {
    let header_index = list_header_index(list_headers);
    let mut parsed_rows = Vec::new();

    for (criteria_row, row) in criteria.rows.iter().enumerate() {
        let mut conditions = Vec::new();

        for (criteria_column, cell) in row.iter().enumerate() {
            if cell.value.is_visually_blank() {
                continue;
            }
            if cell.is_formula {
                return Err(AdvancedFilterError::UnsupportedFormulaCriteria {
                    criteria_row,
                    criteria_column,
                });
            }

            let header = criteria
                .headers
                .get(criteria_column)
                .map_or("", String::as_str);
            let Some(&column_index) = header_index.get(&normalize_header(header)) else {
                return Err(AdvancedFilterError::UnknownCriteriaHeader {
                    header: header.to_string(),
                    criteria_column,
                });
            };

            conditions.push(ParsedCondition {
                column_index,
                predicate: parse_predicate(&cell.value),
            });
        }

        if !conditions.is_empty() {
            parsed_rows.push(ParsedCriteriaRow { conditions });
        }
    }

    Ok(parsed_rows)
}

fn list_header_index(headers: &[String]) -> HashMap<String, usize> {
    let mut index = HashMap::with_capacity(headers.len());
    for (column_index, header) in headers.iter().enumerate() {
        index
            .entry(normalize_header(header))
            .or_insert(column_index);
    }
    index
}

fn criteria_row_matches(row: &[CellValue], criteria_row: &ParsedCriteriaRow) -> bool {
    criteria_row
        .conditions
        .iter()
        .all(|condition| predicate_matches(&row[condition.column_index], &condition.predicate))
}

fn parse_predicate(value: &CellValue) -> CriteriaPredicate {
    let CellValue::Text(text) = value else {
        return CriteriaPredicate::Compare {
            operator: CriteriaOperator::Equal,
            operand: CriteriaOperand::Value(value.clone()),
        };
    };

    let text = text.trim();
    let (operator, operand) = split_operator(text);
    match (operator, operand) {
        (CriteriaOperator::Equal, "") => CriteriaPredicate::Blank,
        (CriteriaOperator::NotEqual, "") => CriteriaPredicate::NonBlank,
        _ if contains_wildcard(operand) && operator_allows_wildcard(operator) => {
            CriteriaPredicate::Wildcard {
                operator,
                pattern: operand.to_string(),
            }
        }
        _ => CriteriaPredicate::Compare {
            operator,
            operand: parse_operand(operand),
        },
    }
}

fn split_operator(text: &str) -> (CriteriaOperator, &str) {
    if let Some(rest) = text.strip_prefix(">=") {
        (CriteriaOperator::GreaterThanOrEqual, rest)
    } else if let Some(rest) = text.strip_prefix("<=") {
        (CriteriaOperator::LessThanOrEqual, rest)
    } else if let Some(rest) = text.strip_prefix("<>") {
        (CriteriaOperator::NotEqual, rest)
    } else if let Some(rest) = text.strip_prefix('=') {
        (CriteriaOperator::Equal, rest)
    } else if let Some(rest) = text.strip_prefix('>') {
        (CriteriaOperator::GreaterThan, rest)
    } else if let Some(rest) = text.strip_prefix('<') {
        (CriteriaOperator::LessThan, rest)
    } else {
        (CriteriaOperator::Equal, text)
    }
}

fn parse_operand(text: &str) -> CriteriaOperand {
    let text = text.trim();
    if text.eq_ignore_ascii_case("true") {
        return CriteriaOperand::Value(CellValue::Boolean(true));
    }
    if text.eq_ignore_ascii_case("false") {
        return CriteriaOperand::Value(CellValue::Boolean(false));
    }
    if let Some(error) = parse_error(text) {
        return CriteriaOperand::Value(CellValue::Error(error, None));
    }
    if let Ok(number) = text.parse::<f64>() {
        let value = CellValue::number(number);
        if matches!(value, CellValue::Number(_)) {
            return CriteriaOperand::Value(value);
        }
    }
    CriteriaOperand::Text(text.to_string())
}

fn parse_error(text: &str) -> Option<CellError> {
    [
        CellError::Null,
        CellError::Div0,
        CellError::Value,
        CellError::Ref,
        CellError::Name,
        CellError::Num,
        CellError::Na,
        CellError::GettingData,
        CellError::Spill,
        CellError::Calc,
        CellError::Circ,
    ]
    .into_iter()
    .find(|error| text.eq_ignore_ascii_case(error.as_str()))
}

fn predicate_matches(value: &CellValue, predicate: &CriteriaPredicate) -> bool {
    match predicate {
        CriteriaPredicate::Blank => value.is_visually_blank(),
        CriteriaPredicate::NonBlank => !value.is_visually_blank(),
        CriteriaPredicate::Compare { operator, operand } => {
            compare_predicate_matches(value, *operator, operand)
        }
        CriteriaPredicate::Wildcard { operator, pattern } => {
            let matches = !value.is_visually_blank()
                && wildcard_match(&cell_match_text(value), pattern.as_str());
            match operator {
                CriteriaOperator::Equal => matches,
                CriteriaOperator::NotEqual => !matches,
                CriteriaOperator::GreaterThan
                | CriteriaOperator::GreaterThanOrEqual
                | CriteriaOperator::LessThan
                | CriteriaOperator::LessThanOrEqual => false,
            }
        }
    }
}

fn compare_predicate_matches(
    value: &CellValue,
    operator: CriteriaOperator,
    operand: &CriteriaOperand,
) -> bool {
    match operator {
        CriteriaOperator::Equal => value_equals_operand(value, operand),
        CriteriaOperator::NotEqual => !value_equals_operand(value, operand),
        CriteriaOperator::GreaterThan
        | CriteriaOperator::GreaterThanOrEqual
        | CriteriaOperator::LessThan
        | CriteriaOperator::LessThanOrEqual => {
            let ordering = compare_for_criteria(value, operand);
            match operator {
                CriteriaOperator::GreaterThan => ordering.is_some_and(Ordering::is_gt),
                CriteriaOperator::GreaterThanOrEqual => ordering.is_some_and(Ordering::is_ge),
                CriteriaOperator::LessThan => ordering.is_some_and(Ordering::is_lt),
                CriteriaOperator::LessThanOrEqual => ordering.is_some_and(Ordering::is_le),
                CriteriaOperator::Equal | CriteriaOperator::NotEqual => unreachable!(),
            }
        }
    }
}

fn value_equals_operand(value: &CellValue, operand: &CriteriaOperand) -> bool {
    match operand {
        CriteriaOperand::Value(operand_value) => cell_values_equal(value, operand_value),
        CriteriaOperand::Text(text) => match value {
            CellValue::Text(value_text) => value_text.eq_ignore_ascii_case(text),
            _ => false,
        },
    }
}

fn compare_for_criteria(value: &CellValue, operand: &CriteriaOperand) -> Option<Ordering> {
    let operand_value = match operand {
        CriteriaOperand::Value(operand_value) => operand_value,
        CriteriaOperand::Text(text) => {
            let CellValue::Text(value_text) = value else {
                return None;
            };
            return Some(compare_text_case_insensitive(value_text, text));
        }
    };

    if value.is_visually_blank() || operand_value.is_visually_blank() {
        return None;
    }
    if type_rank(value) != type_rank(operand_value) {
        return None;
    }
    Some(compare_values(value, operand_value))
}

fn compare_text_case_insensitive(left: &str, right: &str) -> Ordering {
    left.chars()
        .flat_map(char::to_lowercase)
        .cmp(right.chars().flat_map(char::to_lowercase))
}

fn contains_wildcard(text: &str) -> bool {
    let mut escaped = false;
    for ch in text.chars() {
        if escaped {
            escaped = false;
        } else if ch == '~' {
            escaped = true;
        } else if ch == '*' || ch == '?' {
            return true;
        }
    }
    false
}

fn operator_allows_wildcard(operator: CriteriaOperator) -> bool {
    matches!(
        operator,
        CriteriaOperator::Equal | CriteriaOperator::NotEqual
    )
}

fn wildcard_match(value: &str, pattern: &str) -> bool {
    let value: Vec<char> = value.chars().flat_map(char::to_lowercase).collect();
    let pattern: Vec<char> = pattern.chars().flat_map(char::to_lowercase).collect();
    let mut memo = HashMap::new();
    wildcard_match_at(&value, &pattern, 0, 0, &mut memo)
}

fn wildcard_match_at(
    value: &[char],
    pattern: &[char],
    value_index: usize,
    pattern_index: usize,
    memo: &mut HashMap<(usize, usize), bool>,
) -> bool {
    if let Some(&cached) = memo.get(&(value_index, pattern_index)) {
        return cached;
    }

    let result = if pattern_index == pattern.len() {
        value_index == value.len()
    } else if pattern[pattern_index] == '*' {
        wildcard_match_at(value, pattern, value_index, pattern_index + 1, memo)
            || (value_index < value.len()
                && wildcard_match_at(value, pattern, value_index + 1, pattern_index, memo))
    } else if value_index < value.len() {
        match pattern[pattern_index] {
            '?' => wildcard_match_at(value, pattern, value_index + 1, pattern_index + 1, memo),
            '~' if pattern_index + 1 < pattern.len() => {
                pattern[pattern_index + 1] == value[value_index]
                    && wildcard_match_at(value, pattern, value_index + 1, pattern_index + 2, memo)
            }
            ch => {
                ch == value[value_index]
                    && wildcard_match_at(value, pattern, value_index + 1, pattern_index + 1, memo)
            }
        }
    } else {
        false
    };

    memo.insert((value_index, pattern_index), result);
    result
}

fn header_text(value: &CellValue) -> String {
    match value {
        CellValue::Text(text) => text.to_string(),
        CellValue::Null => String::new(),
        CellValue::Number(number) => number.to_string(),
        CellValue::Boolean(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        CellValue::Error(error, _) => error.as_str().to_string(),
        CellValue::Array(_) => String::new(),
        CellValue::Control(control) => {
            if control.value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        CellValue::Image(image) => image.fallback_text().to_string(),
    }
}

fn cell_match_text(value: &CellValue) -> String {
    match value {
        CellValue::Text(text) => text.to_string(),
        CellValue::Null => String::new(),
        CellValue::Number(number) => number.to_string(),
        CellValue::Boolean(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        CellValue::Error(error, _) => error.as_str().to_string(),
        CellValue::Array(_) => String::new(),
        CellValue::Control(control) => {
            if control.value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        CellValue::Image(image) => image.fallback_text().to_string(),
    }
}

fn normalize_header(header: &str) -> String {
    header.trim().to_lowercase()
}

fn row_tuple_key(row: &[CellValue]) -> String {
    let mut result = String::new();
    for value in row {
        let key = cell_value_key(value);
        result.push_str(&key.len().to_string());
        result.push(':');
        result.push_str(&key);
        result.push(';');
    }
    result
}

#[cfg(test)]
#[path = "advanced_filter_tests.rs"]
mod tests;
