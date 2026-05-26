//! Data Table calculator — evaluates a formula with each combination of input values.
//!
//! Supports three modes:
//! - **One-variable row**: row input cell + row values -> one result per row value
//! - **One-variable column**: column input cell + column values -> one row of results
//! - **Two-variable**: both row and column input cells -> full grid of results

use bridge_types::DescribeSchema;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

use cell_types::{CellId, SheetId, SheetPos};
use formula_types::CellRef;
use snapshot_types::DataTableRegionDef;
use value_types::CellValue;
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::range_manager::{A1RangeRef, parse_range, stringify_range};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Parameters for Data Table calculation.
#[derive(Debug, Clone, Serialize, Deserialize, DescribeSchema)]
pub struct DataTableParams {
    /// CellId of the formula cell to evaluate.
    pub formula_cell: String,
    /// CellId of the row input cell (None for column-only tables).
    pub row_input_cell: Option<String>,
    /// CellId of the column input cell (None for row-only tables).
    pub col_input_cell: Option<String>,
    /// Input values for each row.
    pub row_values: Vec<CellValue>,
    /// Input values for each column.
    pub col_values: Vec<CellValue>,
}

/// Result of Data Table calculation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataTableResult {
    /// 2D grid of computed values. results[row][col].
    pub results: Vec<Vec<CellValue>>,
    /// Total cells computed.
    pub cell_count: u32,
    /// Whether the calculation was cancelled (reserved for future async support).
    pub cancelled: bool,
}

/// Rust bridge input for creating a persistent Data Table region.
#[derive(Debug, Clone, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDataTableInput {
    pub sheet_id: SheetId,
    /// Full anchor-inclusive user selection, including formula/header cells.
    pub table_range: String,
    /// Excel-labeled row input cell: consumes top-row values.
    #[serde(default)]
    pub row_input_cell: Option<String>,
    /// Excel-labeled column input cell: consumes left-column values.
    #[serde(default)]
    pub col_input_cell: Option<String>,
}

