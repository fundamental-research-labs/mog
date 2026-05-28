use super::super::types::{CELL_TYPE_DATE, CellData, ParseExtras};
use super::xml_text::validated_xml_text;

pub(super) struct CellExtrasInput {
    pub(super) cm_val: Option<u32>,
    pub(super) vm_val: Option<u32>,
    pub(super) has_ph: bool,
    pub(super) has_explicit_s: bool,
    pub(super) has_xml_space_v: bool,
    pub(super) sst_raw_idx: Option<u32>,
}

pub(super) fn collect_cell_extras(
    extras: &mut ParseExtras,
    last_idx: usize,
    cell_data: CellData,
    strings: &[u8],
    input: CellExtrasInput,
) {
    if let Some(cm) = input.cm_val {
        extras.cm_cells.push((last_idx, cm));
    }
    if let Some(vm) = input.vm_val {
        extras.vm_cells.push((last_idx, vm));
    }
    if input.has_ph {
        extras.phonetic_cells.push(last_idx);
    }
    if cell_data.cell_type == CELL_TYPE_DATE {
        let start = cell_data.value_offset as usize;
        let end = (start + cell_data.value_len as usize).min(strings.len());
        if start <= strings.len() {
            extras
                .date_cells
                .push((last_idx, validated_xml_text(&strings[start..end])));
        }
    }
    if input.has_explicit_s {
        extras.explicit_style_cells.push(last_idx);
    }
    if input.has_xml_space_v {
        extras.xml_space_value_indices.push(last_idx);
    }
    if let Some(idx) = input.sst_raw_idx {
        extras.sst_indices.push((last_idx, idx));
    }
}
