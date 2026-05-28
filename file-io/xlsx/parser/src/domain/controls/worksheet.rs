//! Worksheet-level controls contract.
//!
//! Owns worksheet `<controls>` parsing, `mc:AlternateContent` handling,
//! worksheet `<controlPr>` attributes, modern anchors, and worksheet controls
//! XML generation.

use std::collections::{HashMap, HashSet};

use super::form_control_props;
use super::relationships;
use super::types::{ControlAnchor, FormControl, ModernAnchorResult, WorksheetControlRef};
use super::vml;
use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_u32_attr, resolve_mc_alternate_content};
use crate::output::results::FormControlOutput;
use crate::write::xml_writer::XmlWriter;

const NS_X14: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_XDR: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

/// Parse `<control>` elements from a `<controls>` block.
// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_worksheet_controls(xml: &[u8]) -> Vec<WorksheetControlRef> {
    let mut controls = Vec::new();
    let mut pos = 0;

    while let Some(ctrl_start) = find_tag_simd(xml, b"control", pos) {
        let element_end = find_gt_simd(xml, ctrl_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let element = &xml[ctrl_start..element_end];

        if let Some(shape_id) = parse_u32_attr(element, b"shapeId=\"") {
            let r_id = parse_string_attr(element, b"r:id=\"").unwrap_or_default();
            let name = parse_string_attr(element, b"name=\"");

            controls.push(WorksheetControlRef {
                shape_id,
                r_id,
                name,
            });
        }

        pos = element_end;
    }

    controls
}

/// Parse worksheet-level controls from worksheet XML that may be wrapped in
/// `mc:AlternateContent`.
// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_worksheet_controls_from_xml(worksheet_xml: &[u8]) -> Vec<WorksheetControlRef> {
    let has_supported_controls_choice = worksheet_xml
        .windows(b"Requires=\"x14\"".len())
        .any(|w| w == b"Requires=\"x14\"");
    let all_controls = parse_worksheet_controls(worksheet_xml);
    if has_supported_controls_choice && !all_controls.is_empty() {
        let mut seen = HashSet::new();
        let mut deduped = Vec::with_capacity(all_controls.len());
        for control in all_controls {
            if seen.insert(control.shape_id) {
                deduped.push(control);
            }
        }
        return deduped;
    }

    if let Some(ac_start) = find_tag_simd(worksheet_xml, b"mc:AlternateContent", 0) {
        let ac_end = find_closing_tag(worksheet_xml, b"mc:AlternateContent", ac_start)
            .unwrap_or(worksheet_xml.len());
        let ac_close_tag_end = find_gt_simd(worksheet_xml, ac_end)
            .map(|p| p + 1)
            .unwrap_or(worksheet_xml.len());
        let ac_block = &worksheet_xml[ac_start..ac_close_tag_end];

        if find_tag_simd(ac_block, b"controls", 0).is_some() {
            if let Some(branch) = resolve_mc_alternate_content(ac_block, None) {
                let resolved = &ac_block[branch.start..branch.end];
                if let Some(controls_start) = find_tag_simd(resolved, b"controls", 0) {
                    let controls_end = find_closing_tag(resolved, b"controls", controls_start)
                        .unwrap_or(resolved.len());
                    let controls_block = &resolved[controls_start..controls_end];
                    let parsed = parse_worksheet_controls(controls_block);
                    if !parsed.is_empty() {
                        return parsed;
                    }
                }
            }
        }
    }

    if let Some(controls_start) = find_tag_simd(worksheet_xml, b"controls", 0) {
        let controls_end = find_closing_tag(worksheet_xml, b"controls", controls_start)
            .unwrap_or(worksheet_xml.len());
        let controls_block = &worksheet_xml[controls_start..controls_end];
        let parsed = parse_worksheet_controls(controls_block);
        if !parsed.is_empty() {
            return parsed;
        }
    }

    Vec::new()
}