/// Result returned from the persistent Data Table creation mutation.
#[derive(Debug, Clone, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDataTableResult {
    pub region_id: String,
    pub table_range: String,
    pub body_range: String,
    pub row_input_cell: Option<String>,
    pub col_input_cell: Option<String>,
    pub rows_computed: u32,
    pub cols_computed: u32,
    pub cell_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DataTableLayout {
    OneVariableRow,
    OneVariableColumn,
    TwoVariable,
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

/// Validate a create request and build the canonical body-region definition.
pub(crate) fn prepare_data_table_creation(
    mirror: &CellMirror,
    input: &CreateDataTableInput,
) -> Result<(DataTableRegionDef, CreateDataTableResult), ComputeError> {
    let table_ref = parse_range(&input.table_range).ok_or_else(|| {
        invalid_data_table(
            "DATA_TABLE_INVALID_RANGE",
            "tableRange is not a valid A1 range",
        )
    })?;
    let table_sheet = resolve_range_sheet(mirror, &input.sheet_id, &table_ref)?;
    if table_sheet != input.sheet_id {
        return Err(invalid_data_table(
            "DATA_TABLE_INVALID_RANGE",
            "tableRange must resolve to the request sheet",
        ));
    }
    let table = rect_from_range(&table_ref);
    if table.end_row <= table.start_row || table.end_col <= table.start_col {
        return Err(invalid_data_table(
            "DATA_TABLE_INVALID_LAYOUT",
            "Data Table selection must include a header row, header column, and body",
        ));
    }
    let body = Rect {
        start_row: table.start_row + 1,
        start_col: table.start_col + 1,
        end_row: table.end_row,
        end_col: table.end_col,
    };

    let layout = match (
        input.row_input_cell.as_deref(),
        input.col_input_cell.as_deref(),
    ) {
        (Some(_), Some(_)) => DataTableLayout::TwoVariable,
        (Some(_), None) => DataTableLayout::OneVariableRow,
        (None, Some(_)) => DataTableLayout::OneVariableColumn,
        (None, None) => {
            return Err(invalid_data_table(
                "DATA_TABLE_INPUT_REQUIRED",
                "rowInputCell or colInputCell is required",
            ));
        }
    };

    let row_input_pos = resolve_optional_input_cell(
        mirror,
        &input.sheet_id,
        input.row_input_cell.as_deref(),
        "rowInputCell",
    )?;
    let col_input_pos = resolve_optional_input_cell(
        mirror,
        &input.sheet_id,
        input.col_input_cell.as_deref(),
        "colInputCell",
    )?;

    if let (Some((row_sheet, row, col)), Some((col_sheet, col_row, col_col))) =
        (row_input_pos, col_input_pos)
        && row_sheet == col_sheet
        && row == col_row
        && col == col_col
    {
        return Err(invalid_data_table(
            "DATA_TABLE_INPUT_DUPLICATE",
            "rowInputCell and colInputCell must be different cells",
        ));
    }

    for (label, pos) in [
        ("rowInputCell", row_input_pos),
        ("colInputCell", col_input_pos),
    ] {
        if let Some((sheet, row, col)) = pos {
            if sheet == input.sheet_id && table.contains(row, col) {
                return Err(invalid_data_table(
                    "DATA_TABLE_INPUT_INSIDE_TABLE",
                    &format!("{label} must be outside tableRange"),
                ));
            }
            if mirror
                .resolve_cell_id(&sheet, SheetPos::new(row, col))
                .is_none()
            {
                return Err(invalid_data_table(
                    "DATA_TABLE_INPUT_NOT_FOUND",
                    &format!("{label} must resolve to an existing cell"),
                ));
            }
        }
    }

    validate_formula_sources(mirror, &input.sheet_id, layout, table, body)?;
    validate_body_is_empty(mirror, &input.sheet_id, body)?;
    validate_region_collisions(mirror, &input.sheet_id, table)?;

    let region = DataTableRegionDef {
        sheet: input.sheet_id.to_uuid_string(),
        start_row: body.start_row,
        start_col: body.start_col,
        end_row: body.end_row,
        end_col: body.end_col,
        // Internal legacy names are intentionally normalized at the boundary:
        // row_input_ref consumes left-column values, col_input_ref consumes
        // top-row values. Public rowInputCell/colInputCell follow Excel labels.
        row_input_ref: col_input_pos.map(cell_ref_from_pos),
        col_input_ref: row_input_pos.map(cell_ref_from_pos),
        ooxml_flags: None,
    };
    let region_id = crate::storage::workbook::data_tables::data_table_region_id(&region);
    let body_range = range_string(body);
    let rows = body.end_row - body.start_row + 1;
    let cols = body.end_col - body.start_col + 1;

    Ok((
        region,
        CreateDataTableResult {
            region_id,
            table_range: input.table_range.clone(),
            body_range,
            row_input_cell: input.row_input_cell.clone(),
            col_input_cell: input.col_input_cell.clone(),
            rows_computed: rows,
            cols_computed: cols,
            cell_count: rows * cols,
        },
    ))
}

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

/// Calculate a data table by evaluating a formula with each combination of input values.
///
/// `evaluate` takes a map of CellId -> CellValue overrides and returns the formula result.
/// The overrides temporarily replace cell values during evaluation without modifying the
/// underlying CellMirror.
///
/// # Arguments
///
/// * `row_input_cell` - CellId of the row input cell (None for column-only tables)
/// * `col_input_cell` - CellId of the column input cell (None for row-only tables)
/// * `row_values` - Input values to substitute for the row input cell
/// * `col_values` - Input values to substitute for the column input cell
/// * `evaluate` - Closure that evaluates the formula with the given overrides
///
/// # Returns
///
/// A `DataTableResult` containing the 2D grid of results and metadata.
pub fn calculate_data_table<F>(
    row_input_cell: Option<CellId>,
    col_input_cell: Option<CellId>,
    row_values: &[CellValue],
    col_values: &[CellValue],
    mut evaluate: F,
) -> DataTableResult
where
    F: FnMut(&FxHashMap<CellId, CellValue>) -> CellValue,
{
    let mut results = Vec::new();
    let mut cell_count = 0u32;

    let is_one_var_row = row_input_cell.is_some() && col_input_cell.is_none();
    let is_one_var_col = row_input_cell.is_none() && col_input_cell.is_some();
    let is_two_var = row_input_cell.is_some() && col_input_cell.is_some();

    // Must have at least one input cell specified
    if !is_one_var_row && !is_one_var_col && !is_two_var {
        return DataTableResult {
            results,
            cell_count,
            cancelled: false,
        };
    }

    if is_one_var_row {
        // One-variable row table: substitute each row value into the row input cell
        let input_id = row_input_cell.unwrap();
        for value in row_values {
            let mut overrides = FxHashMap::default();
            overrides.insert(input_id, value.clone());
            let result = evaluate(&overrides);
            results.push(vec![result]);
            cell_count += 1;
        }
    } else if is_one_var_col {
        // One-variable column table: substitute each column value into the column input cell
        let input_id = col_input_cell.unwrap();
        let mut row = Vec::with_capacity(col_values.len());
        for value in col_values {
            let mut overrides = FxHashMap::default();
            overrides.insert(input_id, value.clone());
            let result = evaluate(&overrides);
            row.push(result);
            cell_count += 1;
        }
        results.push(row);
    } else {
        // Two-variable table: substitute both row and column values.
        //
        // row_input_cell receives row_values (one per row in the output grid),
        // col_input_cell receives col_values (one per column in the output grid).
        //
        // NOTE: Callers that map from the Excel TABLE(row_input, col_input)
        // convention — where row_input gets top-row headers and col_input gets
        // left-column headers — must swap the value arrays before calling this
        // function (see data_table_prepass.rs).
        let row_id = row_input_cell.unwrap();
        let col_id = col_input_cell.unwrap();
        for row_val in row_values {
            let mut row = Vec::with_capacity(col_values.len());
            for col_val in col_values {
                let mut overrides = FxHashMap::default();
                overrides.insert(row_id, row_val.clone());
                overrides.insert(col_id, col_val.clone());
                let result = evaluate(&overrides);
                row.push(result);
                cell_count += 1;
            }
            results.push(row);
        }
    }

    DataTableResult {
        results,
        cell_count,
        cancelled: false,
    }
}

fn resolve_range_sheet(
    mirror: &CellMirror,
    default_sheet: &SheetId,
    range: &A1RangeRef,
) -> Result<SheetId, ComputeError> {
    match range.sheet_name.as_deref() {
        Some(sheet_name) => mirror.sheet_by_name(sheet_name).ok_or_else(|| {
            invalid_data_table(
                "DATA_TABLE_SHEET_NOT_FOUND",
                &format!("sheet not found: {sheet_name}"),
            )
        }),
        None => Ok(*default_sheet),
    }
}

fn resolve_optional_input_cell(
    mirror: &CellMirror,
    default_sheet: &SheetId,
    raw: Option<&str>,
    label: &str,
) -> Result<Option<(SheetId, u32, u32)>, ComputeError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let range = parse_range(raw).ok_or_else(|| {
        invalid_data_table(
            "DATA_TABLE_INVALID_INPUT_REF",
            &format!("{label} is not a valid A1 cell reference"),
        )
    })?;
    let rect = rect_from_range(&range);
    if rect.start_row != rect.end_row || rect.start_col != rect.end_col {
        return Err(invalid_data_table(
            "DATA_TABLE_INVALID_INPUT_REF",
            &format!("{label} must be a single cell"),
        ));
    }
    let sheet = resolve_range_sheet(mirror, default_sheet, &range)?;
    Ok(Some((sheet, rect.start_row, rect.start_col)))
}

