//! Database functions: DAVERAGE, DCOUNT, DCOUNTA, DGET, DMAX, DMIN,
//! DPRODUCT, DSTDEV, DSTDEVP, DSUM, DVAR, DVARP
//!
//! All D-functions take 3 arguments: (database, field, criteria)
//! - database: An array where the first row is headers, rest is data
//! - field: Column name (text) or 1-indexed column number
//! - criteria: An array where the first row is header names and subsequent rows are criteria
//!
//! Criteria matching:
//! - Multiple criteria rows = OR (match any row)
//! - Multiple criteria columns in a row = AND (match all columns)
//! - Text criteria: case-insensitive match
//! - Numeric criteria: exact match
//! - Criteria with operators: ">5", "<=10", "<>abc"
//! - Blank criteria cells are skipped (match all)

use value_types::{CellError, CellValue};

use crate::helpers::criteria::parse_criteria as parse_criterion_predicate;
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// Database parsing helpers
// ---------------------------------------------------------------------------

/// Parsed database: headers (lowercase) and data rows.
struct Database {
    headers: Vec<String>,
    data: Vec<Vec<CellValue>>,
}

/// Parsed criteria: field names (lowercase) and condition rows.
struct Criteria {
    fields: Vec<String>,
    conditions: Vec<Vec<CellValue>>,
}

/// Parse a database from a CellValue::Array.
/// First row = headers, rest = data rows.
fn parse_database(val: &CellValue) -> Result<Database, CellError> {
    let arr = match val {
        CellValue::Array(arr) => arr,
        CellValue::Error(e, _) => return Err(*e),
        _ => return Err(CellError::Value),
    };

    if arr.is_empty() {
        return Err(CellError::Value);
    }

    let headers: Vec<String> = arr
        .row(0)
        .iter()
        .map(|v| match v.coerce_to_string() {
            Ok(s) => s.to_lowercase(),
            Err(_) => String::new(),
        })
        .collect();

    if headers.is_empty() || headers.iter().all(|h| h.is_empty()) {
        return Err(CellError::Value);
    }

    let data: Vec<Vec<CellValue>> = (1..arr.rows()).map(|r| arr.row(r).to_vec()).collect();
    Ok(Database { headers, data })
}

/// Parse criteria from a CellValue::Array.
/// First row = field names, rest = condition rows.
fn parse_criteria(val: &CellValue) -> Result<Criteria, CellError> {
    let arr = match val {
        CellValue::Array(arr) => arr,
        CellValue::Error(e, _) => return Err(*e),
        _ => return Err(CellError::Value),
    };

    if arr.is_empty() {
        return Err(CellError::Value);
    }

    let fields: Vec<String> = arr
        .row(0)
        .iter()
        .map(|v| match v.coerce_to_string() {
            Ok(s) => s.to_lowercase(),
            Err(_) => String::new(),
        })
        .collect();

    let conditions = if arr.rows() > 1 {
        (1..arr.rows()).map(|r| arr.row(r).to_vec()).collect()
    } else {
        // Empty criteria (just headers) means match all
        vec![vec![]]
    };

    Ok(Criteria { fields, conditions })
}

/// Find the field index by name (text) or 1-indexed column number.
fn find_field_index(headers: &[String], field: &CellValue) -> Result<usize, CellError> {
    match field {
        CellValue::Error(e, _) => Err(*e),
        CellValue::Number(n) => {
            let idx = n.get() as i64 - 1; // Convert to 0-indexed
            if idx < 0 || idx as usize >= headers.len() {
                Err(CellError::Value)
            } else {
                Ok(idx as usize)
            }
        }
        CellValue::Text(s) => {
            let name = s.to_lowercase();
            headers
                .iter()
                .position(|h| h == &name)
                .ok_or(CellError::Value)
        }
        CellValue::Null => Err(CellError::Value),
        _ => Err(CellError::Value),
    }
}

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
struct PreParsedCriteria {
    rows: Vec<Vec<ParsedCriterion>>,
    /// True when there are no effective criteria (match everything).
    match_all: bool,
}

