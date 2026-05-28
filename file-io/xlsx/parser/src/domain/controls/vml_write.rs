//! VML drawing writer for form controls and OLE preview shapes.

use super::anchors::vml_offset;
use super::mapping::{check_state_to_vml, object_type_to_vml};
use super::types::{ControlAnchor, FormControl, FormControlType, OleObject};
use crate::infra::xml::raw_xml_contains_relationship_attr;
use crate::write::xml_writer::XmlWriter;

/// VML namespace.
const VML_NS: &str = "urn:schemas-microsoft-com:vml";

/// Office namespace for VML.
const OFFICE_NS: &str = "urn:schemas-microsoft-com:office:office";

/// Excel namespace for VML.
const EXCEL_NS: &str = "urn:schemas-microsoft-com:office:excel";

pub fn write_vml_form_controls(controls: &[FormControl], base_shape_id: u32) -> Vec<u8> {
    let mut w = XmlWriter::new();

    w.start_element("xml")
        .attr("xmlns:v", VML_NS)
        .attr("xmlns:o", OFFICE_NS)
        .attr("xmlns:x", EXCEL_NS)
        .end_attrs();

    let idmap_data = controls
        .first()
        .and_then(|c| c.vml_shape.idmap_data.as_deref())
        .unwrap_or("1");
    w.start_element_ns("o", "shapelayout")
        .attr("v:ext", "edit")
        .end_attrs();
    w.start_element_ns("o", "idmap")
        .attr("v:ext", "edit")
        .attr("data", idmap_data)
        .self_close();
    w.end_element_ns("o", "shapelayout");

    write_vml_shapetype_201(&mut w);

    for (i, control) in controls.iter().enumerate() {
        let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
        write_vml_shape(&mut w, control, shape_id);
    }

    w.end_element("xml");
    w.finish()
}

pub fn write_vml_with_ole(
    controls: &[FormControl],
    base_shape_id: u32,
    ole_objects: &[OleObject],
    ole_preview_rel_ids: &[String],
) -> Vec<u8> {
    let mut w = XmlWriter::new();

    w.start_element("xml")
        .attr("xmlns:v", VML_NS)
        .attr("xmlns:o", OFFICE_NS)
        .attr("xmlns:x", EXCEL_NS)
        .end_attrs();

    w.start_element_ns("o", "shapelayout")
        .attr("v:ext", "edit")
        .end_attrs();
    w.start_element_ns("o", "idmap")
        .attr("v:ext", "edit")
        .attr("data", "1")
        .self_close();
    w.end_element_ns("o", "shapelayout");

    if !controls.is_empty() {
        write_vml_shapetype_201(&mut w);
    }
    if !ole_objects.is_empty() {
        write_vml_shapetype_75(&mut w);
    }

    for (i, control) in controls.iter().enumerate() {
        let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
        write_vml_shape(&mut w, control, shape_id);
    }

    for (i, ole_obj) in ole_objects.iter().enumerate() {
        let preview_rel_id = ole_preview_rel_ids.get(i).map(|s| s.as_str()).unwrap_or("");
        write_vml_ole_shape(&mut w, ole_obj, ole_obj.shape_id, preview_rel_id);
    }

    w.end_element("xml");
    w.finish()
}

fn write_vml_shapetype_201(w: &mut XmlWriter) {
    w.start_element_ns("v", "shapetype")
        .attr("id", "_x0000_t201")
        .attr("coordsize", "21600,21600")
        .attr("o:spt", "201")
        .attr("path", "m,l,21600r21600,l21600,xe")
        .end_attrs();
    w.start_element_ns("v", "stroke")
        .attr("joinstyle", "miter")
        .self_close();
    w.start_element_ns("v", "path")
        .attr("shadowok", "f")
        .attr("o:extrusionok", "f")
        .attr("strokeok", "f")
        .attr("fillok", "f")
        .attr("o:connecttype", "rect")
        .self_close();
    w.start_element_ns("o", "lock")
        .attr("v:ext", "edit")
        .attr("shapetype", "t")
        .self_close();
    w.end_element_ns("v", "shapetype");
}

fn write_vml_shapetype_75(w: &mut XmlWriter) {
    w.start_element_ns("v", "shapetype")
        .attr("id", "_x0000_t75")
        .attr("coordsize", "21600,21600")
        .attr("o:spt", "75")
        .attr("o:preferrelative", "t")
        .attr("path", "m@4@5l@4@11@9@11@9@5xe")
        .attr("filled", "f")
        .attr("stroked", "f")
        .end_attrs();
    w.start_element_ns("v", "stroke")
        .attr("joinstyle", "miter")
        .self_close();
    w.start_element_ns("v", "formulas").end_attrs();
    w.start_element_ns("v", "f")
        .attr("eqn", "if lineDrawn pixelLineWidth 0")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @0 1 0")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum 0 0 @1")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @2 1 2")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @3 21600 pixelWidth")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @3 21600 pixelHeight")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @0 0 1")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @6 1 2")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @7 21600 pixelWidth")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @8 21600 0")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @7 21600 pixelHeight")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @10 21600 0")
        .self_close();
    w.end_element_ns("v", "formulas");
    w.start_element_ns("v", "path")
        .attr("o:extrusionok", "f")
        .attr("gradientshapeok", "t")
        .attr("o:connecttype", "rect")
        .self_close();
    w.start_element_ns("o", "lock")
        .attr("v:ext", "edit")
        .attr("aspectratio", "t")
        .self_close();
    w.end_element_ns("v", "shapetype");
}

