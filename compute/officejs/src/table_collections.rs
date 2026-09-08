//! Office.js table row and column collections.
//!
//! The table object itself lives in [`crate::tables`].  This module keeps the
//! collection and child-object adapters separate so that a child proxy can be
//! bound to a stable table-column id or to a positional table-row index.  All
//! range and mutation work is delegated to `compute-api`; this module only
//! translates the Office.js object model to the sheet/table API.

use std::collections::HashMap;

use compute_api::{CellAddress, CellRange, Sheet, mutation::CellInput};
use serde::Deserialize;
use serde_json::{Value, json};
use value_types::CellValue;

use crate::tables::{TableError, TableRangeKind, TableRef};

/// Errors returned by the collection adapters and mapped to Rich API errors
/// by the Office host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TableCollectionError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// The two child collections exposed by `Excel.Table`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TableCollectionKind {
    Rows,
    Columns,
}

impl TableCollectionKind {
    pub(crate) fn from_wire(value: &str) -> Result<Self, TableCollectionError> {
        match value {
            "rows" => Ok(Self::Rows),
            "columns" => Ok(Self::Columns),
            _ => Err(invalid(format!(
                "Unsupported table collection kind '{value}'"
            ))),
        }
    }
}

/// The table ranges reachable from a column object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TableColumnRangeKind {
    Full,
    Header,
    DataBody,
    Total,
}

impl TableColumnRangeKind {
    pub(crate) fn from_wire(value: &str) -> Result<Self, TableCollectionError> {
        match value {
            "full" => Ok(Self::Full),
            "header" => Ok(Self::Header),
            "dataBody" => Ok(Self::DataBody),
            "total" | "totals" => Ok(Self::Total),
            _ => Err(invalid(format!(
                "Unsupported table column range kind '{value}'"
            ))),
        }
    }
}

/// One item in a collection-load response.
///
/// The Office.js bootstrap owns client proxy allocation.  The host sends a
/// stable selector plus the properties requested for that item; the bootstrap
/// calls the normal child `getItem` binding path and seeds those properties.
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct CollectionItem {
    pub(crate) key: String,
    pub(crate) properties: HashMap<String, Value>,
}