fn validate_formula_sources(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    layout: DataTableLayout,
    table: Rect,
    body: Rect,
) -> Result<(), ComputeError> {
    match layout {
        DataTableLayout::OneVariableColumn => {
            for col in body.start_col..=body.end_col {
                require_formula_at(mirror, sheet_id, table.start_row, col)?;
            }
        }
        DataTableLayout::OneVariableRow => {
            for row in body.start_row..=body.end_row {
                require_formula_at(mirror, sheet_id, row, table.start_col)?;
            }
        }
        DataTableLayout::TwoVariable => {
            require_formula_at(mirror, sheet_id, table.start_row, table.start_col)?;
        }
    }
    Ok(())
}

fn require_formula_at(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<(), ComputeError> {
    let pos = SheetPos::new(row, col);
    let cell_id = mirror.resolve_cell_id(sheet_id, pos).ok_or_else(|| {
        invalid_data_table(
            "DATA_TABLE_FORMULA_REQUIRED",
            "formula source cell must exist",
        )
    })?;
    if mirror.get_formula(&cell_id).is_none() {
        return Err(invalid_data_table(
            "DATA_TABLE_FORMULA_REQUIRED",
            "formula source cell must contain a formula",
        ));
    }
    Ok(())
}

fn validate_body_is_empty(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    body: Rect,
) -> Result<(), ComputeError> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };
    for row in body.start_row..=body.end_row {
        for col in body.start_col..=body.end_col {
            if let Some(cell_id) = mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col))
                && let Some(entry) = sheet.get_cell(&cell_id)
                && !entry.is_ghost()
            {
                return Err(invalid_data_table(
                    "DATA_TABLE_BODY_NOT_EMPTY",
                    "Data Table body cells must be empty before creation",
                ));
            }
        }
    }
    Ok(())
}