fn write_vml_ole_shape(w: &mut XmlWriter, ole: &OleObject, shape_id: u32, preview_rel_id: &str) {
    let shape_id_str = format!("_x0000_s{}", shape_id);
    let anchor = &ole.anchor;
    let style = format!(
        "position:absolute;margin-left:0;margin-top:0;width:{}pt;height:{}pt;z-index:{}",
        compute_ole_vml_width(anchor),
        compute_ole_vml_height(anchor),
        shape_id.saturating_sub(1024),
    );

    w.start_element_ns("v", "shape")
        .attr("id", &shape_id_str)
        .attr("type", "#_x0000_t75")
        .attr("style", &style)
        .attr("o:insetmode", "auto")
        .end_attrs();

    if !preview_rel_id.is_empty() {
        w.start_element_ns("v", "imagedata")
            .attr("o:relid", preview_rel_id)
            .attr("o:title", "")
            .self_close();
    }

    w.start_element_ns("o", "lock")
        .attr("v:ext", "edit")
        .attr("rotation", "t")
        .self_close();

    w.start_element_ns("x", "ClientData")
        .attr("ObjectType", "Pict")
        .end_attrs();
    write_vml_anchor(w, anchor);
    w.element_with_text("x:AutoFill", "False");
    w.element_with_text("x:AutoLine", "False");

    if let Some(ref object_pr) = ole.object_pr {
        if let Some(ref obj_anchor) = object_pr.anchor {
            if obj_anchor.size_with_cells {
                w.start_element_ns("x", "SizeWithCells").self_close();
            }
            if obj_anchor.move_with_cells {
                w.start_element_ns("x", "MoveWithCells").self_close();
            }
        }
    }

    w.end_element_ns("x", "ClientData");
    w.end_element_ns("v", "shape");
}

fn write_vml_shape(w: &mut XmlWriter, control: &FormControl, shape_id: u32) {
    let shape_id_str = format!("_x0000_s{}", shape_id);
    let anchor = &control.anchor;
    let vml = &control.vml_shape;

    let style = vml.style.clone().unwrap_or_else(|| {
        format!(
            "position:absolute;margin-left:0;margin-top:0;width:{}pt;height:{}pt;z-index:{};mso-wrap-style:tight",
            compute_vml_width(anchor),
            compute_vml_height(anchor),
            shape_id - 1024,
        )
    });

    let el = w
        .start_element_ns("v", "shape")
        .attr("id", &shape_id_str)
        .attr("type", "#_x0000_t201")
        .attr("style", &style);
    if vml.is_button {
        el.attr("o:button", "t");
    }
    if let Some(ref fillcolor) = vml.fillcolor {
        el.attr("fillcolor", fillcolor);
    }
    if let Some(ref strokecolor) = vml.strokecolor {
        el.attr("strokecolor", strokecolor);
    }
    el.attr("o:insetmode", "auto").end_attrs();

    if let Some(ref fill) = vml.fill_xml {
        if !raw_xml_contains_relationship_attr(fill) {
            w.raw_str(fill);
        }
    }
    if let Some(ref lock) = vml.lock_xml {
        if !raw_xml_contains_relationship_attr(lock) {
            w.raw_str(lock);
        }
    }

    match control.object_type {
        FormControlType::CheckBox
        | FormControlType::RadioButton
        | FormControlType::GroupBox
        | FormControlType::Label
        | FormControlType::Button => {
            let tb = w.start_element_ns("v", "textbox");
            if let Some(ref style) = vml.textbox_style {
                tb.attr("style", style);
            }
            if let Some(ref singleclick) = vml.textbox_singleclick {
                tb.attr("o:singleclick", singleclick);
            }
            tb.end_attrs();

            if let Some(ref content) = vml.textbox_content {
                if !raw_xml_contains_relationship_attr(content) {
                    w.raw_str(content);
                }
            } else {
                let text = control.properties.name.as_deref().unwrap_or("");
                if !text.is_empty() {
                    w.raw_str(&format!(
                        "<div style=\"text-align:left\">{}</div>",
                        escape_xml_text(text)
                    ));
                }
            }
            w.end_element_ns("v", "textbox");
        }
        _ => {}
    }

    w.start_element_ns("x", "ClientData")
        .attr("ObjectType", &object_type_to_vml(&control.object_type))
        .end_attrs();

    write_vml_anchor(w, anchor);

    if let Some(v) = control.properties.vml_extras.get("PrintObject") {
        w.element_with_text("x:PrintObject", v);
    }
    w.element_with_text("x:AutoFill", "False");

    write_vml_control_specific(w, control);

    for (tag, value) in &control.properties.vml_extras {
        match tag.as_str() {
            "PrintObject" => continue,
            "FmlaMacro" if control.properties.macro_name.is_some() => continue,
            "TextHAlign" if control.properties.text_h_align.is_some() => continue,
            "TextVAlign" if control.properties.text_v_align.is_some() => continue,
            _ => {}
        }
        w.element_with_text(&format!("x:{}", tag), value);
    }

    w.end_element_ns("x", "ClientData");
    w.end_element_ns("v", "shape");
}

