use domain_types::ParseOutput;

pub(super) fn theme_xml_for_export(output: &ParseOutput) -> Vec<u8> {
    output
        .theme
        .as_ref()
        .map(crate::domain::themes::write::theme_writer_from_domain)
        .unwrap_or_else(|| {
            crate::domain::themes::write::ThemeWriter::default_office_theme().to_xml()
        })
}