fn validate_region_collisions(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table: Rect,
) -> Result<(), ComputeError> {
    let sheet_uuid = sheet_id.to_uuid_string();
    for region in mirror.all_data_table_regions() {
        if region.sheet == sheet_uuid
            && table.intersects(Rect {
                start_row: region.start_row,
                start_col: region.start_col,
                end_row: region.end_row,
                end_col: region.end_col,
            })
        {
            return Err(invalid_data_table(
                "DATA_TABLE_REGION_OVERLAP",
                "tableRange overlaps an existing Data Table",
            ));
        }
    }

    for table_def in mirror.all_table_defs() {
        if table_def.sheet == *sheet_id
            && table.intersects(Rect {
                start_row: table_def.start_row,
                start_col: table_def.start_col,
                end_row: table_def.end_row,
                end_col: table_def.end_col,
            })
        {
            return Err(invalid_data_table(
                "DATA_TABLE_TABLE_OVERLAP",
                "tableRange overlaps a worksheet table",
            ));
        }
    }

    for merge in mirror.get_merge_regions(sheet_id) {
        if table.intersects(Rect {
            start_row: merge.start_row,
            start_col: merge.start_col,
            end_row: merge.end_row,
            end_col: merge.end_col,
        }) {
            return Err(invalid_data_table(
                "DATA_TABLE_MERGED",
                "tableRange overlaps merged cells",
            ));
        }
    }
    Ok(())
}

fn rect_from_range(range: &A1RangeRef) -> Rect {
    Rect {
        start_row: range.start.row.min(range.end.row),
        start_col: range.start.col.min(range.end.col),
        end_row: range.start.row.max(range.end.row),
        end_col: range.start.col.max(range.end.col),
    }
}

fn range_string(rect: Rect) -> String {
    stringify_range(&A1RangeRef {
        start: crate::range_manager::A1CellRef {
            row: rect.start_row,
            col: rect.start_col,
            row_absolute: false,
            col_absolute: false,
        },
        end: crate::range_manager::A1CellRef {
            row: rect.end_row,
            col: rect.end_col,
            row_absolute: false,
            col_absolute: false,
        },
        sheet_name: None,
    })
}

fn cell_ref_from_pos((sheet, row, col): (SheetId, u32, u32)) -> CellRef {
    CellRef::Positional { sheet, row, col }
}

fn invalid_data_table(code: &str, detail: &str) -> ComputeError {
    ComputeError::InvalidInput {
        message: format!("{code}: {detail}"),
    }
}

impl Rect {
    fn contains(self, row: u32, col: u32) -> bool {
        row >= self.start_row && row <= self.end_row && col >= self.start_col && col <= self.end_col
    }

