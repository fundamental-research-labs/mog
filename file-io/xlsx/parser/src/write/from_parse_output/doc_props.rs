use domain_types::ParseOutput;

pub(super) struct DocPropsXml {
    pub core: Option<Vec<u8>>,
    pub app: Option<Vec<u8>>,
    pub custom: Option<Vec<u8>>,
}

pub(super) fn build_doc_props_xml(output: &ParseOutput) -> DocPropsXml {
    let generated_core = output
        .properties
        .as_ref()
        .map(crate::domain::metadata::write::write_core_props_xml);
    let generated_app = Some(crate::domain::metadata::write::write_app_props_xml(
        output.extended_properties.as_ref(),
    ))
    .filter(|_| output.extended_properties.is_some() || output.properties.is_some());
    let generated_custom = output.properties.as_ref().and_then(|properties| {
        (!properties.custom.is_empty() || !properties.typed_custom.is_empty())
            .then(|| crate::domain::metadata::write::write_custom_props_xml(properties))
    });

    DocPropsXml {
        core: doc_prop_xml(output, "docProps/core.xml", generated_core),
        app: doc_prop_xml(output, "docProps/app.xml", generated_app),
        custom: doc_prop_xml(output, "docProps/custom.xml", generated_custom),
    }
}

fn doc_prop_xml(output: &ParseOutput, path: &str, generated: Option<Vec<u8>>) -> Option<Vec<u8>> {
    let generated = generated?;
    output
        .package_fidelity
        .as_ref()
        .and_then(|metadata| {
            metadata.raw_doc_props.iter().find(|hint| {
                hint.path == path && hint.generated_at_import.as_slice() == generated.as_slice()
            })
        })
        .map(|hint| hint.bytes.clone())
        .or(Some(generated))
}
