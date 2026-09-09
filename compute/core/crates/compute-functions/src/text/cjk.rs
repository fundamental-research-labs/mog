//! CJK functions: ASC, DBCS, JIS, PHONETIC

use value_types::CellValue;

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

/// Map the Unicode compatibility forms used by the Japanese width functions.
///
/// ASC/DBCS are locale-sensitive in Excel, but their documented Japanese
/// behavior is the Unicode full-width/half-width mapping. Keep the mapping
/// explicit so a host locale or OS cannot silently change pure-function
/// results. Some full-width kana (voiced and semi-voiced forms) expand to two
/// half-width code points, so this helper returns a string rather than a char.
fn fullwidth_to_halfwidth(ch: char) -> Option<&'static str> {
    match ch {
        // Full-width ASCII and space.
        '\u{3000}' => Some(" "),
        '\u{FF01}'..='\u{FF5E}' => None,

        // Japanese punctuation and combining marks.
        '\u{3001}' => Some("\u{FF64}"),
        '\u{3002}' => Some("\u{FF61}"),
        '\u{300C}' => Some("\u{FF62}"),
        '\u{300D}' => Some("\u{FF63}"),
        '\u{30FB}' => Some("\u{FF65}"),
        '\u{3099}' => Some("\u{FF9E}"),
        '\u{309A}' => Some("\u{FF9F}"),

        // Small kana and the prolonged sound mark.
        '\u{30A1}' => Some("\u{FF67}"),
        '\u{30A3}' => Some("\u{FF68}"),
        '\u{30A5}' => Some("\u{FF69}"),
        '\u{30A7}' => Some("\u{FF6A}"),
        '\u{30A9}' => Some("\u{FF6B}"),
        '\u{30E3}' => Some("\u{FF6C}"),
        '\u{30E5}' => Some("\u{FF6D}"),
        '\u{30E7}' => Some("\u{FF6E}"),
        '\u{30C3}' => Some("\u{FF6F}"),
        '\u{30FC}' => Some("\u{FF70}"),

        // Basic katakana.
        '\u{30F2}' => Some("\u{FF66}"),
        '\u{30A2}' => Some("\u{FF71}"),
        '\u{30A4}' => Some("\u{FF72}"),
        '\u{30A6}' => Some("\u{FF73}"),
        '\u{30A8}' => Some("\u{FF74}"),
        '\u{30AA}' => Some("\u{FF75}"),
        '\u{30AB}' => Some("\u{FF76}"),
        '\u{30AD}' => Some("\u{FF77}"),
        '\u{30AF}' => Some("\u{FF78}"),
        '\u{30B1}' => Some("\u{FF79}"),
        '\u{30B3}' => Some("\u{FF7A}"),
        '\u{30B5}' => Some("\u{FF7B}"),
        '\u{30B7}' => Some("\u{FF7C}"),
        '\u{30B9}' => Some("\u{FF7D}"),
        '\u{30BB}' => Some("\u{FF7E}"),
        '\u{30BD}' => Some("\u{FF7F}"),
        '\u{30BF}' => Some("\u{FF80}"),
        '\u{30C1}' => Some("\u{FF81}"),
        '\u{30C4}' => Some("\u{FF82}"),
        '\u{30C6}' => Some("\u{FF83}"),
        '\u{30C8}' => Some("\u{FF84}"),
        '\u{30CA}' => Some("\u{FF85}"),
        '\u{30CB}' => Some("\u{FF86}"),
        '\u{30CC}' => Some("\u{FF87}"),
        '\u{30CD}' => Some("\u{FF88}"),
        '\u{30CE}' => Some("\u{FF89}"),
        '\u{30CF}' => Some("\u{FF8A}"),
        '\u{30D2}' => Some("\u{FF8B}"),
        '\u{30D5}' => Some("\u{FF8C}"),
        '\u{30D8}' => Some("\u{FF8D}"),
        '\u{30DB}' => Some("\u{FF8E}"),
        '\u{30DE}' => Some("\u{FF8F}"),
        '\u{30DF}' => Some("\u{FF90}"),
        '\u{30E0}' => Some("\u{FF91}"),
        '\u{30E1}' => Some("\u{FF92}"),
        '\u{30E2}' => Some("\u{FF93}"),
        '\u{30E4}' => Some("\u{FF94}"),
        '\u{30E6}' => Some("\u{FF95}"),
        '\u{30E8}' => Some("\u{FF96}"),
        '\u{30E9}' => Some("\u{FF97}"),
        '\u{30EA}' => Some("\u{FF98}"),
        '\u{30EB}' => Some("\u{FF99}"),
        '\u{30EC}' => Some("\u{FF9A}"),
        '\u{30ED}' => Some("\u{FF9B}"),
        '\u{30EF}' => Some("\u{FF9C}"),
        '\u{30F3}' => Some("\u{FF9D}"),

        // Voiced and semi-voiced kana are represented by a base plus a mark
        // in the half-width repertoire. The final two entries are the JIS
        // extended wa/wo voiced forms that also have half-width sequences.
        '\u{30AC}' => Some("\u{FF76}\u{FF9E}"),
        '\u{30AE}' => Some("\u{FF77}\u{FF9E}"),
        '\u{30B0}' => Some("\u{FF78}\u{FF9E}"),
        '\u{30B2}' => Some("\u{FF79}\u{FF9E}"),
        '\u{30B4}' => Some("\u{FF7A}\u{FF9E}"),
        '\u{30B6}' => Some("\u{FF7B}\u{FF9E}"),
        '\u{30B8}' => Some("\u{FF7C}\u{FF9E}"),
        '\u{30BA}' => Some("\u{FF7D}\u{FF9E}"),
        '\u{30BC}' => Some("\u{FF7E}\u{FF9E}"),
        '\u{30BE}' => Some("\u{FF7F}\u{FF9E}"),
        '\u{30C0}' => Some("\u{FF80}\u{FF9E}"),
        '\u{30C2}' => Some("\u{FF81}\u{FF9E}"),
        '\u{30C5}' => Some("\u{FF82}\u{FF9E}"),
        '\u{30C7}' => Some("\u{FF83}\u{FF9E}"),
        '\u{30C9}' => Some("\u{FF84}\u{FF9E}"),
        '\u{30D0}' => Some("\u{FF8A}\u{FF9E}"),
        '\u{30D3}' => Some("\u{FF8B}\u{FF9E}"),
        '\u{30D6}' => Some("\u{FF8C}\u{FF9E}"),
        '\u{30D9}' => Some("\u{FF8D}\u{FF9E}"),
        '\u{30DC}' => Some("\u{FF8E}\u{FF9E}"),
        '\u{30D1}' => Some("\u{FF8A}\u{FF9F}"),
        '\u{30D4}' => Some("\u{FF8B}\u{FF9F}"),
        '\u{30D7}' => Some("\u{FF8C}\u{FF9F}"),
        '\u{30DA}' => Some("\u{FF8D}\u{FF9F}"),
        '\u{30DD}' => Some("\u{FF8E}\u{FF9F}"),
        '\u{30F4}' => Some("\u{FF73}\u{FF9E}"),
        '\u{30F7}' => Some("\u{FF9C}\u{FF9E}"),
        '\u{30FA}' => Some("\u{FF66}\u{FF9E}"),
        _ => None,
    }
}

