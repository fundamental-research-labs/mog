// ExtensionList
// =============================================================================

/// Extension list for future compatibility (ECMA-376 CT_OfficeArtExtensionList).
///
/// Preserves raw XML for extensions that are not yet modelled.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ExtensionList {
    /// Raw XML string of the extension list element contents.
    pub raw_xml: Option<String>,
}
