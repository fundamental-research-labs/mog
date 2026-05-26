use domain_types::CellFormat;
use value_types::ComputeError;

const MAX_FONT_SIZE_PT: f64 = 409.0;
const MIN_FONT_SIZE_PT: f64 = 1.0;

pub fn validate_cell_format(format: &CellFormat) -> Result<(), ComputeError> {
    if let Some(ref size) = format.font_size {
        validate_font_size(size.points())?;
    }
    if let Some(ref color) = format.font_color {
        validate_color(color, "fontColor")?;
    }
    if let Some(ref color) = format.background_color {
        validate_color(color, "backgroundColor")?;
    }
    if let Some(ref color) = format.pattern_foreground_color {
        validate_color(color, "patternForegroundColor")?;
    }
    Ok(())
}

fn validate_font_size(size_pt: f64) -> Result<(), ComputeError> {
    if !(MIN_FONT_SIZE_PT..=MAX_FONT_SIZE_PT).contains(&size_pt) {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "fontSize must be {}-{} pt, got {} pt",
                MIN_FONT_SIZE_PT, MAX_FONT_SIZE_PT, size_pt
            ),
        });
    }
    Ok(())
}

fn validate_color(color: &str, field: &str) -> Result<(), ComputeError> {
    let valid = (color.starts_with('#')
        && (color.len() == 4 || color.len() == 7 || color.len() == 9)
        // starts_with('#') guarantees byte 0 is single-byte ASCII '#'.
        && {
            #[allow(clippy::string_slice)]
            let rest = &color[1..];
            rest.chars().all(|c| c.is_ascii_hexdigit())
        })
        || color.starts_with("theme:")
        || color.starts_with("rgb(")
        || color.starts_with("rgba(");

    if !valid {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Invalid {}: \"{}\" — expected #RGB, #RRGGBB, #RRGGBBAA, theme:name, or rgb()/rgba()",
                field, color
            ),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_font_size_below_min() {
        assert!(validate_font_size(0.5).is_err());
        assert!(validate_font_size(0.0).is_err());
        assert!(validate_font_size(-1.0).is_err());
    }

    #[test]
    fn rejects_font_size_above_max() {
        assert!(validate_font_size(410.0).is_err());
        assert!(validate_font_size(1000.0).is_err());
    }

    #[test]
    fn accepts_valid_font_size() {
        assert!(validate_font_size(1.0).is_ok());
        assert!(validate_font_size(12.0).is_ok());
        assert!(validate_font_size(409.0).is_ok());
    }

    #[test]
    fn rejects_invalid_color() {
        assert!(validate_color("red", "fontColor").is_err());
        assert!(validate_color("#GG0000", "fontColor").is_err());
        assert!(validate_color("#12345", "fontColor").is_err());
        assert!(validate_color("", "fontColor").is_err());
    }

    #[test]
    fn accepts_hex3_color() {
        assert!(validate_color("#F00", "fontColor").is_ok());
    }

    #[test]
    fn accepts_hex6_color() {
        assert!(validate_color("#FF0000", "fontColor").is_ok());
    }

    #[test]
    fn accepts_hex8_color() {
        assert!(validate_color("#FF0000FF", "fontColor").is_ok());
    }

    #[test]
    fn accepts_theme_color() {
        assert!(validate_color("theme:accent1", "fontColor").is_ok());
    }

    #[test]
    fn accepts_rgb_rgba_color() {
        assert!(validate_color("rgb(255,0,0)", "fontColor").is_ok());
        assert!(validate_color("rgba(255,0,0,0.5)", "fontColor").is_ok());
    }
}
