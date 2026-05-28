use super::super::color::DrawingColor;
use super::{TextAutonumberType, TextFont};

// BulletProperties and sub-types
// =============================================================================

/// Bullet colour specification (ECMA-376 EG_TextBulletColor).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BulletColor {
    /// Bullet uses the text colour.
    FollowText,
    /// Bullet uses a custom colour.
    Custom(DrawingColor),
}

/// Bullet size specification (ECMA-376 EG_TextBulletSize).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum BulletSize {
    /// Bullet size follows text size.
    FollowText,
    /// Bullet size as percentage of text size (hundredths of a percent).
    Percent(u32),
    /// Bullet size in points (hundredths of a point).
    Points(u32),
}

/// Bullet type specification (ECMA-376 EG_TextBulletTypeface).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BulletType {
    /// No bullet.
    None,
    /// Character bullet (e.g., "bullet character").
    Char(String),
    /// Automatic numbered bullet.
    AutoNum {
        /// Numbering scheme.
        scheme: TextAutonumberType,
        /// Starting number (defaults to 1 in OOXML).
        start_at: Option<u32>,
    },
    /// Picture bullet (relationship ID to image).
    Blip(String),
}

/// Bullet properties for a paragraph (ECMA-376 CT_TextParagraphProperties bullet group).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BulletProperties {
    /// Bullet colour.
    pub color: Option<BulletColor>,
    /// Bullet size.
    pub size: Option<BulletSize>,
    /// Bullet font.
    pub font: Option<TextFont>,
    /// Whether the bullet font follows the text font (`<a:buFontTx/>`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub font_follows_text: bool,
    /// Bullet type.
    pub bullet_type: Option<BulletType>,
}
