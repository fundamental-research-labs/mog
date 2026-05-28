use super::super::types::{Table, TableBoolOption};

/// Set a boolean table display option.
pub fn set_table_option(table: &Table, option: TableBoolOption, value: bool) -> Table {
    let mut result = table.clone();
    match option {
        TableBoolOption::BandedRows => result.banded_rows = value,
        TableBoolOption::BandedColumns => result.banded_columns = value,
        TableBoolOption::EmphasizeFirstColumn => result.emphasize_first_column = value,
        TableBoolOption::EmphasizeLastColumn => result.emphasize_last_column = value,
        TableBoolOption::ShowFilterButtons => result.show_filter_buttons = value,
    }
    result
}

/// Set the table style.
pub fn set_table_style(table: &Table, style_id: &str) -> Table {
    let mut result = table.clone();
    result.style = style_id.to_string();
    result
}
