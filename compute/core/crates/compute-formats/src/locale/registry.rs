use super::data::{SUPPORTED_CULTURE_TAGS, culture_for_tag};
use super::types::CultureInfo;

/// Build a [`CultureInfo`] from an IETF culture tag (e.g., `"de-DE"`).
///
/// Supports 10 cultures: en-US, en-GB, de-DE, fr-FR, es-ES, it-IT, pt-BR,
/// ja-JP, zh-CN, ko-KR. Unknown tags fall back to en-US defaults.
///
/// # Examples
///
/// ```
/// use compute_formats::get_culture;
///
/// let de = get_culture("de-DE");
/// assert_eq!(de.decimal_separator, ",");
/// assert_eq!(de.thousands_separator, ".");
///
/// // Unknown tags return en-US:
/// let unknown = get_culture("xx-XX");
/// assert_eq!(unknown.name, "en-US");
/// ```
#[must_use]
pub fn get_culture(culture: &str) -> CultureInfo {
    culture_for_tag(culture).unwrap_or_default()
}

/// Get all 10 supported cultures.
///
/// # Examples
///
/// ```
/// use compute_formats::get_all_cultures;
///
/// let cultures = get_all_cultures();
/// assert_eq!(cultures.len(), 10);
/// assert_eq!(cultures[0].name, "en-US");
/// ```
#[must_use]
pub fn get_all_cultures() -> Vec<CultureInfo> {
    SUPPORTED_CULTURE_TAGS
        .iter()
        .copied()
        .map(get_culture)
        .collect()
}
