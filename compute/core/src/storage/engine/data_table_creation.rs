use cell_types::SheetPos;
use value_types::{CellValue, ComputeError};

use crate::data_table::CreateDataTableInput;
use crate::snapshot::{MutationResult, RecalcResult};

use super::data_table_formula;
use super::mutation::{self, MutationOutput};
use super::{YrsComputeEngine, services};

pub(super) fn create_data_table(
    engine: &mut YrsComputeEngine,
    input: CreateDataTableInput,
) -> Result<MutationOutput, ComputeError> {
    let (region, data) = crate::data_table::prepare_data_table_creation(&engine.mirror, &input)?;
    let table_formula =
        data_table_formula::formula_for_region(&engine.mirror, &input.sheet_id, &region)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: "DATA_TABLE_INPUT_REQUIRED: Data Table formula inputs are required"
                    .to_string(),
            })?;

    let mut recalc = materialize_data_table_body(engine, &input, &region, &table_formula)?;
    engine.prepare_recalc_for_flush(&mut recalc);

    if data_table_body_missing_values(engine, &input, &region) {
        let _ = services::mutation_handlers::mutation_clear_range_by_position(
            &mut engine.stores,
            &mut engine.mirror,
            &mut engine.mutation,
            input.sheet_id,
            region.start_row,
            region.start_col,
            region.end_row,
            region.end_col,
        );
        return Err(ComputeError::InvalidInput {
            message:
                "DATA_TABLE_EVALUATION_UNSUPPORTED: createDataTable did not materialize computed body values"
                    .to_string(),
        });
    }

    crate::storage::workbook::data_tables::upsert_data_table_region(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        &region,
    );
    engine.mirror.upsert_data_table_region(region);
    Ok(MutationOutput::Recalc(
        MutationResult::from_recalc(recalc).with_data(&data)?,
    ))
}

fn materialize_data_table_body(
    engine: &mut YrsComputeEngine,
    input: &CreateDataTableInput,
    region: &snapshot_types::DataTableRegionDef,
    table_formula: &str,
) -> Result<RecalcResult, ComputeError> {
    let mut edits = Vec::with_capacity(
        ((region.end_row - region.start_row + 1) * (region.end_col - region.start_col + 1))
            as usize,
    );
    for row in region.start_row..=region.end_row {
        for col in region.start_col..=region.end_col {
            edits.push((
                input.sheet_id,
                row,
                col,
                mutation::CellInput::formula(table_formula),
            ));
        }
    }

    services::mutation_handlers::mutation_set_cells_by_position(
        &mut engine.stores,
        &mut engine.mirror,
        &mut engine.mutation,
        edits,
        true,
    )
}

fn data_table_body_missing_values(
    engine: &YrsComputeEngine,
    input: &CreateDataTableInput,
    region: &snapshot_types::DataTableRegionDef,
) -> bool {
    for row in region.start_row..=region.end_row {
        for col in region.start_col..=region.end_col {
            let Some(cell_id) = engine
                .mirror
                .resolve_cell_id(&input.sheet_id, SheetPos::new(row, col))
            else {
                return true;
            };
            let has_table_formula = engine
                .stores
                .compute
                .get_formula(&cell_id)
                .is_some_and(|formula| formula.to_ascii_uppercase().contains("TABLE("));
            let has_computed_value = engine
                .mirror
                .get_cell_value_raw(&cell_id)
                .is_some_and(|value| !matches!(value, CellValue::Null));
            if !has_table_formula || !has_computed_value {
                return true;
            }
        }
    }
    false
}
