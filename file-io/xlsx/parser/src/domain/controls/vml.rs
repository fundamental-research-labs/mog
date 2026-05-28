//! Legacy VML controls contract.
//!
//! Owns VML shape discovery, `x:ClientData` parsing, visual shape
//! preservation, VML-only ClientData extras, and OLE preview image discovery.

use std::collections::HashMap;

use super::anchors::vml_offset;
use super::mapping::{check_state_to_vml, object_type_to_vml};
use super::relationships;
use super::types::{ControlAnchor, FormControl, FormControlType, OleObject};
use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_string_attr_verbatim};
use crate::write::xml_writer::XmlWriter;

/// VML namespace.
const VML_NS: &str = "urn:schemas-microsoft-com:vml";

/// Office namespace for VML.
const OFFICE_NS: &str = "urn:schemas-microsoft-com:office:office";

/// Excel namespace for VML.
const EXCEL_NS: &str = "urn:schemas-microsoft-com:office:excel";

const VML_ONLY_TAGS: &[&str] = &[
    "FmlaPict",
    "Accel",
    "Accel2",
    "Row",
    "Column",
    "Visible",
    "RowHidden",
    "ColHidden",
    "Default",
    "Help",
    "Cancel",
    "Dismiss",
    "ValidIds",
    "MapOCX",
    "Camera",
    "AutoScale",
    "DDE",
    "ScriptText",
    "ScriptExtended",
    "ScriptLanguage",
    "ScriptLocation",
    "LCT",
];

// Slices use offsets from ASCII VML/XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_vml_drawing(xml: &[u8], controls: &mut Vec<FormControl>) {
    let mut pos = 0;

    while let Some(shape_start) = find_tag_simd(xml, b"v:shape", pos) {
        let shape_end = find_closing_tag(xml, b"v:shape", shape_start).unwrap_or(xml.len());
        let shape_slice = &xml[shape_start..shape_end];

        if let Some(client_rel) = find_tag_simd(shape_slice, b"x:ClientData", 0) {
            let client_end_rel = find_closing_tag(shape_slice, b"x:ClientData", client_rel)
                .unwrap_or(shape_slice.len());
            let cd = &shape_slice[client_rel..client_end_rel];

            let element_end = find_gt_simd(cd, 0).map(|p| p + 1).unwrap_or(cd.len());
            let element = &cd[..element_end];
            let object_type_str = parse_string_attr(element, b"ObjectType=\"");

            if object_type_str.as_deref() == Some("Note") {
                pos = shape_end;
                continue;
            }

            let object_type = object_type_str
                .map(|s| FormControlType::from_str(&s))
                .unwrap_or(FormControlType::Unknown("Unknown".to_string()));

            let mut control = FormControl::new(object_type);

            parse_vml_shape_props(xml, shape_start, shape_slice, client_rel, &mut control);
            parse_mapped_client_data(cd, &mut control);
            parse_vml_anchor(cd, &mut control);
            parse_vml_linked_properties(cd, &mut control);
            parse_vml_only_extras(cd, &mut control);

            controls.push(control);
        }

        pos = shape_end + 1;
    }
}

// Slices use offsets from ASCII VML/XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_vml_imagedata(xml: &[u8]) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let mut pos = 0;

    while let Some(shape_start) = find_tag_simd(xml, b"v:shape", pos) {
        let shape_end = find_closing_tag(xml, b"v:shape", shape_start).unwrap_or(xml.len());
        let shape_tag_end = find_gt_simd(xml, shape_start)
            .map(|p| p + 1)
            .unwrap_or(shape_end);
        let shape_element = &xml[shape_start..shape_tag_end];

        let shape_id_str = parse_string_attr_verbatim(shape_element, b"id=\"");

        if let Some(imgdata_start) = find_tag_simd(xml, b"v:imagedata", shape_start) {
            if imgdata_start < shape_end {
                let imgdata_end = find_gt_simd(xml, imgdata_start)
                    .map(|p| p + 1)
                    .unwrap_or(shape_end);
                let imgdata_element = &xml[imgdata_start..imgdata_end];

                let rel_id = parse_string_attr(imgdata_element, b"o:relid=\"")
                    .or_else(|| parse_string_attr(imgdata_element, b"r:id=\""));

                if let (Some(sid), Some(rid)) = (shape_id_str.as_ref(), rel_id) {
                    result.insert(sid.clone(), rid);
                }
            }
        }

        pos = shape_end + 1;
    }

    result
}