fn halfwidth_katakana_to_fullwidth(ch: char) -> Option<char> {
    match ch {
        '\u{FF61}' => Some('\u{3002}'),
        '\u{FF62}' => Some('\u{300C}'),
        '\u{FF63}' => Some('\u{300D}'),
        '\u{FF64}' => Some('\u{3001}'),
        '\u{FF65}' => Some('\u{30FB}'),
        '\u{FF66}' => Some('\u{30F2}'),
        '\u{FF67}' => Some('\u{30A1}'),
        '\u{FF68}' => Some('\u{30A3}'),
        '\u{FF69}' => Some('\u{30A5}'),
        '\u{FF6A}' => Some('\u{30A7}'),
        '\u{FF6B}' => Some('\u{30A9}'),
        '\u{FF6C}' => Some('\u{30E3}'),
        '\u{FF6D}' => Some('\u{30E5}'),
        '\u{FF6E}' => Some('\u{30E7}'),
        '\u{FF6F}' => Some('\u{30C3}'),
        '\u{FF70}' => Some('\u{30FC}'),
        '\u{FF71}' => Some('\u{30A2}'),
        '\u{FF72}' => Some('\u{30A4}'),
        '\u{FF73}' => Some('\u{30A6}'),
        '\u{FF74}' => Some('\u{30A8}'),
        '\u{FF75}' => Some('\u{30AA}'),
        '\u{FF76}' => Some('\u{30AB}'),
        '\u{FF77}' => Some('\u{30AD}'),
        '\u{FF78}' => Some('\u{30AF}'),
        '\u{FF79}' => Some('\u{30B1}'),
        '\u{FF7A}' => Some('\u{30B3}'),
        '\u{FF7B}' => Some('\u{30B5}'),
        '\u{FF7C}' => Some('\u{30B7}'),
        '\u{FF7D}' => Some('\u{30B9}'),
        '\u{FF7E}' => Some('\u{30BB}'),
        '\u{FF7F}' => Some('\u{30BD}'),
        '\u{FF80}' => Some('\u{30BF}'),
        '\u{FF81}' => Some('\u{30C1}'),
        '\u{FF82}' => Some('\u{30C4}'),
        '\u{FF83}' => Some('\u{30C6}'),
        '\u{FF84}' => Some('\u{30C8}'),
        '\u{FF85}' => Some('\u{30CA}'),
        '\u{FF86}' => Some('\u{30CB}'),
        '\u{FF87}' => Some('\u{30CC}'),
        '\u{FF88}' => Some('\u{30CD}'),
        '\u{FF89}' => Some('\u{30CE}'),
        '\u{FF8A}' => Some('\u{30CF}'),
        '\u{FF8B}' => Some('\u{30D2}'),
        '\u{FF8C}' => Some('\u{30D5}'),
        '\u{FF8D}' => Some('\u{30D8}'),
        '\u{FF8E}' => Some('\u{30DB}'),
        '\u{FF8F}' => Some('\u{30DE}'),
        '\u{FF90}' => Some('\u{30DF}'),
        '\u{FF91}' => Some('\u{30E0}'),
        '\u{FF92}' => Some('\u{30E1}'),
        '\u{FF93}' => Some('\u{30E2}'),
        '\u{FF94}' => Some('\u{30E4}'),
        '\u{FF95}' => Some('\u{30E6}'),
        '\u{FF96}' => Some('\u{30E8}'),
        '\u{FF97}' => Some('\u{30E9}'),
        '\u{FF98}' => Some('\u{30EA}'),
        '\u{FF99}' => Some('\u{30EB}'),
        '\u{FF9A}' => Some('\u{30EC}'),
        '\u{FF9B}' => Some('\u{30ED}'),
        '\u{FF9C}' => Some('\u{30EF}'),
        '\u{FF9D}' => Some('\u{30F3}'),
        _ => None,
    }
}

