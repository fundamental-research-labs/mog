use domain_types::ParseOutput;

pub(super) struct DocPropsXml {
    pub core: Option<Vec<u8>>,
    pub app: Option<Vec<u8>>,
    pub custom: Option<Vec<u8>>,
}

pub(super) fn build_doc_props_xml(output: &ParseOutput) -> DocPropsXml {
    DocPropsXml {
        core: output
            .properties
            .as_ref()
            .map(crate::domain::metadata::write::write_core_props_xml),
        app: Some(crate::domain::metadata::write::write_app_props_xml(
            output.extended_properties.as_ref(),
        ))
        .filter(|_| output.extended_properties.is_some() || output.properties.is_some()),
        custom: output.properties.as_ref().and_then(|properties| {
            (!properties.custom.is_empty() || !properties.typed_custom.is_empty())
                .then(|| crate::domain::metadata::write::write_custom_props_xml(properties))
        }),
    }
}
