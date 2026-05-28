use crate::domain::styles::types::CellStyleDef;
use crate::write::xml_writer::XmlWriter;

pub(super) fn write_cell_styles(w: &mut XmlWriter, cell_styles: &[CellStyleDef]) {
    if cell_styles.is_empty() {
        w.start_element("cellStyles")
            .attr_num("count", 1u32)
            .end_attrs();

        w.start_element("cellStyle")
            .attr("name", "Normal")
            .attr_num("xfId", 0u32)
            .attr_num("builtinId", 0u32)
            .self_close();

        w.end_element("cellStyles");
        return;
    }

    w.start_element("cellStyles")
        .attr_num("count", cell_styles.len())
        .end_attrs();

    for cs in cell_styles {
        w.start_element("cellStyle")
            .attr_xstring("name", cs.effective_name())
            .attr_num("xfId", cs.xf_id);

        if let Some(id) = cs.builtin_id {
            w.attr_num("builtinId", id);
        }
        if cs.effective_custom_builtin() {
            w.attr("customBuiltin", "1");
        }
        if let Some(level) = cs.i_level {
            w.attr_num("iLevel", level);
        }
        if cs.hidden == Some(true) {
            w.attr("hidden", "1");
        }
        if let Some(ref uid) = cs.xr_uid {
            w.attr("xr:uid", uid);
        }

        let ext_xml = cs.ext_lst.as_ref().and_then(|e| e.raw_xml.as_ref());
        if let Some(raw) = ext_xml
            && !crate::infra::xml::raw_xml_contains_relationship_attr(raw)
        {
            w.end_attrs();
            w.raw(raw.as_bytes());
            w.end_element("cellStyle");
        } else {
            w.self_close();
        }
    }

    w.end_element("cellStyles");
}