pub fn extract_vml_shape_number(vml_id: &str) -> Option<u32> {
    if let Some(idx) = vml_id.rfind('s') {
        vml_id.get(idx + 1..)?.parse().ok()
    } else {
        vml_id.parse().ok()
    }
}

/// Parse VML drawing controls for a sheet from worksheet VML relationships.
pub(crate) fn parse_vml_drawing_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    rels_xml: &[u8],
) -> Vec<FormControl> {
    let relationships = relationships::parse_worksheet_relationships(sheet_num, rels_xml);
    let mut all_vml_controls = Vec::new();

    for full_path in relationships::legacy_vml_drawing_targets(&relationships) {
        if let Ok(vml_xml) = archive.read_file(full_path) {
            parse_vml_drawing(&vml_xml, &mut all_vml_controls);
        }
    }

    all_vml_controls
}

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
        if !crate::infra::xml::raw_xml_contains_relationship_attr(fill) {
            w.raw_str(fill);
        }
    }
    if let Some(ref lock) = vml.lock_xml {
        if !crate::infra::xml::raw_xml_contains_relationship_attr(lock) {
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
                if !crate::infra::xml::raw_xml_contains_relationship_attr(content) {
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

// Slices use offsets from ASCII VML/XML tag delimiters.
#[allow(clippy::string_slice)]
fn parse_vml_shape_props(
    full_xml: &[u8],
    shape_start: usize,
    shape_slice: &[u8],
    client_rel: usize,
    control: &mut FormControl,
) {
    let shape_tag_end = find_gt_simd(shape_slice, 0).unwrap_or(shape_slice.len());
    let shape_tag = &shape_slice[..shape_tag_end];

    control.vml_shape.style = parse_vml_attr(shape_tag, b"style=");
    control.vml_shape.is_button =
        parse_string_attr(shape_tag, b"o:button=\"").map_or(false, |v| v == "t");
    control.vml_shape.fillcolor = parse_string_attr(shape_tag, b"fillcolor=\"");
    control.vml_shape.strokecolor = parse_string_attr(shape_tag, b"strokecolor=\"");
    control.shape_id = parse_string_attr_verbatim(shape_tag, b"o:spid=\"")
        .or_else(|| parse_string_attr_verbatim(shape_tag, b"id=\""))
        .and_then(|id| extract_vml_shape_number(&id));

    if let Some(fill_start) = find_tag_simd(shape_slice, b"v:fill", 0) {
        if fill_start < client_rel {
            let fill_gt = find_gt_simd(shape_slice, fill_start)
                .map(|g| g + 1)
                .unwrap_or(shape_slice.len());
            if let Ok(s) = std::str::from_utf8(&shape_slice[fill_start..fill_gt]) {
                control.vml_shape.fill_xml = Some(s.to_string());
            }
        }
    }

    if let Some(lock_start) = find_tag_simd(shape_slice, b"o:lock", 0) {
        if lock_start < client_rel {
            let lock_gt = find_gt_simd(shape_slice, lock_start)
                .map(|g| g + 1)
                .unwrap_or(shape_slice.len());
            if let Ok(s) = std::str::from_utf8(&shape_slice[lock_start..lock_gt]) {
                control.vml_shape.lock_xml = Some(s.to_string());
            }
        }
    }

    if let Some(tb_start) = find_tag_simd(shape_slice, b"v:textbox", 0) {
        if tb_start < client_rel {
            let tb_tag_end = find_gt_simd(shape_slice, tb_start).unwrap_or(shape_slice.len());
            let tb_tag = &shape_slice[tb_start..tb_tag_end];
            control.vml_shape.textbox_style = parse_vml_attr(tb_tag, b"style=");
            control.vml_shape.textbox_singleclick = parse_string_attr(tb_tag, b"o:singleclick=\"");

            let content_start = tb_tag_end + 1;
            if let Some(tb_close) = find_closing_tag(shape_slice, b"v:textbox", tb_start) {
                if let Ok(s) = std::str::from_utf8(&shape_slice[content_start..tb_close]) {
                    let trimmed = s.trim();
                    if !trimmed.is_empty() {
                        control.vml_shape.textbox_content = Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    let pre_shape = &full_xml[..shape_start];
    if let Some(idmap_start) = pre_shape.windows(8).rposition(|w| w == b"o:idmap") {
        let idmap_slice = &full_xml[idmap_start..shape_start];
        control.vml_shape.idmap_data = parse_string_attr(idmap_slice, b"data=\"");
    }
}

fn parse_mapped_client_data(cd: &[u8], control: &mut FormControl) {
    if control.properties.macro_name.is_none() {
        if let Some(text) = client_data_text(cd, b"x:FmlaMacro") {
            control.properties.macro_name = Some(text);
        }
    }
    if control.properties.text_h_align.is_none() {
        if let Some(text) = client_data_text(cd, b"x:TextHAlign") {
            control.properties.text_h_align = Some(text);
        }
    }
    if control.properties.text_v_align.is_none() {
        if let Some(text) = client_data_text(cd, b"x:TextVAlign") {
            control.properties.text_v_align = Some(text);
        }
    }
    if let Some(text) = client_data_text(cd, b"x:PrintObject") {
        control
            .properties
            .vml_extras
            .insert("PrintObject".to_string(), text);
    }
}

// Slices use offsets from ASCII VML/XML tag delimiters.
#[allow(clippy::string_slice)]
fn parse_vml_anchor(cd: &[u8], control: &mut FormControl) {
    if let Some(anchor_start) = find_tag_simd(cd, b"x:Anchor", 0) {
        let anchor_end = find_closing_tag(cd, b"x:Anchor", anchor_start).unwrap_or(cd.len());
        let content_start = find_gt_simd(cd, anchor_start)
            .map(|p| p + 1)
            .unwrap_or(anchor_end);
        let anchor_text = &cd[content_start..anchor_end];
        let anchor_str = String::from_utf8_lossy(anchor_text);
        if let Some(anchor) = ControlAnchor::from_vml_anchor(&anchor_str) {
            control.anchor = anchor;
        }
    }
}

fn parse_vml_linked_properties(cd: &[u8], control: &mut FormControl) {
    if let Some(link_text) = client_data_text_preserve(cd, b"x:FmlaLink") {
        control.properties.linked_cell = Some(link_text);
    }
    if let Some(range_text) = client_data_text_preserve(cd, b"x:FmlaRange") {
        control.properties.input_range = Some(range_text);
    }
}

// Slices use offsets from ASCII VML/XML tag delimiters.
#[allow(clippy::string_slice)]
fn parse_vml_only_extras(cd: &[u8], control: &mut FormControl) {
    for tag_name in VML_ONLY_TAGS {
        let prefixed = format!("x:{}", tag_name);
        if let Some(tag_start) = find_tag_simd(cd, prefixed.as_bytes(), 0) {
            let gt_pos = find_gt_simd(cd, tag_start).unwrap_or(cd.len());
            let is_self_closing = gt_pos > 0 && cd[gt_pos - 1] == b'/';

            if is_self_closing {
                control
                    .properties
                    .vml_extras
                    .insert(tag_name.to_string(), String::new());
            } else {
                let content_start = gt_pos + 1;
                let tag_end =
                    find_closing_tag(cd, prefixed.as_bytes(), tag_start).unwrap_or(cd.len());
                let text = String::from_utf8_lossy(&cd[content_start..tag_end]);
                control
                    .properties
                    .vml_extras
                    .insert(tag_name.to_string(), text.trim().to_string());
            }
        }
    }
}

fn client_data_text(cd: &[u8], tag: &[u8]) -> Option<String> {
    let text = client_data_text_preserve(cd, tag)?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

// Slices use offsets from ASCII VML/XML tag delimiters.
#[allow(clippy::string_slice)]
fn client_data_text_preserve(cd: &[u8], tag: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(cd, tag, 0)?;
    let content_start = find_gt_simd(cd, tag_start)
        .map(|p| p + 1)
        .unwrap_or(cd.len());
    let tag_end = find_closing_tag(cd, tag, tag_start).unwrap_or(cd.len());
    Some(String::from_utf8_lossy(&cd[content_start..tag_end]).into_owned())
}

/// Parse a VML attribute value, handling both single and double quotes.
// Slices use offsets from ASCII VML/XML attribute delimiters.
#[allow(clippy::string_slice)]
fn parse_vml_attr(xml: &[u8], attr_name: &[u8]) -> Option<String> {
    let attr_pos = find_attr_simd(xml, attr_name, 0)?;
    let value_start = attr_pos + attr_name.len();
    if value_start >= xml.len() {
        return None;
    }
    let quote_char = xml[value_start];
    if quote_char != b'\'' && quote_char != b'"' {
        return None;
    }
    let content_start = value_start + 1;
    for i in content_start..xml.len() {
        if xml[i] == quote_char {
            return std::str::from_utf8(&xml[content_start..i])
                .ok()
                .map(|s| s.to_string());
        }
    }
    None
}
