use crate::domain::styles::types::{AlignmentDef, CellXfDef, ProtectionDef};
use crate::write::xml_writer::XmlWriter;

pub(super) fn write_cell_style_xfs(w: &mut XmlWriter, cell_style_xfs: &[CellXfDef]) {
    w.start_element("cellStyleXfs")
        .attr_num("count", cell_style_xfs.len())
        .end_attrs();

    for xf in cell_style_xfs {
        write_xf(w, xf, false);
    }

    w.end_element("cellStyleXfs");
}

pub(super) fn write_cell_xfs(w: &mut XmlWriter, cell_xfs: &[CellXfDef]) {
    w.start_element("cellXfs")
        .attr_num("count", cell_xfs.len())
        .end_attrs();

    for xf in cell_xfs {
        write_xf(w, xf, true);
    }

    w.end_element("cellXfs");
}

fn write_xf(w: &mut XmlWriter, xf: &CellXfDef, is_cell_xf: bool) {
    w.start_element("xf");
    if let Some(id) = xf.num_fmt_id {
        w.attr_num("numFmtId", id);
    }
    if let Some(id) = xf.font_id {
        w.attr_num("fontId", id);
    }
    if let Some(id) = xf.fill_id {
        w.attr_num("fillId", id);
    }
    if let Some(id) = xf.border_id {
        w.attr_num("borderId", id);
    }

    if is_cell_xf {
        if let Some(xf_id) = xf.xf_id {
            w.attr_num("xfId", xf_id);
        }
    }

    if xf.quote_prefix {
        w.attr("quotePrefix", "1");
    }
    if xf.pivot_button {
        w.attr("pivotButton", "1");
    }

    match xf.apply_number_format {
        Some(true) => {
            w.attr("applyNumberFormat", "1");
        }
        Some(false) => {
            w.attr("applyNumberFormat", "0");
        }
        None => {}
    }
    match xf.apply_font {
        Some(true) => {
            w.attr("applyFont", "1");
        }
        Some(false) => {
            w.attr("applyFont", "0");
        }
        None => {}
    }
    match xf.apply_fill {
        Some(true) => {
            w.attr("applyFill", "1");
        }
        Some(false) => {
            w.attr("applyFill", "0");
        }
        None => {}
    }
    match xf.apply_border {
        Some(true) => {
            w.attr("applyBorder", "1");
        }
        Some(false) => {
            w.attr("applyBorder", "0");
        }
        None => {}
    }
    match xf.apply_alignment {
        Some(true) => {
            w.attr("applyAlignment", "1");
        }
        Some(false) => {
            w.attr("applyAlignment", "0");
        }
        None => {}
    }
    match xf.apply_protection {
        Some(true) => {
            w.attr("applyProtection", "1");
        }
        Some(false) => {
            w.attr("applyProtection", "0");
        }
        None => {}
    }

    let has_alignment = xf.alignment.is_some();
    let has_protection = xf.protection.is_some();
    let has_ext_lst = xf
        .ext_lst
        .as_ref()
        .and_then(|e| e.raw_xml.as_ref())
        .is_some();

    if has_alignment || has_protection || has_ext_lst {
        w.end_attrs();

        if let Some(ref align) = xf.alignment {
            write_alignment(w, align);
        }

        if let Some(ref prot) = xf.protection {
            write_protection(w, prot);
        }

        if let Some(ref ext_lst) = xf.ext_lst {
            if let Some(ref raw) = ext_lst.raw_xml {
                if !crate::infra::xml::raw_xml_contains_relationship_attr(raw) {
                    w.raw(raw.as_bytes());
                }
            }
        }

        w.end_element("xf");
    } else {
        w.self_close();
    }
}

fn write_alignment(w: &mut XmlWriter, align: &AlignmentDef) {
    write_alignment_inner(w, align, false);
}

pub(super) fn write_alignment_inner(
    w: &mut XmlWriter,
    align: &AlignmentDef,
    preserve_defaults: bool,
) {
    w.start_element("alignment");

    if let Some(h) = align.horizontal {
        w.attr("horizontal", h.to_ooxml());
    }
    if let Some(v) = align.vertical {
        w.attr("vertical", v.to_ooxml());
    }
    if let Some(rotation) = align.text_rotation {
        w.attr_num("textRotation", rotation);
    }
    match align.wrap_text {
        Some(true) => {
            w.attr("wrapText", "1");
        }
        Some(false) if preserve_defaults => {
            w.attr("wrapText", "0");
        }
        _ => {}
    }
    if let Some(indent) = align.indent {
        w.attr_num("indent", indent);
    }
    if let Some(relative_indent) = align.relative_indent {
        w.attr_num("relativeIndent", relative_indent);
    }
    match align.justify_last_line {
        Some(true) => {
            w.attr("justifyLastLine", "1");
        }
        Some(false) if preserve_defaults => {
            w.attr("justifyLastLine", "0");
        }
        _ => {}
    }
    match align.shrink_to_fit {
        Some(true) => {
            w.attr("shrinkToFit", "1");
        }
        Some(false) if preserve_defaults => {
            w.attr("shrinkToFit", "0");
        }
        _ => {}
    }
    if let Some(reading_order) = align.reading_order {
        w.attr_num("readingOrder", reading_order);
    }
    match align.auto_indent {
        Some(true) => {
            w.attr("autoIndent", "1");
        }
        Some(false) if preserve_defaults => {
            w.attr("autoIndent", "0");
        }
        _ => {}
    }

    w.self_close();
}

pub(super) fn write_protection(w: &mut XmlWriter, prot: &ProtectionDef) {
    w.start_element("protection");

    match prot.locked {
        Some(true) => {
            w.attr("locked", "1");
        }
        Some(false) => {
            w.attr("locked", "0");
        }
        None => {}
    }
    match prot.hidden {
        Some(true) => {
            w.attr("hidden", "1");
        }
        Some(false) => {
            w.attr("hidden", "0");
        }
        None => {}
    }

    w.self_close();
}