fn compose_halfwidth_katakana(base: char, mark: char) -> Option<char> {
    match (base, mark) {
        ('\u{30A6}', '\u{FF9E}') => Some('\u{30F4}'),
        ('\u{30AB}', '\u{FF9E}') => Some('\u{30AC}'),
        ('\u{30AD}', '\u{FF9E}') => Some('\u{30AE}'),
        ('\u{30AF}', '\u{FF9E}') => Some('\u{30B0}'),
        ('\u{30B1}', '\u{FF9E}') => Some('\u{30B2}'),
        ('\u{30B3}', '\u{FF9E}') => Some('\u{30B4}'),
        ('\u{30B5}', '\u{FF9E}') => Some('\u{30B6}'),
        ('\u{30B7}', '\u{FF9E}') => Some('\u{30B8}'),
        ('\u{30B9}', '\u{FF9E}') => Some('\u{30BA}'),
        ('\u{30BB}', '\u{FF9E}') => Some('\u{30BC}'),
        ('\u{30BD}', '\u{FF9E}') => Some('\u{30BE}'),
        ('\u{30BF}', '\u{FF9E}') => Some('\u{30C0}'),
        ('\u{30C1}', '\u{FF9E}') => Some('\u{30C2}'),
        ('\u{30C4}', '\u{FF9E}') => Some('\u{30C5}'),
        ('\u{30C6}', '\u{FF9E}') => Some('\u{30C7}'),
        ('\u{30C8}', '\u{FF9E}') => Some('\u{30C9}'),
        ('\u{30CF}', '\u{FF9E}') => Some('\u{30D0}'),
        ('\u{30D2}', '\u{FF9E}') => Some('\u{30D3}'),
        ('\u{30D5}', '\u{FF9E}') => Some('\u{30D6}'),
        ('\u{30D8}', '\u{FF9E}') => Some('\u{30D9}'),
        ('\u{30DB}', '\u{FF9E}') => Some('\u{30DC}'),
        ('\u{30CF}', '\u{FF9F}') => Some('\u{30D1}'),
        ('\u{30D2}', '\u{FF9F}') => Some('\u{30D4}'),
        ('\u{30D5}', '\u{FF9F}') => Some('\u{30D7}'),
        ('\u{30D8}', '\u{FF9F}') => Some('\u{30DA}'),
        ('\u{30DB}', '\u{FF9F}') => Some('\u{30DD}'),
        ('\u{30EF}', '\u{FF9E}') => Some('\u{30F7}'),
        ('\u{30F2}', '\u{FF9E}') => Some('\u{30FA}'),
        _ => None,
    }
}

