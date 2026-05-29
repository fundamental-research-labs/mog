use super::formula_storage::canonicalize_formula_for_ooxml;
use super::{CellData, CellValue, to_a1};
use crate::write::xml_writer::XmlWriter;
use ooxml_types::worksheet::CellFormulaType;

pub(super) fn write_cell(w: &mut XmlWriter, cell: &CellData) {
    let cell_ref = to_a1(cell.row, cell.col);

    w.start_element("c");
    if let Some(cm) = cell.cell_metadata_index {
        w.attr_num("cm", cm);
    }
    if cell.phonetic {
        w.attr("ph", "1");
    }
    w.attr("r", &cell_ref);
    if let Some(style) = cell.style_index {
        w.attr_num("s", style);
    }
    write_type_attr(w, cell);
    if let Some(vm_val) = cell.vm {
        w.attr_num("vm", vm_val);
    }

    if matches!(&cell.value, CellValue::Empty) {
        w.self_close();
        return;
    }

    w.end_attrs();
    write_cell_value(w, cell);
    w.end_element("c");
}

fn write_type_attr(w: &mut XmlWriter, cell: &CellData) {
    match &cell.value {
        CellValue::Empty => {
            if let Some(ref t) = cell.explicit_type {
                w.attr("t", t);
            }
        }
        CellValue::Number(_) => {}
        _ if cell.date_lexical_value.is_some() => {
            w.attr("t", "d");
        }
        CellValue::String(_) => {
            w.attr("t", "s");
        }
        CellValue::InlineString(_) => {
            w.attr("t", "inlineStr");
        }
        CellValue::FormulaString(_) => {
            w.attr("t", "str");
        }
        CellValue::Boolean(_) => {
            w.attr("t", "b");
        }
        CellValue::Error(..) => {
            w.attr("t", "e");
        }
        CellValue::Formula { cached_value, .. } => {
            if let Some(cached) = cached_value {
                match cached.as_ref() {
                    CellValue::String(_) => {
                        w.attr("t", "s");
                    }
                    CellValue::InlineString(_) | CellValue::FormulaString(_) => {
                        w.attr("t", "str");
                    }
                    CellValue::Boolean(_) => {
                        w.attr("t", "b");
                    }
                    CellValue::Error(..) => {
                        w.attr("t", "e");
                    }
                    _ => {}
                }
            } else if let Some(ref hint) = cell.formula_type_hint {
                w.attr("t", hint);
            }
        }
    }
}

fn write_cell_value(w: &mut XmlWriter, cell: &CellData) {
    match &cell.value {
        CellValue::Empty => {
            unreachable!("Empty cells handled above with self_close()");
        }
        CellValue::Number(n) => {
            let formatted = formatted_number(cell, *n);
            w.element_with_text("v", &formatted);
        }
        _ if cell.date_lexical_value.is_some() => {
            if let Some(date_value) = &cell.date_lexical_value {
                w.element_with_text("v", date_value);
            }
        }
        CellValue::String(idx) => {
            w.element_with_text("v", &idx.to_string());
        }
        CellValue::InlineString(s) => {
            write_inline_string(w, s);
        }
        CellValue::FormulaString(s) => {
            write_text_value(w, s, cell.preserve_space_value);
        }
        CellValue::Boolean(b) => {
            w.element_with_text("v", if *b { "1" } else { "0" });
        }
        CellValue::Error(e) => {
            w.element_with_text("v", e);
        }
        CellValue::Formula {
            formula,
            cached_value,
            cell_formula,
        } => {
            write_formula(w, cell, formula, cell_formula.as_ref());
            if let Some(cached) = cached_value {
                write_cached_value(w, cell, cached.as_ref());
            }
        }
    }
}

fn write_inline_string(w: &mut XmlWriter, s: &str) {
    w.start_element("is").end_attrs();
    let needs_preserve = s.starts_with(' ')
        || s.ends_with(' ')
        || s.starts_with('\t')
        || s.ends_with('\t')
        || s.contains('\n');
    if needs_preserve {
        w.start_element("t")
            .attr("xml:space", "preserve")
            .end_attrs()
            .text_xstring(s)
            .end_element("t");
    } else {
        w.start_element("t")
            .end_attrs()
            .text_xstring(s)
            .end_element("t");
    }
    w.end_element("is");
}

fn write_text_value(w: &mut XmlWriter, s: &str, preserve_space: bool) {
    if preserve_space {
        w.start_element("v")
            .attr("xml:space", "preserve")
            .end_attrs()
            .text_xstring(s)
            .end_element("v");
    } else if s.is_empty() {
        w.start_element("v").self_close();
    } else {
        w.start_element("v")
            .end_attrs()
            .text_xstring(s)
            .end_element("v");
    }
}

