//! Modern `ctrlProp*.xml` read/write contract for `CT_FormControlPr`.
//!
//! Supported attribute inventory:
//! - object type: `objectType`
//! - formulas: `fmlaLink`, `fmlaRange`, `fmlaGroup`, `fmlaTxbx`
//! - state: `checked`, `val`, `sel`, `min`, `max`, `inc`, `page`
//! - list/dropdown: `dropLines`, `seltype`, `dropStyle`, `multiSel`, `itemLst`
//! - appearance/behavior: `dx`, `widthMin`, `textHAlign`, `textVAlign`,
//!   `editVal`, `lockText`, `noThreeD`, `noThreeD2`, `colored`, `horiz`,
//!   `firstButton`, `multiLine`, `verticalBar`, `passwordEdit`, `justLastX`
//! - metadata: `altText`, `macro`

use super::mapping::{check_state_to_modern, object_type_to_modern};
use super::types::{CheckState, FormControl, FormControlType};
use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::{parse_bool_attr, parse_string_attr, parse_u32_attr};
use crate::write::xml_writer::XmlWriter;

/// Namespace for form control properties (Office 2010+).
const NS_X14: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_ctrl_prop(xml: &[u8]) -> Option<FormControl> {
    let start = find_tag_simd(xml, b"formControlPr", 0)?;
    let element_end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
    let element = &xml[start..element_end];

    let object_type = parse_string_attr(element, b"objectType=\"")
        .map(|s| FormControlType::from_str(&s))
        .unwrap_or(FormControlType::Unknown("Unknown".to_string()));

    let mut control = FormControl::new(object_type);

    control.properties.linked_cell = parse_string_attr(element, b"fmlaLink=\"");
    control.properties.input_range = parse_string_attr(element, b"fmlaRange=\"");
    control.properties.fmla_group = parse_string_attr(element, b"fmlaGroup=\"");
    control.properties.fmla_txbx = parse_string_attr(element, b"fmlaTxbx=\"");
    control.properties.alt_text = parse_string_attr(element, b"altText=\"");
    control.properties.macro_name = parse_string_attr(element, b"macro=\"");

    if let Some(checked) = parse_string_attr(element, b"checked=\"") {
        control.properties.checked = Some(CheckState::from_str(&checked));
    }

    control.properties.val = parse_u32_attr(element, b"val=\"");
    control.properties.sel = parse_u32_attr(element, b"sel=\"");
    control.properties.min_value = parse_i32_attr(element, b"min=\"");
    control.properties.max_value = parse_i32_attr(element, b"max=\"");
    control.properties.increment = parse_i32_attr(element, b"inc=\"");
    control.properties.page_increment = parse_i32_attr(element, b"page=\"");
    control.properties.drop_lines = parse_u32_attr(element, b"dropLines=\"");
    control.properties.dx = parse_u32_attr(element, b"dx=\"");
    control.properties.width_min = parse_u32_attr(element, b"widthMin=\"");

    control.properties.sel_type = parse_string_attr(element, b"seltype=\"");
    control.properties.drop_style = parse_string_attr(element, b"dropStyle=\"");
    control.properties.multi_sel = parse_string_attr(element, b"multiSel=\"");
    control.properties.text_h_align = parse_string_attr(element, b"textHAlign=\"");
    control.properties.text_v_align = parse_string_attr(element, b"textVAlign=\"");
    control.properties.edit_val = parse_string_attr(element, b"editVal=\"");

    control.properties.lock_text = parse_bool_attr(element, b"lockText=\"");
    control.properties.no_three_d2 = parse_bool_attr(element, b"noThreeD2=\"");
    control.properties.no_three_d = parse_bool_attr(element, b"noThreeD=\"");
    control.properties.colored = parse_bool_attr(element, b"colored=\"");
    control.properties.horiz = parse_bool_attr(element, b"horiz=\"");
    control.properties.first_button = parse_bool_attr(element, b"firstButton=\"");
    control.properties.multi_line = parse_bool_attr(element, b"multiLine=\"");
    control.properties.vertical_bar = parse_bool_attr(element, b"verticalBar=\"");
    control.properties.password_edit = parse_bool_attr(element, b"passwordEdit=\"");
    control.properties.just_last_x = parse_bool_attr(element, b"justLastX=\"");

    let body_end = find_closing_tag(xml, b"formControlPr", start).unwrap_or(element_end);
    if let Some(item_lst_start) = find_tag_simd(xml, b"itemLst", start) {
        if item_lst_start < body_end {
            let item_lst_end =
                find_closing_tag(xml, b"itemLst", item_lst_start).unwrap_or(body_end);
            let mut item_pos = item_lst_start;
            while let Some(item_start) = find_tag_simd(xml, b"item", item_pos) {
                if item_start >= item_lst_end {
                    break;
                }
                let item_end = find_gt_simd(xml, item_start)
                    .map(|p| p + 1)
                    .unwrap_or(item_lst_end);
                let item_element = &xml[item_start..item_end];
                if let Some(val) = parse_string_attr(item_element, b"val=\"") {
                    control.properties.items.push(val);
                }
                item_pos = item_end;
            }
        }
    }

    Some(control)
}