#[derive(Clone)]
pub(crate) struct TableRowAddResult {
    pub(crate) row: TableRowRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableCollectionState {
    id: String,
    name: String,
    range: TableCollectionRange,
    has_header_row: bool,
    has_totals_row: bool,
    #[serde(default)]
    columns: Vec<TableCollectionColumn>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TableCollectionRange {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableCollectionColumn {
    id: String,
    name: String,
    index: u32,
    #[serde(default)]
    calculated_formula: Option<String>,
    #[serde(default)]
    ooxml_column_id: Option<u32>,
}

/// A column child proxy bound to the canonical column id.
#[derive(Clone)]
pub(crate) struct TableColumnRef {
    table: TableRef,
    column_id: String,
}

impl TableColumnRef {
    pub(crate) fn new(table: TableRef, column_id: String) -> Self {
        Self { table, column_id }
    }

    pub(crate) fn key(&self) -> &str {
        &self.column_id
    }

    pub(crate) fn table(&self) -> TableRef {
        self.table.clone()
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.table.sheet()
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, TableCollectionError> {
        let table = resolve_table(&self.table)?;
        let column = resolve_column_by_id(&table, &self.column_id)?;
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => Value::Bool(false),
                "id" => json!(public_column_id(column)),
                "index" => json!(column.index),
                "name" => Value::String(column.name.clone()),
                "values" => column_values(&self.sheet(), &table, column.index)?,
                "valuesAsJson" | "valuesAsJsonLocal" => {
                    return Err(unsupported(property, "TableColumn"));
                }
                other => return Err(unsupported(other, "TableColumn")),
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), TableCollectionError> {
        let table = resolve_table(&self.table)?;
        let column = resolve_column_by_id(&table, &self.column_id)?;
        match property {
            "name" => {
                let name = required_name(value, "TableColumn.name")?;
                self.sheet()
                    .tables()
                    .rename_column(&table.name, column.index, name)
                    .map_err(engine)?;
            }
            "values" => {
                let (row_count, _) = data_dimensions(&table);
                let grid = table_value_grid(value, row_count as usize, 1, "TableColumn.values")?;
                if row_count > 0 {
                    let range =
                        range_for_column(&table, column.index, TableColumnRangeKind::DataBody)?;
                    self.sheet()
                        .set_range_typed(range.as_str(), &grid)
                        .map_err(engine)?;
                }
            }
            "id" | "index" => return Err(read_only(property, "TableColumn")),
            "valuesAsJson" | "valuesAsJsonLocal" => {
                return Err(unsupported(property, "TableColumn"));
            }
            other => return Err(unsupported(other, "TableColumn")),
        }
        Ok(())
    }

    pub(crate) fn delete(&self) -> Result<(), TableCollectionError> {
        let table = resolve_table(&self.table)?;
        let column = resolve_column_by_id(&table, &self.column_id)?;
        if table.columns.len() <= 1 {
            return Err(invalid(
                "A table must retain at least one column".to_string(),
            ));
        }
        let deleted_column = table.range.start_col + column.index;
        // Remove the physical worksheet column first. The structural metadata
        // pass then keeps the table alive and moves its range with the cells;
        // doing the metadata contraction first would make a first-column
        // delete look like the entire (already contracted) table was deleted.
        self.sheet()
            .structure()
            .delete_columns(deleted_column, 1)
            .map_err(engine)?;
        self.sheet()
            .tables()
            .remove_column(&table.name, column.index)
            .map_err(engine)?;
        // The table metadata API contracts the table definition but leaves
        // worksheet cells in place. The structural delete above moved cells,
        // formulas, and neighboring columns together; resize restores the
        // intended range after the metadata contraction.
        self.sheet()
            .tables()
            .resize(
                &table.name,
                table.range.start_row,
                table.range.start_col,
                table.range.end_row,
                table.range.end_col - 1,
            )
            .map_err(engine)?;
        Ok(())
    }

    pub(crate) fn range_address(
        &self,
        kind: TableColumnRangeKind,
    ) -> Result<String, TableCollectionError> {
        let table = resolve_table(&self.table)?;
        let column = resolve_column_by_id(&table, &self.column_id)?;
        range_for_column(&table, column.index, kind)
    }
}

/// A row child proxy bound to a physical table-row position.
///
/// `relative_index` intentionally remains positional.  Inserting a row before
/// this proxy changes the data at that position, matching the Office.js
/// contract that a `TableRow` represents a physical location rather than a
/// logical record.
#[derive(Clone)]
pub(crate) struct TableRowRef {
    table: TableRef,
    relative_index: u32,
    /// Rows created with `alwaysInsert:false` are written below the table and
    /// therefore do not participate in the table's data-body range.
    fixed_row: Option<u32>,
}

impl TableRowRef {
    pub(crate) fn new(table: TableRef, relative_index: u32) -> Self {
        Self {
            table,
            relative_index,
            fixed_row: None,
        }
    }

    fn fixed(table: TableRef, relative_index: u32, absolute_row: u32) -> Self {
        Self {
            table,
            relative_index,
            fixed_row: Some(absolute_row),
        }
    }

    pub(crate) fn index(&self) -> u32 {
        self.relative_index
    }

    pub(crate) fn table(&self) -> TableRef {
        self.table.clone()
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.table.sheet()
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, TableCollectionError> {
        let table = resolve_table(&self.table)?;
        let mut result = HashMap::new();
        let bounds = self.row_bounds(&table)?;
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => Value::Bool(false),
                "index" => json!(self.relative_index),
                "values" => range_values(&self.sheet(), bounds)?,
                "valuesAsJson" | "valuesAsJsonLocal" => {
                    return Err(unsupported(property, "TableRow"));
                }
                other => return Err(unsupported(other, "TableRow")),
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), TableCollectionError> {
        let table = resolve_table(&self.table)?;
        let bounds = self.row_bounds(&table)?;
        match property {
            "values" => {
                let row_width = bounds.3 - bounds.1 + 1;
                let grid = table_value_grid(value, 1, row_width as usize, "TableRow.values")?;
                self.sheet()
                    .set_range_typed(
                        a1_range(bounds.0, bounds.1, bounds.2, bounds.3).as_str(),
                        &grid,
                    )
                    .map_err(engine)?;
            }
            "index" => return Err(read_only(property, "TableRow")),
            "valuesAsJson" | "valuesAsJsonLocal" => {
                return Err(unsupported(property, "TableRow"));
            }
            other => return Err(unsupported(other, "TableRow")),
        }
        Ok(())
    }

    pub(crate) fn delete(&self) -> Result<(), TableCollectionError> {
        if self.fixed_row.is_some() {
            return Err(invalid(
                "A row created with alwaysInsert=false is outside the table and cannot be deleted through TableRow.delete()".to_string(),
            ));
        }
        let table = resolve_table(&self.table)?;
        ensure_rows_not_filtered(&self.table, &table)?;
        let (data_start, data_end) = data_row_bounds(&table)
            .ok_or_else(|| item_not_found_error("The table does not have a data body range"))?;
        let data_count = data_end - data_start + 1;
        if self.relative_index >= data_count {
            return item_not_found(format!("Table row index {}", self.relative_index));
        }
        if data_count <= 1 {
            return invalid_result("A table must retain at least one data row");
        }
        delete_table_row(&self.table, &table, data_start + self.relative_index)
    }

    pub(crate) fn range_address(&self) -> Result<String, TableCollectionError> {
        let table = resolve_table(&self.table)?;
        let bounds = self.row_bounds(&table)?;
        Ok(a1_range(bounds.0, bounds.1, bounds.2, bounds.3))
    }

    fn row_bounds(
        &self,
        table: &TableCollectionState,
    ) -> Result<(u32, u32, u32, u32), TableCollectionError> {
        let row = match self.fixed_row {
            Some(row) => row,
            None => {
                let (start, end) = data_row_bounds(table).ok_or_else(|| {
                    item_not_found_error("The table does not have a data body range")
                })?;
                if self.relative_index > end - start {
                    return item_not_found(format!("Table row index {}", self.relative_index));
                }
                start + self.relative_index
            }
        };
        Ok((row, table.range.start_col, row, table.range.end_col))
    }
}

/// Load a table's rows or columns collection.
///
/// `properties` accepts the normal Office load paths (`count`, `items`, and
/// `items/<property>`).  The returned map is ready to merge into the host's
/// generic `loaded[objectId]` response.
pub(crate) fn load_collection(
    table_ref: &TableRef,
    kind: TableCollectionKind,
    properties: &[String],
) -> Result<HashMap<String, Value>, TableCollectionError> {
    let table = resolve_table(table_ref)?;
    let mut result = HashMap::new();
    let mut item_properties = Vec::new();
    let mut load_items = false;
    let mut load_default_items = false;

    for property in properties {
        match property.as_str() {
            // Collections are ordinary, non-nullable client objects.  Keep
            // the inherited ClientObject null-object probe loadable even
            // though it is not part of the collection's toJSON data shape.
            "isNullObject" => {
                result.insert(property.clone(), Value::Bool(false));
            }
            "count" => {
                result.insert("count".to_string(), json!(collection_count(&table, kind)));
            }
            "items" => {
                load_items = true;
                load_default_items = true;
            }
            path if path.starts_with("items/") => {
                load_items = true;
                let child = path.trim_start_matches("items/");
                if child == "$all" {
                    load_default_items = true;
                    continue;
                }
                if child.is_empty() || child.contains('/') {
                    return Err(invalid(format!("Invalid collection load path '{path}'")));
                }
                if !item_properties.iter().any(|existing| existing == child) {
                    item_properties.push(child.to_string());
                }
            }
            other => return Err(unsupported(other, "Table collection")),
        }
    }

    if load_items {
        if load_default_items {
            let defaults: &[&str] = match kind {
                TableCollectionKind::Columns => &["id", "index", "name", "values"],
                TableCollectionKind::Rows => &["index", "values"],
            };
            item_properties = defaults.iter().map(|name| (*name).to_string()).collect();
        }
        let items = match kind {
            TableCollectionKind::Columns => table
                .columns
                .iter()
                .map(|column| {
                    let properties = load_column_properties(
                        table_ref.sheet(),
                        &table,
                        column,
                        &item_properties,
                    )?;
                    Ok(CollectionItem {
                        key: column.id.clone(),
                        properties,
                    })
                })
                .collect::<Result<Vec<_>, TableCollectionError>>()?,
            TableCollectionKind::Rows => {
                let count = collection_count(&table, kind);
                (0..count)
                    .map(|index| {
                        let row = TableRowRef::new(table_ref.clone(), index);
                        let properties = load_row_properties(&row, &table, &item_properties)?;
                        Ok(CollectionItem {
                            key: index.to_string(),
                            properties,
                        })
                    })
                    .collect::<Result<Vec<_>, TableCollectionError>>()?
            }
        };
        result.insert(
            "items".to_string(),
            serde_json::to_value(items).map_err(encoding)?,
        );
    }
    Ok(result)
}

/// Bind a column by its Office `getItem` key (name, canonical id, or numeric
/// imported/legacy id).
pub(crate) fn get_column(
    table_ref: &TableRef,
    key: &Value,
) -> Result<TableColumnRef, TableCollectionError> {
    let table = resolve_table(table_ref)?;
    let column = if let Some(number) = key.as_u64() {
        let text = number.to_string();
        let legacy_id = u32::try_from(number).ok();
        table.columns.iter().find(|column| {
            column.id == text
                || column.ooxml_column_id == legacy_id
                || public_column_id(column) == number
        })
    } else if let Some(text) = key.as_str() {
        let numeric_id = text.parse::<u64>().ok();
        table.columns.iter().find(|column| {
            column.id == text
                || column.name.eq_ignore_ascii_case(text)
                || numeric_id.is_some_and(|id| public_column_id(column) == id)
        })
    } else {
        None
    };
    let column = column.ok_or_else(|| item_not_found_error(format!("Table column key {key}")))?;
    Ok(TableColumnRef::new(table_ref.clone(), column.id.clone()))
}

pub(crate) fn get_column_at(
    table_ref: &TableRef,
    index: i64,
) -> Result<TableColumnRef, TableCollectionError> {
    let table = resolve_table(table_ref)?;
    let index = checked_index(index, table.columns.len(), "column")?;
    Ok(TableColumnRef::new(
        table_ref.clone(),
        table.columns[index].id.clone(),
    ))
}

pub(crate) fn get_row_at(
    table_ref: &TableRef,
    index: i64,
) -> Result<TableRowRef, TableCollectionError> {
    let table = resolve_table(table_ref)?;
    let count = collection_count(&table, TableCollectionKind::Rows);
    let index = checked_index(index, count as usize, "row")?;
    Ok(TableRowRef::new(table_ref.clone(), index as u32))
}

/// Add a column and optionally populate its data body.
pub(crate) fn add_column(
    table_ref: &TableRef,
    index: Option<i64>,
    values: Option<&Value>,
    name: Option<&Value>,
) -> Result<TableColumnRef, TableCollectionError> {
    let table = resolve_table(table_ref)?;
    let position = insertion_index(index, table.columns.len(), "column")?;
    let column_name = match name {
        None | Some(Value::Null) => generated_column_name(&table),
        Some(value) => required_name(value, "TableColumn.name")?.to_string(),
    };
    if table
        .columns
        .iter()
        .any(|column| column.name.eq_ignore_ascii_case(&column_name))
    {
        return Err(invalid(format!(
            "A table column named '{column_name}' already exists"
        )));
    }

    let (row_count, _) = data_dimensions(&table);
    let parsed_values = values
        .filter(|value| !value.is_null())
        .map(|value| table_value_grid(value, row_count as usize, 1, "TableColumn.values"))
        .transpose()?;

    let sheet = table_ref.sheet();
    // A worksheet column insertion at the table's left edge is the only
    // prepend path that lets the engine move formulas and neighboring cells
    // with their identities intact. The table metadata is repaired below so
    // the newly-created column remains at the original start position.
    let old_header_values = if position == 0 && table.has_header_row {
        Some(snapshot_range_inputs(
            &sheet,
            &TableCollectionRange {
                start_row: table.range.start_row,
                start_col: table.range.start_col,
                end_row: table.range.start_row,
                end_col: table.range.end_col,
            },
        )?)
    } else {
        None
    };

    // Reserve worksheet space before changing the table definition. Inserting
    // at an interior position lets the engine adjust formulas and neighboring
    // cells in one structural operation. Appending reserves a blank column at
    // the right edge; prepending inserts at the table's left edge and repairs
    // the metadata range after the table API adds its column definition.
    let reserved_column = if position == 0 {
        table.range.start_col
    } else {
        table.range.start_col + position as u32
    };
    sheet
        .structure()
        .insert_columns(reserved_column, 1)
        .map_err(engine)?;

    sheet
        .tables()
        .add_column(&table.name, &column_name, position as u32)
        .map_err(engine)?;

    if position == 0 {
        let expanded_end = table.range.end_col.checked_add(1).ok_or_else(|| {
            invalid("The added column would exceed the worksheet column limit".to_string())
        })?;
        // The left-edge worksheet insertion shifted the table to the right;
        // put its start back while retaining the new column definition.
        sheet
            .tables()
            .resize(
                &table.name,
                table.range.start_row,
                table.range.start_col,
                table.range.end_row,
                expanded_end,
            )
            .map_err(engine)?;

        if let Some(old_header_values) = old_header_values {
            let shifted_start = table.range.start_col + 1;
            let shifted_end = table.range.end_col.checked_add(1).ok_or_else(|| {
                invalid("The added column would exceed the worksheet column limit".to_string())
            })?;
            sheet
                .set_range_typed(
                    a1_range(
                        table.range.start_row,
                        shifted_start,
                        table.range.start_row,
                        shifted_end,
                    )
                    .as_str(),
                    &old_header_values,
                )
                .map_err(engine)?;
            let new_header = vec![vec![Some(CellInput::Literal {
                text: column_name.clone(),
            })]];
            sheet
                .set_range_typed(
                    a1_range(
                        table.range.start_row,
                        table.range.start_col,
                        table.range.start_row,
                        table.range.start_col,
                    )
                    .as_str(),
                    &new_header,
                )
                .map_err(engine)?;
        }
    } else if position < table.columns.len() {
        // The structural insert already grew the table range by one column;
        // add_column grows it once more while adding metadata. Restore the
        // intended width without changing its start position.
        sheet
            .tables()
            .resize(
                &table.name,
                table.range.start_row,
                table.range.start_col,
                table.range.end_row,
                table.range.end_col + 1,
            )
            .map_err(engine)?;
    }
    if let Some(grid) = parsed_values.as_ref()
        && row_count > 0
    {
        let updated = resolve_table(table_ref)?;
        let range = range_for_column(&updated, position as u32, TableColumnRangeKind::DataBody)?;
        table_ref
            .sheet()
            .set_range_typed(range.as_str(), grid)
            .map_err(engine)?;
    }
    let updated = resolve_table(table_ref)?;
    let column = updated.columns.get(position).ok_or_else(|| {
        encoding_message("the engine did not return the newly-added table column")
    })?;
    Ok(TableColumnRef::new(table_ref.clone(), column.id.clone()))
}

/// Add one or more rows.  The return reference points at the first newly
/// added row, matching `TableRowCollection.add`.
pub(crate) fn add_rows(
    table_ref: &TableRef,
    index: Option<i64>,
    values: Option<&Value>,
    always_insert: Option<bool>,
) -> Result<TableRowAddResult, TableCollectionError> {
    let table = resolve_table(table_ref)?;
    let width = table.range.end_col - table.range.start_col + 1;
    let data_count = collection_count(&table, TableCollectionKind::Rows);
    let requested_index = insertion_index(index, data_count as usize, "row")? as u32;
    let parsed_values = values
        .filter(|value| !value.is_null())
        .map(|value| table_row_values(value, width as usize))
        .transpose()?;
    let row_count = parsed_values.as_ref().map_or(1, |grid| grid.len() as u32);
    let insert_in_table = always_insert.unwrap_or(true);
    let sheet = table_ref.sheet();

    if !insert_in_table {
        let absolute = table.range.end_row.checked_add(1).ok_or_else(|| {
            invalid("The added rows would exceed the worksheet row limit".to_string())
        })?;
        let end = absolute.checked_add(row_count - 1).ok_or_else(|| {
            invalid("The added rows would exceed the worksheet row limit".to_string())
        })?;
        // `alwaysInsert:false` writes into the first rows below the table when
        // they are empty. If occupied cells exist below the table, preserve
        // them by shifting the used sheet region down before writing.
        if sheet_has_rows_at_or_below(&sheet, absolute)? {
            insert_sheet_rows(&sheet, absolute, row_count, table.range.end_col)?;
        }
        let grid = parsed_values.as_ref();
        if let Some(grid) = grid {
            sheet
                .set_range_typed(
                    a1_range(absolute, table.range.start_col, end, table.range.end_col).as_str(),
                    grid,
                )
                .map_err(engine)?;
        }
        return Ok(TableRowAddResult {
            row: TableRowRef::fixed(table_ref.clone(), data_count, absolute),
        });
    }

    let insert_row = data_insert_row(&table, requested_index)?;
    insert_sheet_rows(&sheet, insert_row, row_count, table.range.end_col)?;
    let new_end = table.range.end_row.checked_add(row_count).ok_or_else(|| {
        invalid("The added rows would exceed the worksheet row limit".to_string())
    })?;
    sheet
        .tables()
        .resize(
            &table.name,
            table.range.start_row,
            table.range.start_col,
            new_end,
            table.range.end_col,
        )
        .map_err(engine)?;

    let mut grid =
        parsed_values.unwrap_or_else(|| vec![vec![None; width as usize]; row_count as usize]);
    fill_calculated_formulas(&table, &mut grid);
    if grid.iter().any(|row| row.iter().any(Option::is_some)) {
        let end = insert_row.checked_add(row_count - 1).ok_or_else(|| {
            invalid("The added rows would exceed the worksheet row limit".to_string())
        })?;
        sheet
            .set_range_typed(
                a1_range(insert_row, table.range.start_col, end, table.range.end_col).as_str(),
                &grid,
            )
            .map_err(engine)?;
    }

    Ok(TableRowAddResult {
        row: TableRowRef::new(table_ref.clone(), requested_index),
    })
}

/// Delete rows by relative index.  The indices are interpreted against the
/// collection before the operation, as Office's batch delete API specifies.
pub(crate) fn delete_rows(
    table_ref: &TableRef,
    indices: &[u32],
) -> Result<(), TableCollectionError> {
    if indices.is_empty() {
        return Ok(());
    }
    let table = resolve_table(table_ref)?;
    ensure_rows_not_filtered(table_ref, &table)?;
    let (start, end) = data_row_bounds(&table)
        .ok_or_else(|| item_not_found_error("The table does not have a data body range"))?;
    let count = end - start + 1;
    let mut sorted = indices.to_vec();
    sorted.sort_unstable();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(invalid(
            "A requested table row appears more than once".to_string(),
        ));
    }
    if sorted.iter().any(|index| *index >= count) {
        return Err(invalid("A requested table row does not exist".to_string()));
    }
    if sorted.len() as u32 >= count {
        return Err(invalid(
            "A table must retain at least one data row".to_string(),
        ));
    }
    // Delete from the bottom so all indices retain their pre-operation
    // meaning and each structure operation remains a normal engine mutation.
    for index in sorted.into_iter().rev() {
        let current = resolve_table(table_ref)?;
        let (current_start, _) = data_row_bounds(&current)
            .ok_or_else(|| item_not_found_error("The table does not have a data body range"))?;
        delete_table_row(table_ref, &current, current_start + index)?;
    }
    Ok(())
}

/// Delete a contiguous run of data rows using Office's `deleteRowsAt` shape.
pub(crate) fn delete_rows_at(
    table_ref: &TableRef,
    index: i64,
    count: i64,
) -> Result<(), TableCollectionError> {
    if index < 0 || count <= 0 {
        return Err(invalid(
            "TableRowCollection.deleteRowsAt requires a non-negative index and a positive count"
                .to_string(),
        ));
    }
    let end = index.checked_add(count).ok_or_else(|| {
        invalid("TableRowCollection.deleteRowsAt exceeds the row index range".to_string())
    })?;
    let table = resolve_table(table_ref)?;
    let rows = collection_count(&table, TableCollectionKind::Rows) as i64;
    if end > rows {
        return Err(invalid(
            "TableRowCollection.deleteRowsAt exceeds the data-row count".to_string(),
        ));
    }
    let indices = (index..end)
        .map(|row| {
            u32::try_from(row).map_err(|_| {
                invalid("TableRowCollection.deleteRowsAt exceeds the row index range".to_string())
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    delete_rows(table_ref, &indices)
}

/// Delete one physical table row while preserving cells outside the table.
///
/// The partial-shift API remaps cell identities and deliberately skips the
/// metadata-shift pass used by worksheet-wide row operations. Resize the
/// table explicitly after the remap so its data-body range follows the cells.
fn delete_table_row(
    table_ref: &TableRef,
    table: &TableCollectionState,
    absolute_row: u32,
) -> Result<(), TableCollectionError> {
    let (data_start, data_end) = data_row_bounds(table)
        .ok_or_else(|| item_not_found_error("The table does not have a data body range"))?;
    if absolute_row < data_start || absolute_row > data_end {
        return item_not_found(format!("Table row position {absolute_row}"));
    }
    let data_count = data_end - data_start + 1;
    if data_count <= 1 {
        return invalid_result("A table must retain at least one data row");
    }

    let sheet = table_ref.sheet();
    let column_count = sheet_shift_column_count(&sheet, table.range.end_col)?;
    sheet
        .structure()
        .delete_cells_with_shift(absolute_row, 0, 1, column_count, false)
        .map_err(engine)?;

    let new_end = table.range.end_row.checked_sub(1).ok_or_else(|| {
        invalid("Deleting the table row would exceed the worksheet row limit".to_string())
    })?;
    sheet
        .tables()
        .resize(
            &table.name,
            table.range.start_row,
            table.range.start_col,
            new_end,
            table.range.end_col,
        )
        .map_err(engine)?;
    Ok(())
}

/// Add worksheet rows by remapping the used cell region from `at` downward.
///
/// The range width includes the table and every currently used neighboring
/// column. This preserves adjacent values/formulas while keeping table
/// metadata under explicit control at the call site.
fn insert_sheet_rows(
    sheet: &Sheet,
    at: u32,
    count: u32,
    table_end_col: u32,
) -> Result<(), TableCollectionError> {
    let column_count = sheet_shift_column_count(sheet, table_end_col)?;
    sheet
        .structure()
        .insert_cells_with_shift(at, 0, count, column_count, false)
        .map_err(engine)?;
    Ok(())
}

fn sheet_shift_column_count(
    sheet: &Sheet,
    table_end_col: u32,
) -> Result<u32, TableCollectionError> {
    let table_width = table_end_col
        .checked_add(1)
        .ok_or_else(|| invalid("The table exceeds the worksheet column limit".to_string()))?;
    let used_width = sheet
        .get_data_bounds()
        .map_err(engine)?
        .and_then(|bounds| bounds.max_col.checked_add(1))
        .unwrap_or(0);
    Ok(table_width.max(used_width))
}

fn sheet_has_rows_at_or_below(sheet: &Sheet, row: u32) -> Result<bool, TableCollectionError> {
    Ok(sheet
        .get_data_bounds()
        .map_err(engine)?
        .is_some_and(|bounds| bounds.max_row >= row))
}

fn ensure_rows_not_filtered(
    table_ref: &TableRef,
    table: &TableCollectionState,
) -> Result<(), TableCollectionError> {
    let filtered = table_ref
        .sheet()
        .filters()
        .get_all()
        .map_err(engine)?
        .into_iter()
        .any(|filter| {
            filter.table_id.as_deref() == Some(table.id.as_str())
                && (!filter.column_filters.is_empty() || filter.advanced_filter.is_some())
        });
    if filtered {
        return Err(TableCollectionError {
            code: "InsertDeleteConflict",
            message: "Cannot insert or delete rows in a filtered table".to_string(),
        });
    }
    Ok(())
}

fn load_column_properties(
    sheet: Sheet,
    table: &TableCollectionState,
    column: &TableCollectionColumn,
    requested: &[String],
) -> Result<HashMap<String, Value>, TableCollectionError> {
    let mut properties = HashMap::new();
    for property in requested {
        let value = match property.as_str() {
            "id" => json!(public_column_id(column)),
            "index" => json!(column.index),
            "name" => Value::String(column.name.clone()),
            "values" => column_values(&sheet, table, column.index)?,
            "valuesAsJson" | "valuesAsJsonLocal" => {
                return Err(unsupported(property, "TableColumn"));
            }
            other => return Err(unsupported(other, "TableColumn")),
        };
        properties.insert(property.clone(), value);
    }
    Ok(properties)
}

fn load_row_properties(
    row: &TableRowRef,
    table: &TableCollectionState,
    requested: &[String],
) -> Result<HashMap<String, Value>, TableCollectionError> {
    let mut properties = HashMap::new();
    for property in requested {
        let value = match property.as_str() {
            "index" => json!(row.relative_index),
            "values" => range_values(&row.sheet(), row.row_bounds(table)?)?,
            "valuesAsJson" | "valuesAsJsonLocal" => {
                return Err(unsupported(property, "TableRow"));
            }
            other => return Err(unsupported(other, "TableRow")),
        };
        properties.insert(property.clone(), value);
    }
    Ok(properties)
}

fn resolve_table(table_ref: &TableRef) -> Result<TableCollectionState, TableCollectionError> {
    let full = table_ref
        .range_address(TableRangeKind::Full)
        .map_err(table_error)?;
    let bounds = CellRange::from(full.as_str()).resolve().map_err(engine)?;
    let sheet = table_ref.sheet();
    for table in sheet.tables().get_all().map_err(engine)? {
        let table = decode_table(table)?;
        let candidate = (
            table.range.start_row,
            table.range.start_col,
            table.range.end_row,
            table.range.end_col,
        );
        if candidate == bounds {
            return Ok(table);
        }
    }
    item_not_found("The requested table no longer exists".to_string())
}

fn resolve_column_by_id<'a>(
    table: &'a TableCollectionState,
    id: &str,
) -> Result<&'a TableCollectionColumn, TableCollectionError> {
    table
        .columns
        .iter()
        .find(|column| column.id == id)
        .ok_or_else(|| item_not_found_error(format!("Table column id {id}")))
}

/// Convert Mog's stable string identity to Office's numeric `TableColumn.id`.
/// Imported workbooks retain the OOXML numeric id; runtime-created columns do
/// not, so use a deterministic 53-bit value derived from the stable id. This
/// keeps the public id stable when columns are inserted or reordered while
/// remaining exactly representable by a JavaScript number.
fn public_column_id(column: &TableCollectionColumn) -> u64 {
    if let Some(id) = column.ooxml_column_id {
        return u64::from(id);
    }

    const FNV_OFFSET: u64 = 14_695_981_039_346_656_037;
    const FNV_PRIME: u64 = 1_099_511_628_211;
    const JS_SAFE_INTEGER: u64 = (1 << 53) - 1;
    let mut hash = FNV_OFFSET;
    for byte in column.id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    let value = hash & JS_SAFE_INTEGER;
    if value == 0 { 1 } else { value }
}

fn collection_count(table: &TableCollectionState, kind: TableCollectionKind) -> u32 {
    match kind {
        TableCollectionKind::Columns => table.columns.len() as u32,
        TableCollectionKind::Rows => data_dimensions(table).0,
    }
}

fn data_dimensions(table: &TableCollectionState) -> (u32, u32) {
    let count = data_row_bounds(table).map_or(0, |(start, end)| end - start + 1);
    (count, table.range.end_col - table.range.start_col + 1)
}

fn data_row_bounds(table: &TableCollectionState) -> Option<(u32, u32)> {
    let start = table
        .range
        .start_row
        .checked_add(u32::from(table.has_header_row))?;
    let end = table
        .range
        .end_row
        .checked_sub(u32::from(table.has_totals_row))?;
    (start <= end).then_some((start, end))
}

fn data_insert_row(
    table: &TableCollectionState,
    relative_index: u32,
) -> Result<u32, TableCollectionError> {
    let start = table
        .range
        .start_row
        .checked_add(u32::from(table.has_header_row))
        .ok_or_else(|| invalid("The added row would exceed the worksheet row limit".to_string()))?;
    let count = collection_count(table, TableCollectionKind::Rows);
    start
        .checked_add(relative_index.min(count))
        .ok_or_else(|| invalid("The added row would exceed the worksheet row limit".to_string()))
}

fn range_for_column(
    table: &TableCollectionState,
    index: u32,
    kind: TableColumnRangeKind,
) -> Result<String, TableCollectionError> {
    if index as usize >= table.columns.len() {
        return item_not_found(format!("Table column index {index}"));
    }
    let column = table.range.start_col + index;
    let (start, end) = match kind {
        TableColumnRangeKind::Full => (table.range.start_row, table.range.end_row),
        TableColumnRangeKind::Header if table.has_header_row => {
            (table.range.start_row, table.range.start_row)
        }
        TableColumnRangeKind::Header => {
            return item_not_found("The table does not have a header row".to_string());
        }
        TableColumnRangeKind::DataBody => data_row_bounds(table)
            .ok_or_else(|| item_not_found_error("The table does not have a data body range"))?,
        TableColumnRangeKind::Total if table.has_totals_row => {
            (table.range.end_row, table.range.end_row)
        }
        TableColumnRangeKind::Total => {
            return item_not_found("The table does not have a totals row".to_string());
        }
    };
    Ok(a1_range(start, column, end, column))
}

fn column_values(
    sheet: &Sheet,
    table: &TableCollectionState,
    index: u32,
) -> Result<Value, TableCollectionError> {
    let Some((start, end)) = data_row_bounds(table) else {
        return Ok(Value::Array(Vec::new()));
    };
    range_values(
        sheet,
        (
            start,
            table.range.start_col + index,
            end,
            table.range.start_col + index,
        ),
    )
}

fn range_values(
    sheet: &Sheet,
    (start_row, start_col, end_row, end_col): (u32, u32, u32, u32),
) -> Result<Value, TableCollectionError> {
    let values = sheet
        .get_range_values_2d(CellRange::Bounds(start_row, start_col, end_row, end_col))
        .map_err(engine)?;
    Ok(Value::Array(
        values
            .into_iter()
            .map(|row| Value::Array(row.into_iter().map(cell_to_json).collect()))
            .collect(),
    ))
}

/// Snapshot a table range as typed cell inputs before a structural operation.
///
/// The prepend-column path inserts a worksheet column at the table's left
/// edge.  Header cells are restored after the table metadata mutation, so a
/// typed snapshot keeps literals, values, and formulas intact while the new
/// first header is populated by the caller.
fn snapshot_range_inputs(
    sheet: &Sheet,
    range: &TableCollectionRange,
) -> Result<Vec<Vec<Option<CellInput>>>, TableCollectionError> {
    let mut grid = Vec::new();
    for row in range.start_row..=range.end_row {
        let mut cells = Vec::new();
        for col in range.start_col..=range.end_col {
            let address = CellAddress::Position(row, col);
            let input = if let Some(formula) = sheet.get_formula(address.clone()).map_err(engine)? {
                CellInput::formula(&formula)
            } else {
                CellInput::from_cell_value(&sheet.get_cell_value(address).map_err(engine)?)
            };
            cells.push(Some(input));
        }
        grid.push(cells);
    }
    Ok(grid)
}

fn table_row_values(
    value: &Value,
    width: usize,
) -> Result<Vec<Vec<Option<CellInput>>>, TableCollectionError> {
    if !value.is_array() {
        if width == 1 {
            return Ok(vec![vec![table_cell_input(value, "values")?]]);
        }
        return invalid_result(
            "TableRowCollection.add values require one scalar per one-column table or a 2-dimensional array",
        );
    }
    let rows = value.as_array().ok_or_else(|| {
        invalid("TableRowCollection.add values require a 2-dimensional array or scalar".to_string())
    })?;
    if rows.is_empty() {
        return invalid_result("TableRowCollection.add values cannot be empty");
    }
    let mut grid = Vec::with_capacity(rows.len());
    for row in rows {
        let cells = row.as_array().ok_or_else(|| {
            invalid("TableRowCollection.add values require a 2-dimensional array".to_string())
        })?;
        if cells.len() != width {
            return invalid_result(format!(
                "TableRowCollection.add values has {} columns; table requires {width}",
                cells.len()
            ));
        }
        grid.push(
            cells
                .iter()
                .map(|cell| table_cell_input(cell, "values"))
                .collect::<Result<Vec<_>, _>>()?,
        );
    }
    Ok(grid)
}

fn table_value_grid(
    value: &Value,
    expected_rows: usize,
    expected_cols: usize,
    property: &str,
) -> Result<Vec<Vec<Option<CellInput>>>, TableCollectionError> {
    if !value.is_array() {
        if expected_rows == 1 && expected_cols == 1 {
            return Ok(vec![vec![table_cell_input(value, property)?]]);
        }
        return invalid_result(format!(
            "{property} requires a {expected_rows}x{expected_cols} 2-dimensional array"
        ));
    }
    let rows = value.as_array().expect("array checked");
    if rows.len() != expected_rows {
        return invalid_result(format!(
            "{property} has {} rows; target requires {expected_rows}",
            rows.len()
        ));
    }
    let mut grid = Vec::with_capacity(rows.len());
    for (row_index, row) in rows.iter().enumerate() {
        let cells = row
            .as_array()
            .ok_or_else(|| invalid(format!("{property} requires a 2-dimensional array")))?;
        if cells.len() != expected_cols {
            return invalid_result(format!(
                "{property} row {row_index} has {} columns; target requires {expected_cols}",
                cells.len()
            ));
        }
        grid.push(
            cells
                .iter()
                .map(|cell| table_cell_input(cell, property))
                .collect::<Result<Vec<_>, _>>()?,
        );
    }
    Ok(grid)
}

fn table_cell_input(
    value: &Value,
    property: &str,
) -> Result<Option<CellInput>, TableCollectionError> {
    match value {
        Value::Null => Ok(None),
        Value::Bool(value) => Ok(Some(CellInput::Value {
            value: CellValue::Boolean(*value),
        })),
        Value::Number(value) => value
            .as_f64()
            .map(CellValue::from)
            .map(|value| Some(CellInput::Value { value }))
            .ok_or_else(|| invalid(format!("{property} must contain finite numbers"))),
        Value::String(value) if value.is_empty() => Ok(Some(CellInput::Clear)),
        Value::String(value)
            if value.starts_with('+') || value.starts_with('-') || value.starts_with('=') =>
        {
            Ok(Some(CellInput::formula(value)))
        }
        Value::String(value) => Ok(Some(CellInput::Literal {
            text: value.clone(),
        })),
        _ => invalid_result(format!(
            "{property} must contain only strings, numbers, booleans, or null"
        )),
    }
}

fn fill_calculated_formulas(table: &TableCollectionState, grid: &mut [Vec<Option<CellInput>>]) {
    for row in grid {
        for (index, cell) in row.iter_mut().enumerate() {
            if cell.is_none()
                && let Some(formula) = table
                    .columns
                    .get(index)
                    .and_then(|column| column.calculated_formula.as_deref())
            {
                *cell = Some(CellInput::formula(formula));
            }
        }
    }
}

fn generated_column_name(table: &TableCollectionState) -> String {
    for index in 1..100_000 {
        let candidate = format!("Column{index}");
        if table
            .columns
            .iter()
            .all(|column| !column.name.eq_ignore_ascii_case(&candidate))
        {
            return candidate;
        }
    }
    "Column".to_string()
}

fn insertion_index(
    index: Option<i64>,
    length: usize,
    object: &str,
) -> Result<usize, TableCollectionError> {
    match index {
        None | Some(-1) => Ok(length),
        Some(value) if value >= 0 && (value as usize) <= length => Ok(value as usize),
        Some(value) => invalid_result(format!(
            "The {object} insertion index {value} is outside 0..={length}"
        )),
    }
}

fn checked_index(index: i64, length: usize, object: &str) -> Result<usize, TableCollectionError> {
    if index >= 0 && (index as usize) < length {
        Ok(index as usize)
    } else {
        item_not_found(format!("Table {object} index {index}"))
    }
}

fn required_name<'a>(value: &'a Value, property: &str) -> Result<&'a str, TableCollectionError> {
    value
        .as_str()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| invalid(format!("{property} must be a non-empty string")))
}

fn cell_to_json(value: CellValue) -> Value {
    match value {
        CellValue::Null => Value::String(String::new()),
        CellValue::Boolean(value) => Value::Bool(value),
        CellValue::Number(_) => value
            .as_number()
            .map(|number| json!(number))
            .unwrap_or(Value::Null),
        CellValue::Text(value) => Value::String(value.to_string()),
        CellValue::Error(error, _) => Value::String(error.to_string()),
        other => Value::String(other.to_string()),
    }
}

fn decode_table(
    table: impl serde::Serialize,
) -> Result<TableCollectionState, TableCollectionError> {
    let value = serde_json::to_value(table).map_err(encoding)?;
    serde_json::from_value(value).map_err(encoding)
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

fn table_error(error: TableError) -> TableCollectionError {
    TableCollectionError {
        code: error.code,
        message: error.message,
    }
}

fn engine(error: impl std::fmt::Display) -> TableCollectionError {
    TableCollectionError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(error: serde_json::Error) -> TableCollectionError {
    TableCollectionError {
        code: "GeneralException",
        message: format!("Failed to encode table collection state: {error}"),
    }
}

fn encoding_message(message: &str) -> TableCollectionError {
    TableCollectionError {
        code: "GeneralException",
        message: message.to_string(),
    }
}

fn unsupported(property: &str, object: &str) -> TableCollectionError {
    TableCollectionError {
        code: "InvalidArgument",
        message: format!("Unsupported {object} property '{property}'"),
    }
}

fn read_only(property: &str, object: &str) -> TableCollectionError {
    TableCollectionError {
        code: "InvalidArgument",
        message: format!("{object}.{property} is read-only"),
    }
}

fn invalid(message: String) -> TableCollectionError {
    TableCollectionError {
        code: "InvalidArgument",
        message,
    }
}

fn invalid_result<T>(message: impl Into<String>) -> Result<T, TableCollectionError> {
    Err(invalid(message.into()))
}

fn item_not_found_error(message: impl Into<String>) -> TableCollectionError {
    TableCollectionError {
        code: "ItemNotFound",
        message: message.into(),
    }
}

fn item_not_found<T>(message: impl Into<String>) -> Result<T, TableCollectionError> {
    Err(item_not_found_error(message))
}
