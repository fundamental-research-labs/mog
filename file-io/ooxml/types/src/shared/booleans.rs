// ============================================================================
// OnOff — ST_OnOff
// ============================================================================

/// Union boolean type that accepts: true/false/1/0/on/off (ST_OnOff).
///
/// This is the most common boolean representation in OOXML attributes.
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
pub enum OnOff {
    /// On / true / 1.
    #[xml("true", alias = "1", alias = "on")]
    On,
    /// Off / false / 0 (default).
    #[default]
    #[xml("false", alias = "0", alias = "off")]
    Off,
}

// ============================================================================
// OnOff1 — ST_OnOff1
// ============================================================================

/// String-only boolean: "on", "off" (ST_OnOff1).
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
pub enum OnOff1 {
    /// On.
    #[xml("on")]
    On,
    /// Off (default).
    #[default]
    #[xml("off")]
    Off,
}

// ============================================================================
// TrueFalse — ST_TrueFalse
// ============================================================================

/// VML boolean type: "t", "f", "true", "false" (ST_TrueFalse).
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
pub enum TrueFalse {
    /// True.
    #[xml("true", alias = "t")]
    True,
    /// False (default).
    #[default]
    #[xml("false", alias = "f")]
    False,
}

// ============================================================================
// TrueFalseBlank — ST_TrueFalseBlank
// ============================================================================

/// VML boolean with blank: "t", "f", "true", "false", "", "True", "False" (ST_TrueFalseBlank).
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
pub enum TrueFalseBlank {
    /// True.
    #[xml("true", alias = "t", alias = "True")]
    True,
    /// False.
    #[xml("false", alias = "f", alias = "False")]
    False,
    /// Blank (default).
    #[default]
    #[xml("")]
    Blank,
}
