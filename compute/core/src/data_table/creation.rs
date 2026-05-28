use cell_types::{SheetId, SheetPos};
use snapshot_types::DataTableRegionDef;
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::range_manager::parse_range;

use super::errors::invalid_data_table;
use super::geometry::Rect;
use super::refs::{
    cell_ref_from_pos, range_string, rect_from_range, resolve_optional_input_cell,
    resolve_range_sheet,
};
use super::types::{CreateDataTableInput, CreateDataTableResult, DataTableLayout};

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

pub(super) fn validate_formula_sources(
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

pub(super) fn require_formula_at(
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

pub(super) fn validate_body_is_empty(
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

pub(super) fn validate_region_collisions(
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