fn convert_to_halfwidth(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for ch in s.chars() {
        if let Some(mapped) = fullwidth_to_halfwidth(ch) {
            result.push_str(mapped);
        } else if ('\u{FF01}'..='\u{FF5E}').contains(&ch) {
            result.push(char::from_u32(ch as u32 - 0xFEE0).unwrap_or(ch));
        } else {
            result.push(ch);
        }
    }
    result
}

fn convert_to_fullwidth(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut result = String::with_capacity(s.len());
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];

        // A half-width voiced syllable is two code points. Normalize the
        // common combinations to the corresponding precomposed full-width
        // kana; preserve uncommon combinations as a full-width base plus its
        // combining mark below.
        if let (Some(base), Some(mark)) = (
            halfwidth_katakana_to_fullwidth(ch),
            chars.get(index + 1).copied(),
        ) {
            let is_mark = matches!(mark, '\u{FF9E}' | '\u{FF9F}');
            if is_mark {
                if let Some(composed) = compose_halfwidth_katakana(base, mark) {
                    result.push(composed);
                    index += 2;
                    continue;
                }
            }
        }

        if let Some(mapped) = halfwidth_katakana_to_fullwidth(ch) {
            result.push(mapped);
        } else if ch == '\u{FF9E}' {
            result.push('\u{3099}');
        } else if ch == '\u{FF9F}' {
            result.push('\u{309A}');
        } else if ch == ' ' {
            result.push('\u{3000}');
        } else if ('!'..='~').contains(&ch) {
            result.push(char::from_u32(ch as u32 + 0xFEE0).unwrap_or(ch));
        } else {
            result.push(ch);
        }
        index += 1;
    }
    result
}

