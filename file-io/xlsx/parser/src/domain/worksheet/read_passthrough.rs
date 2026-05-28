use super::read_support::complete_element_xml;

/// Extract the raw `<autoFilter ...>` element from worksheet XML for verbatim round-trip.
pub fn extract_auto_filter_xml(post_sd: &[u8]) -> Option<String> {
    complete_element_xml(post_sd, b"autoFilter")
}

/// Extract the raw `<customProperties>...</customProperties>` element from post-sheetData XML.
pub fn extract_custom_properties_xml(post_sd: &[u8]) -> Option<String> {
    complete_element_xml(post_sd, b"customProperties")
}
