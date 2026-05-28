// ============================================================================
// VerticalAlignRun — ST_VerticalAlignRun
// ============================================================================

/// Vertical alignment for a text run (ECMA-376 ST_VerticalAlignRun).
///
/// Controls superscript/subscript positioning within rich text.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum VerticalAlignRun {
    /// Normal baseline text (default).
    #[default]
    #[xml("baseline")]
    Baseline,
    /// Superscript text.
    #[xml("superscript")]
    Superscript,
    /// Subscript text.
    #[xml("subscript")]
    Subscript,
}
