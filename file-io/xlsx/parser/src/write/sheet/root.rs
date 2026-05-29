use super::SheetWriter;
use crate::write::mc_builder::McIgnorableBuilder;
use crate::write::xml_writer::XmlWriter;

const SPREADSHEET_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MC_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const X14AC_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac";
const XR_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2014/revision";

pub(super) fn write_worksheet_start(w: &mut XmlWriter, sheet: &SheetWriter) {
    let has_descent = sheet.sheet_format_pr.default_row_descent.is_some()
        || sheet.rows.values().any(|(rd, _)| rd.descent.is_some());
    let has_uid = sheet.uid.is_some()
        || sheet
            .data_validations_xml
            .as_ref()
            .map_or(false, |xml| xml.contains("xr:uid"))
        || sheet
            .ext_lst_xml
            .as_ref()
            .map_or(false, |xml| xml.contains("xr:uid"));

    let mut mc_builder = McIgnorableBuilder::new();
    if sheet.root_namespaces.is_none() {
        if has_descent {
            mc_builder.add("x14ac");
        }
        if has_uid {
            mc_builder.add("xr");
        }
    }
    if let Some(ref ns) = sheet.root_namespaces {
        if ns.has_prefix("mc") {
            mc_builder.add_from_namespace_map(ns);
            if has_descent {
                mc_builder.add("x14ac");
            }
            if has_uid {
                mc_builder.add("xr");
            }
        }
    }

    w.start_element("worksheet")
        .attr("xmlns", SPREADSHEET_NS)
        .attr("xmlns:r", RELATIONSHIPS_NS);

    let preserved_has_x14ac = sheet
        .root_namespaces
        .as_ref()
        .map_or(false, |ns| ns.has_prefix("x14ac"));
    let preserved_has_xr = sheet
        .root_namespaces
        .as_ref()
        .map_or(false, |ns| ns.has_prefix("xr"));
    let preserved_has_mc = sheet
        .root_namespaces
        .as_ref()
        .map_or(false, |ns| ns.has_prefix("mc"));

    let ignorable_value = mc_builder.build();
    if !mc_builder.is_empty() && !preserved_has_mc {
        w.attr("xmlns:mc", MC_NS);
    }

    if has_descent && !preserved_has_x14ac {
        w.attr("xmlns:x14ac", X14AC_NS);
    }
    if has_uid && !preserved_has_xr {
        w.attr("xmlns:xr", XR_NS);
    }

    if let Some(ref ns) = sheet.root_namespaces {
        for decl in ns.all() {
            if let Some(ref prefix) = decl.prefix {
                if prefix == "r" {
                    continue;
                }
                if prefix == "mc" {
                    if !mc_builder.is_empty() {
                        w.attr("xmlns:mc", MC_NS);
                        if let Some(ref ignorable) = ignorable_value {
                            w.attr("mc:Ignorable", ignorable);
                        }
                    }
                    continue;
                }
                if (prefix == "x14ac" && has_descent && !preserved_has_x14ac)
                    || (prefix == "xr" && has_uid && !preserved_has_xr)
                {
                    continue;
                }
                w.attr(&format!("xmlns:{}", prefix), &decl.uri);
            }
        }
    }

    if let Some(ref uid) = sheet.uid {
        w.attr("xr:uid", uid);
    }

    if !preserved_has_mc {
        if let Some(ref ignorable) = ignorable_value {
            w.attr("mc:Ignorable", ignorable);
        }
    }

    w.end_attrs();
}

pub(super) fn write_worksheet_end(w: &mut XmlWriter) {
    w.end_element("worksheet");
}
