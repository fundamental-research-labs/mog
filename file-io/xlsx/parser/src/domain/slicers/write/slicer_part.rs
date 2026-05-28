use crate::infra::xml::raw_xml_contains_relationship_attr;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::slicers::SlicerDef;

use super::namespaces::{NS_MC, NS_X, NS_X14, NS_XR10};

/// Serialize a vector of slicer definitions to an `xl/slicers/slicer{N}.xml` part.
///
/// Optional attributes that match their defaults are omitted.
pub fn write_slicer_part(slicers: &[SlicerDef]) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();

    let has_uid = slicers.iter().any(|s| s.uid.is_some());

    w.start_element("slicers")
        .attr("xmlns", NS_X14)
        .attr("xmlns:mc", NS_MC);

    if has_uid {
        w.attr("mc:Ignorable", "x xr10");
    } else {
        w.attr("mc:Ignorable", "x");
    }
    w.attr("xmlns:x", NS_X);
    if has_uid {
        w.attr("xmlns:xr10", NS_XR10);
    }

    w.end_attrs();

    for slicer in slicers {
        write_slicer_element(&mut w, slicer);
    }

    w.end_element("slicers");
    w.finish()
}

fn write_slicer_element(w: &mut XmlWriter, s: &SlicerDef) {
    w.start_element("slicer").attr("name", &s.name);

    if let Some(ref uid) = s.uid {
        w.attr("xr10:uid", uid);
    }

    w.attr("cache", &s.cache);

    if let Some(ref caption) = s.caption {
        w.attr("caption", caption);
    }
    if let Some(start_item) = s.start_item {
        w.attr("startItem", &start_item.to_string());
    }
    if s.column_count != 1 {
        w.attr("columnCount", &s.column_count.to_string());
    }
    if !s.show_caption {
        w.attr("showCaption", "0");
    }
    if s.level != 0 {
        w.attr("level", &s.level.to_string());
    }
    if let Some(ref style) = s.style {
        w.attr("style", style);
    }
    if s.locked_position {
        w.attr("lockedPosition", "1");
    }
    if let Some(row_height) = s.row_height {
        w.attr("rowHeight", &row_height.to_string());
    }

    if let Some(ref ext_lst) = s.ext_lst {
        if !raw_xml_contains_relationship_attr(ext_lst) {
            w.end_attrs();
            w.raw_str(ext_lst);
            w.end_element("slicer");
            return;
        }
    }

    w.self_close();
}
