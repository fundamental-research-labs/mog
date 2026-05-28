// ============================================================================
// ConformanceClass — ST_ConformanceClass
// ============================================================================

/// Document conformance class (ST_ConformanceClass).
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
pub enum ConformanceClass {
    /// Strict conformance.
    #[xml("strict")]
    Strict,
    /// Transitional conformance (default).
    #[default]
    #[xml("transitional")]
    Transitional,
}
