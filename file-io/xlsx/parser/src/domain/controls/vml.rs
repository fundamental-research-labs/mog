//! Legacy VML controls contract.
//!
//! Owns VML shape discovery, `x:ClientData` parsing, visual shape
//! preservation, VML-only ClientData extras, and OLE preview image discovery.

use std::collections::HashMap;

use super::relationships;
use super::types::{ControlAnchor, FormControl, FormControlType};
pub(crate) use super::vml_write::escape_xml_text;
pub use super::vml_write::{write_vml_form_controls, write_vml_with_ole};
use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_string_attr_verbatim};

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