/// Pre-parse all criteria cells into closures so we parse once, not per row.
fn preparse_criteria(db: &Database, criteria: &Criteria) -> PreParsedCriteria {
    // Empty conditions match everything
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

            // D-functions: blank criteria = match all for this column
            if is_blank_criterion(crit_val) {
                continue;
            }

            // Find the column in the database
            let col_idx = match db.headers.iter().position(|h| h == field_name) {
                Some(idx) => idx,
                None => continue, // Field not found in database, skip
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
fn row_matches_preparsed(data_row: &[CellValue], criteria: &PreParsedCriteria) -> bool {
    if criteria.match_all {
        return true;
    }

    // Each criteria row is an OR condition
    for parsed_row in &criteria.rows {
        let mut row_ok = true;

        // Each criterion in the row is an AND condition
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

/// Collect values from a specific field column for rows matching criteria.
fn get_matching_values(db: &Database, field_idx: usize, criteria: &Criteria) -> Vec<CellValue> {
    let preparsed = preparse_criteria(db, criteria);
    let mut values = Vec::new();
    for row in &db.data {
        if row_matches_preparsed(row, &preparsed) {
            values.push(row.get(field_idx).cloned().unwrap_or(CellValue::Null));
        }
    }
    values
}

/// Extract numbers from matching values, skipping non-numeric.
fn extract_matching_numbers(values: &[CellValue]) -> Vec<f64> {
    let mut nums = Vec::new();
    for v in values {
        if let CellValue::Number(n) = v {
            nums.push(n.get());
        }
    }
    nums
}

/// Parse the 3 standard database arguments: (database, field, criteria).
/// Returns (Database, field_index, Criteria) or an error CellValue.
fn parse_db_args(args: &[CellValue]) -> Result<(Database, usize, Criteria), CellValue> {
    // Check for errors in arguments
    for arg in args {
        if let CellValue::Error(e, _) = arg {
            return Err(CellValue::Error(*e, None));
        }
    }

    let db = match parse_database(&args[0]) {
        Ok(db) => db,
        Err(e) => return Err(CellValue::error_with_message(e, "invalid database range")),
    };

    let field_idx = match find_field_index(&db.headers, &args[1]) {
        Ok(idx) => idx,
        Err(e) => {
            return Err(CellValue::error_with_message(
                e,
                "field not found in database headers",
            ));
        }
    };

    let criteria = match parse_criteria(&args[2]) {
        Ok(c) => c,
        Err(e) => return Err(CellValue::error_with_message(e, "invalid criteria range")),
    };

    Ok((db, field_idx, criteria))
}

// ---------------------------------------------------------------------------
// DSUM
// ---------------------------------------------------------------------------

pub struct FnDsum;
impl PureFunction for FnDsum {
    fn name(&self) -> &'static str {
        "DSUM"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);
        CellValue::number(nums.iter().sum())
    }
}

// ---------------------------------------------------------------------------
// DAVERAGE
// ---------------------------------------------------------------------------

pub struct FnDaverage;
impl PureFunction for FnDaverage {
    fn name(&self) -> &'static str {
        "DAVERAGE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.is_empty() {
            CellValue::error_with_message(
                CellError::Div0,
                "DAVERAGE: no numeric values in matching rows",
            )
        } else {
            CellValue::number(nums.iter().sum::<f64>() / nums.len() as f64)
        }
    }
}

// ---------------------------------------------------------------------------
// DCOUNT
// ---------------------------------------------------------------------------

pub struct FnDcount;
impl PureFunction for FnDcount {
    fn name(&self) -> &'static str {
        "DCOUNT"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let count = values
            .iter()
            .filter(|v| matches!(v, CellValue::Number(_)))
            .count();
        CellValue::number(count as f64)
    }
}

// ---------------------------------------------------------------------------
// DCOUNTA
// ---------------------------------------------------------------------------

pub struct FnDcounta;
impl PureFunction for FnDcounta {
    fn name(&self) -> &'static str {
        "DCOUNTA"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let count = values
            .iter()
            .filter(|v| !matches!(v, CellValue::Null))
            .count();
        CellValue::number(count as f64)
    }
}

// ---------------------------------------------------------------------------
// DGET
// ---------------------------------------------------------------------------

pub struct FnDget;
impl PureFunction for FnDget {
    fn name(&self) -> &'static str {
        "DGET"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);

        match values.len() {
            0 => CellValue::error_with_message(
                CellError::Value,
                "DGET: no records match the criteria",
            ),
            1 => values[0].clone(),
            _ => CellValue::error_with_message(
                CellError::Num,
                "DGET: more than one record matches the criteria",
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// DMAX
// ---------------------------------------------------------------------------

pub struct FnDmax;
impl PureFunction for FnDmax {
    fn name(&self) -> &'static str {
        "DMAX"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.is_empty() {
            CellValue::number(0.0)
        } else {
            CellValue::number(nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max))
        }
    }
}

