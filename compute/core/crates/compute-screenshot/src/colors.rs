use tiny_skia::Color;

/// Convert packed RGBA u32 (0xRRGGBBAA) to tiny-skia Color.
/// Returns `None` for fully transparent (0x00000000).
pub fn rgba_to_color(rgba: u32) -> Option<Color> {
    if rgba == 0 {
        return None;
    }
    let r = ((rgba >> 24) & 0xFF) as u8;
    let g = ((rgba >> 16) & 0xFF) as u8;
    let b = ((rgba >> 8) & 0xFF) as u8;
    let a = (rgba & 0xFF) as u8;
    Some(Color::from_rgba8(r, g, b, a))
}

/// Parse CSS hex color (#RGB, #RRGGBB, or #RRGGBBAA) to tiny-skia Color.
pub fn css_hex_to_color(hex: &str) -> Option<Color> {
    let hex = hex.strip_prefix('#').unwrap_or(hex);
    match hex.len() {
        3 => {
            let r = u8::from_str_radix(&hex[0..1], 16).ok()? * 17;
            let g = u8::from_str_radix(&hex[1..2], 16).ok()? * 17;
            let b = u8::from_str_radix(&hex[2..3], 16).ok()? * 17;
            Some(Color::from_rgba8(r, g, b, 255))
        }
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            Some(Color::from_rgba8(r, g, b, 255))
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
            Some(Color::from_rgba8(r, g, b, a))
        }
        _ => None,
    }
}

/// Default gridline color (#D0D7DE).
pub fn gridline_color() -> Color {
    Color::from_rgba8(0xD0, 0xD7, 0xDE, 0xFF)
}

/// Default header background (#F8F9FA).
pub fn header_bg() -> Color {
    Color::from_rgba8(0xF8, 0xF9, 0xFA, 0xFF)
}

/// Default header text (#333333).
pub fn header_text() -> Color {
    Color::from_rgba8(0x33, 0x33, 0x33, 0xFF)
}

/// Default header border (#DADCE0).
pub fn header_border() -> Color {
    Color::from_rgba8(0xDA, 0xDC, 0xE0, 0xFF)
}

/// Black text default.
pub const BLACK: Color = Color::BLACK;

/// White background.
pub const WHITE: Color = Color::WHITE;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgba_zero_returns_none() {
        assert!(rgba_to_color(0).is_none());
    }

    #[test]
    fn rgba_red_opaque() {
        let c = rgba_to_color(0xFF0000FF).unwrap();
        assert_eq!(c.red(), 1.0);
        assert_eq!(c.green(), 0.0);
        assert_eq!(c.blue(), 0.0);
        assert_eq!(c.alpha(), 1.0);
    }

    #[test]
    fn rgba_with_alpha() {
        let c = rgba_to_color(0x00FF0080).unwrap();
        assert_eq!(c.green(), 1.0);
        assert!((c.alpha() - 128.0 / 255.0).abs() < 0.01);
    }

    #[test]
    fn css_hex_6_digit() {
        let c = css_hex_to_color("#FF8000").unwrap();
        assert_eq!(c.red(), 1.0);
        assert!((c.green() - 128.0 / 255.0).abs() < 0.01);
        assert_eq!(c.blue(), 0.0);
        assert_eq!(c.alpha(), 1.0);
    }

    #[test]
    fn css_hex_without_hash() {
        let c = css_hex_to_color("00FF00").unwrap();
        assert_eq!(c.green(), 1.0);
    }

    #[test]
    fn css_hex_3_digit() {
        let c = css_hex_to_color("#F00").unwrap();
        assert_eq!(c.red(), 1.0);
        assert_eq!(c.green(), 0.0);
        assert_eq!(c.blue(), 0.0);
    }

    #[test]
    fn css_hex_8_digit_with_alpha() {
        let c = css_hex_to_color("#FF000080").unwrap();
        assert_eq!(c.red(), 1.0);
        assert!((c.alpha() - 128.0 / 255.0).abs() < 0.01);
    }

    #[test]
    fn css_hex_invalid() {
        assert!(css_hex_to_color("#ZZZZZZ").is_none());
        assert!(css_hex_to_color("#12345").is_none());
        assert!(css_hex_to_color("").is_none());
    }

    #[test]
    fn constant_colors_are_valid() {
        // Just verify the consts don't panic when accessed
        assert_eq!(WHITE.alpha(), 1.0);
        assert_eq!(BLACK.red(), 0.0);
        assert_eq!(gridline_color().alpha(), 1.0);
        assert_eq!(header_bg().alpha(), 1.0);
    }
}
