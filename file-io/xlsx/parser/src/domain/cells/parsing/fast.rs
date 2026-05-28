use super::super::adapters::{find_byte, find_sequence};
use super::super::helpers::{ScanResult, find_sheet_data, parse_row_number, scan_cell};
use super::super::types::{CellData, ParseExtras};
use super::cell_extras::{CellExtrasInput, collect_cell_extras};
use super::formula_extras::collect_formula_extras;
use super::rows::apply_fast_row_attrs;
use ooxml_types::worksheet::RowHeight;

pub(super) fn parse_worksheet_core(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    row_heights: &mut Vec<RowHeight>,
    mut extras: Option<&mut ParseExtras>,
    col_styles: &[Option<u32>],
) -> usize {
    let mut cell_idx = 0;
    let mut pos = 0;

    pos = match find_sheet_data(xml, pos) {
        Some(p) => p,
        None => return 0,
    };

    let sheet_data_end = find_sequence(xml, b"</sheetData>", pos).unwrap_or(xml.len());
    let mut current_row: u32 = 0;
    let mut current_row_style: Option<u32> = None;

    while pos < sheet_data_end && cell_idx < cells.len() {
        if let Some(tag_start) = find_byte(xml, b'<', pos) {
            if tag_start >= sheet_data_end {
                break;
            }
            pos = tag_start + 1;

            if pos + 3 < xml.len()
                && xml[pos] == b'r'
                && xml[pos + 1] == b'o'
                && xml[pos + 2] == b'w'
            {
                if let Some(row_num) = parse_row_number(xml, pos) {
                    current_row = row_num.saturating_sub(1);
                }
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    let applied = apply_fast_row_attrs(
                        &xml[pos..gt],
                        current_row,
                        gt > 0 && xml[gt - 1] == b'/',
                        row_heights,
                        extras.as_deref_mut(),
                    );
                    current_row_style = applied.row_style;
                    pos = gt + 1;
                }
            } else if xml[pos] == b'c'
                && (xml.get(pos + 1).map_or(true, |&c| c == b' ' || c == b'>'))
            {
                let cell_start = tag_start;
                let ScanResult {
                    cell: cell_opt,
                    end: cell_end,
                    is_self_closing,
                    cm_val,
                    vm_val,
                    has_ph,
                    has_explicit_s,
                    has_xml_space_v,
                    sst_raw_idx,
                    authored_style_only,
                } = match scan_cell(
                    xml,
                    cell_start,
                    current_row,
                    shared_strings,
                    strings,
                    current_row_style,
                    col_styles,
                ) {
                    Some(sr) => sr,
                    None => break,
                };

                let cell_parsed = if let Some(cell_data) = cell_opt {
                    cells[cell_idx] = cell_data;
                    cell_idx += 1;
                    true
                } else {
                    false
                };

                if let Some(ext) = extras.as_deref_mut() {
                    if let Some(style_only) = authored_style_only {
                        ext.authored_style_only_cells.push(style_only);
                    }
                    if cell_parsed {
                        let last_idx = cell_idx - 1;
                        let cell_data = cells[last_idx];
                        collect_cell_extras(
                            ext,
                            last_idx,
                            cell_data,
                            strings,
                            CellExtrasInput {
                                cm_val,
                                vm_val,
                                has_ph,
                                has_explicit_s,
                                has_xml_space_v,
                                sst_raw_idx,
                            },
                        );
                        if !is_self_closing {
                            let cell_xml = &xml[cell_start..cell_end];
                            collect_formula_extras(
                                ext,
                                last_idx,
                                cell_data,
                                cell_xml,
                                strings,
                                has_xml_space_v,
                            );
                        }
                    }
                }

                pos = cell_end;
            } else if xml[pos] == b'/' {
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    pos = gt + 1;
                }
            } else if let Some(gt) = find_byte(xml, b'>', pos) {
                pos = gt + 1;
            }
        } else {
            break;
        }
    }

    cell_idx
}
