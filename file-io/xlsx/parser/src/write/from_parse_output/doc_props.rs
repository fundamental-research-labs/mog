use domain_types::ParseOutput;

pub(super) struct DocPropsXml {
    pub core: Option<Vec<u8>>,
    pub app: Option<Vec<u8>>,
    pub custom: Option<Vec<u8>>,
}

pub(super) fn build_doc_props_xml(output: &ParseOutput) -> DocPropsXml {
    let Some(properties) = output.properties.as_ref() else {
        return DocPropsXml {
            core: None,
            app: None,
            custom: None,
        };
    };

    DocPropsXml {
        core: Some(crate::domain::metadata::write::write_core_props_xml(
            properties,
        )),
        app: Some(crate::domain::metadata::write::write_app_props_xml()),
        custom: (!properties.custom.is_empty())
            .then(|| crate::domain::metadata::write::write_custom_props_xml(properties)),
    }
}
