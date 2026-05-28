use value_types::CellValue;

/// Parsed database: headers (lowercase) and data rows.
pub(super) struct Database {
    pub(super) headers: Vec<String>,
    pub(super) data: Vec<Vec<CellValue>>,
}

/// Parsed criteria: field names (lowercase) and condition rows.
pub(super) struct Criteria {
    pub(super) fields: Vec<String>,
    pub(super) conditions: Vec<Vec<CellValue>>,
}