pub(crate) fn write_ctrl_prop_xml(control: &FormControl) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();

    w.start_element("formControlPr")
        .attr("xmlns", NS_X14)
        .attr("objectType", &object_type_to_modern(&control.object_type));

    let props = &control.properties;

    if let Some(ref v) = props.linked_cell {
        w.attr("fmlaLink", v);
    }
    if let Some(ref v) = props.input_range {
        w.attr("fmlaRange", v);
    }
    if let Some(ref v) = props.fmla_group {
        w.attr("fmlaGroup", v);
    }
    if let Some(ref v) = props.fmla_txbx {
        w.attr("fmlaTxbx", v);
    }
    if let Some(ref checked) = props.checked {
        w.attr("checked", check_state_to_modern(checked));
    }
    if let Some(val) = props.val {
        w.attr_num("val", val);
    }
    if let Some(sel) = props.sel {
        w.attr_num("sel", sel);
    }
    if let Some(min) = props.min_value {
        w.attr_num("min", min);
    }
    if let Some(max) = props.max_value {
        w.attr_num("max", max);
    }
    if let Some(inc) = props.increment {
        w.attr_num("inc", inc);
    }
    if let Some(page) = props.page_increment {
        w.attr_num("page", page);
    }
    if let Some(dl) = props.drop_lines {
        w.attr_num("dropLines", dl);
    }
    if let Some(dx) = props.dx {
        w.attr_num("dx", dx);
    }
    if let Some(wm) = props.width_min {
        w.attr_num("widthMin", wm);
    }
    if let Some(ref v) = props.sel_type {
        w.attr("seltype", v);
    }
    if let Some(ref v) = props.drop_style {
        w.attr("dropStyle", v);
    }
    if let Some(ref v) = props.multi_sel {
        w.attr("multiSel", v);
    }
    if let Some(ref v) = props.text_h_align {
        w.attr("textHAlign", v);
    }
    if let Some(ref v) = props.text_v_align {
        w.attr("textVAlign", v);
    }
    if let Some(ref v) = props.edit_val {
        w.attr("editVal", v);
    }
    if let Some(ref v) = props.alt_text {
        w.attr("altText", v);
    }
    if let Some(ref v) = props.macro_name {
        w.attr("macro", v);
    }
    if props.lock_text {
        w.attr("lockText", "1");
    }
    if props.no_three_d2 {
        w.attr("noThreeD2", "1");
    }
    if props.no_three_d {
        w.attr("noThreeD", "1");
    }
    if props.colored {
        w.attr("colored", "1");
    }
    if props.horiz {
        w.attr("horiz", "1");
    }
    if props.first_button {
        w.attr("firstButton", "1");
    }
    if props.multi_line {
        w.attr("multiLine", "1");
    }
    if props.vertical_bar {
        w.attr("verticalBar", "1");
    }
    if props.password_edit {
        w.attr("passwordEdit", "1");
    }
    if props.just_last_x {
        w.attr("justLastX", "1");
    }

    if props.items.is_empty() {
        w.self_close();
    } else {
        w.end_attrs();
        w.start_element("itemLst").end_attrs();
        for item in &props.items {
            w.start_element("item").attr("val", item).self_close();
        }
        w.end_element("itemLst");
        w.end_element("formControlPr");
    }

    w.finish()
}

