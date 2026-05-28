use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetProtection {
    pub is_protected: bool,
    /// Legacy OOXML `password` hash.
    pub password_hash: Option<String>,
    /// Modern OOXML `hashValue`.
    pub hash_value: Option<String>,
    pub algorithm_name: Option<String>,
    pub salt_value: Option<String>,
    pub spin_count: Option<u32>,
    pub select_locked: bool,
    pub select_unlocked: bool,
    pub format_cells: bool,
    pub format_columns: bool,
    pub format_rows: bool,
    pub insert_columns: bool,
    pub insert_rows: bool,
    pub insert_hyperlinks: bool,
    pub delete_columns: bool,
    pub delete_rows: bool,
    pub sort: bool,
    pub auto_filter: bool,
    pub pivot_tables: bool,
    pub objects: bool,
    pub scenarios: bool,
}

impl Default for SheetProtection {
    fn default() -> Self {
        Self {
            is_protected: false,
            password_hash: None,
            hash_value: None,
            algorithm_name: None,
            salt_value: None,
            spin_count: None,
            select_locked: true,
            select_unlocked: true,
            format_cells: false,
            format_columns: false,
            format_rows: false,
            insert_columns: false,
            insert_rows: false,
            insert_hyperlinks: false,
            delete_columns: false,
            delete_rows: false,
            sort: false,
            auto_filter: false,
            pivot_tables: false,
            objects: false,
            scenarios: false,
        }
    }
}

// WorkbookProtection has moved to domain::workbook (full 15-field OOXML version).
