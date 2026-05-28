/// Convert domain-types `FormControl` items into parser-internal `FormControl`
/// items for the controls writer.
///
/// The domain FormControl stores control type, anchor, and a JSON properties blob.
/// This reverses the conversion done in `to_parse_output::features::convert_form_controls`.
/// Convert unified `FloatingObject` items with `FormControl` data into writer `FormControl`.
pub(super) fn convert_unified_form_controls(
    controls: &[&domain_types::domain::floating_object::FloatingObject],
) -> Vec<crate::domain::controls::types::FormControl> {
    use crate::domain::controls::types::{
        AnchorSource, CheckState, ControlAnchor, FormControl, FormControlProperties,
        FormControlType, VmlShapeProps,
    };
    use std::collections::HashMap;

    controls
        .iter()
        .filter_map(|fo| {
            let fc_data = match &fo.data {
                domain_types::domain::floating_object::FloatingObjectData::FormControl(d) => d,
                _ => return None,
            };
            // Filter out "Note" controls
            if fc_data.control_type == "Note" {
                return None;
            }

            let object_type = FormControlType::from_str(&fc_data.control_type);
            let props = fc_data.ooxml.as_ref();
            let default_props =
                domain_types::domain::floating_object::FormControlOoxmlProps::default();
            let p = props.unwrap_or(&default_props);
            let anchor_ref = &fo.common.anchor;

            let anchor_source = match p.anchor_source.as_str() {
                "Modern" => AnchorSource::Modern,
                _ => AnchorSource::Vml,
            };

            let anchor = ControlAnchor {
                from_col: anchor_ref.anchor_col,
                from_col_offset: anchor_ref.anchor_col_offset,
                from_row: anchor_ref.anchor_row,
                from_row_offset: anchor_ref.anchor_row_offset,
                to_col: anchor_ref.end_col.unwrap_or(anchor_ref.anchor_col + 2),
                to_col_offset: anchor_ref.end_col_offset.unwrap_or(0),
                to_row: anchor_ref.end_row.unwrap_or(anchor_ref.anchor_row + 2),
                to_row_offset: anchor_ref.end_row_offset.unwrap_or(0),
                anchor_source,
            };

            let checked = p.checked.as_deref().map(CheckState::from_str);

            let vml_extras: HashMap<String, String> = p.vml_extras.clone();

            let items: Vec<String> = p.items.clone();

            let name_opt = if fo.common.name.is_empty() {
                None
            } else {
                Some(fo.common.name.clone())
            };

            let properties = FormControlProperties {
                name: name_opt,
                alt_text: p.alt_text.clone(),
                linked_cell: fc_data.cell_link.clone(),
                input_range: fc_data.input_range.clone(),
                fmla_group: p.fmla_group.clone(),
                fmla_txbx: p.fmla_txbx.clone(),
                checked,
                val: p.val,
                sel: p.sel,
                min_value: p.min,
                max_value: p.max,
                increment: p.inc,
                page_increment: p.page,
                drop_lines: p.drop_lines,
                sel_type: p.sel_type.clone(),
                drop_style: p.drop_style.clone(),
                macro_name: p.macro_name.clone(),
                colored: p.colored,
                dx: p.dx,
                horiz: p.horiz,
                first_button: p.first_button,
                no_three_d: p.no_three_d,
                no_three_d2: p.no_three_d2,
                lock_text: p.lock_text,
                multi_sel: p.multi_sel.clone(),
                text_h_align: p.text_h_align.clone(),
                text_v_align: p.text_v_align.clone(),
                edit_val: p.edit_val.clone(),
                multi_line: p.multi_line,
                vertical_bar: p.vertical_bar,
                password_edit: p.password_edit,
                just_last_x: p.just_last_x,
                width_min: p.width_min,
                items,
                vml_extras,
            };

            let shape_id = if p.shape_id != 0 {
                Some(p.shape_id)
            } else {
                None
            };

            let control_pr_attrs: HashMap<String, String> = p.control_pr_attrs.clone();

            // Read the typed VmlShapeProps directly (typed OOXML preservation).
            let vml_shape: VmlShapeProps = p.vml_shape.clone().unwrap_or_default();

            Some(FormControl {
                object_type,
                anchor,
                properties,
                shape_id,
                control_pr_attrs,
                control_pr: p.control_pr.clone(),
                move_with_cells: p.move_with_cells,
                size_with_cells: p.size_with_cells,
                vml_shape,
            })
        })
        .collect()
}