fn write_vml_anchor(w: &mut XmlWriter, anchor: &ControlAnchor) {
    let vml_anchor = format!(
        "{}, {}, {}, {}, {}, {}, {}, {}",
        anchor.from_col,
        vml_offset(anchor.from_col_offset, &anchor.anchor_source),
        anchor.from_row,
        vml_offset(anchor.from_row_offset, &anchor.anchor_source),
        anchor.to_col,
        vml_offset(anchor.to_col_offset, &anchor.anchor_source),
        anchor.to_row,
        vml_offset(anchor.to_row_offset, &anchor.anchor_source),
    );
    w.element_with_text("x:Anchor", &vml_anchor);
}

fn write_vml_control_specific(w: &mut XmlWriter, control: &FormControl) {
    let props = &control.properties;

    if let Some(ref v) = props.linked_cell {
        w.element_with_text("x:FmlaLink", v);
    }
    if let Some(ref v) = props.input_range {
        w.element_with_text("x:FmlaRange", v);
    }
    if let Some(ref v) = props.fmla_group {
        w.element_with_text("x:FmlaGroup", v);
    }
    if let Some(ref v) = props.fmla_txbx {
        w.element_with_text("x:FmlaTxbx", v);
    }
    if let Some(ref checked) = props.checked {
        w.element_with_text("x:Checked", check_state_to_vml(checked));
    }
    if let Some(val) = props.val {
        w.element_with_text("x:Val", &val.to_string());
    }
    if let Some(sel) = props.sel {
        w.element_with_text("x:Sel", &sel.to_string());
    }
    if let Some(min) = props.min_value {
        w.element_with_text("x:Min", &min.to_string());
    }
    if let Some(max) = props.max_value {
        w.element_with_text("x:Max", &max.to_string());
    }
    if let Some(inc) = props.increment {
        w.element_with_text("x:Inc", &inc.to_string());
    }
    if let Some(page) = props.page_increment {
        w.element_with_text("x:Page", &page.to_string());
    }
    if let Some(dl) = props.drop_lines {
        w.element_with_text("x:DropLines", &dl.to_string());
    }
    if let Some(dx) = props.dx {
        w.element_with_text("x:Dx", &dx.to_string());
    }
    if let Some(ref v) = props.sel_type {
        w.element_with_text("x:SelType", v);
    }
    if let Some(ref v) = props.drop_style {
        w.element_with_text("x:DropStyle", v);
    }
    if let Some(ref v) = props.multi_sel {
        w.element_with_text("x:MultiSel", v);
    }
    if props.lock_text {
        w.element_with_text("x:LockText", "True");
    }
    if props.no_three_d {
        w.start_element_ns("x", "NoThreeD").self_close();
    }
    if props.no_three_d2 {
        w.start_element_ns("x", "NoThreeD2").self_close();
    }
    if props.colored {
        w.start_element_ns("x", "Colored").self_close();
    }
    if props.horiz {
        w.element_with_text("x:Horiz", "True");
    }
    if props.first_button {
        w.start_element_ns("x", "FirstButton").self_close();
    }
    if props.multi_line {
        w.start_element_ns("x", "MultiLine").self_close();
    }
    if props.vertical_bar {
        w.start_element_ns("x", "VScroll").self_close();
    }
    if props.password_edit {
        w.start_element_ns("x", "PasswordEdit").self_close();
    }
    if let Some(ref v) = props.macro_name {
        w.element_with_text("x:FmlaMacro", v);
    }
    if let Some(ref v) = props.text_h_align {
        w.element_with_text("x:TextHAlign", v);
    }
    if let Some(ref v) = props.text_v_align {
        w.element_with_text("x:TextVAlign", v);
    }
}

fn compute_ole_vml_width(anchor: &ControlAnchor) -> u32 {
    let col_diff = anchor.to_col.saturating_sub(anchor.from_col);
    col_diff * 64 + 48
}

fn compute_ole_vml_height(anchor: &ControlAnchor) -> u32 {
    let row_diff = anchor.to_row.saturating_sub(anchor.from_row);
    row_diff * 15 + 15
}

fn compute_vml_width(anchor: &ControlAnchor) -> u32 {
    let col_diff = anchor.to_col.saturating_sub(anchor.from_col);
    col_diff * 64 + 48
}

fn compute_vml_height(anchor: &ControlAnchor) -> u32 {
    let row_diff = anchor.to_row.saturating_sub(anchor.from_row);
    row_diff * 15 + 15
}

pub(crate) fn escape_xml_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            _ => result.push(ch),
        }
    }
    result
}
