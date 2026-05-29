use domain_types::{
    DataFeatureDiagnostic, DataFeatureDiagnosticCode, DataFeatureDiagnosticSeverity,
    DataFeatureExportBehavior, FeaturePropertyAttribute, FeaturePropertyBag,
    FeaturePropertyBagElement, FeaturePropertyBagKind, FeaturePropertyBagPackageIdentity,
    WorkbookFeatureProperties,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

use crate::infra::opc::resolve_relationship_target;
use crate::zip::XlsxArchive;

pub const FEATURE_PROPERTY_BAG_REL_TYPE: &str =
    "http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag";
pub const FEATURE_PROPERTY_BAG_CONTENT_TYPE: &str =
    "application/vnd.ms-excel.featurepropertybag+xml";
pub const FEATURE_PROPERTY_BAG_NS: &str =
    "http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag";
pub const DEFAULT_FEATURE_PROPERTY_BAG_PATH: &str = "xl/featurePropertyBag/featurePropertyBag.xml";

pub fn read_workbook_feature_properties(
    archive: &XlsxArchive,
    workbook_relationships: &[ooxml_types::shared::OpcRelationship],
    content_type_overrides: &[(String, String)],
) -> WorkbookFeatureProperties {
    let Some(relationship) = workbook_relationships
        .iter()
        .find(|relationship| relationship.rel_type == FEATURE_PROPERTY_BAG_REL_TYPE)
    else {
        return WorkbookFeatureProperties::default();
    };

    let resolved_path =
        match resolve_relationship_target(Some("xl/workbook.xml"), &relationship.target) {
            Ok(path) => path,
            Err(_) => {
                return with_diagnostic(
                    None,
                    Some(relationship),
                    DataFeatureDiagnosticCode::InvalidFeaturePropertyBagReference,
                    "Feature property bag workbook relationship target could not be resolved",
                );
            }
        };

    let Some(content_type) = content_type_overrides
        .iter()
        .find(|(path, _)| domain_types::normalize_package_path(path) == resolved_path)
        .map(|(_, content_type)| content_type.clone())
    else {
        return with_diagnostic(
            Some(&resolved_path),
            Some(relationship),
            DataFeatureDiagnosticCode::MissingFeaturePropertyBagContentType,
            "Feature property bag part is missing its content type override",
        );
    };

    if content_type != FEATURE_PROPERTY_BAG_CONTENT_TYPE {
        return with_diagnostic(
            Some(&resolved_path),
            Some(relationship),
            DataFeatureDiagnosticCode::WrongFeaturePropertyBagContentType,
            "Feature property bag part has an unsupported content type",
        );
    }

    let Ok(xml) = archive.read_file(&resolved_path) else {
        return with_diagnostic(
            Some(&resolved_path),
            Some(relationship),
            DataFeatureDiagnosticCode::MissingFeaturePropertyBagPart,
            "Feature property bag workbook relationship targets a missing part",
        );
    };

    let mut feature_properties = parse_feature_property_bags_xml(&xml).unwrap_or_else(|summary| {
        with_diagnostic(
            Some(&resolved_path),
            Some(relationship),
            DataFeatureDiagnosticCode::MalformedFeaturePropertyBagXml,
            summary,
        )
    });
    feature_properties.package = Some(FeaturePropertyBagPackageIdentity {
        path: resolved_path,
        content_type,
        workbook_relationship_id: Some(relationship.id.clone()),
        workbook_relationship_type: relationship.rel_type.clone(),
        workbook_relationship_target: Some(relationship.target.clone()),
    });
    feature_properties
}

pub fn parse_feature_property_bags_xml(xml: &[u8]) -> Result<WorkbookFeatureProperties, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut bags = Vec::new();
    let mut stack: Vec<FeaturePropertyBagElement> = Vec::new();
    let mut current_bag: Option<FeaturePropertyBag> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(start)) => {
                let name = local_name(&start);
                if name == "bag" && current_bag.is_none() {
                    let attributes = attributes(&start)?;
                    let bag_type = attribute_value(&attributes, "type").unwrap_or_default();
                    let imported_ordinal = bags.len() as u32;
                    current_bag = Some(FeaturePropertyBag {
                        stable_id: format!("feature-bag-{imported_ordinal}"),
                        imported_ordinal,
                        imported_bag_id: Some(imported_ordinal),
                        kind: FeaturePropertyBagKind::from_bag_type(&bag_type),
                        ext_ref: attribute_value(&attributes, "extRef"),
                        bag_type,
                        attributes,
                        children: Vec::new(),
                    });
                } else if current_bag.is_some() {
                    stack.push(FeaturePropertyBagElement {
                        name,
                        attributes: attributes(&start)?,
                        text: None,
                        children: Vec::new(),
                    });
                }
            }
            Ok(Event::Empty(start)) => {
                let name = local_name(&start);
                if name == "bag" && current_bag.is_none() {
                    let attributes = attributes(&start)?;
                    let bag_type = attribute_value(&attributes, "type").unwrap_or_default();
                    let imported_ordinal = bags.len() as u32;
                    bags.push(FeaturePropertyBag {
                        stable_id: format!("feature-bag-{imported_ordinal}"),
                        imported_ordinal,
                        imported_bag_id: Some(imported_ordinal),
                        kind: FeaturePropertyBagKind::from_bag_type(&bag_type),
                        ext_ref: attribute_value(&attributes, "extRef"),
                        bag_type,
                        attributes,
                        children: Vec::new(),
                    });
                } else if current_bag.is_some() {
                    push_element(
                        &mut stack,
                        current_bag.as_mut(),
                        FeaturePropertyBagElement {
                            name,
                            attributes: attributes(&start)?,
                            text: None,
                            children: Vec::new(),
                        },
                    );
                }
            }
            Ok(Event::Text(text)) => {
                if let Some(element) = stack.last_mut() {
                    let value = text
                        .unescape()
                        .map_err(|err| format!("invalid feature property text: {err}"))?
                        .into_owned();
                    if !value.is_empty() {
                        element.text = Some(value);
                    }
                }
            }
            Ok(Event::End(end)) => {
                let name = String::from_utf8_lossy(end.local_name().as_ref()).to_string();
                if name == "bag" && stack.is_empty() {
                    if let Some(bag) = current_bag.take() {
                        bags.push(bag);
                    }
                } else if current_bag.is_some()
                    && let Some(element) = stack.pop()
                {
                    push_element(&mut stack, current_bag.as_mut(), element);
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("malformed feature property bag XML: {err}")),
            _ => {}
        }
        buf.clear();
    }

    let mut diagnostics = Vec::new();
    for bag in &bags {
        if bag.kind == FeaturePropertyBagKind::Unknown {
            diagnostics.push(DataFeatureDiagnostic {
                code: DataFeatureDiagnosticCode::UnsupportedFeaturePropertyBag,
                severity: DataFeatureDiagnosticSeverity::Warning,
                package_path: None,
                relationship_owner: Some("xl/workbook.xml".to_string()),
                relationship_id: None,
                affected_feature_id: Some(bag.stable_id.clone()),
                export_behavior: DataFeatureExportBehavior::DroppedWithDiagnostic,
                summary: format!(
                    "Unsupported feature property bag type `{}` requires an explicit owner before export",
                    bag.bag_type
                ),
                api_visible: true,
            });
        }
    }

    Ok(WorkbookFeatureProperties {
        bags,
        diagnostics,
        package: None,
    })
}

