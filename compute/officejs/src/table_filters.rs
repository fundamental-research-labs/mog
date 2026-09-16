//! Table filters share the worksheet AutoFilter criteria translation, but keep
//! their durable state scoped to the table's ID.
use crate::{
    dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext},
    host::BatchError,
    sort_filter,
    table_collections::TableColumnRef,
    tables::{TableRangeKind, TableRef},
};
use domain_types::filter::FilterState;
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};

pub(crate) struct TableFiltersHandler;
impl ExtensionHandler for TableFiltersHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "tableFilterGet"
                | "tableFilterApply"
                | "tableFilterClear"
                | "tableClearFilters"
                | "tableReapplyFilters"
        )
    }
    fn handle(
        &self,
        op: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        match text(op, "op")? {
            "tableFilterGet" => {
                let column = context.table_column(text(op, "columnId")?)?;
                context.bind_object(text(op, "id")?, Arc::new(FilterRef { column }));
            }
            "tableFilterApply" | "tableFilterClear" => {
                let filter = context.extension_object::<FilterRef>(text(op, "id")?)?;
                let (table, _, col) = filter.location()?;
                // Parse before creating or changing any engine state.
                let criteria = if text(op, "op")? == "tableFilterApply" {
                    Some(
                        sort_filter::parse_filter_criteria(&op["criteria"])
                            .map_err(criteria_error)?,
                    )
                } else {
                    None
                };
                if let Some(record) = table_filter(&table, criteria.is_some())? {
                    let sheet = table.sheet();
                    if let Some(criteria) = criteria {
                        let criteria = serde_json::from_value(criteria).map_err(engine)?;
                        sheet
                            .filters()
                            .set_column_filter(&record.id, col, criteria)
                            .map_err(engine)?;
                    } else {
                        sheet
                            .filters()
                            .clear_column_filter(&record.id, col)
                            .map_err(engine)?;
                    }
                    sheet.filters().apply(&record.id).map_err(engine)?;
                }
            }
            "tableClearFilters" | "tableReapplyFilters" => {
                let table = context.table(text(op, "tableId")?)?;
                if let Some(record) = table_filter(&table, false)? {
                    let sheet = table.sheet();
                    if text(op, "op")? == "tableClearFilters" {
                        sheet
                            .filters()
                            .clear_all_column_filters(&record.id)
                            .map_err(engine)?;
                        sheet.filters().apply(&record.id).map_err(engine)?;
                    } else {
                        sheet.filters().reapply(&record.id).map_err(engine)?;
                    }
                }
            }
            _ => return Ok(false),
        }
        Ok(true)
    }
}

struct FilterRef {
    column: TableColumnRef,
}
impl FilterRef {
    fn location(&self) -> Result<(TableRef, u32, u32), BatchError> {
        let table = self.column.table();
        let address = table
            .range_address(TableRangeKind::Full)
            .map_err(|e| BatchError {
                code: e.code,
                message: e.message,
            })?;
        let (row, col, _, _) = compute_api::CellRange::from(address.as_str())
            .resolve()
            .map_err(engine)?;
        let index = self
            .column
            .load(&["index".into()])
            .map_err(|e| BatchError {
                code: e.code,
                message: e.message,
            })?["index"]
            .as_u64()
            .unwrap() as u32;
        Ok((table, row, col + index))
    }
}
impl ExtensionObject for FilterRef {
    fn object_type(&self) -> &'static str {
        "Filter"
    }
    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let (table, row, col) = self.location()?;
        let mut criteria = json!({});
        if let Some(record) = table_filter(&table, false)? {
            if let Some(cell) = table.sheet().get_cell_data((row, col)).map_err(engine)? {
                if let Some(stored) = cell["cell_id"]
                    .as_str()
                    .and_then(|id| record.column_filters.get(id))
                {
                    criteria = sort_filter::office_criteria_from_domain(
                        &serde_json::to_value(stored).map_err(engine)?,
                    )
                    .map_err(criteria_error)?;
                }
            }
        }
        properties
            .iter()
            .map(|name| match name.as_str() {
                "criteria" => Ok((name.clone(), criteria.clone())),
                "isNullObject" => Ok((name.clone(), json!(false))),
                _ => Err(BatchError {
                    code: "InvalidArgument",
                    message: format!("Unknown Filter property: {name}"),
                }),
            })
            .collect()
    }
    fn set(&self, _: &str, _: &Value) -> Result<(), BatchError> {
        Err(BatchError {
            code: "InvalidArgument",
            message: "Filter properties are read-only".into(),
        })
    }
}

fn table_filter(table: &TableRef, create: bool) -> Result<Option<FilterState>, BatchError> {
    let id = table.load(&["id".into()]).map_err(|e| BatchError {
        code: e.code,
        message: e.message,
    })?["id"]
        .as_str()
        .unwrap()
        .to_string();
    let sheet = table.sheet();
    let existing = sheet
        .filters()
        .get_all()
        .map_err(engine)?
        .into_iter()
        .find(|filter| filter.table_id.as_deref() == Some(&id));
    if existing.is_some() || !create {
        return Ok(existing);
    }
    let address = table
        .range_address(TableRangeKind::Full)
        .map_err(|e| BatchError {
            code: e.code,
            message: e.message,
        })?;
    let (sr, sc, er, ec) = compute_api::CellRange::from(address.as_str())
        .resolve()
        .map_err(engine)?;
    let totals = table.load(&["showTotals".into()]).map_err(|e| BatchError {
        code: e.code,
        message: e.message,
    })?["showTotals"]
        .as_bool()
        .unwrap_or(false);
    sheet.filters().create(json!({ "startRow": sr, "startCol": sc, "endRow": er - u32::from(totals), "endCol": ec, "filterType": "tableFilter", "tableId": id })).map_err(engine)?;
    Ok(sheet
        .filters()
        .get_all()
        .map_err(engine)?
        .into_iter()
        .find(|filter| filter.table_id.as_deref() == Some(&id)))
}
fn text<'a>(op: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    op[field].as_str().ok_or_else(|| BatchError {
        code: "InvalidArgument",
        message: format!("{field} is required"),
    })
}
fn criteria_error(error: sort_filter::SortFilterError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}
fn engine(error: impl std::fmt::Display) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: error.to_string(),
    }
}
