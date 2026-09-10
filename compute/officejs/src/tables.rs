use std::collections::HashMap;

use compute_api::{Sheet, SheetId, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{range_navigation::parse_range_address, worksheets};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TableError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TableRangeKind {
    Full,
    Header,
    DataBody,
    Total,
}

impl TableRangeKind {
    pub(crate) fn from_wire(value: &str) -> Result<Self, TableError> {
        match value {
            "full" => Ok(Self::Full),
            "header" => Ok(Self::Header),
            "dataBody" => Ok(Self::DataBody),
            "total" | "totals" => Ok(Self::Total),
            _ => Err(invalid(format!("Unsupported table range kind '{value}'"))),
        }
    }
}

/// A host proxy anchored to the engine's stable table ID.
///
/// Names are deliberately not cached: every operation resolves the current
/// canonical table by ID, so a proxy remains usable after `Table.name` changes.
#[derive(Clone)]
pub(crate) struct TableRef {
    sheet: Sheet,
    stable_id: String,
}

/// One table item in a `TableCollection` hydration response.
///
/// The JavaScript collection adapter uses `key` to enter the normal
/// `TableCollection.getItem` path.  The worksheet ID is descriptor metadata
/// for workbook-scoped collections; it is intentionally not exposed as a
/// table property.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TableCollectionItem {
    pub(crate) key: String,
    pub(crate) worksheet_id: String,
    pub(crate) properties: HashMap<String, Value>,
}

