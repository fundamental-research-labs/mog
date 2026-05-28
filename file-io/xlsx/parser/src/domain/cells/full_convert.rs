//! Conversion from fast worksheet cell buffers into full-parse cell output.

use std::collections::HashMap;

use crate::domain::cells::{
    AuthoredStyleOnlyCell, CELL_TYPE_BOOL, CELL_TYPE_EMPTY, CELL_TYPE_ERROR, CELL_TYPE_FORMULA,
    CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING, CellData, ParseExtras,
    VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE, VALUE_TYPE_SHARED_STRING,
    adjust_formula_references,
};
use crate::output::results::{
    CELL_TYPE_VAL_BOOL, CELL_TYPE_VAL_EMPTY, CELL_TYPE_VAL_ERROR, CELL_TYPE_VAL_FORMULA,
    CELL_TYPE_VAL_NUMBER, CELL_TYPE_VAL_STRING, DataTableInfo, FullCellData,
};
use ooxml_types::worksheet::ColWidth;

/// Build a flat col_styles lookup from parsed ColWidth entries.
///
/// Returns a Vec where index = 0-based column number, value = Some(style_id)
/// if that column has a non-zero default style. The cell parser uses this to
/// skip empty cells whose style matches the column default.
pub(crate) fn build_col_styles_from_widths(col_widths: &[ColWidth]) -> Vec<Option<u32>> {
    let max_col = col_widths
        .iter()
        .filter(|cw| cw.style.map(|s| s > 0).unwrap_or(false))
        .map(|cw| cw.max as usize)
        .max()
        .unwrap_or(0);
    if max_col == 0 {
        return Vec::new();
    }
    let mut styles = vec![None; max_col];
    for cw in col_widths {
        if let Some(style_id) = cw.style {
            if style_id > 0 {
                for one_based in cw.min..=cw.max.min(max_col as u32) {
                    let idx = one_based.saturating_sub(1) as usize;
                    if idx < styles.len() {
                        styles[idx] = Some(style_id);
                    }
                }
            }
        }
    }
    styles
}

/// Convert bytes to String after the XML part boundary has validated UTF-8.
#[inline]
fn bytes_to_string(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes)
        .expect("worksheet/shared-string XML text was validated as UTF-8 at the archive boundary")
        .to_owned()
}

#[inline]
fn needs_xstring_decode(bytes: &[u8]) -> bool {
    // Worksheet string-bearing text follows the same OOXML xstring boundary as
    // sharedStrings.xml: XML entities decode, _xHHHH_ escapes decode, and raw
    // XML CR/CRLF normalizes to LF.
    bytes.contains(&b'&') || bytes.contains(&b'_') || bytes.contains(&b'\r')
}

#[inline]
fn decode_xstring_to_string(bytes: &[u8], decode_buf: &mut Vec<u8>) -> String {
    if needs_xstring_decode(bytes) {
        decode_buf.clear();
        crate::domain::strings::read::decode_xml_entities_full(bytes, decode_buf);
        bytes_to_string(decode_buf)
    } else {
        bytes_to_string(bytes)
    }
}

pub(crate) fn coalesce_authored_style_only_cells(
    cells: &[AuthoredStyleOnlyCell],
) -> Vec<domain_types::AuthoredStyleRun> {
    if cells.is_empty() {
        return Vec::new();
    }

    let mut points = cells.to_vec();
    points.sort_by_key(|c| (c.row, c.col, c.style_idx));
    points.dedup_by_key(|c| (c.row, c.col, c.style_idx));

    let mut row_runs: Vec<domain_types::AuthoredStyleRun> = Vec::new();
    for point in points {
        if let Some(last) = row_runs.last_mut()
            && last.start_row == point.row
            && last.end_row == point.row
            && last.style_id == point.style_idx
            && last.end_col.saturating_add(1) == point.col
        {
            last.end_col = point.col;
            continue;
        }
        row_runs.push(domain_types::AuthoredStyleRun {
            start_row: point.row,
            start_col: point.col,
            end_row: point.row,
            end_col: point.col,
            style_id: point.style_idx,
        });
    }

    let mut rectangles: Vec<domain_types::AuthoredStyleRun> = Vec::new();
    let mut active: HashMap<(u32, u32, u32), usize> = HashMap::new();
    for run in row_runs {
        let key = (run.start_col, run.end_col, run.style_id);
        if let Some(&idx) = active.get(&key)
            && rectangles[idx].end_row.saturating_add(1) == run.start_row
        {
            rectangles[idx].end_row = run.end_row;
            continue;
        }
        let idx = rectangles.len();
        active.insert(key, idx);
        rectangles.push(run);
    }

    rectangles.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    rectangles
}

