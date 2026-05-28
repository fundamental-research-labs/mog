use domain_types::ParseOutput;
use yrs::MapRef;

use super::HydrationIdMap;

pub(super) fn hydrate_data_table_regions_from_parse_output(
    workbook: &MapRef,
    output: &ParseOutput,
    id_map: &HydrationIdMap,
    txn: &mut yrs::TransactionMut<'_>,
) {
    let regions = data_table_regions_for_hydration(output, id_map);
    crate::storage::workbook::data_tables::hydrate_data_table_regions(workbook, &regions, txn);
}

fn data_table_regions_for_hydration(
    output: &ParseOutput,
    id_map: &HydrationIdMap,
) -> Vec<snapshot_types::DataTableRegionDef> {
    output
        .data_table_regions
        .iter()
        .filter_map(|region| {
            let sheet_id = id_map.sheet_ids.get(region.sheet_index as usize)?;
            Some(snapshot_types::DataTableRegionDef {
                sheet: sheet_id.to_uuid_string(),
                start_row: region.start_row,
                start_col: region.start_col,
                end_row: region.end_row,
                end_col: region.end_col,
                row_input_ref: region.row_input_ref,
                col_input_ref: region.col_input_ref,
                ooxml_flags: region.ooxml_flags.clone().map(|flags| {
                    snapshot_types::DataTableOoxmlFlags {
                        r1: flags.r1,
                        r2: flags.r2,
                        aca: flags.aca,
                        ca: flags.ca,
                        bx: flags.bx,
                        dt2d: flags.dt2d,
                        dtr: flags.dtr,
                        del1: flags.del1,
                        del2: flags.del2,
                    }
                }),
            })
        })
        .collect()
}
