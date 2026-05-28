// ============================================================================
// XAlign — ST_XAlign
// ============================================================================

/// Horizontal alignment (ST_XAlign).
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
pub enum XAlign {
    /// Left (default).
    #[default]
    #[xml("left")]
    Left,
    /// Center.
    #[xml("center")]
    Center,
    /// Right.
    #[xml("right")]
    Right,
    /// Inside.
    #[xml("inside")]
    Inside,
    /// Outside.
    #[xml("outside")]
    Outside,
}

// ============================================================================
// YAlign — ST_YAlign
// ============================================================================

/// Vertical alignment (ST_YAlign).
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
pub enum YAlign {
    /// Inline.
    #[xml("inline")]
    Inline,
    /// Top (default).
    #[default]
    #[xml("top")]
    Top,
    /// Center.
    #[xml("center")]
    Center,
    /// Bottom.
    #[xml("bottom")]
    Bottom,
    /// Inside.
    #[xml("inside")]
    Inside,
    /// Outside.
    #[xml("outside")]
    Outside,
}