/// Extract a modern anchor and worksheet `<controlPr>` attributes for a shapeId.
// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub(crate) fn extract_modern_anchor_and_attrs(
    worksheet_xml: &[u8],
    target_shape_id: u32,
) -> Option<(ModernAnchorResult, HashMap<String, String>)> {
    let shape_id_attr = format!("shapeId=\"{}\"", target_shape_id);
    let shape_id_bytes = shape_id_attr.as_bytes();

    let mut pos = 0;
    while let Some(ctrl_start) = find_tag_simd(worksheet_xml, b"control", pos) {
        let ctrl_gt = find_gt_simd(worksheet_xml, ctrl_start)
            .map(|p| p + 1)
            .unwrap_or(worksheet_xml.len());
        let ctrl_elem = &worksheet_xml[ctrl_start..ctrl_gt];

        if find_attr_simd(ctrl_elem, shape_id_bytes, 0).is_some() {
            let is_self_closing = ctrl_gt > 1 && worksheet_xml[ctrl_gt - 2] == b'/';
            if !is_self_closing {
                let ctrl_close = find_closing_tag(worksheet_xml, b"control", ctrl_start)
                    .unwrap_or(worksheet_xml.len());
                let ctrl_body = &worksheet_xml[ctrl_gt..ctrl_close];

                if let Some(cpr_start) = find_tag_simd(ctrl_body, b"controlPr", 0) {
                    let cpr_tag_end = find_gt_simd(ctrl_body, cpr_start)
                        .map(|p| p + 1)
                        .unwrap_or(ctrl_body.len());
                    let cpr_element = &ctrl_body[cpr_start..cpr_tag_end];

                    let mut attrs = HashMap::new();
                    for attr_name in &[
                        "defaultSize",
                        "print",
                        "autoFill",
                        "autoPict",
                        "autoLine",
                        "macro",
                        "altText",
                        "disabled",
                        "locked",
                    ] {
                        let needle = format!("{}=\"", attr_name);
                        if let Some(val) = parse_string_attr(cpr_element, needle.as_bytes()) {
                            attrs.insert(attr_name.to_string(), val);
                        }
                    }

                    let cpr_close = find_closing_tag(ctrl_body, b"controlPr", cpr_start)
                        .unwrap_or(ctrl_body.len());
                    let cpr_body = &ctrl_body[cpr_start..cpr_close];

                    if let Some(result) = ControlAnchor::from_modern_anchor(cpr_body) {
                        return Some((result, attrs));
                    }
                }
            }
        }

        pos = ctrl_gt;
    }

    None
}