    fn intersects(self, other: Rect) -> bool {
        self.start_row <= other.end_row
            && self.end_row >= other.start_row
            && self.start_col <= other.end_col
            && self.end_col >= other.start_col
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::CellId;
    use value_types::{CellError, CellValue, FiniteF64};

    /// Helper: create a CellId from a raw u128 value.
    fn cell(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    /// Simple evaluator that returns the sum of override values as numbers.
    fn sum_evaluator(overrides: &FxHashMap<CellId, CellValue>) -> CellValue {
        let mut total = 0.0;
        for value in overrides.values() {
            match value.coerce_to_number() {
                Ok(n) => total += n,
                Err(e) => return CellValue::Error(e, None),
            }
        }
        CellValue::number(total)
    }

    /// Evaluator that doubles the first override value.
    fn double_evaluator(overrides: &FxHashMap<CellId, CellValue>) -> CellValue {
        if let Some(value) = overrides.values().next() {
            match value.coerce_to_number() {
                Ok(n) => return CellValue::number(n * 2.0),
                Err(e) => return CellValue::Error(e, None),
            }
        }
        CellValue::Number(FiniteF64::must(0.0))
    }

    // -----------------------------------------------------------------------
    // 1. test_one_var_row -- single row input, 5 values
    // -----------------------------------------------------------------------
    #[test]
    fn test_one_var_row() {
        let row_input = Some(cell(1));
        let col_input = None;
        let row_values: Vec<CellValue> = (1..=5)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();
        let col_values: Vec<CellValue> = vec![];

        let result = calculate_data_table(
            row_input,
            col_input,
            &row_values,
            &col_values,
            double_evaluator,
        );

        assert_eq!(result.results.len(), 5);
        assert_eq!(result.cell_count, 5);
        assert!(!result.cancelled);

        // Each result should be double the input
        for (i, row) in result.results.iter().enumerate() {
            assert_eq!(row.len(), 1);
            assert_eq!(
                row[0],
                CellValue::Number(FiniteF64::must((i as f64 + 1.0) * 2.0))
            );
        }
    }

    // -----------------------------------------------------------------------
    // 2. test_one_var_col -- single column input, 5 values
    // -----------------------------------------------------------------------
    #[test]
    fn test_one_var_col() {
        let row_input = None;
        let col_input = Some(cell(2));
        let row_values: Vec<CellValue> = vec![];
        let col_values: Vec<CellValue> = (10..=14)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();

        let result = calculate_data_table(
            row_input,
            col_input,
            &row_values,
            &col_values,
            double_evaluator,
        );

        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].len(), 5);
        assert_eq!(result.cell_count, 5);

        for (i, val) in result.results[0].iter().enumerate() {
            assert_eq!(
                *val,
                CellValue::Number(FiniteF64::must((10 + i) as f64 * 2.0))
            );
        }
    }

