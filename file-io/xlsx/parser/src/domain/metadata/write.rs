//! Document properties writer — generates `docProps/core.xml` and `docProps/app.xml`.

use crate::write::xml_writer::XmlWriter;

/// Build `docProps/core.xml` (Dublin Core metadata).
pub fn write_core_props_xml(props: &domain_types::DocumentProperties) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();
    w.start_element("cp:coreProperties")
        .attr(
            "xmlns:cp",
            "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
        )
        .attr("xmlns:dc", "http://purl.org/dc/elements/1.1/")
        .attr("xmlns:dcterms", "http://purl.org/dc/terms/")
        .attr("xmlns:dcmitype", "http://purl.org/dc/dcmitype/")
        .attr("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance")
        .end_attrs();

    if let Some(ref title) = props.title {
        w.start_element("dc:title")
            .end_attrs()
            .text(title)
            .end_element("dc:title");
    }
    if let Some(ref creator) = props.creator {
        w.start_element("dc:creator")
            .end_attrs()
            .text(creator)
            .end_element("dc:creator");
    }
    if let Some(ref description) = props.description {
        w.start_element("dc:description")
            .end_attrs()
            .text(description)
            .end_element("dc:description");
    }
    if let Some(ref subject) = props.subject {
        w.start_element("dc:subject")
            .end_attrs()
            .text(subject)
            .end_element("dc:subject");
    }
    if let Some(ref category) = props.category {
        w.start_element("cp:category")
            .end_attrs()
            .text(category)
            .end_element("cp:category");
    }
    if let Some(ref keywords) = props.keywords {
        w.start_element("cp:keywords")
            .end_attrs()
            .text(keywords)
            .end_element("cp:keywords");
    }
    if let Some(ref last_modified_by) = props.last_modified_by {
        w.start_element("cp:lastModifiedBy")
            .end_attrs()
            .text(last_modified_by)
            .end_element("cp:lastModifiedBy");
    }
    if let Some(ref created) = props.created {
        w.start_element("dcterms:created")
            .attr("xsi:type", "dcterms:W3CDTF")
            .end_attrs()
            .text(created)
            .end_element("dcterms:created");
    }
    if let Some(ref modified) = props.modified {
        w.start_element("dcterms:modified")
            .attr("xsi:type", "dcterms:W3CDTF")
            .end_attrs()
            .text(modified)
            .end_element("dcterms:modified");
    }

    w.end_element("cp:coreProperties");
    w.finish()
}

/// Build `docProps/app.xml` (extended properties).
pub fn write_app_props_xml() -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();
    w.start_element("Properties")
        .attr(
            "xmlns",
            "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
        )
        .end_attrs();
    w.start_element("Application")
        .end_attrs()
        .text("Shortcut")
        .end_element("Application");
    w.end_element("Properties");
    w.finish()
}
