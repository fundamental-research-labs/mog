use crate::write::xml_writer::XmlWriter;
use domain_types::{ParseOutput, WorkbookMetadata};

pub(super) fn metadata_xml_for_export(
    output: &ParseOutput,
    _round_trip_ctx: Option<&domain_types::RoundTripContext>,
) -> Option<Vec<u8>> {
    output
        .metadata
        .as_ref()
        .filter(|metadata| !metadata.is_empty())
        .map(write_metadata_xml)
}

fn write_metadata_xml(metadata: &WorkbookMetadata) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();
    w.start_element("metadata")
        .attr(
            "xmlns",
            "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        )
        .attr(
            "xmlns:xda",
            "http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray",
        )
        .end_attrs();

    if !metadata.metadata_types.is_empty() {
        w.start_element("metadataTypes")
            .attr_num("count", metadata.metadata_types.len())
            .end_attrs();
        for mt in &metadata.metadata_types {
            w.start_element("metadataType").attr("name", &mt.name);
            if mt.min_supported_version != 0 {
                w.attr_num("minSupportedVersion", mt.min_supported_version);
            }
            attr_bool_01(&mut w, "copy", mt.copy);
            attr_bool_01(&mut w, "pasteAll", mt.paste_all);
            attr_bool_01(&mut w, "pasteValues", mt.paste_values);
            attr_bool_01(&mut w, "merge", mt.merge);
            attr_bool_01(&mut w, "splitFirst", mt.split_first);
            attr_bool_01(&mut w, "rowColShift", mt.row_col_shift);
            attr_bool_01(&mut w, "clearFormats", mt.clear_formats);
            attr_bool_01(&mut w, "clearComments", mt.clear_comments);
            attr_bool_01(&mut w, "assign", mt.assign);
            attr_bool_01(&mut w, "coerce", mt.coerce);
            attr_bool_01(&mut w, "cellMeta", mt.cell_meta);
            w.self_close();
        }
        w.end_element("metadataTypes");
    }

    for group in &metadata.future_metadata {
        w.start_element("futureMetadata")
            .attr("name", &group.name)
            .attr_num("count", group.blocks.len())
            .end_attrs();
        for block in &group.blocks {
            w.start_element("bk")
                .end_attrs()
                .raw_str(&block.raw_xml)
                .end_element("bk");
        }
        w.end_element("futureMetadata");
    }

    if !metadata.cell_metadata.is_empty() {
        w.start_element("cellMetadata")
            .attr_num("count", metadata.cell_metadata.len())
            .end_attrs();
        for block in &metadata.cell_metadata {
            w.start_element("bk").end_attrs();
            for record in &block.records {
                w.start_element("rc")
                    .attr_num("t", record.t)
                    .attr_num("v", record.v)
                    .self_close();
            }
            w.end_element("bk");
        }
        w.end_element("cellMetadata");
    }

    w.end_element("metadata");
    w.finish()
}

fn attr_bool_01(w: &mut XmlWriter, name: &str, value: bool) {
    if value {
        w.attr(name, "1");
    }
}