/// Parse form controls for a given sheet.
///
/// This function implements the full modern + legacy merge pipeline:
///
/// 1. Parse `<controls>` from worksheet XML to get `WorksheetControlRef`s (shapeId, rId, name).
/// 2. Read sheet .rels to resolve typed ctrlProp relationships.
/// 3. Parse each `ctrlProp*.xml` with `parse_ctrl_prop()` to get properties.
/// 4. Parse VML drawing for legacy anchor/property data (fallback).
/// 5. Merge modern (ctrlProp) and VML data by shapeId:
///    - Properties come from ctrlProp (modern) when available.
///    - Modern anchor from `<controlPr>` in worksheet XML is preferred.
///    - VML anchor is used as fallback.
///
/// Returns `Vec<FormControlOutput>` ready for WASM serialization.
pub fn parse_form_controls_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    worksheet_xml: &[u8],
) -> Vec<FormControlOutput> {
    let ws_controls = parse_worksheet_controls_from_xml(worksheet_xml);
    if ws_controls.is_empty() {
        return parse_vml_only_controls(archive, sheet_num);
    }

    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return Vec::new(),
    };
    let relationships = relationships::parse_worksheet_relationships(sheet_num, &rels_xml);

    let mut modern_anchors: HashMap<u32, ModernAnchorResult> = HashMap::new();
    let mut control_pr_attrs_map: HashMap<u32, HashMap<String, String>> = HashMap::new();
    for wsc in &ws_controls {
        if let Some((anchor_result, attrs)) =
            extract_modern_anchor_and_attrs(worksheet_xml, wsc.shape_id)
        {
            modern_anchors.insert(wsc.shape_id, anchor_result);
            if !attrs.is_empty() {
                control_pr_attrs_map.insert(wsc.shape_id, attrs);
            }
        }
    }

    let mut controls: Vec<(u32, FormControl)> = Vec::new();
    for wsc in &ws_controls {
        if let Some(full_path) = relationships::ctrl_prop_target(&relationships, &wsc.r_id) {
            if let Ok(ctrl_xml) = archive.read_file(full_path) {
                if let Some(mut fc) = form_control_props::parse_ctrl_prop(&ctrl_xml) {
                    if fc.properties.name.is_none() {
                        fc.properties.name = wsc.name.clone();
                    }
                    if let Some(anchor_result) = modern_anchors.get(&wsc.shape_id) {
                        fc.anchor = anchor_result.anchor.clone();
                        fc.move_with_cells = anchor_result.move_with_cells;
                        fc.size_with_cells = anchor_result.size_with_cells;
                    }
                    if let Some(attrs) = control_pr_attrs_map.get(&wsc.shape_id) {
                        fc.control_pr_attrs = attrs.clone();
                    }
                    controls.push((wsc.shape_id, fc));
                }
            }
        }
    }

    let vml_controls = vml::parse_vml_drawing_for_sheet(archive, sheet_num, &rels_xml);
    merge_vml_controls(&mut controls, &vml_controls, &modern_anchors);

    controls
        .into_iter()
        .map(|(shape_id, fc)| FormControlOutput::from_form_control(&fc, shape_id))
        .collect()
}

fn merge_vml_controls(
    controls: &mut [(u32, FormControl)],
    vml_controls: &[FormControl],
    modern_anchors: &HashMap<u32, ModernAnchorResult>,
) {
    if vml_controls.is_empty() {
        return;
    }

    let vml_by_shape_id: HashMap<u32, &FormControl> = vml_controls
        .iter()
        .filter_map(|fc| fc.shape_id.map(|shape_id| (shape_id, fc)))
        .collect();

    for (i, (shape_id, fc)) in controls.iter_mut().enumerate() {
        if let Some(vml_fc) = vml_by_shape_id
            .get(shape_id)
            .copied()
            .or_else(|| vml_controls.get(i))
        {
            if !modern_anchors.contains_key(shape_id) {
                fc.anchor = vml_fc.anchor.clone();
            }

            for (k, v) in &vml_fc.properties.vml_extras {
                fc.properties
                    .vml_extras
                    .entry(k.clone())
                    .or_insert_with(|| v.clone());
            }

            if let Some(ref m) = vml_fc.properties.macro_name {
                fc.properties
                    .vml_extras
                    .entry("FmlaMacro".to_string())
                    .or_insert_with(|| m.clone());
            }
            if let Some(ref v) = vml_fc.properties.text_h_align {
                fc.properties
                    .vml_extras
                    .entry("TextHAlign".to_string())
                    .or_insert_with(|| v.clone());
            }
            if let Some(ref v) = vml_fc.properties.text_v_align {
                fc.properties
                    .vml_extras
                    .entry("TextVAlign".to_string())
                    .or_insert_with(|| v.clone());
            }

            fc.vml_shape = vml_fc.vml_shape.clone();
        }
    }
}

fn parse_vml_only_controls(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
) -> Vec<FormControlOutput> {
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return Vec::new(),
    };

    vml::parse_vml_drawing_for_sheet(archive, sheet_num, &rels_xml)
        .iter()
        .enumerate()
        .map(|(i, fc)| FormControlOutput::from_form_control(fc, i as u32))
        .collect()
}

