//! Kerning support for PDF font metrics.
//! Extracts kerning pairs and adjusts text measurements.

use super::subset::SubsetError;
use ttf_parser::{Face, GlyphId};

/// A single kerning pair.
#[derive(Debug, Clone, PartialEq)]
pub struct KernPair {
    pub left_glyph: u16,
    pub right_glyph: u16,
    pub value: i16,
}

/// Extract kerning pairs for all glyph pairs present in the font.
/// Since ttf-parser does not expose iteration over kern pairs,
/// we probe pairs from a given set of glyph IDs.
pub fn extract_kern_pairs_for_glyphs(
    font_data: &[u8],
    glyph_ids: &[u16],
) -> Result<Vec<KernPair>, SubsetError> {
    let face =
        Face::parse(font_data, 0).map_err(|e| SubsetError::ParseError(format!("kern: {:?}", e)))?;
    let mut pairs = Vec::new();
    for &left in glyph_ids {
        for &right in glyph_ids {
            let lg = GlyphId(left);
            let rg = GlyphId(right);
            if let Some(kern) = face.tables().kern {
                for subtable in kern.subtables {
                    if !subtable.horizontal {
                        continue;
                    }
                    if let Some(val) = subtable.glyphs_kerning(lg, rg)
                        && val != 0
                    {
                        pairs.push(KernPair {
                            left_glyph: left,
                            right_glyph: right,
                            value: val,
                        });
                        break;
                    }
                }
            }
        }
    }
    Ok(pairs)
}

/// Measure text width with kerning applied.
pub fn measure_with_kerning(font_data: &[u8], text: &str, size: f64, units_per_em: u16) -> f64 {
    let face = match Face::parse(font_data, 0) {
        Ok(f) => f,
        Err(_) => return 0.0,
    };
    let scale = size / units_per_em as f64;
    let chars: Vec<char> = text.chars().collect();
    let mut width = 0.0;
    for (i, &ch) in chars.iter().enumerate() {
        if let Some(gid) = face.glyph_index(ch) {
            let adv = face.glyph_hor_advance(gid).unwrap_or(0) as f64;
            width += adv * scale;
            // Apply kerning with next character
            if i + 1 < chars.len()
                && let Some(next_gid) = face.glyph_index(chars[i + 1])
                && let Some(kern) = face.tables().kern
            {
                for subtable in kern.subtables {
                    if !subtable.horizontal {
                        continue;
                    }
                    if let Some(v) = subtable.glyphs_kerning(gid, next_gid) {
                        width += v as f64 * scale;
                        break;
                    }
                }
            }
        }
    }
    width
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_kern_pairs_invalid_font() {
        let result = extract_kern_pairs_for_glyphs(&[0, 1, 2, 3], &[1, 2]);
        assert!(result.is_err());
    }

    #[test]
    fn test_measure_with_kerning_invalid_font() {
        let w = measure_with_kerning(&[0], "hello", 12.0, 1000);
        assert_eq!(w, 0.0);
    }

    #[test]
    fn test_kern_pair_struct() {
        let p = KernPair {
            left_glyph: 1,
            right_glyph: 2,
            value: -50,
        };
        assert_eq!(p.value, -50);
        assert_eq!(p.left_glyph, 1);
    }
}