pub(crate) struct FnAsc;
impl PureFunction for FnAsc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ASC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_string() {
            Ok(s) => CellValue::Text(convert_to_halfwidth(s.as_ref()).into()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnDbcs;
impl PureFunction for FnDbcs {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DBCS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_string() {
            Ok(s) => CellValue::Text(convert_to_fullwidth(s.as_ref()).into()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnJis;
impl PureFunction for FnJis {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "JIS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // JIS is the Japanese localized spelling of the DBCS width
        // conversion. Keep the accepted alias because legacy workbooks can
        // persist JIS even though the invariant OOXML function list names
        // DBCS; formula availability is resolved by the parser/registry.
        FnDbcs.call(args)
    }
}

pub(crate) struct FnPhonetic;
impl PureFunction for FnPhonetic {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PHONETIC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        // PHONETIC returns the phonetic (furigana) string.
        // Not applicable outside Japanese — return the input text as-is.
        match args[0].coerce_to_string() {
            Ok(s) => CellValue::Text(s.into_owned().into()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnAsc));
    registry.register(Box::new(FnDbcs));
    registry.register(Box::new(FnJis));
    registry.register(Box::new(FnPhonetic));
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{err, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::CellError;

    #[test]
    fn test_asc() {
        let f = FnAsc;
        // Full-width 'A' (U+FF21) -> half-width 'A' (U+0041)
        assert_eq!(f.call(&[text("\u{FF21}")]), text("A"));
        // Full-width space -> half-width space
        assert_eq!(f.call(&[text("\u{3000}")]), text(" "));
        // Already half-width — no change
        assert_eq!(f.call(&[text("ABC")]), text("ABC"));
    }

    #[test]
    fn test_dbcs() {
        let f = FnDbcs;
        // Half-width 'A' (U+0041) -> full-width 'A' (U+FF21)
        assert_eq!(f.call(&[text("A")]), text("\u{FF21}"));
        // Half-width space -> full-width space
        assert_eq!(f.call(&[text(" ")]), text("\u{3000}"));
    }

    #[test]
    fn test_jis_same_as_dbcs() {
        assert_eq!(FnJis.call(&[text("A")]), FnDbcs.call(&[text("A")]));
    }

    #[test]
    fn test_phonetic_passthrough() {
        let f = FnPhonetic;
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[num(123.0)]), text("123"));
    }

    #[test]
    fn test_asc_full_range() {
        // Full-width digits -> half-width
        assert_eq!(FnAsc.call(&[text("\u{FF10}\u{FF11}\u{FF19}")]), text("019"));
        // Full-width lowercase -> half-width
        assert_eq!(FnAsc.call(&[text("\u{FF41}")]), text("a"));
        // Full-width punctuation
        assert_eq!(FnAsc.call(&[text("\u{FF01}")]), text("!"));
    }

    #[test]
    fn test_asc_empty_string() {
        assert_eq!(FnAsc.call(&[text("")]), text(""));
    }

    #[test]
    fn test_asc_non_convertible_passthrough() {
        // CJK ideographs should pass through unchanged
        assert_eq!(FnAsc.call(&[text("\u{4E16}")]), text("\u{4E16}")); // "world" kanji
    }

    #[test]
    fn test_asc_mixed_content() {
        // Mix of full-width and half-width
        assert_eq!(
            FnAsc.call(&[text("hello\u{FF21}world")]),
            text("helloAworld")
        );
    }

    #[test]
    fn test_asc_error_propagation() {
        assert_eq!(FnAsc.call(&[err(CellError::Div0)]), err(CellError::Div0));
    }

    #[test]
    fn test_dbcs_full_range() {
        // Half-width digits -> full-width
        assert_eq!(FnDbcs.call(&[text("0")]), text("\u{FF10}"));
        assert_eq!(FnDbcs.call(&[text("9")]), text("\u{FF19}"));
        // Half-width lowercase -> full-width
        assert_eq!(FnDbcs.call(&[text("a")]), text("\u{FF41}"));
        // Punctuation
        assert_eq!(FnDbcs.call(&[text("!")]), text("\u{FF01}"));
    }

    #[test]
    fn test_dbcs_empty_string() {
        assert_eq!(FnDbcs.call(&[text("")]), text(""));
    }

    #[test]
    fn test_dbcs_non_convertible_passthrough() {
        // Characters outside 0x0020-0x007E pass through
        assert_eq!(FnDbcs.call(&[text("\u{4E16}")]), text("\u{4E16}"));
    }

    #[test]
    fn test_dbcs_space_to_fullwidth() {
        // Half-width space (0x20) -> full-width space (0x3000)
        assert_eq!(
            FnDbcs.call(&[text("A B")]),
            text("\u{FF21}\u{3000}\u{FF22}")
        );
    }

    #[test]
    fn test_dbcs_roundtrip_with_asc() {
        // DBCS then ASC should be identity for ASCII
        let original = text("Hello World! 123");
        let full_width = FnDbcs.call(std::slice::from_ref(&original));
        let back = FnAsc.call(&[full_width]);
        assert_eq!(back, original);
    }

    #[test]
    fn test_jis_identical_to_dbcs() {
        // JIS is functionally identical to DBCS
        assert_eq!(FnJis.call(&[text("Hello")]), FnDbcs.call(&[text("Hello")]));
        assert_eq!(FnJis.call(&[text("123")]), FnDbcs.call(&[text("123")]));
        assert_eq!(FnJis.call(&[text(" ")]), FnDbcs.call(&[text(" ")]));
    }

    #[test]
    fn test_asc_converts_katakana_and_voiced_forms() {
        assert_eq!(
            FnAsc.call(&[text("\u{30AB}\u{30BF}\u{30AB}\u{30CA}")]),
            text("\u{FF76}\u{FF80}\u{FF76}\u{FF85}")
        );
        assert_eq!(
            FnAsc.call(&[text("\u{30AC}\u{30D1}\u{30F4}")]),
            text("\u{FF76}\u{FF9E}\u{FF8A}\u{FF9F}\u{FF73}\u{FF9E}")
        );
        assert_eq!(
            FnAsc.call(&[text("\u{30F7}\u{30FA}")]),
            text("\u{FF9C}\u{FF9E}\u{FF66}\u{FF9E}")
        );
    }

    #[test]
    fn test_dbcs_converts_katakana_and_voiced_forms() {
        assert_eq!(
            FnDbcs.call(&[text("\u{FF76}\u{FF80}\u{FF76}\u{FF85}")]),
            text("\u{30AB}\u{30BF}\u{30AB}\u{30CA}")
        );
        assert_eq!(
            FnDbcs.call(&[text("\u{FF76}\u{FF9E}\u{FF8A}\u{FF9F}\u{FF73}\u{FF9E}")]),
            text("\u{30AC}\u{30D1}\u{30F4}")
        );
        assert_eq!(
            FnDbcs.call(&[text("\u{FF9C}\u{FF9E}\u{FF66}\u{FF9E}")]),
            text("\u{30F7}\u{30FA}")
        );
    }

    #[test]
    fn test_asc_dbcs_roundtrip_for_supported_kana() {
        let halfwidth = "\u{FF71}\u{FF72}\u{FF73}\u{FF74}\u{FF75}\u{FF76}\u{FF77}\u{FF78}\u{FF79}\u{FF7A}\u{FF7B}\u{FF7C}\u{FF7D}\u{FF7E}\u{FF7F}\u{FF80}\u{FF81}\u{FF82}\u{FF83}\u{FF84}\u{FF85}\u{FF86}\u{FF87}\u{FF88}\u{FF89}\u{FF8A}\u{FF8B}\u{FF8C}\u{FF8D}\u{FF8E}\u{FF8F}\u{FF90}\u{FF91}\u{FF92}\u{FF93}\u{FF94}\u{FF95}\u{FF96}\u{FF97}\u{FF98}\u{FF99}\u{FF9A}\u{FF9B}\u{FF9C}\u{FF9D}";
        let fullwidth = FnDbcs.call(&[text(halfwidth)]);
        assert_eq!(FnAsc.call(&[fullwidth]), text(halfwidth));
    }

    #[test]
    fn test_jis_alias_keeps_dbcs_blank_and_kana_semantics() {
        assert_eq!(FnJis.call(&[value_types::CellValue::Null]), text(""));
        assert_eq!(FnJis.call(&[text("\u{FF76}\u{FF9E}")]), text("\u{30AC}"));
    }

    #[test]
    fn test_width_functions_blank_cell_return_empty_text() {
        let blank = value_types::CellValue::Null;
        assert_eq!(FnAsc.call(std::slice::from_ref(&blank)), text(""));
        assert_eq!(FnDbcs.call(std::slice::from_ref(&blank)), text(""));
        assert_eq!(FnJis.call(std::slice::from_ref(&blank)), text(""));
    }

    #[test]
    fn test_phonetic_returns_text_unchanged() {
        assert_eq!(FnPhonetic.call(&[text("Tokyo")]), text("Tokyo"));
        assert_eq!(FnPhonetic.call(&[text("")]), text(""));
    }

    #[test]
    fn test_phonetic_number_coercion() {
        assert_eq!(FnPhonetic.call(&[num(42.0)]), text("42"));
    }

    #[test]
    fn test_phonetic_error_propagation() {
        assert_eq!(
            FnPhonetic.call(&[err(CellError::Value)]),
            err(CellError::Value)
        );
    }

    // -------------------------------------------------------------------
    // modern.rs — TEXTBEFORE, TEXTAFTER, TEXTSPLIT
    // -------------------------------------------------------------------
}
