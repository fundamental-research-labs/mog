//! JSON serialization helpers for XLSX themes.
//!
//! Theme serialization uses hand-written JSON builders because the Theme struct
//! lives in a separate module and does not derive Serialize.

use crate::domain::themes;

/// Resolve a ThemeColor to an RGB hex string, returning None if unresolvable.
pub fn resolve_theme_color_hex(
    theme: &themes::Theme,
    color: &Option<themes::ThemeColor>,
) -> Option<String> {
    let tc = color.as_ref()?;
    let rgb = theme.resolve_color(tc)?;
    Some(rgb.to_hex())
}
