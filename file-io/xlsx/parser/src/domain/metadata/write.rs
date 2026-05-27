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
pub fn write_app_props_xml(props: Option<&ooxml_types::doc_props::ExtendedProperties>) -> Vec<u8> {
    if let Some(props) = props {
        return write_modeled_app_props_xml(props);
    }

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

fn write_modeled_app_props_xml(props: &ooxml_types::doc_props::ExtendedProperties) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();
    w.start_element("Properties")
        .attr(
            "xmlns",
            "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
        )
        .attr(
            "xmlns:vt",
            "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
        )
        .end_attrs();

    text_opt(&mut w, "Application", props.application.as_deref());
    text_opt(
        &mut w,
        "DocSecurity",
        props.doc_security.map(|v| v.to_string()).as_deref(),
    );
    bool_opt(&mut w, "ScaleCrop", props.scale_crop);
    text_opt(&mut w, "Template", props.template.as_deref());
    text_opt(&mut w, "Manager", props.manager.as_deref());
    text_opt(&mut w, "Company", props.company.as_deref());
    bool_opt(&mut w, "LinksUpToDate", props.links_up_to_date);
    bool_opt(&mut w, "SharedDoc", props.shared_doc);
    bool_opt(&mut w, "HyperlinksChanged", props.hyperlinks_changed);
    text_opt(&mut w, "HyperlinkBase", props.hyperlink_base.as_deref());
    text_opt(&mut w, "AppVersion", props.app_version.as_deref());
    text_opt(&mut w, "TotalTime", props.total_time.as_deref());

    if !props.heading_pairs.is_empty() {
        w.start_element("HeadingPairs").end_attrs();
        w.start_element("vt:vector")
            .attr_num("size", props.heading_pairs.len() * 2)
            .attr("baseType", "variant")
            .end_attrs();
        for pair in &props.heading_pairs {
            w.start_element("vt:variant")
                .end_attrs()
                .element_with_text("vt:lpstr", &pair.name)
                .end_element("vt:variant");
            w.start_element("vt:variant")
                .end_attrs()
                .element_with_text("vt:i4", &pair.count.to_string())
                .end_element("vt:variant");
        }
        w.end_element("vt:vector").end_element("HeadingPairs");
    }

    if !props.titles_of_parts.is_empty() {
        w.start_element("TitlesOfParts").end_attrs();
        w.start_element("vt:vector")
            .attr_num("size", props.titles_of_parts.len())
            .attr("baseType", "lpstr")
            .end_attrs();
        for title in &props.titles_of_parts {
            w.element_with_text("vt:lpstr", title);
        }
        w.end_element("vt:vector").end_element("TitlesOfParts");
    }

    w.end_element("Properties");
    w.finish()
}

fn text_opt(w: &mut XmlWriter, name: &str, value: Option<&str>) {
    if let Some(value) = value {
        w.element_with_text(name, value);
    }
}

fn bool_opt(w: &mut XmlWriter, name: &str, value: Option<bool>) {
    if let Some(value) = value {
        w.element_with_text(name, if value { "true" } else { "false" });
    }
}

/// Build `docProps/custom.xml` from modeled custom document properties.
pub fn write_custom_props_xml(props: &domain_types::DocumentProperties) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();
    w.start_element("Properties")
        .attr(
            "xmlns",
            "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties",
        )
        .attr(
            "xmlns:vt",
            "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
        )
        .end_attrs();

    let typed_properties: Vec<_> = if props.typed_custom.is_empty() {
        props
            .custom
            .iter()
            .map(|(name, value)| domain_types::DocumentCustomProperty {
                name: name.clone(),
                value: domain_types::DocumentCustomPropertyValue::Lpwstr(value.clone()),
            })
            .collect()
    } else {
        props.typed_custom.clone()
    };

    for (idx, prop) in typed_properties.iter().enumerate() {
        w.start_element("property")
            .attr("fmtid", "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}")
            .attr_num("pid", idx + 2)
            .attr("name", &prop.name)
            .end_attrs();
        write_custom_property_value(&mut w, &prop.value);
        w.end_element("property");
    }

    w.end_element("Properties");
    w.finish()
}

fn write_custom_property_value(
    w: &mut XmlWriter,
    value: &domain_types::DocumentCustomPropertyValue,
) {
    match value {
        domain_types::DocumentCustomPropertyValue::Lpwstr(value) => {
            write_custom_property_text(w, "vt:lpwstr", value);
        }
        domain_types::DocumentCustomPropertyValue::I4(value) => {
            w.start_element("vt:i4")
                .end_attrs()
                .text(&value.to_string())
                .end_element("vt:i4");
        }
        domain_types::DocumentCustomPropertyValue::R8(value) => {
            w.start_element("vt:r8")
                .end_attrs()
                .text(&value.to_string())
                .end_element("vt:r8");
        }
        domain_types::DocumentCustomPropertyValue::Bool(value) => {
            w.start_element("vt:bool")
                .end_attrs()
                .text(if *value { "true" } else { "false" })
                .end_element("vt:bool");
        }
        domain_types::DocumentCustomPropertyValue::Filetime(value) => {
            write_custom_property_text(w, "vt:filetime", value);
        }
    }
}

fn write_custom_property_text(w: &mut XmlWriter, element: &str, value: &str) {
    w.start_element(element)
        .end_attrs()
        .text(value)
        .end_element(element);
}