    // -----------------------------------------------------------------------
    // 3. test_two_var -- row + column inputs, 3x4 grid
    // -----------------------------------------------------------------------
    #[test]
    fn test_two_var() {
        let row_input = Some(cell(1));
        let col_input = Some(cell(2));
        let row_values: Vec<CellValue> = (1..=3)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();
        let col_values: Vec<CellValue> = (10..=13)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();

        let result = calculate_data_table(
            row_input,
            col_input,
            &row_values,
            &col_values,
            sum_evaluator,
        );

        assert_eq!(result.results.len(), 3);
        for row in &result.results {
            assert_eq!(row.len(), 4);
        }
        assert_eq!(result.cell_count, 12);

        // In a two-var table, row_input gets row_values[r] and col_input gets col_values[c].
        // With sum_evaluator: result[r][c] = row_values[r] + col_values[c]
        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(11.0))
        ); // 10 + 1
        assert_eq!(
            result.results[0][3],
            CellValue::Number(FiniteF64::must(14.0))
        ); // 13 + 1
        assert_eq!(
            result.results[2][0],
            CellValue::Number(FiniteF64::must(13.0))
        ); // 10 + 3
        assert_eq!(
            result.results[2][3],
            CellValue::Number(FiniteF64::must(16.0))
        ); // 13 + 3
    }

    // -----------------------------------------------------------------------
    // 4. test_empty_row_values -- no row values -> empty results
    // -----------------------------------------------------------------------
    #[test]
    fn test_empty_row_values() {
        let row_input = Some(cell(1));
        let col_input = None;
        let row_values: Vec<CellValue> = vec![];
        let col_values: Vec<CellValue> = vec![];

        let result = calculate_data_table(
            row_input,
            col_input,
            &row_values,
            &col_values,
            double_evaluator,
        );

        assert_eq!(result.results.len(), 0);
        assert_eq!(result.cell_count, 0);
    }

    // -----------------------------------------------------------------------
    // 5. test_empty_col_values -- no col values -> empty results
    // -----------------------------------------------------------------------
    #[test]
    fn test_empty_col_values() {
        let row_input = None;
        let col_input = Some(cell(2));
        let row_values: Vec<CellValue> = vec![];
        let col_values: Vec<CellValue> = vec![];

        let result = calculate_data_table(
            row_input,
            col_input,
            &row_values,
            &col_values,
            double_evaluator,
        );

        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].len(), 0);
        assert_eq!(result.cell_count, 0);
    }

    // -----------------------------------------------------------------------
    // 6. test_no_input_cells -- neither input specified -> empty results
    // -----------------------------------------------------------------------
    #[test]
    fn test_no_input_cells() {
        let row_values: Vec<CellValue> = vec![CellValue::Number(FiniteF64::must(1.0))];
        let col_values: Vec<CellValue> = vec![CellValue::Number(FiniteF64::must(2.0))];

        let result = calculate_data_table(None, None, &row_values, &col_values, double_evaluator);

        assert_eq!(result.results.len(), 0);
        assert_eq!(result.cell_count, 0);
    }

    // -----------------------------------------------------------------------
    // 7. test_single_value -- one row value, one result
    // -----------------------------------------------------------------------
    #[test]
    fn test_single_value() {
        let row_input = Some(cell(1));
        let row_values = vec![CellValue::Number(FiniteF64::must(42.0))];

        let result = calculate_data_table(row_input, None, &row_values, &[], double_evaluator);

        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].len(), 1);
        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(84.0))
        );
        assert_eq!(result.cell_count, 1);
    }

    // -----------------------------------------------------------------------
    // 8. test_result_dimensions -- verify results grid dimensions match inputs
    // -----------------------------------------------------------------------
    #[test]
    fn test_result_dimensions() {
        // One-variable row: N rows, 1 column each
        let row_values: Vec<CellValue> = (0..7)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();
        let result = calculate_data_table(Some(cell(1)), None, &row_values, &[], double_evaluator);
        assert_eq!(result.results.len(), 7);
        for row in &result.results {
            assert_eq!(row.len(), 1);
        }

        // One-variable col: 1 row, N columns
        let col_values: Vec<CellValue> = (0..4)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();
        let result = calculate_data_table(None, Some(cell(2)), &[], &col_values, double_evaluator);
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].len(), 4);

        // Two-variable: R rows x C columns
        let row_values: Vec<CellValue> = (0..5)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();
        let col_values: Vec<CellValue> = (0..3)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();
        let result = calculate_data_table(
            Some(cell(1)),
            Some(cell(2)),
            &row_values,
            &col_values,
            sum_evaluator,
        );
        assert_eq!(result.results.len(), 5);
        for row in &result.results {
            assert_eq!(row.len(), 3);
        }
    }

    // -----------------------------------------------------------------------
    // 9. test_formula_returning_text -- formula produces text values
    // -----------------------------------------------------------------------
    #[test]
    fn test_formula_returning_text() {
        let text_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
            if let Some(value) = overrides.values().next() {
                return CellValue::Text(format!("Result: {}", value).into());
            }
            CellValue::Text("empty".into())
        };

        let row_input = Some(cell(1));
        let row_values = vec![
            CellValue::Number(FiniteF64::must(1.0)),
            CellValue::Text("hello".into()),
        ];

        let result = calculate_data_table(row_input, None, &row_values, &[], text_evaluator);

        assert_eq!(result.results.len(), 2);
        assert!(matches!(result.results[0][0], CellValue::Text(_)));
        assert!(matches!(result.results[1][0], CellValue::Text(_)));
    }

    // -----------------------------------------------------------------------
    // 10. test_formula_returning_error -- formula produces error values
    // -----------------------------------------------------------------------
    #[test]
    fn test_formula_returning_error() {
        let error_evaluator = |_overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
            CellValue::Error(CellError::Div0, None)
        };

        let row_input = Some(cell(1));
        let row_values = vec![
            CellValue::Number(FiniteF64::must(1.0)),
            CellValue::Number(FiniteF64::must(2.0)),
        ];

        let result = calculate_data_table(row_input, None, &row_values, &[], error_evaluator);

        assert_eq!(result.results.len(), 2);
        assert_eq!(
            result.results[0][0],
            CellValue::Error(CellError::Div0, None)
        );
        assert_eq!(
            result.results[1][0],
            CellValue::Error(CellError::Div0, None)
        );
        assert_eq!(result.cell_count, 2);
    }

    // -----------------------------------------------------------------------
    // 11. test_override_applied -- verify override actually changes result
    // -----------------------------------------------------------------------
    #[test]
    fn test_override_applied() {
        let input_cell = cell(100);

        // Evaluator that checks the override map and returns the overridden value
        let identity_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
            overrides
                .get(&cell(100))
                .cloned()
                .unwrap_or(CellValue::Null)
        };

        let row_values = vec![
            CellValue::Number(FiniteF64::must(10.0)),
            CellValue::Number(FiniteF64::must(20.0)),
            CellValue::Number(FiniteF64::must(30.0)),
        ];

        let result =
            calculate_data_table(Some(input_cell), None, &row_values, &[], identity_evaluator);

        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(10.0))
        );
        assert_eq!(
            result.results[1][0],
            CellValue::Number(FiniteF64::must(20.0))
        );
        assert_eq!(
            result.results[2][0],
            CellValue::Number(FiniteF64::must(30.0))
        );
    }

    // -----------------------------------------------------------------------
    // 12. test_two_var_override_both -- verify both overrides applied simultaneously
    // -----------------------------------------------------------------------
    #[test]
    fn test_two_var_override_both() {
        let row_cell = cell(1);
        let col_cell = cell(2);

        // Evaluator that verifies both overrides are present and returns their product
        let verify_both_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
            let row_val = overrides.get(&cell(1));
            let col_val = overrides.get(&cell(2));
            match (row_val, col_val) {
                (Some(r), Some(c)) => {
                    let rn = r.coerce_to_number().unwrap_or(0.0);
                    let cn = c.coerce_to_number().unwrap_or(0.0);
                    CellValue::number(rn * cn)
                }
                _ => CellValue::Error(CellError::Value, None),
            }
        };

        let row_values = vec![
            CellValue::Number(FiniteF64::must(2.0)),
            CellValue::Number(FiniteF64::must(3.0)),
        ];
        let col_values = vec![
            CellValue::Number(FiniteF64::must(5.0)),
            CellValue::Number(FiniteF64::must(7.0)),
        ];

        let result = calculate_data_table(
            Some(row_cell),
            Some(col_cell),
            &row_values,
            &col_values,
            verify_both_evaluator,
        );

        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(10.0))
        ); // 2 * 5
        assert_eq!(
            result.results[0][1],
            CellValue::Number(FiniteF64::must(14.0))
        ); // 2 * 7
        assert_eq!(
            result.results[1][0],
            CellValue::Number(FiniteF64::must(15.0))
        ); // 3 * 5
        assert_eq!(
            result.results[1][1],
            CellValue::Number(FiniteF64::must(21.0))
        ); // 3 * 7
    }

    // -----------------------------------------------------------------------
    // 13. test_cell_count -- verify cell_count matches total cells computed
    // -----------------------------------------------------------------------
    #[test]
    fn test_cell_count() {
        // One-var row: 5 cells
        let result = calculate_data_table(
            Some(cell(1)),
            None,
            &(0..5)
                .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
                .collect::<Vec<_>>(),
            &[],
            double_evaluator,
        );
        assert_eq!(result.cell_count, 5);

        // One-var col: 8 cells
        let result = calculate_data_table(
            None,
            Some(cell(2)),
            &[],
            &(0..8)
                .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
                .collect::<Vec<_>>(),
            double_evaluator,
        );
        assert_eq!(result.cell_count, 8);

        // Two-var: 4 * 6 = 24 cells
        let result = calculate_data_table(
            Some(cell(1)),
            Some(cell(2)),
            &(0..4)
                .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
                .collect::<Vec<_>>(),
            &(0..6)
                .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
                .collect::<Vec<_>>(),
            sum_evaluator,
        );
        assert_eq!(result.cell_count, 24);
    }

    // -----------------------------------------------------------------------
    // 14. test_large_table -- 100x100 two-variable table
    // -----------------------------------------------------------------------
    #[test]
    fn test_large_table() {
        let row_values: Vec<CellValue> = (0..100)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();
        let col_values: Vec<CellValue> = (0..100)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();

        let result = calculate_data_table(
            Some(cell(1)),
            Some(cell(2)),
            &row_values,
            &col_values,
            sum_evaluator,
        );

        assert_eq!(result.results.len(), 100);
        assert_eq!(result.results[0].len(), 100);
        assert_eq!(result.cell_count, 10_000);
        assert!(!result.cancelled);

        // Spot check a few values
        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(0.0))
        ); // 0 + 0
        assert_eq!(
            result.results[99][99],
            CellValue::Number(FiniteF64::must(198.0))
        ); // 99 + 99
        assert_eq!(
            result.results[50][25],
            CellValue::Number(FiniteF64::must(75.0))
        ); // 50 + 25
    }

    // -----------------------------------------------------------------------
    // 15. test_boolean_input_values -- boolean input values work
    // -----------------------------------------------------------------------
    #[test]
    fn test_boolean_input_values() {
        let row_input = Some(cell(1));
        let row_values = vec![CellValue::Boolean(true), CellValue::Boolean(false)];

        // Evaluator that coerces boolean to number (TRUE=1, FALSE=0) and doubles it
        let result = calculate_data_table(row_input, None, &row_values, &[], double_evaluator);

        assert_eq!(result.results.len(), 2);
        // TRUE coerced to 1.0, doubled = 2.0
        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(2.0))
        );
        // FALSE coerced to 0.0, doubled = 0.0
        assert_eq!(
            result.results[1][0],
            CellValue::Number(FiniteF64::must(0.0))
        );
    }

    // -----------------------------------------------------------------------
    // 16. test_null_input_values -- Null input values work
    // -----------------------------------------------------------------------
    #[test]
    fn test_null_input_values() {
        let row_input = Some(cell(1));
        let row_values = vec![CellValue::Null];

        let result = calculate_data_table(row_input, None, &row_values, &[], double_evaluator);

        assert_eq!(result.results.len(), 1);
        // Null coerced to 0.0, doubled = 0.0
        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(0.0))
        );
        assert_eq!(result.cell_count, 1);
    }

    // -----------------------------------------------------------------------
    // 17. test_cancelled_is_always_false -- synchronous implementation
    // -----------------------------------------------------------------------
    #[test]
    fn test_cancelled_is_always_false() {
        let result = calculate_data_table(
            Some(cell(1)),
            None,
            &[CellValue::Number(FiniteF64::must(1.0))],
            &[],
            double_evaluator,
        );
        assert!(!result.cancelled);

        let result = calculate_data_table(None, None, &[], &[], double_evaluator);
        assert!(!result.cancelled);
    }

    // -----------------------------------------------------------------------
    // 18. test_mixed_value_types -- different CellValue types in row values
    // -----------------------------------------------------------------------
    #[test]
    fn test_mixed_value_types() {
        let identity_evaluator = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
            overrides.get(&cell(1)).cloned().unwrap_or(CellValue::Null)
        };

        let row_input = Some(cell(1));
        let row_values = vec![
            CellValue::Number(FiniteF64::must(42.0)),
            CellValue::Text("hello".into()),
            CellValue::Boolean(true),
            CellValue::Null,
            CellValue::Error(CellError::Na, None),
        ];

        let result = calculate_data_table(row_input, None, &row_values, &[], identity_evaluator);

        assert_eq!(result.results.len(), 5);
        assert_eq!(
            result.results[0][0],
            CellValue::Number(FiniteF64::must(42.0))
        );
        assert_eq!(result.results[1][0], CellValue::Text("hello".into()));
        assert_eq!(result.results[2][0], CellValue::Boolean(true));
        assert_eq!(result.results[3][0], CellValue::Null);
        assert_eq!(result.results[4][0], CellValue::Error(CellError::Na, None));
        assert_eq!(result.cell_count, 5);
    }
}