pub fn write_feature_property_bags_xml(feature_properties: &WorkbookFeatureProperties) -> Vec<u8> {
    let mut writer = crate::write::xml_writer::XmlWriter::new();
    writer.write_declaration();
    writer
        .start_element("FeaturePropertyBags")
        .attr("xmlns", FEATURE_PROPERTY_BAG_NS)
        .end_attrs();
    for bag in &feature_properties.bags {
        writer.start_element("bag");
        for attribute in &bag.attributes {
            writer.attr(&attribute.name, &attribute.value);
        }
        if !bag
            .attributes
            .iter()
            .any(|attribute| attribute.name == "type")
        {
            writer.attr("type", &bag.bag_type);
        }
        if let Some(ext_ref) = bag.ext_ref.as_deref()
            && !bag
                .attributes
                .iter()
                .any(|attribute| attribute.name == "extRef")
        {
            writer.attr("extRef", ext_ref);
        }
        if bag.children.is_empty() {
            writer.self_close();
        } else {
            writer.end_attrs();
            for child in &bag.children {
                write_feature_property_element(&mut writer, child);
            }
            writer.end_element("bag");
        }
    }
    writer.end_element("FeaturePropertyBags");
    writer.finish()
}

fn write_feature_property_element(
    writer: &mut crate::write::xml_writer::XmlWriter,
    element: &FeaturePropertyBagElement,
) {
    writer.start_element(&element.name);
    for attribute in &element.attributes {
        writer.attr(&attribute.name, &attribute.value);
    }
    if element.children.is_empty() && element.text.is_none() {
        writer.self_close();
        return;
    }
    writer.end_attrs();
    if let Some(text) = element.text.as_deref() {
        writer.text(text);
    }
    for child in &element.children {
        write_feature_property_element(writer, child);
    }
    writer.end_element(&element.name);
}

fn push_element(
    stack: &mut [FeaturePropertyBagElement],
    current_bag: Option<&mut FeaturePropertyBag>,
    element: FeaturePropertyBagElement,
) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(element);
    } else if let Some(bag) = current_bag {
        bag.children.push(element);
    }
}

fn attributes(start: &BytesStart<'_>) -> Result<Vec<FeaturePropertyAttribute>, String> {
    start
        .attributes()
        .map(|attr| {
            let attr = attr.map_err(|err| format!("invalid feature property attribute: {err}"))?;
            Ok(FeaturePropertyAttribute {
                name: String::from_utf8_lossy(attr.key.local_name().as_ref()).to_string(),
                value: attr
                    .unescape_value()
                    .map_err(|err| format!("invalid feature property attribute value: {err}"))?
                    .into_owned(),
            })
        })
        .collect()
}

fn attribute_value(attributes: &[FeaturePropertyAttribute], name: &str) -> Option<String> {
    attributes
        .iter()
        .find(|attribute| attribute.name == name)
        .map(|attribute| attribute.value.clone())
}

fn local_name(start: &BytesStart<'_>) -> String {
    String::from_utf8_lossy(start.local_name().as_ref()).to_string()
}

fn with_diagnostic(
    package_path: Option<&str>,
    relationship: Option<&ooxml_types::shared::OpcRelationship>,
    code: DataFeatureDiagnosticCode,
    summary: impl Into<String>,
) -> WorkbookFeatureProperties {
    WorkbookFeatureProperties {
        bags: Vec::new(),
        diagnostics: vec![DataFeatureDiagnostic {
            code,
            severity: DataFeatureDiagnosticSeverity::Warning,
            package_path: package_path.map(str::to_string),
            relationship_owner: Some("xl/workbook.xml".to_string()),
            relationship_id: relationship.map(|rel| rel.id.clone()),
            affected_feature_id: None,
            export_behavior: DataFeatureExportBehavior::DroppedWithDiagnostic,
            summary: summary.into(),
            api_visible: true,
        }],
        package: None,
    }
}