fn write_formula(
    w: &mut XmlWriter,
    cell: &CellData,
    formula: &str,
    cell_formula: Option<&ooxml_types::worksheet::CellFormula>,
) {
    let ca = cell.force_recalc;
    let psf = cell.preserve_space_formula;

    match cell_formula {
        Some(cf) if cf.t == CellFormulaType::Shared && cf.si.is_some() => {
            let si = cf.si.unwrap();
            if let Some(ref ref_range) = cf.r#ref {
                let b = w
                    .start_element("f")
                    .attr("t", "shared")
                    .attr("si", &si.to_string())
                    .attr("ref", ref_range);
                if ca {
                    b.attr("ca", "1");
                }
                if psf {
                    b.attr("xml:space", "preserve");
                }
                b.end_attrs();
                let formula_text = canonicalize_formula_for_ooxml(&cf.text);
                w.text(&formula_text);
                w.end_element("f");
            } else if ca {
                w.empty_element(
                    "f",
                    &[("t", "shared"), ("si", &si.to_string()), ("ca", "1")],
                );
            } else {
                w.empty_element("f", &[("t", "shared"), ("si", &si.to_string())]);
            }
        }
        Some(cf) if cf.t == CellFormulaType::Array => {
            if let Some(ref ref_range) = cf.r#ref {
                let b = w
                    .start_element("f")
                    .attr("ref", ref_range)
                    .attr("t", "array");
                if cf.aca {
                    b.attr("aca", "1");
                }
                if ca {
                    b.attr("ca", "1");
                }
                if psf {
                    b.attr("xml:space", "preserve");
                }
                b.end_attrs();
                let formula_text = canonicalize_formula_for_ooxml(&cf.text);
                w.text(&formula_text);
                w.end_element("f");
            } else {
                let b = w.start_element("f");
                if ca {
                    b.attr("ca", "1");
                }
                if psf {
                    b.attr("xml:space", "preserve");
                }
                b.end_attrs();
                let formula_text = canonicalize_formula_for_ooxml(formula);
                w.text(&formula_text);
                w.end_element("f");
            }
        }
        Some(cf) if cf.t == CellFormulaType::DataTable => {
            let b = w.start_element("f").attr("t", "dataTable");
            if let Some(ref ref_range) = cf.r#ref {
                b.attr("ref", ref_range);
            }
            if cf.dt2d {
                b.attr("dt2D", "1");
            }
            if cf.dtr {
                b.attr("dtr", "1");
            }
            if cf.del1 {
                b.attr("del1", "1");
            }
            if cf.del2 {
                b.attr("del2", "1");
            }
            if cf.aca {
                b.attr("aca", "1");
            }
            if let Some(ref r1) = cf.r1 {
                b.attr("r1", r1);
            }
            if let Some(ref r2) = cf.r2 {
                b.attr("r2", r2);
            }
            if cf.bx {
                b.attr("bx", "1");
            }
            if ca || cf.ca {
                b.attr("ca", "1");
            }
            b.self_close();
        }
        _ => {
            if ca || psf {
                let b = w.start_element("f");
                if ca {
                    b.attr("ca", "1");
                }
                if psf {
                    b.attr("xml:space", "preserve");
                }
                b.end_attrs();
                let formula_text = canonicalize_formula_for_ooxml(formula);
                w.text(&formula_text);
                w.end_element("f");
            } else {
                let formula_text = canonicalize_formula_for_ooxml(formula);
                w.element_with_text("f", &formula_text);
            }
        }
    }
}

fn write_cached_value(w: &mut XmlWriter, cell: &CellData, cached: &CellValue) {
    match cached {
        CellValue::Number(n) => {
            let formatted = formatted_number(cell, *n);
            w.element_with_text("v", &formatted);
        }
        CellValue::String(idx) => {
            w.element_with_text("v", &idx.to_string());
        }
        CellValue::Boolean(b) => {
            w.element_with_text("v", if *b { "1" } else { "0" });
        }
        CellValue::Error(e) => {
            w.element_with_text("v", e);
        }
        CellValue::InlineString(s) | CellValue::FormulaString(s) => {
            write_text_value(w, s, cell.preserve_space_value);
        }
        _ => {}
    }
}

fn formatted_number(cell: &CellData, n: f64) -> String {
    match &cell.original_value {
        Some(orig) => orig.clone(),
        None => format_number(n),
    }
}

pub(super) fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{:.0}", n)
    } else {
        let s = format!("{}", n);
        if s.contains('.') {
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            s
        }
    }
}
