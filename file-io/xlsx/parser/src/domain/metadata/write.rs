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
    if let Some(ref identifier) = props.identifier {
        w.start_element("dc:identifier")
            .end_attrs()
            .text(identifier)
            .end_element("dc:identifier");
    }
    if let Some(ref language) = props.language {
        w.start_element("dc:language")
            .end_attrs()
            .text(language)
            .end_element("dc:language");
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
    if let Some(ref content_status) = props.content_status {
        w.start_element("cp:contentStatus")
            .end_attrs()
            .text(content_status)
            .end_element("cp:contentStatus");
    }
    if let Some(ref content_type) = props.content_type {
        w.start_element("cp:contentType")
            .end_attrs()
            .text(content_type)
            .end_element("cp:contentType");
    }
    if let Some(ref last_modified_by) = props.last_modified_by {
        w.start_element("cp:lastModifiedBy")
            .end_attrs()
            .text(last_modified_by)
            .end_element("cp:lastModifiedBy");
    }
    if let Some(ref last_printed) = props.last_printed {
        w.start_element("cp:lastPrinted")
            .end_attrs()
            .text(last_printed)
            .end_element("cp:lastPrinted");
    }
    if let Some(ref revision) = props.revision {
        w.start_element("cp:revision")
            .end_attrs()
            .text(revision)
            .end_element("cp:revision");
    }
    if let Some(ref version) = props.version {
        w.start_element("cp:version")
            .end_attrs()
            .text(version)
            .end_element("cp:version");
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
pub fn write_app_props_xml(props: Option<&domain_types::ExtendedDocumentProperties>) -> Vec<u8> {
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

fn write_modeled_app_props_xml(props: &domain_types::ExtendedDocumentProperties) -> Vec<u8> {
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
    u32_opt(&mut w, "Pages", props.pages);
    u32_opt(&mut w, "Words", props.words);
    u32_opt(&mut w, "Characters", props.characters);
    text_opt(
        &mut w,
        "PresentationFormat",
        props.presentation_format.as_deref(),
    );
    u32_opt(&mut w, "Lines", props.lines);
    u32_opt(&mut w, "Paragraphs", props.paragraphs);
    u32_opt(&mut w, "Slides", props.slides);
    u32_opt(&mut w, "Notes", props.notes);
    u32_opt(&mut w, "HiddenSlides", props.hidden_slides);
    u32_opt(&mut w, "MMClips", props.mm_clips);
    bool_opt(&mut w, "LinksUpToDate", props.links_up_to_date);
    u32_opt(&mut w, "CharactersWithSpaces", props.characters_with_spaces);
    bool_opt(&mut w, "SharedDoc", props.shared_doc);
    bool_opt(&mut w, "HyperlinksChanged", props.hyperlinks_changed);
    text_opt(&mut w, "HyperlinkBase", props.hyperlink_base.as_deref());
    text_opt(&mut w, "DigSig", props.dig_sig.as_deref());
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
        write_lpstr_vector(&mut w, "TitlesOfParts", &props.titles_of_parts);
    }

    if !props.hlinks.is_empty() {
        write_lpstr_vector(&mut w, "HLinks", &props.hlinks);
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

fn u32_opt(w: &mut XmlWriter, name: &str, value: Option<u32>) {
    if let Some(value) = value {
        w.element_with_text(name, &value.to_string());
    }
}

fn write_lpstr_vector(w: &mut XmlWriter, name: &str, values: &[String]) {
    w.start_element(name).end_attrs();
    w.start_element("vt:vector")
        .attr_num("size", values.len())
        .attr("baseType", "lpstr")
        .end_attrs();
    for value in values {
        w.element_with_text("vt:lpstr", value);
    }
    w.end_element("vt:vector").end_element(name);
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
                fmtid: None,
                pid: None,
                name: name.clone(),
                link_target: None,
                value: domain_types::DocumentCustomPropertyValue::Lpwstr(value.clone()),
            })
            .collect()
    } else {
        props.typed_custom.clone()
    };

    for (idx, prop) in typed_properties.iter().enumerate() {
        w.start_element("property")
            .attr(
                "fmtid",
                prop.fmtid
                    .as_deref()
                    .unwrap_or(domain_types::DEFAULT_CUSTOM_PROPERTY_FMTID),
            )
            .attr_num("pid", prop.pid.unwrap_or((idx + 2) as u32))
            .attr("name", &prop.name);
        if let Some(link_target) = prop.link_target.as_deref() {
            w.attr("linkTarget", link_target);
        }
        w.end_attrs();
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
        domain_types::DocumentCustomPropertyValue::Empty => {
            w.start_element("vt:empty")
                .end_attrs()
                .end_element("vt:empty");
        }
        domain_types::DocumentCustomPropertyValue::Null => {
            w.start_element("vt:null")
                .end_attrs()
                .end_element("vt:null");
        }
        domain_types::DocumentCustomPropertyValue::Lpwstr(value) => {
            write_custom_property_text(w, "vt:lpwstr", value);
        }
        domain_types::DocumentCustomPropertyValue::Lpstr(value) => {
            write_custom_property_text(w, "vt:lpstr", value);
        }
        domain_types::DocumentCustomPropertyValue::Bstr(value) => {
            write_custom_property_text(w, "vt:bstr", value);
        }
        domain_types::DocumentCustomPropertyValue::I1(value) => {
            write_custom_property_text(w, "vt:i1", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::I2(value) => {
            write_custom_property_text(w, "vt:i2", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::I4(value) => {
            write_custom_property_text(w, "vt:i4", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::I8(value) => {
            write_custom_property_text(w, "vt:i8", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::Int(value) => {
            write_custom_property_text(w, "vt:int", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::Ui1(value) => {
            write_custom_property_text(w, "vt:ui1", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::Ui2(value) => {
            write_custom_property_text(w, "vt:ui2", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::Ui4(value) => {
            write_custom_property_text(w, "vt:ui4", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::Ui8(value) => {
            write_custom_property_text(w, "vt:ui8", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::Uint(value) => {
            write_custom_property_text(w, "vt:uint", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::R4(value) => {
            write_custom_property_text(w, "vt:r4", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::R8(value) => {
            write_custom_property_text(w, "vt:r8", &value.to_string());
        }
        domain_types::DocumentCustomPropertyValue::Decimal(value) => {
            write_custom_property_text(w, "vt:decimal", value);
        }
        domain_types::DocumentCustomPropertyValue::Bool(value) => {
            write_custom_property_text(w, "vt:bool", if *value { "true" } else { "false" });
        }
        domain_types::DocumentCustomPropertyValue::Date(value) => {
            write_custom_property_text(w, "vt:date", value);
        }
        domain_types::DocumentCustomPropertyValue::Filetime(value) => {
            write_custom_property_text(w, "vt:filetime", value);
        }
        domain_types::DocumentCustomPropertyValue::Cy(value) => {
            write_custom_property_text(w, "vt:cy", value)
        }
        domain_types::DocumentCustomPropertyValue::Error(value) => {
            write_custom_property_text(w, "vt:error", value)
        }
        domain_types::DocumentCustomPropertyValue::Clsid(value) => {
            write_custom_property_text(w, "vt:clsid", value)
        }
        domain_types::DocumentCustomPropertyValue::Blob(value) => {
            write_custom_property_text(w, "vt:blob", value)
        }
        domain_types::DocumentCustomPropertyValue::Oblob(value) => {
            write_custom_property_text(w, "vt:oblob", value)
        }
        domain_types::DocumentCustomPropertyValue::Stream(value) => {
            write_custom_property_text(w, "vt:stream", value)
        }
        domain_types::DocumentCustomPropertyValue::Ostream(value) => {
            write_custom_property_text(w, "vt:ostream", value)
        }
        domain_types::DocumentCustomPropertyValue::Storage(value) => {
            write_custom_property_text(w, "vt:storage", value)
        }
        domain_types::DocumentCustomPropertyValue::Ostorage(value) => {
            write_custom_property_text(w, "vt:ostorage", value)
        }
        domain_types::DocumentCustomPropertyValue::Vstream(value) => {
            write_custom_property_text(w, "vt:vstream", value)
        }
        domain_types::DocumentCustomPropertyValue::Vector(vector) => {
            w.start_element("vt:vector")
                .attr_num("size", vector.values.len())
                .attr("baseType", &vector.base_type)
                .end_attrs();
            for value in &vector.values {
                write_custom_property_value(w, value);
            }
            w.end_element("vt:vector");
        }
    }
}

fn write_custom_property_text(w: &mut XmlWriter, element: &str, value: &str) {
    w.start_element(element)
        .end_attrs()
        .text(value)
        .end_element(element);
}
