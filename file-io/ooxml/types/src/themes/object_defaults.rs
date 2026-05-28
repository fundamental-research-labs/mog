use crate::drawings::ExtensionList;

// =============================================================================
// Default Shape Definition (CT_DefaultShapeDefinition)
// =============================================================================

/// Default shape definition (ECMA-376 CT_DefaultShapeDefinition, dml-main.xsd:2266).
///
/// The XSD defines required children `spPr` (CT_ShapeProperties), `bodyPr`
/// (CT_TextBodyProperties), and `lstStyle` (CT_TextListStyle), plus optional
/// `style` (CT_ShapeStyle) and `extLst`.
///
/// **Intentional simplification**: Stored as raw XML passthrough since the inner
/// structure is complex and rarely needed for spreadsheet processing. The raw XML
/// preserves full fidelity for roundtrip — `spPr`, `bodyPr`, and `lstStyle` are
/// all captured within `raw_xml`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct DefaultShapeDefinition {
    /// Raw XML content of the shape definition (contains spPr, bodyPr, lstStyle, etc.)
    pub raw_xml: Option<String>,
}

// =============================================================================
// Object Style Defaults (CT_ObjectStyleDefaults)
// =============================================================================

/// Default styles for shapes, lines, and text boxes (ECMA-376 CT_ObjectStyleDefaults).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct ObjectStyleDefaults {
    /// Default shape definition
    pub sp_def: Option<DefaultShapeDefinition>,
    /// Default line definition
    pub ln_def: Option<DefaultShapeDefinition>,
    /// Default text definition
    pub tx_def: Option<DefaultShapeDefinition>,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}
