use super::super::helpers::{extract_formula_extras_fused, parse_cell_ref_fast};
use super::super::types::{
    CellData, ParseExtras, SharedFormulaMaster, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA,
};
use super::data_tables::push_data_table_entry;
use super::xml_text::validated_xml_text;

pub(super) fn collect_formula_extras(
    extras: &mut ParseExtras,
    last_idx: usize,
    cell_data: CellData,
    cell_xml: &[u8],
    strings: &mut Vec<u8>,
    has_xml_space_v: bool,
) {
    if cell_data.value_type != VALUE_TYPE_FORMULA
        && cell_data.value_type != VALUE_TYPE_CACHED_FORMULA
    {
        return;
    }

    let fe = extract_formula_extras_fused(cell_xml);

    if !has_xml_space_v && fe.v_xml_space {
        extras.xml_space_value_indices.push(last_idx);
    }

    if let Some(sf) = &fe.shared {
        if let Some((cell_row, cell_col)) = parse_cell_ref_fast(cell_xml) {
            if sf.is_master {
                if let Some(formula_bytes) = fe.formula_text {
                    let formula_text = if formula_bytes.contains(&b'&') {
                        let mut decoded = Vec::with_capacity(formula_bytes.len());
                        crate::domain::strings::read::decode_xml_entities_full(
                            formula_bytes,
                            &mut decoded,
                        );
                        validated_xml_text(&decoded)
                    } else {
                        validated_xml_text(formula_bytes)
                    };
                    let ref_range_str = sf.ref_range.map(validated_xml_text).unwrap_or_default();
                    extras.sf_masters.insert(
                        sf.si,
                        SharedFormulaMaster {
                            formula_text,
                            master_row: cell_row,
                            master_col: cell_col,
                            ref_range: ref_range_str,
                        },
                    );
                }
            } else {
                extras.sf_refs.push((sf.si, cell_row, cell_col));
            }
        }
    }

    if cell_data.value_type == VALUE_TYPE_FORMULA {
        if fe.v_self_closing {
            let offset = strings.len() as u32;
            extras.cached_values.push((last_idx, offset, 0));
        } else if let Some(cached_bytes) = fe.v_content {
            let offset = strings.len() as u32;
            let len = cached_bytes.len() as u32;
            strings.extend_from_slice(cached_bytes);
            extras.cached_values.push((last_idx, offset, len));
        }
    }

    if fe.ca {
        extras.force_recalc_indices.push(last_idx);
    }
    if fe.aca {
        extras.aca_indices.push(last_idx);
    }
    if fe.f_xml_space {
        extras.xml_space_formula_indices.push(last_idx);
    }
    if fe.is_array {
        if let Some(ref_bytes) = fe.f_ref {
            let ref_val = validated_xml_text(ref_bytes);
            extras.array_refs.push((last_idx, ref_val));
        }
    }
    if fe.is_data_table && cell_data.value_type == VALUE_TYPE_CACHED_FORMULA {
        push_data_table_entry(extras, &fe, cell_xml);
    }
}