// Slices use offsets from ASCII XML attribute delimiters.
#[allow(clippy::string_slice)]
fn parse_i32_attr(xml: &[u8], attr: &[u8]) -> Option<i32> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;

    let value_str = String::from_utf8_lossy(&xml[start..end]);
    value_str.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_supported_attributes_roundtrip_through_ctrl_prop_xml() {
        let input = br#"<formControlPr objectType="CheckBox"
            checked="Checked"
            fmlaLink="$A$1"
            fmlaRange="$B$1:$B$10"
            fmlaGroup="$C$1"
            fmlaTxbx="$D$1"
            altText="My checkbox"
            macro="MyMacro"
            val="50"
            sel="3"
            min="-5"
            max="100"
            inc="1"
            page="10"
            dropLines="8"
            dx="20"
            widthMin="64"
            seltype="Multi"
            dropStyle="Combo"
            multiSel="1,3,5"
            textHAlign="Center"
            textVAlign="Top"
            editVal="Restricted"
            lockText="1"
            noThreeD2="1"
            noThreeD="1"
            colored="1"
            horiz="1"
            firstButton="1"
            multiLine="1"
            verticalBar="1"
            passwordEdit="1"
            justLastX="1">
            <itemLst>
                <item val="Option A"/>
                <item val="Option B"/>
            </itemLst>
        </formControlPr>"#;

        let parsed = parse_ctrl_prop(input).unwrap();
        let written = write_ctrl_prop_xml(&parsed);
        let reparsed = parse_ctrl_prop(&written).unwrap();

        assert_eq!(reparsed.object_type, FormControlType::CheckBox);
        assert_eq!(reparsed.properties.checked, Some(CheckState::Checked));
        assert_eq!(reparsed.properties.linked_cell.as_deref(), Some("$A$1"));
        assert_eq!(
            reparsed.properties.input_range.as_deref(),
            Some("$B$1:$B$10")
        );
        assert_eq!(reparsed.properties.fmla_group.as_deref(), Some("$C$1"));
        assert_eq!(reparsed.properties.fmla_txbx.as_deref(), Some("$D$1"));
        assert_eq!(reparsed.properties.alt_text.as_deref(), Some("My checkbox"));
        assert_eq!(reparsed.properties.macro_name.as_deref(), Some("MyMacro"));
        assert_eq!(reparsed.properties.val, Some(50));
        assert_eq!(reparsed.properties.sel, Some(3));
        assert_eq!(reparsed.properties.min_value, Some(-5));
        assert_eq!(reparsed.properties.max_value, Some(100));
        assert_eq!(reparsed.properties.increment, Some(1));
        assert_eq!(reparsed.properties.page_increment, Some(10));
        assert_eq!(reparsed.properties.drop_lines, Some(8));
        assert_eq!(reparsed.properties.dx, Some(20));
        assert_eq!(reparsed.properties.width_min, Some(64));
        assert_eq!(reparsed.properties.sel_type.as_deref(), Some("Multi"));
        assert_eq!(reparsed.properties.drop_style.as_deref(), Some("Combo"));
        assert_eq!(reparsed.properties.multi_sel.as_deref(), Some("1,3,5"));
        assert_eq!(reparsed.properties.text_h_align.as_deref(), Some("Center"));
        assert_eq!(reparsed.properties.text_v_align.as_deref(), Some("Top"));
        assert_eq!(reparsed.properties.edit_val.as_deref(), Some("Restricted"));
        assert!(reparsed.properties.lock_text);
        assert!(reparsed.properties.no_three_d2);
        assert!(reparsed.properties.no_three_d);
        assert!(reparsed.properties.colored);
        assert!(reparsed.properties.horiz);
        assert!(reparsed.properties.first_button);
        assert!(reparsed.properties.multi_line);
        assert!(reparsed.properties.vertical_bar);
        assert!(reparsed.properties.password_edit);
        assert!(reparsed.properties.just_last_x);
        assert_eq!(
            reparsed.properties.items,
            vec!["Option A".to_string(), "Option B".to_string()]
        );
    }
}