// ---------------------------------------------------------------------------
// DMIN
// ---------------------------------------------------------------------------

pub struct FnDmin;
impl PureFunction for FnDmin {
    fn name(&self) -> &'static str {
        "DMIN"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.is_empty() {
            CellValue::number(0.0)
        } else {
            CellValue::number(nums.iter().cloned().fold(f64::INFINITY, f64::min))
        }
    }
}

// ---------------------------------------------------------------------------
// DPRODUCT
// ---------------------------------------------------------------------------

pub struct FnDproduct;
impl PureFunction for FnDproduct {
    fn name(&self) -> &'static str {
        "DPRODUCT"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.is_empty() {
            CellValue::number(0.0)
        } else {
            CellValue::number(nums.iter().product())
        }
    }
}

// ---------------------------------------------------------------------------
// DSTDEV (sample standard deviation)
// ---------------------------------------------------------------------------

pub struct FnDstdev;
impl PureFunction for FnDstdev {
    fn name(&self) -> &'static str {
        "DSTDEV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.len() < 2 {
            return CellValue::error_with_message(
                CellError::Div0,
                "DSTDEV: need at least 2 numeric values for sample standard deviation",
            );
        }

        let mean = nums.iter().sum::<f64>() / nums.len() as f64;
        let variance =
            nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() - 1) as f64;
        CellValue::number(variance.sqrt())
    }
}

// ---------------------------------------------------------------------------
// DSTDEVP (population standard deviation)
// ---------------------------------------------------------------------------

pub struct FnDstdevp;
impl PureFunction for FnDstdevp {
    fn name(&self) -> &'static str {
        "DSTDEVP"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.is_empty() {
            return CellValue::error_with_message(
                CellError::Div0,
                "DSTDEVP: no numeric values in matching rows",
            );
        }

        let mean = nums.iter().sum::<f64>() / nums.len() as f64;
        let variance = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64;
        CellValue::number(variance.sqrt())
    }
}

// ---------------------------------------------------------------------------
// DVAR (sample variance)
// ---------------------------------------------------------------------------

pub struct FnDvar;
impl PureFunction for FnDvar {
    fn name(&self) -> &'static str {
        "DVAR"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.len() < 2 {
            return CellValue::error_with_message(
                CellError::Div0,
                "DVAR: need at least 2 numeric values for sample variance",
            );
        }

        let mean = nums.iter().sum::<f64>() / nums.len() as f64;
        let variance =
            nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() - 1) as f64;
        CellValue::number(variance)
    }
}

// ---------------------------------------------------------------------------
// DVARP (population variance)
// ---------------------------------------------------------------------------

pub struct FnDvarp;
impl PureFunction for FnDvarp {
    fn name(&self) -> &'static str {
        "DVARP"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let (db, field_idx, criteria) = match parse_db_args(args) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let values = get_matching_values(&db, field_idx, &criteria);
        let nums = extract_matching_numbers(&values);

        if nums.is_empty() {
            return CellValue::error_with_message(
                CellError::Div0,
                "DVARP: no numeric values in matching rows",
            );
        }

