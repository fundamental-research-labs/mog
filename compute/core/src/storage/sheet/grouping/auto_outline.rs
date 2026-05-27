use cell_types::{SheetId, col_to_letter};
use regex::Regex;
use yrs::{Doc, MapRef};

use super::crud::group_rows;
use super::queries::get_groups;
use super::types::{CellRange, GroupAxis, SubtotalsCellAccessor};

pub fn auto_outline(
    doc: &Doc,
    sheets: &MapRef,
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
) -> u32 {
    let agg_re = Regex::new(r"(?i)\b(SUM|SUBTOTAL|AVERAGE|COUNT|MAX|MIN|PRODUCT)\s*\(").unwrap();
    let mut created: u32 = 0;
    for row in (range.start_row() + 1)..=range.end_row() {
        for col in range.start_col()..=range.end_col() {
            let raw = cell_accessor.get_cell_raw_value(sheet_id, row, col);
            if !raw.starts_with('=') {
                continue;
            }
            let formula = raw.to_uppercase();
            if !agg_re.is_match(&formula) {
                continue;
            }
            let cl = col_to_letter(col);
            let rp = Regex::new(&format!(r"(?i){}(\d+):{}(\d+)", cl, cl)).unwrap();
            if let Some(caps) = rp.captures(&formula) {
                let rs: u32 = caps[1].parse::<u32>().unwrap_or(0).saturating_sub(1);
                let re: u32 = caps[2].parse::<u32>().unwrap_or(0).saturating_sub(1);
                if rs >= range.start_row() && re < row && re >= rs {
                    let existing = get_groups(doc, sheets, sheet_id, GroupAxis::Row);
                    if !existing.iter().any(|g| g.start == rs && g.end == row)
                        && group_rows(doc, sheets, sheet_id, rs, row).is_ok()
                    {
                        created += 1;
                    }
                }
            }
        }
    }
    created
}

// =============================================================================
// Subtotal Integration
// =============================================================================
