use std::sync::Arc;

use compute_document::schema::{KEY_CELLS, KEY_FORMULA, KEY_FORMULA_TEMPLATE, KEY_SHEET_ORDER};
use yrs::{Any, Array, ArrayRef, Doc, Map, MapRef, Out, Transact};

/// Formula field values to write for a matching cell.
pub(super) struct FormulaFieldUpdate {
    pub(super) new_template: Option<String>,
    pub(super) new_formula: Option<String>,
}

struct CellUpdate {
    sheet_hex: String,
    cell_hex: String,
    fields: FormulaFieldUpdate,
}

/// Read the sheetOrder array from the workbook map.
pub(super) fn get_sheet_order_array<T: yrs::ReadTxn>(
    workbook: &MapRef,
    txn: &T,
) -> Option<ArrayRef> {
    match workbook.get(txn, KEY_SHEET_ORDER) {
        Some(Out::YArray(arr)) => Some(arr),
        _ => None,
    }
}

pub(super) fn update_formula_cells<F>(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    mut build_update: F,
) -> u32
where
    F: FnMut(Option<&str>, Option<&str>) -> Option<FormulaFieldUpdate>,
{
    let updates: Vec<CellUpdate> = {
        let txn = doc.transact();
        let Some(order_arr) = get_sheet_order_array(workbook, &txn) else {
            return 0;
        };
        let len = order_arr.len(&txn);
        let mut updates = Vec::new();

        for i in 0..len {
            if let Some(Out::Any(Any::String(sheet_hex))) = order_arr.get(&txn, i)
                && let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
                && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
            {
                let keys: Vec<String> = cells_map.keys(&txn).map(|k| k.to_string()).collect();

                for cell_hex in &keys {
                    if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex.as_str()) {
                        let template = match cell_map.get(&txn, KEY_FORMULA_TEMPLATE) {
                            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
                            _ => None,
                        };
                        let formula = match cell_map.get(&txn, KEY_FORMULA) {
                            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
                            _ => None,
                        };

                        let Some(fields) = build_update(template.as_deref(), formula.as_deref())
                        else {
                            continue;
                        };

                        updates.push(CellUpdate {
                            sheet_hex: sheet_hex.to_string(),
                            cell_hex: cell_hex.clone(),
                            fields,
                        });
                    }
                }
            }
        }

        updates
    };

    if updates.is_empty() {
        return 0;
    }

    let count = updates.len() as u32;
    let mut txn = doc.transact_mut();

    for update in &updates {
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &update.sheet_hex)
            && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
            && let Some(Out::YMap(cell_map)) = cells_map.get(&txn, update.cell_hex.as_str())
        {
            if let Some(ref new_template) = update.fields.new_template {
                cell_map.insert(
                    &mut txn,
                    KEY_FORMULA_TEMPLATE,
                    Any::String(Arc::from(new_template.as_str())),
                );
            }
            if let Some(ref new_formula) = update.fields.new_formula {
                cell_map.insert(
                    &mut txn,
                    KEY_FORMULA,
                    Any::String(Arc::from(new_formula.as_str())),
                );
            }
        }
    }

    count
}
