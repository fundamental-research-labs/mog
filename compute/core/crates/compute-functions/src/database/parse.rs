use value_types::{CellError, CellValue};

use super::model::{Criteria, Database};

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
        vec![vec![]]
    };

    Ok(Criteria { fields, conditions })
}

/// Find the field index by name (text) or 1-indexed column number.
fn find_field_index(headers: &[String], field: &CellValue) -> Result<usize, CellError> {
    match field {
        CellValue::Error(e, _) => Err(*e),
        CellValue::Number(n) => {
            let idx = n.get() as i64 - 1;
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

/// Parse the 3 standard database arguments: (database, field, criteria).
/// Returns (Database, field_index, Criteria) or an error CellValue.
pub(super) fn parse_db_args(args: &[CellValue]) -> Result<(Database, usize, Criteria), CellValue> {
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