/// Convert a single CellData to FullCellData.
///
/// `decode_buf` is a reusable buffer for XML entity decoding, avoiding
/// per-cell allocation for cells containing `&amp;`, `&lt;`, etc.
pub(crate) fn convert_cell_data(
    c: &CellData,
    strings_buffer: &[u8],
    decode_buf: &mut Vec<u8>,
) -> FullCellData {
    let raw_string = if c.value_len > 0 && (c.value_offset as usize) < strings_buffer.len() {
        let start = c.value_offset as usize;
        let end = (start + c.value_len as usize).min(strings_buffer.len());
        let bytes = &strings_buffer[start..end];
        let value_already_decoded_from_sst = c.value_type == VALUE_TYPE_SHARED_STRING
            || (c.value_type == VALUE_TYPE_CACHED_FORMULA && c.cell_type == CELL_TYPE_STRING);
        let may_have_entities = !value_already_decoded_from_sst
            && (c.cell_type == CELL_TYPE_STRING
                || c.cell_type == CELL_TYPE_FORMULA_STRING
                || c.value_type == VALUE_TYPE_FORMULA);
        if may_have_entities {
            Some(decode_xstring_to_string(bytes, decode_buf))
        } else {
            Some(bytes_to_string(bytes))
        }
    } else if c.value_type == VALUE_TYPE_SHARED_STRING {
        Some(String::new())
    } else if c.value_type == VALUE_TYPE_INLINE && c.cell_type == CELL_TYPE_FORMULA_STRING {
        Some(String::new())
    } else if c.value_type == VALUE_TYPE_CACHED_FORMULA {
        Some(String::new())
    } else {
        None
    };

    let (cell_type, cached_value_type) =
        if c.value_type == VALUE_TYPE_FORMULA || c.value_type == VALUE_TYPE_CACHED_FORMULA {
            (CELL_TYPE_VAL_FORMULA, c.cell_type)
        } else if c.value_type == crate::domain::cells::types::VALUE_TYPE_NONE {
            let ct = match c.cell_type {
                CELL_TYPE_STRING => CELL_TYPE_VAL_STRING,
                _ => CELL_TYPE_VAL_EMPTY,
            };
            (ct, c.cell_type)
        } else {
            let ct = match c.cell_type {
                CELL_TYPE_EMPTY => CELL_TYPE_VAL_EMPTY,
                CELL_TYPE_NUMBER => CELL_TYPE_VAL_NUMBER,
                CELL_TYPE_STRING | CELL_TYPE_FORMULA_STRING => CELL_TYPE_VAL_STRING,
                crate::domain::cells::types::CELL_TYPE_DATE => {
                    crate::output::results::CELL_TYPE_VAL_DATE
                }
                CELL_TYPE_BOOL => CELL_TYPE_VAL_BOOL,
                CELL_TYPE_ERROR => CELL_TYPE_VAL_ERROR,
                CELL_TYPE_FORMULA => CELL_TYPE_VAL_FORMULA,
                _ => CELL_TYPE_VAL_EMPTY,
            };
            (ct, c.cell_type)
        };

    let (value, formula) = if c.value_type == VALUE_TYPE_FORMULA {
        (None, raw_string)
    } else if c.value_type == VALUE_TYPE_CACHED_FORMULA {
        (raw_string, None)
    } else {
        (raw_string, None)
    };

    FullCellData {
        row: c.row,
        col: c.col,
        cell_type,
        style_idx: c.style_idx,
        value,
        formula,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        phonetic: false,
        vm: None,
        date_lexical_value: None,
        cached_value_type,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    }
}