pub(crate) fn write_worksheet_controls(
    controls: &[FormControl],
    base_shape_id: u32,
    r_ids: &[String],
) -> Vec<u8> {
    let mut w = XmlWriter::new();

    w.start_element("mc:AlternateContent")
        .attr("xmlns:mc", NS_MC)
        .attr("xmlns:x14", NS_X14)
        .attr("xmlns:xdr", NS_XDR)
        .end_attrs();

    w.start_element("mc:Choice")
        .attr("Requires", "x14")
        .end_attrs();

    w.start_element("controls").end_attrs();

    for (i, control) in controls.iter().enumerate() {
        let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
        let r_id = r_ids.get(i).map(String::as_str).unwrap_or("");
        let name = control.properties.name.as_deref().unwrap_or("");

        w.start_element("mc:AlternateContent")
            .attr("xmlns:mc", NS_MC)
            .end_attrs();

        w.start_element("mc:Choice")
            .attr("Requires", "x14")
            .end_attrs();

        w.start_element("control")
            .attr_num("shapeId", shape_id)
            .attr("r:id", r_id)
            .attr("name", name)
            .end_attrs();

        write_control_pr(&mut w, control);

        w.end_element("control");
        w.end_element("mc:Choice");
        w.end_element("mc:AlternateContent");
    }

    w.end_element("controls");
    w.end_element("mc:Choice");

    w.start_element("mc:Fallback").end_attrs();
    w.start_element("controls").end_attrs();
    for (i, control) in controls.iter().enumerate() {
        let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
        let r_id = r_ids.get(i).map(String::as_str).unwrap_or("");
        let name = control.properties.name.as_deref().unwrap_or("");

        w.start_element("control")
            .attr_num("shapeId", shape_id)
            .attr("r:id", r_id)
            .attr("name", name)
            .self_close();
    }
    w.end_element("controls");
    w.end_element("mc:Fallback");

    w.end_element("mc:AlternateContent");

    w.finish()
}

fn write_control_pr(w: &mut XmlWriter, control: &FormControl) {
    w.start_element("controlPr");

    if !control.control_pr_attrs.is_empty() {
        let attrs = &control.control_pr_attrs;
        for attr_name in &[
            "defaultSize",
            "print",
            "disabled",
            "locked",
            "autoFill",
            "autoPict",
            "autoLine",
            "macro",
            "altText",
        ] {
            if let Some(val) = attrs.get(*attr_name) {
                w.attr(attr_name, val);
            }
        }
    } else {
        w.attr("defaultSize", "0")
            .attr("autoFill", "0")
            .attr("autoLine", "0");

        if let Some(ref macro_name) = control.properties.macro_name {
            w.attr("macro", macro_name);
        }

        if let Some(ref alt_text) = control.properties.alt_text {
            w.attr("altText", alt_text);
        }
    }

    w.end_attrs();

    write_modern_anchor(
        w,
        &control.anchor,
        control.move_with_cells,
        control.size_with_cells,
    );

    w.end_element("controlPr");
}

fn write_modern_anchor(
    w: &mut XmlWriter,
    anchor: &ControlAnchor,
    move_with_cells: bool,
    size_with_cells: bool,
) {
    w.start_element("anchor")
        .attr("moveWithCells", if move_with_cells { "1" } else { "0" })
        .attr("sizeWithCells", if size_with_cells { "1" } else { "0" })
        .end_attrs();

    w.start_element("from").end_attrs();
    w.element_with_text("xdr:col", &anchor.from_col.to_string());
    w.element_with_text("xdr:colOff", &anchor.from_col_offset.to_string());
    w.element_with_text("xdr:row", &anchor.from_row.to_string());
    w.element_with_text("xdr:rowOff", &anchor.from_row_offset.to_string());
    w.end_element("from");

    w.start_element("to").end_attrs();
    w.element_with_text("xdr:col", &anchor.to_col.to_string());
    w.element_with_text("xdr:colOff", &anchor.to_col_offset.to_string());
    w.element_with_text("xdr:row", &anchor.to_row.to_string());
    w.element_with_text("xdr:rowOff", &anchor.to_row_offset.to_string());
    w.end_element("to");

    w.end_element("anchor");
}
