use std::sync::Arc;

use compute_document::schema::{KEY_CELLS, KEY_FORMULA, KEY_FORMULA_TEMPLATE, KEY_SHEET_ORDER};
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Array, ArrayRef, Doc, Map, MapRef, Origin, Out, Transact};

struct CellFormulaUpdate {
    sheet_hex: String,
    cell_hex: String,
    new_template: String,
    new_formula: String,
}

fn get_sheet_order_array<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<ArrayRef> {
    match workbook.get(txn, KEY_SHEET_ORDER) {
        Some(Out::YArray(arr)) => Some(arr),
        _ => None,
    }
}

pub(super) fn update_matching_formula_cells<M, R>(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    matcher: M,
    rewriter: R,
) -> u32
where
    M: Fn(&str) -> bool,
    R: Fn(&str, &str) -> (String, String),
{
    let updates: Vec<CellFormulaUpdate> = {
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
                            Some(Out::Any(Any::String(s))) => s.to_string(),
                            _ => continue,
                        };

                        if !matcher(&template) {
                            continue;
                        }

                        let formula = match cell_map.get(&txn, KEY_FORMULA) {
                            Some(Out::Any(Any::String(s))) => s.to_string(),
                            _ => String::new(),
                        };
                        let (new_template, new_formula) = rewriter(&template, &formula);

                        updates.push(CellFormulaUpdate {
                            sheet_hex: sheet_hex.to_string(),
                            cell_hex: cell_hex.clone(),
                            new_template,
                            new_formula,
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
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    for update in &updates {
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &update.sheet_hex)
            && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
            && let Some(Out::YMap(cell_map)) = cells_map.get(&txn, update.cell_hex.as_str())
        {
            cell_map.insert(
                &mut txn,
                KEY_FORMULA_TEMPLATE,
                Any::String(Arc::from(update.new_template.as_str())),
            );
            cell_map.insert(
                &mut txn,
                KEY_FORMULA,
                Any::String(Arc::from(update.new_formula.as_str())),
            );
        }
    }

    count
}