/// Apply the extras collected during the first parse pass to the FullCellData array.
pub(crate) fn apply_parse_extras(
    cells: &mut [FullCellData],
    extras: &ParseExtras,
    cells_buffer: &[CellData],
    strings_buffer: &[u8],
    shared_strings: &[String],
) {
    let mut decode_buf = Vec::new();
    for &(cell_idx, offset, len) in &extras.cached_values {
        if cell_idx < cells.len()
            && cells[cell_idx].formula.is_some()
            && cells[cell_idx].value.is_none()
        {
            let start = offset as usize;
            let end = (start + len as usize).min(strings_buffer.len());
            if start <= strings_buffer.len() {
                let value_bytes = &strings_buffer[start..end];
                let value_str = decode_xstring_to_string(value_bytes, &mut decode_buf);

                if cell_idx < cells_buffer.len() {
                    let cd = cells_buffer[cell_idx];
                    if cd.cell_type == CELL_TYPE_STRING {
                        let resolved = value_str
                            .parse::<usize>()
                            .ok()
                            .and_then(|idx| shared_strings.get(idx).cloned());
                        if let Some(s) = resolved {
                            cells[cell_idx].value = Some(s);
                        } else {
                            cells[cell_idx].value = Some(value_str.clone());
                        }
                    } else {
                        cells[cell_idx].value = Some(value_str.clone());
                    }
                } else {
                    cells[cell_idx].value = Some(value_str.clone());
                }
            }
        }
    }

    for &cell_idx in &extras.force_recalc_indices {
        if cell_idx < cells.len() {
            cells[cell_idx].force_recalc = true;
        }
    }
    for &cell_idx in &extras.xml_space_formula_indices {
        if cell_idx < cells.len() {
            cells[cell_idx].preserve_space_formula = true;
        }
    }
    for &cell_idx in &extras.xml_space_value_indices {
        if cell_idx < cells.len() {
            cells[cell_idx].preserve_space_value = true;
        }
    }
    for (cell_idx, ref_str) in &extras.array_refs {
        if *cell_idx < cells.len() {
            cells[*cell_idx].array_ref = Some(ref_str.clone());
        }
    }

    {
        use ooxml_types::worksheet::{CellFormula as OoxmlCellFormula, CellFormulaType};
        for (cell_idx, ref_str) in &extras.array_refs {
            if *cell_idx < cells.len() {
                let formula_text = cells[*cell_idx].formula.clone().unwrap_or_default();
                cells[*cell_idx].cell_formula = Some(OoxmlCellFormula {
                    t: CellFormulaType::Array,
                    r#ref: Some(ref_str.clone()),
                    text: formula_text,
                    ..Default::default()
                });
            }
        }
    }

    for &(cell_idx, cm_val) in &extras.cm_cells {
        if cell_idx < cells.len() {
            cells[cell_idx].cell_metadata_index = Some(cm_val);
        }
    }
    for &(cell_idx, vm_val) in &extras.vm_cells {
        if cell_idx < cells.len() {
            cells[cell_idx].vm = Some(vm_val);
        }
    }
    for &cell_idx in &extras.phonetic_cells {
        if cell_idx < cells.len() {
            cells[cell_idx].phonetic = true;
        }
    }
    for (cell_idx, date_value) in &extras.date_cells {
        if *cell_idx < cells.len() {
            cells[*cell_idx].date_lexical_value = Some(date_value.clone());
        }
    }
    for &cell_idx in &extras.aca_indices {
        if cell_idx < cells.len()
            && let Some(ref mut cf) = cells[cell_idx].cell_formula
        {
            cf.aca = true;
        }
    }
    for &(cell_idx, sst_idx) in &extras.sst_indices {
        if cell_idx < cells.len() {
            cells[cell_idx].sst_index = Some(sst_idx);
        }
    }
    for &cell_idx in &extras.explicit_style_cells {
        if cell_idx < cells.len() {
            cells[cell_idx].has_explicit_style = true;
        }
    }

    let need_pos_map = !extras.sf_masters.is_empty()
        || !extras.sf_refs.is_empty()
        || !extras.data_tables.is_empty();

    if !need_pos_map {
        return;
    }

    let mut cell_pos_map: HashMap<(u32, u32), usize> = HashMap::with_capacity(cells.len());
    for (idx, cell) in cells.iter().enumerate() {
        cell_pos_map.insert((cell.row, cell.col), idx);
    }

    if !extras.sf_masters.is_empty() && !extras.sf_refs.is_empty() {
        for &(si, ref_row, ref_col) in &extras.sf_refs {
            if let Some(master) = extras.sf_masters.get(&si) {
                let row_offset = ref_row as i32 - master.master_row as i32;
                let col_offset = ref_col as i32 - master.master_col as i32;
                let expanded = adjust_formula_references(
                    master.formula_text.as_bytes(),
                    row_offset,
                    col_offset,
                );
                if let Some(&cell_idx) = cell_pos_map.get(&(ref_row, ref_col)) {
                    cells[cell_idx].formula = Some(expanded);
                }
            }
        }
    }

    {
        use ooxml_types::worksheet::{CellFormula as OoxmlCellFormula, CellFormulaType};

        for (&si, master) in &extras.sf_masters {
            if let Some(&cell_idx) = cell_pos_map.get(&(master.master_row, master.master_col)) {
                cells[cell_idx].cell_formula = Some(OoxmlCellFormula {
                    t: CellFormulaType::Shared,
                    si: Some(si),
                    r#ref: Some(master.ref_range.clone()),
                    text: master.formula_text.clone(),
                    ..Default::default()
                });
            }
        }

        for &(si, ref_row, ref_col) in &extras.sf_refs {
            if let Some(&cell_idx) = cell_pos_map.get(&(ref_row, ref_col)) {
                cells[cell_idx].cell_formula = Some(OoxmlCellFormula {
                    t: CellFormulaType::Shared,
                    si: Some(si),
                    ..Default::default()
                });
            }
        }
    }

    for dt in &extras.data_tables {
        let formula = synthesize_data_table_formula(dt);
        for row in dt.start_row..=dt.end_row {
            for col in dt.start_col..=dt.end_col {
                if let Some(&cell_idx) = cell_pos_map.get(&(row, col)) {
                    let needs_formula = cells[cell_idx]
                        .formula
                        .as_ref()
                        .map_or(true, |f| f.is_empty());
                    if needs_formula {
                        cells[cell_idx].formula = Some(formula.clone());
                    }
                }
            }
        }
    }

    {
        use ooxml_types::worksheet::{CellFormula as OoxmlCellFormula, CellFormulaType};

        for dt in &extras.data_tables {
            if let Some(&cell_idx) = cell_pos_map.get(&(dt.start_row, dt.start_col)) {
                let ref_range = format!(
                    "{}:{}",
                    crate::infra::a1::to_a1(dt.start_row, dt.start_col),
                    crate::infra::a1::to_a1(dt.end_row, dt.end_col),
                );
                cells[cell_idx].cell_formula = Some(OoxmlCellFormula {
                    t: CellFormulaType::DataTable,
                    r#ref: Some(ref_range),
                    r1: dt.r1.clone().or_else(|| {
                        dt.row_input_ref
                            .as_ref()
                            .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
                    }),
                    r2: dt.r2.clone().or_else(|| {
                        dt.col_input_ref
                            .as_ref()
                            .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
                    }),
                    aca: dt.aca,
                    ca: dt.ca,
                    bx: dt.bx,
                    dt2d: dt.dt2d,
                    dtr: dt.dtr,
                    del1: dt.del1,
                    del2: dt.del2,
                    ..Default::default()
                });
            }
        }
    }
}