        let mean = nums.iter().sum::<f64>() / nums.len() as f64;
        let variance = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64;
        CellValue::number(variance)
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDsum));
    registry.register(Box::new(FnDaverage));
    registry.register(Box::new(FnDcount));
    registry.register(Box::new(FnDcounta));
    registry.register(Box::new(FnDget));
    registry.register(Box::new(FnDmax));
    registry.register(Box::new(FnDmin));
    registry.register(Box::new(FnDproduct));
    registry.register(Box::new(FnDstdev));
    registry.register(Box::new(FnDstdevp));
    registry.register(Box::new(FnDvar));
    registry.register(Box::new(FnDvarp));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    /// Build a database array:
    /// | Name  | Age | Salary |
    /// | Alice | 30  | 50000  |
    /// | Bob   | 25  | 40000  |
    /// | Carol | 30  | 60000  |
    /// | Dave  | 35  | 70000  |
    fn sample_db() -> CellValue {
        CellValue::from_rows(vec![
            vec![text("Name"), text("Age"), text("Salary")],
            vec![text("Alice"), num(30.0), num(50000.0)],
            vec![text("Bob"), num(25.0), num(40000.0)],
            vec![text("Carol"), num(30.0), num(60000.0)],
            vec![text("Dave"), num(35.0), num(70000.0)],
        ])
    }

    /// Criteria: Age = 30
    fn criteria_age_30() -> CellValue {
        CellValue::from_rows(vec![vec![text("Age")], vec![num(30.0)]])
    }

    /// Criteria: Age > 25
    fn criteria_age_gt_25() -> CellValue {
        CellValue::from_rows(vec![vec![text("Age")], vec![text(">25")]])
    }

    /// Criteria: match all (just headers, no conditions)
    fn criteria_all() -> CellValue {
        CellValue::from_rows(vec![vec![text("Age")]])
    }

    #[test]
    fn test_dsum_basic() {
        let f = FnDsum;
        // Sum Salary where Age=30 => 50000+60000=110000
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
        assert_eq!(result, num(110000.0));
    }

    #[test]
    fn test_dsum_field_by_number() {
        let f = FnDsum;
        // Field 3 = Salary, Age=30 => 110000
        let result = f.call(&[sample_db(), num(3.0), criteria_age_30()]);
        assert_eq!(result, num(110000.0));
    }

    #[test]
    fn test_dsum_gt_criteria() {
        let f = FnDsum;
        // Sum Salary where Age>25 => 50000+60000+70000=180000
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_gt_25()]);
        assert_eq!(result, num(180000.0));
    }

    #[test]
    fn test_daverage() {
        let f = FnDaverage;
        // Average Salary where Age=30 => (50000+60000)/2 = 55000
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
        assert_eq!(result, num(55000.0));
    }

    #[test]
    fn test_dcount() {
        let f = FnDcount;
        // Count numeric Salary values where Age=30 => 2
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
        assert_eq!(result, num(2.0));
    }

    #[test]
    fn test_dcounta() {
        let f = FnDcounta;
        // Count non-blank Name values where Age=30 => 2
        let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
        assert_eq!(result, num(2.0));
    }

    #[test]
    fn test_dget_single_match() {
        let f = FnDget;
        // Name where Age=25 => Bob (single match)
        let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(25.0)]]);
        let result = f.call(&[sample_db(), text("Name"), crit]);
        assert_eq!(result, text("Bob"));
    }

    #[test]
    fn test_dget_multiple_matches() {
        let f = FnDget;
        // Name where Age=30 => multiple matches => #NUM!
        let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
        assert_eq!(result, err(CellError::Num));
    }

    #[test]
    fn test_dget_no_match() {
        let f = FnDget;
        // Name where Age=99 => no match => #VALUE!
        let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(99.0)]]);
        let result = f.call(&[sample_db(), text("Name"), crit]);
        assert_eq!(result, err(CellError::Value));
    }

    #[test]
    fn test_dmax() {
        let f = FnDmax;
        // Max Salary where Age=30 => 60000
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
        assert_eq!(result, num(60000.0));
    }

    #[test]
    fn test_dmin() {
        let f = FnDmin;
        // Min Salary where Age=30 => 50000
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
        assert_eq!(result, num(50000.0));
    }

    #[test]
    fn test_dproduct() {
        let f = FnDproduct;
        // Product of Age where Age=30 => 30*30 = 900
        let result = f.call(&[sample_db(), text("Age"), criteria_age_30()]);
        assert_eq!(result, num(900.0));
    }

    #[test]
    fn test_dsum_all_rows() {
        let f = FnDsum;
        // Sum all salaries (criteria with just headers) => 50000+40000+60000+70000=220000
        let result = f.call(&[sample_db(), text("Salary"), criteria_all()]);
        assert_eq!(result, num(220000.0));
    }

    #[test]
    fn test_dstdev() {
        let f = FnDstdev;
        // Sample stdev of Salary where Age>25: [50000, 60000, 70000]
        // mean=60000, deviations: -10000, 0, 10000
        // sum_sq = 2e8, variance = 2e8/2 = 1e8, stdev = 10000
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_gt_25()]);
        assert_eq!(result, num(10000.0));
    }

    #[test]
    fn test_dstdevp() {
        let f = FnDstdevp;
        // Pop stdev of Salary where Age=30: [50000, 60000]
        // mean=55000, deviations: -5000, 5000
        // sum_sq = 5e7, variance = 5e7/2 = 2.5e7, stdev = 5000
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
        assert_eq!(result, num(5000.0));
    }

    #[test]
    fn test_dvar() {
        let f = FnDvar;
        // Sample variance of Salary where Age>25: [50000, 60000, 70000]
        // variance = 1e8
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_gt_25()]);
        assert_eq!(result, num(100000000.0));
    }

    #[test]
    fn test_dvarp() {
        let f = FnDvarp;
        // Pop variance of Salary where Age=30: [50000, 60000]
        // variance = 2.5e7
        let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
        assert_eq!(result, num(25000000.0));
    }

    #[test]
    fn test_or_criteria() {
        let f = FnDsum;
        // OR criteria: Age=25 OR Age=35
        let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(25.0)], vec![num(35.0)]]);
        // Salary where Age=25 OR Age=35 => 40000+70000=110000
        let result = f.call(&[sample_db(), text("Salary"), crit]);
        assert_eq!(result, num(110000.0));
    }

    #[test]
    fn test_and_criteria() {
        let f = FnDsum;
        // AND criteria: Age=30 AND Name=Alice
        let crit = CellValue::from_rows(vec![
            vec![text("Age"), text("Name")],
            vec![num(30.0), text("Alice")],
        ]);
        // Salary where Age=30 AND Name=Alice => 50000
        let result = f.call(&[sample_db(), text("Salary"), crit]);
        assert_eq!(result, num(50000.0));
    }

    #[test]
    fn test_invalid_field() {
        let f = FnDsum;
        let result = f.call(&[sample_db(), text("Nonexistent"), criteria_age_30()]);
        assert_eq!(result, err(CellError::Value));
    }

    #[test]
    fn test_error_propagation() {
        let f = FnDsum;
        let result = f.call(&[err(CellError::Ref), text("Salary"), criteria_age_30()]);
        assert_eq!(result, err(CellError::Ref));
    }

    #[test]
    fn test_dget_multiple_matches_returns_num_error() {
        let f = FnDget;
        // DGET with multiple matches must return #NUM! per Excel spec
        let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
        assert_eq!(result, err(CellError::Num));
    }

    #[test]
    fn test_dsum_wildcard_star() {
        let f = FnDsum;
        // Wildcard "A*" should match "Alice" and "Anna" but not "Bob"
        let db = CellValue::from_rows(vec![
            vec![text("Name"), text("Score")],
            vec![text("Alice"), num(10.0)],
            vec![text("Anna"), num(20.0)],
            vec![text("Bob"), num(30.0)],
        ]);
        let crit = CellValue::from_rows(vec![vec![text("Name")], vec![text("A*")]]);
        let result = f.call(&[db, text("Score"), crit]);
        assert_eq!(result, num(30.0)); // 10 + 20
    }

    #[test]
    fn test_dcount_wildcard_question_mark() {
        let f = FnDcount;
        // Wildcard "?ob" should match "Bob" and "Rob" but not "Alice"
        let db = CellValue::from_rows(vec![
            vec![text("Name"), text("Score")],
            vec![text("Bob"), num(10.0)],
            vec![text("Rob"), num(20.0)],
            vec![text("Alice"), num(30.0)],
        ]);
        let crit = CellValue::from_rows(vec![vec![text("Name")], vec![text("?ob")]]);
        let result = f.call(&[db, text("Score"), crit]);
        assert_eq!(result, num(2.0)); // Bob and Rob matched, both have numeric Score
    }

    #[test]
    fn test_dget_zero_matches_returns_value_error() {
        let f = FnDget;
        // DGET with 0 matches must return #VALUE! per Excel spec
        let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(999.0)]]);
        let result = f.call(&[sample_db(), text("Name"), crit]);
        assert_eq!(result, err(CellError::Value));
    }

    #[test]
    fn test_dget_two_plus_matches_returns_num_error() {
        let f = FnDget;
        // DGET with 2+ matches must return #NUM! per Excel spec
        // Age=30 matches Alice and Carol
        let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
        assert_eq!(result, err(CellError::Num));
    }

    #[test]
    fn test_header_only_database() {
        let f = FnDsum;
        // Header-only database (no data rows) should return 0 for DSUM
        let db = CellValue::from_rows(vec![vec![text("Name"), text("Score")]]);
        let crit = CellValue::from_rows(vec![vec![text("Name")], vec![text("Alice")]]);
        let result = f.call(&[db, text("Score"), crit]);
        assert_eq!(result, num(0.0));
    }
}

// ---------------------------------------------------------------------------
// Function structs for registration (used by mod.rs):
// FnDsum, FnDaverage, FnDcount, FnDcounta, FnDget, FnDmax, FnDmin,
// FnDproduct, FnDstdev, FnDstdevp, FnDvar, FnDvarp
// ---------------------------------------------------------------------------
