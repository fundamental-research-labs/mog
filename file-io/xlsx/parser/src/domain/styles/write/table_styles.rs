use crate::domain::styles::types::TableStyleDef;
use crate::write::xml_writer::XmlWriter;

pub(super) fn write_table_styles(
    w: &mut XmlWriter,
    table_styles: &[TableStyleDef],
    default_table_style: Option<&str>,
    default_pivot_style: Option<&str>,
) {
    w.start_element("tableStyles")
        .attr_num("count", table_styles.len());

    w.attr(
        "defaultTableStyle",
        default_table_style.unwrap_or("TableStyleMedium2"),
    );
    w.attr(
        "defaultPivotStyle",
        default_pivot_style.unwrap_or("PivotStyleLight16"),
    );

    if table_styles.is_empty() {
        w.self_close();
        return;
    }

    w.end_attrs();

    for ts in table_styles {
        w.start_element("tableStyle").attr("name", &ts.name);

        match ts.pivot {
            Some(true) => {
                w.attr("pivot", "1");
            }
            Some(false) => {
                w.attr("pivot", "0");
            }
            None => {}
        }
        match ts.table {
            Some(false) => {
                w.attr("table", "0");
            }
            Some(true) => {
                w.attr("table", "1");
            }
            None => {}
        }
        if let Some(count) = ts.count {
            w.attr_num("count", count);
        }
        if let Some(ref uid) = ts.xr_uid {
            w.attr("xr9:uid", uid);
        }

        w.end_attrs();

        for el in &ts.elements {
            w.start_element("tableStyleElement")
                .attr("type", el.style_type.to_ooxml());

            if let Some(dxf_id) = el.dxf_id {
                w.attr_num("dxfId", dxf_id);
            }

            if let Some(size) = el.size {
                w.attr_num("size", size);
            }

            w.self_close();
        }

        w.end_element("tableStyle");
    }

    w.end_element("tableStyles");
}