pub(crate) fn data_table_ooxml_flags(
    dt: &crate::domain::cells::types::DataTableEntry,
) -> domain_types::DataTableOoxmlFlags {
    domain_types::DataTableOoxmlFlags {
        r1: dt.r1.clone(),
        r2: dt.r2.clone(),
        aca: dt.aca,
        ca: dt.ca,
        bx: dt.bx,
        dt2d: dt.dt2d,
        dtr: dt.dtr,
        del1: dt.del1,
        del2: dt.del2,
    }
}

pub(crate) fn data_table_info(dt: &crate::domain::cells::types::DataTableEntry) -> DataTableInfo {
    DataTableInfo {
        start_row: dt.start_row,
        start_col: dt.start_col,
        end_row: dt.end_row,
        end_col: dt.end_col,
        row_input_ref: dt.row_input_ref,
        col_input_ref: dt.col_input_ref,
        ooxml_flags: Some(data_table_ooxml_flags(dt)),
    }
}

/// Synthesize the `TABLE(r2, r1)` formula text written into every body cell
/// of a data-table region.
fn synthesize_data_table_formula(dt: &crate::domain::cells::types::DataTableEntry) -> String {
    let r1_arg = dt
        .row_input_ref
        .as_ref()
        .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
        .unwrap_or_else(|| "\"\"".to_string());
    let r2_arg = dt
        .col_input_ref
        .as_ref()
        .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
        .unwrap_or_else(|| "\"\"".to_string());
    format!("TABLE({},{})", r2_arg, r1_arg)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cell(
        row: u32,
        col: u32,
        cell_type: u8,
        value: Option<&str>,
        formula: Option<&str>,
    ) -> FullCellData {
        FullCellData {
            row,
            col,
            cell_type,
            style_idx: 0,
            value: value.map(|s| s.to_string()),
            formula: formula.map(|s| s.to_string()),
            force_recalc: false,
            array_ref: None,
            cell_metadata_index: None,
            vm: None,
            phonetic: false,
            date_lexical_value: None,
            cached_value_type: 0,
            cell_formula: None,
            preserve_space_formula: false,
            preserve_space_value: false,
            sst_index: None,
            has_explicit_style: false,
        }
    }

    #[test]
    fn convert_cell_data_does_not_double_decode_shared_string_entities() {
        let strings_buffer = b"Design &lt;br&gt; work";
        let cell = CellData {
            row: 0,
            col: 0,
            cell_type: CELL_TYPE_STRING,
            style_idx: 0,
            value_type: VALUE_TYPE_SHARED_STRING,
            value_offset: 0,
            value_len: strings_buffer.len() as u32,
        };
        let mut decode_buf = Vec::new();

        let converted = convert_cell_data(&cell, strings_buffer, &mut decode_buf);

        assert_eq!(converted.value.as_deref(), Some("Design &lt;br&gt; work"));
    }

    #[test]
    fn convert_cell_data_decodes_raw_inline_string_entities_once() {
        let strings_buffer = b"Design &amp; build";
        let cell = CellData {
            row: 0,
            col: 0,
            cell_type: CELL_TYPE_FORMULA_STRING,
            style_idx: 0,
            value_type: VALUE_TYPE_INLINE,
            value_offset: 0,
            value_len: strings_buffer.len() as u32,
        };
        let mut decode_buf = Vec::new();

        let converted = convert_cell_data(&cell, strings_buffer, &mut decode_buf);

        assert_eq!(converted.value.as_deref(), Some("Design & build"));
    }

    #[test]
    fn convert_cell_data_normalizes_raw_xml_crlf_in_formula_string_values() {
        let strings_buffer = b"alpha\r\nbeta";
        let cell = CellData {
            row: 0,
            col: 0,
            cell_type: CELL_TYPE_FORMULA_STRING,
            style_idx: 0,
            value_type: VALUE_TYPE_CACHED_FORMULA,
            value_offset: 0,
            value_len: strings_buffer.len() as u32,
        };
        let mut decode_buf = Vec::new();

        let converted = convert_cell_data(&cell, strings_buffer, &mut decode_buf);

        assert_eq!(converted.value.as_deref(), Some("alpha\nbeta"));
    }

    #[test]
    fn convert_cell_data_decodes_ooxml_escapes_in_raw_inline_strings() {
        let strings_buffer = b"alpha_x000D_\nbeta_x005F_x000D_";
        let cell = CellData {
            row: 0,
            col: 0,
            cell_type: CELL_TYPE_FORMULA_STRING,
            style_idx: 0,
            value_type: VALUE_TYPE_INLINE,
            value_offset: 0,
            value_len: strings_buffer.len() as u32,
        };
        let mut decode_buf = Vec::new();

        let converted = convert_cell_data(&cell, strings_buffer, &mut decode_buf);

        assert_eq!(converted.value.as_deref(), Some("alpha\r\nbeta_x000D_"));
    }

    #[test]
    fn convert_cell_data_does_not_double_decode_cached_formula_shared_string() {
        let strings_buffer = b"Cached &lt;br&gt; text";
        let cell = CellData {
            row: 0,
            col: 0,
            cell_type: CELL_TYPE_STRING,
            style_idx: 0,
            value_type: VALUE_TYPE_CACHED_FORMULA,
            value_offset: 0,
            value_len: strings_buffer.len() as u32,
        };
        let mut decode_buf = Vec::new();

        let converted = convert_cell_data(&cell, strings_buffer, &mut decode_buf);

        assert_eq!(converted.value.as_deref(), Some("Cached &lt;br&gt; text"));
    }

    #[test]
    fn apply_parse_extras_decodes_cached_formula_xstring_values() {
        let strings_buffer = b"cached_x000D_\r\nvalue";
        let cells_buffer = [CellData {
            row: 0,
            col: 0,
            cell_type: CELL_TYPE_FORMULA_STRING,
            style_idx: 0,
            value_type: VALUE_TYPE_CACHED_FORMULA,
            value_offset: 0,
            value_len: strings_buffer.len() as u32,
        }];
        let mut cells = vec![make_cell(0, 0, CELL_TYPE_VAL_FORMULA, None, Some("A1"))];
        let mut extras = ParseExtras::default();
        extras
            .cached_values
            .push((0, 0, strings_buffer.len() as u32));

        apply_parse_extras(&mut cells, &extras, &cells_buffer, strings_buffer, &[]);

        assert_eq!(cells[0].value.as_deref(), Some("cached\r\nvalue"));
    }

    #[test]
    fn shared_formula_slave_missing_master_gets_no_formula() {
        let mut cells = vec![make_cell(
            620,
            37,
            CELL_TYPE_VAL_FORMULA,
            Some("#N/A"),
            None,
        )];

        let mut extras = ParseExtras::default();
        extras.sf_refs.push((0, 620, 37));

        apply_parse_extras(&mut cells, &extras, &[], &[], &[]);

        assert!(cells[0].formula.is_none());
    }

    #[test]
    fn shared_formula_slave_existing_master_gets_expanded_formula() {
        let mut cells = vec![
            make_cell(0, 0, CELL_TYPE_VAL_FORMULA, Some("1"), Some("A1+1")),
            make_cell(1, 0, CELL_TYPE_VAL_FORMULA, Some("2"), None),
        ];

        let mut extras = ParseExtras::default();
        extras.sf_masters.insert(
            0,
            crate::domain::cells::types::SharedFormulaMaster {
                formula_text: "A1+1".to_string(),
                master_row: 0,
                master_col: 0,
                ref_range: "A1:A2".to_string(),
            },
        );
        extras.sf_refs.push((0, 1, 0));

        apply_parse_extras(&mut cells, &extras, &[], &[], &[]);

        assert_eq!(cells[1].formula.as_deref(), Some("A2+1"));
    }

    #[test]
    fn shared_formula_mixed_masters_some_missing() {
        let mut cells = vec![
            make_cell(
                0,
                0,
                CELL_TYPE_VAL_FORMULA,
                Some("#N/A"),
                Some("VLOOKUP(A1,$B$1:$D$10,3)"),
            ),
            make_cell(1, 0, CELL_TYPE_VAL_FORMULA, Some("#N/A"), None),
            make_cell(2, 0, CELL_TYPE_VAL_FORMULA, Some("#N/A"), None),
            make_cell(0, 5, CELL_TYPE_VAL_FORMULA, Some("10"), Some("E1+1")),
            make_cell(1, 5, CELL_TYPE_VAL_FORMULA, Some("11"), None),
        ];

        let mut extras = ParseExtras::default();
        extras.sf_masters.insert(
            0,
            crate::domain::cells::types::SharedFormulaMaster {
                formula_text: "VLOOKUP(A1,$B$1:$D$10,3)".to_string(),
                master_row: 0,
                master_col: 0,
                ref_range: "A1:A3".to_string(),
            },
        );
        extras.sf_masters.insert(
            2,
            crate::domain::cells::types::SharedFormulaMaster {
                formula_text: "E1+1".to_string(),
                master_row: 0,
                master_col: 5,
                ref_range: "F1:F2".to_string(),
            },
        );

        extras.sf_refs.push((0, 1, 0));
        extras.sf_refs.push((1, 2, 0));
        extras.sf_refs.push((2, 1, 5));

        apply_parse_extras(&mut cells, &extras, &[], &[], &[]);

        assert!(cells[1].formula.is_some());
        assert!(cells[2].formula.is_none());
        assert!(cells[4].formula.is_some());
    }

    #[test]
    fn shared_formula_missing_master_preserves_cached_value() {
        let mut cells = vec![make_cell(
            620,
            37,
            CELL_TYPE_VAL_FORMULA,
            Some("#N/A"),
            None,
        )];

        let mut extras = ParseExtras::default();
        extras.sf_refs.push((0, 620, 37));

        apply_parse_extras(&mut cells, &extras, &[], &[], &[]);

        assert!(cells[0].formula.is_none());
        assert_eq!(cells[0].value.as_deref(), Some("#N/A"));
        assert_eq!(cells[0].cell_type, CELL_TYPE_VAL_FORMULA);
    }

    #[test]
    fn shared_formula_missing_master_no_cached_value() {
        let mut cells = vec![make_cell(620, 37, CELL_TYPE_VAL_FORMULA, None, None)];

        let mut extras = ParseExtras::default();
        extras.sf_refs.push((0, 620, 37));

        apply_parse_extras(&mut cells, &extras, &[], &[], &[]);

        assert!(cells[0].formula.is_none());
        assert!(cells[0].value.is_none());
        assert_eq!(cells[0].cell_type, CELL_TYPE_VAL_FORMULA);
    }

    #[test]
    fn shared_formula_chain_first_cell_missing_master() {
        let mut cells: Vec<FullCellData> = (0..5)
            .map(|i| make_cell(620 + i, 37, CELL_TYPE_VAL_FORMULA, Some("#N/A"), None))
            .collect();

        let mut extras = ParseExtras::default();
        for i in 0..5 {
            extras.sf_refs.push((0, 620 + i, 37));
        }

        apply_parse_extras(&mut cells, &extras, &[], &[], &[]);

        for (i, cell) in cells.iter().enumerate() {
            assert!(
                cell.formula.is_none(),
                "Cell at row {} should have no formula",
                620 + i as u32
            );
            assert_eq!(cell.value.as_deref(), Some("#N/A"));
        }
    }

    #[test]
    fn shared_formula_cells_get_cell_formula_metadata() {
        use ooxml_types::worksheet::CellFormulaType;

        let mut cells = vec![
            make_cell(0, 0, CELL_TYPE_VAL_FORMULA, Some("1"), Some("A1+1")),
            make_cell(1, 0, CELL_TYPE_VAL_FORMULA, Some("2"), None),
        ];

        let mut extras = ParseExtras::default();
        extras.sf_masters.insert(
            0,
            crate::domain::cells::types::SharedFormulaMaster {
                formula_text: "A1+1".to_string(),
                master_row: 0,
                master_col: 0,
                ref_range: "A1:A2".to_string(),
            },
        );
        extras.sf_refs.push((0, 1, 0));

        apply_parse_extras(&mut cells, &extras, &[], &[], &[]);

        let master_cf = cells[0]
            .cell_formula
            .as_ref()
            .expect("master should have cell_formula");
        assert_eq!(master_cf.t, CellFormulaType::Shared);
        assert_eq!(master_cf.si, Some(0));
        assert_eq!(master_cf.r#ref.as_deref(), Some("A1:A2"));
        assert_eq!(master_cf.text, "A1+1");

        let ref_cf = cells[1]
            .cell_formula
            .as_ref()
            .expect("reference should have cell_formula");
        assert_eq!(ref_cf.t, CellFormulaType::Shared);
        assert_eq!(ref_cf.si, Some(0));
        assert_eq!(ref_cf.r#ref, None);
        assert_eq!(cells[1].formula.as_deref(), Some("A2+1"));
    }
}
