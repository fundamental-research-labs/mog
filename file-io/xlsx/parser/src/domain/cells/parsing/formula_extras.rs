use super::super::helpers::{
    extract_formula_extras_fused, extract_inline_string_owned_forward, find_start_tag,
    parse_cell_ref_fast,
};
use super::super::types::{
    CellData, EmptyFormulaMetadata, ParseExtras, SharedFormulaMaster, VALUE_TYPE_CACHED_FORMULA,
    VALUE_TYPE_FORMULA,
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

    // Some producers encode formula caches with <is> rather than <v>.
    // Decode each text run once, exactly as for ordinary inline strings.
    if fe.v_content.is_none()
        && !fe.v_self_closing
        && let Some(is_tag) = find_start_tag(cell_xml, b"is", 0)
        && let Some(text) = extract_inline_string_owned_forward(cell_xml, is_tag.lt)
    {
        extras
            .cached_inline_strings
            .push((last_idx, validated_xml_text(&text)));
    }

    if fe.ca {
        extras.force_recalc_indices.push(last_idx);
    }
    if fe.v_self_closing || fe.v_content.is_some_and(|value| value.is_empty()) {
        extras.empty_cached_value_indices.push(last_idx);
    }
    if fe.aca {
        extras.aca_indices.push(last_idx);
    }
    if fe.f_xml_space {
        extras.xml_space_formula_indices.push(last_idx);
    }

    // A self-closing formula without a shared/array/data-table type is still
    // authored formula markup. Keep its attributes as metadata, but do not
    // synthesize an executable empty formula string. Array followers use this
    // form; the array master's range remains the source of their grouping.
    if fe.empty_formula && fe.shared.is_none() && !fe.is_array && !fe.is_data_table {
        extras.empty_formula_metadata.push((
            last_idx,
            EmptyFormulaMetadata {
                ca: fe.ca,
                aca: fe.aca,
                bx: fe.bx,
                dt2d: fe.dt2d,
                dtr: fe.dtr,
                del1: fe.del1,
                del2: fe.del2,
                ref_range: fe.f_ref.map(validated_xml_text),
                r1: fe.r1.map(validated_xml_text),
                r2: fe.r2.map(validated_xml_text),
            },
        ));
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