/// Resolve the worksheet used by `TableCollection.add` and validate its source
/// address.  A worksheet-scoped collection takes precedence over every address
/// qualifier.  For workbook-scoped string addresses, a quoted or unquoted
/// worksheet qualifier selects that worksheet; an unqualified address uses the
/// persisted active worksheet.  A workbook-scoped Range overload supplies its
/// originating worksheet through `range_sheet`.
pub(crate) fn resolve_table_add_source(
    workbook: &Workbook,
    worksheet_scope: Option<Sheet>,
    range_sheet: Option<Sheet>,
    address: &str,
) -> Result<Sheet, TableError> {
    let sheet = if let Some(sheet) = worksheet_scope {
        sheet
    } else if let Some(sheet) = range_sheet {
        sheet
    } else if let Some(name) = qualified_sheet_name(address)? {
        worksheets::get_item(workbook, &name)
            .map_err(worksheet_error)?
            .sheet()
    } else {
        worksheets::active(workbook)
            .map_err(worksheet_error)?
            .sheet()
    };

    parse_range_address(&sheet, address).map_err(range_navigation)?;
    Ok(sheet)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableState {
    id: String,
    name: String,
    range: TableRangeState,
    has_header_row: bool,
    has_totals_row: bool,
    style: String,
    #[serde(default)]
    banded_rows: bool,
    #[serde(default)]
    banded_columns: bool,
    #[serde(default)]
    emphasize_first_column: bool,
    #[serde(default)]
    emphasize_last_column: bool,
    #[serde(default)]
    show_filter_buttons: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableRangeState {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

impl TableRef {
    pub(crate) fn add(
        workbook: &Workbook,
        sheet: Sheet,
        address: &str,
        has_headers: bool,
    ) -> Result<Self, TableError> {
        let range = parse_range_address(&sheet, address).map_err(range_navigation)?;
        if range.is_whole_sheet() || range.is_entire_row() || range.is_entire_column() {
            return Err(invalid(format!(
                "Table.add requires a bounded range: '{address}'"
            )));
        }
        let (start_row, start_col, end_row, end_col) = range.bounds();

        for existing in sheet.tables().get_all().map_err(engine)? {
            let existing = decode_table(existing)?;
            if ranges_overlap(start_row, start_col, end_row, end_col, &existing.range) {
                return Err(invalid(format!(
                    "A table cannot overlap the existing table '{}'.",
                    existing.name
                )));
            }
        }

        let name = unique_table_name(workbook)?;
        let (effective_end_row, effective_has_headers, columns) = if has_headers {
            (end_row, true, Vec::new())
        } else {
            let effective_end_row = end_row.checked_add(1).ok_or_else(|| {
                invalid("A generated table header would exceed the worksheet row limit".to_string())
            })?;
            if effective_end_row >= 1_048_576 {
                return Err(invalid(
                    "A generated table header would exceed the worksheet row limit".to_string(),
                ));
            }
            let column_count = end_col - start_col + 1;
            let columns: Vec<String> = (1..=column_count)
                .map(|index| format!("Column{index}"))
                .collect();

            // `hasHeaders` describes the source data, not the resulting table's
            // header visibility. Excel inserts a worksheet row, moves the source
            // data down, and creates visible ColumnN headings.
            sheet
                .structure()
                .insert_rows(start_row, 1)
                .map_err(engine)?;
            let header_address = a1_range(start_row, start_col, start_row, end_col);
            sheet
                .set_range(header_address.as_str(), &[columns.clone()])
                .map_err(engine)?;
            (effective_end_row, true, columns)
        };
        sheet
            .tables()
            .create(
                &name,
                start_row,
                start_col,
                effective_end_row,
                end_col,
                columns,
                effective_has_headers,
            )
            .map_err(engine)?;
        Self::get_item(sheet, &name)
    }

    pub(crate) fn get_item(sheet: Sheet, key: &str) -> Result<Self, TableError> {
        let table = sheet
            .tables()
            .get_all()
            .map_err(engine)?
            .into_iter()
            .find(|table| {
                table.id.eq_ignore_ascii_case(key) || table.name.eq_ignore_ascii_case(key)
            })
            .ok_or_else(|| item_not_found(key))?;
        Ok(Self {
            sheet,
            stable_id: table.id,
        })
    }

    /// Resolve a table by name or stable ID across all worksheets.
    pub(crate) fn get_item_in_workbook(workbook: &Workbook, key: &str) -> Result<Self, TableError> {
        let table = workbook
            .get_all_tables()
            .map_err(engine)?
            .into_iter()
            .find(|entry| {
                entry.table.id.eq_ignore_ascii_case(key)
                    || entry.table.name.eq_ignore_ascii_case(key)
            })
            .ok_or_else(|| item_not_found(key))?;
        let sheet_id = SheetId::from_uuid_str(&table.sheet_id).map_err(engine)?;
        let sheet = workbook.sheet(&sheet_id).map_err(engine)?;
        Ok(Self {
            sheet,
            stable_id: table.table.id,
        })
    }

    /// Resolve a table by zero-based position in a worksheet collection.
    pub(crate) fn get_item_at(sheet: Sheet, index: i64) -> Result<Self, TableError> {
        let tables = sheet.tables().get_all().map_err(engine)?;
        let index = checked_collection_index(index, tables.len(), "table")?;
        Ok(Self {
            sheet,
            stable_id: tables[index].id.clone(),
        })
    }

    /// Resolve a table by zero-based position in a workbook collection.
    pub(crate) fn get_item_at_in_workbook(
        workbook: &Workbook,
        index: i64,
    ) -> Result<Self, TableError> {
        let tables = workbook.get_all_tables().map_err(engine)?;
        let index = checked_collection_index(index, tables.len(), "table")?;
        let table = &tables[index];
        let sheet_id = SheetId::from_uuid_str(&table.sheet_id).map_err(engine)?;
        Ok(Self {
            sheet: workbook.sheet(&sheet_id).map_err(engine)?,
            stable_id: table.table.id.clone(),
        })
    }

    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, TableError> {
        let table = self.resolve()?;
        load_table_properties(&table, properties)
    }

    /// Delete the table while preserving its cell contents as normal cells.
    pub(crate) fn delete(&self) -> Result<(), TableError> {
        let table = self.resolve()?;
        self.sheet.tables().delete(&table.name).map_err(engine)?;
        Ok(())
    }

    /// Convert the table to a normal range and return its former full range.
    pub(crate) fn convert_to_range(&self) -> Result<String, TableError> {
        let address = self.range_address(TableRangeKind::Full)?;
        let table = self.resolve()?;
        self.sheet
            .tables()
            .convert_to_range(&table.name)
            .map_err(engine)?;
        Ok(address)
    }

    /// Resize the table from an A1 address on its worksheet.
    pub(crate) fn resize(&self, address: &str) -> Result<(), TableError> {
        let range = parse_range_address(&self.sheet, address).map_err(range_navigation)?;
        if range.is_whole_sheet() || range.is_entire_row() || range.is_entire_column() {
            return Err(invalid(
                "Table.resize requires a bounded range address".to_string(),
            ));
        }
        let (start_row, start_col, end_row, end_col) = range.bounds();
        self.resize_bounds(start_row, start_col, end_row, end_col)
    }

    /// Resize the table to already-resolved zero-based bounds.
    ///
    /// The Office.js contract requires the new range to overlap the old
    /// range and to keep its top row fixed.  Validate those constraints here,
    /// before delegating the persisted mutation to compute-api.
    pub(crate) fn resize_bounds(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(), TableError> {
        if start_row > end_row || start_col > end_col {
            return Err(invalid(
                "Table.resize requires a non-empty range".to_string(),
            ));
        }

        let table = self.resolve()?;
        if start_row != table.range.start_row
            || !ranges_overlap(start_row, start_col, end_row, end_col, &table.range)
        {
            return Err(invalid(
                "The new table range must overlap the existing range and keep the same top row"
                    .to_string(),
            ));
        }

        for existing in self.sheet.tables().get_all().map_err(engine)? {
            let existing = decode_table(existing)?;
            if existing.id != table.id
                && ranges_overlap(start_row, start_col, end_row, end_col, &existing.range)
            {
                return Err(invalid(format!(
                    "A table cannot overlap the existing table '{}'.",
                    existing.name
                )));
            }
        }

        self.sheet
            .tables()
            .resize(&table.name, start_row, start_col, end_row, end_col)
            .map_err(engine)?;
        Ok(())
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), TableError> {
        let table = self.resolve()?;
        match property {
            "name" => {
                let name = required_string(value, "Table.name")?;
                self.sheet
                    .tables()
                    .rename(&table.name, name)
                    .map_err(engine)?;
            }
            "style" => {
                let style = value
                    .as_str()
                    .ok_or_else(|| invalid("Table.style must be a string".to_string()))?;
                self.sheet
                    .tables()
                    .set_style(&table.name, style)
                    .map_err(engine)?;
            }
            "showHeaders" => {
                let requested = required_bool(value, "Table.showHeaders")?;
                if requested != table.has_header_row {
                    self.sheet
                        .tables()
                        .toggle_header_row(&table.name)
                        .map_err(engine)?;
                }
            }
            "showTotals" => {
                let requested = required_bool(value, "Table.showTotals")?;
                if requested != table.has_totals_row {
                    self.sheet
                        .tables()
                        .toggle_totals_row(&table.name)
                        .map_err(engine)?;
                }
            }
            "showBandedRows" => {
                let requested = required_bool(value, "Table.showBandedRows")?;
                if requested != table.banded_rows {
                    self.sheet
                        .tables()
                        .set_bool_option(&table.name, "bandedRows", requested)
                        .map_err(engine)?;
                }
            }
            "showBandedColumns" => {
                let requested = required_bool(value, "Table.showBandedColumns")?;
                if requested != table.banded_columns {
                    self.sheet
                        .tables()
                        .set_bool_option(&table.name, "bandedColumns", requested)
                        .map_err(engine)?;
                }
            }
            "highlightFirstColumn" => {
                let requested = required_bool(value, "Table.highlightFirstColumn")?;
                if requested != table.emphasize_first_column {
                    self.sheet
                        .tables()
                        .set_bool_option(&table.name, "emphasizeFirstColumn", requested)
                        .map_err(engine)?;
                }
            }
            "highlightLastColumn" => {
                let requested = required_bool(value, "Table.highlightLastColumn")?;
                if requested != table.emphasize_last_column {
                    self.sheet
                        .tables()
                        .set_bool_option(&table.name, "emphasizeLastColumn", requested)
                        .map_err(engine)?;
                }
            }
            "showFilterButton" => {
                let requested = required_bool(value, "Table.showFilterButton")?;
                if !table.has_header_row {
                    return Err(invalid(
                        "Table.showFilterButton requires a table header row".to_string(),
                    ));
                }
                if requested != table.show_filter_buttons {
                    self.sheet
                        .tables()
                        .set_bool_option(&table.name, "showFilterButtons", requested)
                        .map_err(engine)?;
                }
            }
            other => {
                return Err(TableError {
                    code: "InvalidArgument",
                    message: format!("Table.{other} is read-only or unsupported"),
                });
            }
        }
        Ok(())
    }

    pub(crate) fn range_address(&self, kind: TableRangeKind) -> Result<String, TableError> {
        let table = self.resolve()?;
        let (start_row, start_col, end_row, end_col) = match kind {
            TableRangeKind::Full => (
                table.range.start_row,
                table.range.start_col,
                table.range.end_row,
                table.range.end_col,
            ),
            TableRangeKind::Header if table.has_header_row => (
                table.range.start_row,
                table.range.start_col,
                table.range.start_row,
                table.range.end_col,
            ),
            TableRangeKind::Header => {
                return Err(TableError {
                    code: "ItemNotFound",
                    message: "The table does not have a header row.".to_string(),
                });
            }
            TableRangeKind::Total if table.has_totals_row => (
                table.range.end_row,
                table.range.start_col,
                table.range.end_row,
                table.range.end_col,
            ),
            TableRangeKind::Total => {
                return Err(TableError {
                    code: "ItemNotFound",
                    message: "The table does not have a totals row.".to_string(),
                });
            }
            TableRangeKind::DataBody => {
                let start_row = table.range.start_row + u32::from(table.has_header_row);
                let Some(end_row) = table
                    .range
                    .end_row
                    .checked_sub(u32::from(table.has_totals_row))
                else {
                    return Err(TableError {
                        code: "ItemNotFound",
                        message: "The table does not have a data body range.".to_string(),
                    });
                };
                if start_row > end_row {
                    return Err(TableError {
                        code: "ItemNotFound",
                        message: "The table does not have a data body range.".to_string(),
                    });
                }
                (
                    start_row,
                    table.range.start_col,
                    end_row,
                    table.range.end_col,
                )
            }
        };
        Ok(a1_range(start_row, start_col, end_row, end_col))
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    fn resolve(&self) -> Result<TableState, TableError> {
        let table = self
            .sheet
            .tables()
            .get_all()
            .map_err(engine)?
            .into_iter()
            .find(|table| table.id == self.stable_id)
            .ok_or_else(|| item_not_found(&self.stable_id))?;
        decode_table(table)
    }
}

/// Load the scalar properties supported by the Office.js table adapter.
pub(crate) fn load_table_properties(
    table: &TableState,
    properties: &[String],
) -> Result<HashMap<String, Value>, TableError> {
    let defaults = [
        "id",
        "name",
        "style",
        "showHeaders",
        "showTotals",
        "highlightFirstColumn",
        "highlightLastColumn",
        "showBandedRows",
        "showBandedColumns",
        "showFilterButton",
    ];
    let properties: Vec<&str> = if properties.is_empty() {
        defaults.to_vec()
    } else {
        properties.iter().map(String::as_str).collect()
    };
    let mut result = HashMap::new();
    for property in properties {
        let value = match property {
            "id" => Value::String(table.id.clone()),
            "name" => Value::String(table.name.clone()),
            "style" => Value::String(table.style.clone()),
            "showHeaders" => Value::Bool(table.has_header_row),
            "showTotals" => Value::Bool(table.has_totals_row),
            "highlightFirstColumn" => Value::Bool(table.emphasize_first_column),
            "highlightLastColumn" => Value::Bool(table.emphasize_last_column),
            "showBandedRows" => Value::Bool(table.banded_rows),
            "showBandedColumns" => Value::Bool(table.banded_columns),
            "showFilterButton" => Value::Bool(table.show_filter_buttons),
            "isNullObject" => Value::Bool(false),
            other => {
                return Err(TableError {
                    code: "InvalidArgument",
                    message: format!("Table.{other} is not supported by this Office.js host"),
                });
            }
        };
        result.insert(property.to_string(), value);
    }
    Ok(result)
}

/// Return table collection items for a worksheet or for the whole workbook.
///
/// `properties` contains scalar properties requested for each item.  An empty
/// list uses the collection's default scalar projection.
pub(crate) fn collection_items(
    workbook: &Workbook,
    worksheet: Option<&Sheet>,
    properties: &[String],
) -> Result<Vec<TableCollectionItem>, TableError> {
    let mut result = Vec::new();
    if let Some(sheet) = worksheet {
        for table in sheet.tables().get_all().map_err(engine)? {
            let state = decode_table(table)?;
            result.push(TableCollectionItem {
                key: state.id.clone(),
                worksheet_id: sheet.id().to_uuid_string(),
                properties: load_table_properties(&state, properties)?,
            });
        }
        return Ok(result);
    }

    for entry in workbook.get_all_tables().map_err(engine)? {
        let sheet_id = entry.sheet_id.clone();
        let state = decode_table(entry.table)?;
        result.push(TableCollectionItem {
            key: state.id.clone(),
            worksheet_id: sheet_id,
            properties: load_table_properties(&state, properties)?,
        });
    }
    Ok(result)
}

fn unique_table_name(workbook: &Workbook) -> Result<String, TableError> {
    let existing = workbook.get_all_tables().map_err(engine)?;
    for suffix in 1..10_000 {
        let candidate = format!("Table{suffix}");
        if existing
            .iter()
            .all(|entry| !entry.table.name.eq_ignore_ascii_case(&candidate))
        {
            return Ok(candidate);
        }
    }
    Err(TableError {
        code: "GeneralException",
        message: "Unable to generate a unique table name".to_string(),
    })
}

fn required_string<'a>(value: &'a Value, property: &str) -> Result<&'a str, TableError> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("{property} must be a non-empty string")))
}

fn required_bool(value: &Value, property: &str) -> Result<bool, TableError> {
    value
        .as_bool()
        .ok_or_else(|| invalid(format!("{property} must be a boolean")))
}

fn checked_collection_index(index: i64, length: usize, kind: &str) -> Result<usize, TableError> {
    if index < 0 {
        return Err(invalid(format!(
            "TableCollection.getItemAt {kind} index must be non-negative"
        )));
    }
    let index = usize::try_from(index).map_err(|_| {
        invalid(format!(
            "TableCollection.getItemAt {kind} index is outside the supported range"
        ))
    })?;
    if index >= length {
        return Err(item_not_found(&format!("{kind} index {index}")));
    }
    Ok(index)
}

fn item_not_found(key: &str) -> TableError {
    TableError {
        code: "ItemNotFound",
        message: format!("The requested table doesn't exist. Name or ID: {key}"),
    }
}

fn invalid(message: String) -> TableError {
    TableError {
        code: "InvalidArgument",
        message,
    }
}

fn engine(error: impl std::fmt::Display) -> TableError {
    TableError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn range_navigation(error: crate::range_navigation::RangeNavigationError) -> TableError {
    TableError {
        code: error.code,
        message: error.message,
    }
}

fn worksheet_error(error: crate::worksheets::WorksheetError) -> TableError {
    TableError {
        code: error.code,
        message: error.message,
    }
}

fn qualified_sheet_name(raw: &str) -> Result<Option<String>, TableError> {
    let raw = raw.trim();
    let Some(separator) = raw.rfind('!') else {
        return Ok(None);
    };

    let qualifier = raw[..separator].trim();
    let reference = raw[separator + 1..].trim();
    if qualifier.is_empty() || reference.is_empty() {
        return Err(invalid(format!(
            "Invalid sheet-qualified range address '{raw}'"
        )));
    }

    let name = if qualifier.len() >= 2 && qualifier.starts_with('\'') && qualifier.ends_with('\'') {
        qualifier[1..qualifier.len() - 1].replace("''", "'")
    } else if qualifier
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '.')
    {
        qualifier.to_string()
    } else {
        return Err(invalid(format!(
            "Invalid worksheet qualifier in range address '{raw}'"
        )));
    };

    if name.is_empty() {
        return Err(invalid(format!(
            "Invalid worksheet qualifier in range address '{raw}'"
        )));
    }
    Ok(Some(name))
}

fn encoding(error: serde_json::Error) -> TableError {
    TableError {
        code: "GeneralException",
        message: format!("Failed to encode table state: {error}"),
    }
}

fn decode_table(table: impl serde::Serialize) -> Result<TableState, TableError> {
    let value = serde_json::to_value(table).map_err(encoding)?;
    serde_json::from_value(value).map_err(encoding)
}

fn ranges_overlap(
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    existing: &TableRangeState,
) -> bool {
    start_row <= existing.end_row
        && end_row >= existing.start_row
        && start_col <= existing.end_col
        && end_col >= existing.start_col
}

fn a1_range(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    let start = format!("{}{}", column_name(start_col), start_row + 1);
    let end = format!("{}{}", column_name(end_col), end_row + 1);
    if start == end {
        start
    } else {
        format!("{start}:{end}")
    }
}

fn column_name(mut column: u32) -> String {
    let mut reversed = Vec::new();
    loop {
        reversed.push((b'A' + (column % 26) as u8) as char);
        column /= 26;
        if column == 0 {
            break;
        }
        column -= 1;
    }
    reversed.into_iter().rev().collect()
}
