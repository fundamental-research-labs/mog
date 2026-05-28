use domain_types::domain::external_link::CachedValue;

/// Parse a cached value from cell content.
///
/// Returns `(CachedValue, Option<String>)` where the second element is the raw
/// numeric string for round-trip fidelity.
pub(super) fn parse_cached_value(
    content: &[u8],
    cell_type: Option<&str>,
) -> (CachedValue, Option<String>) {
    if content.is_empty() {
        return (CachedValue::Empty, None);
    }

    let content_str = if memchr::memchr(b'&', content).is_some() {
        std::borrow::Cow::Owned(crate::infra::xml::decode_xml_entities(content))
    } else {
        String::from_utf8_lossy(content)
    };

    match cell_type {
        Some("s") => (CachedValue::String(content_str.into_owned()), None),
        Some("str") => (CachedValue::String(content_str.into_owned()), None),
        Some("b") => {
            let val = content_str.trim();
            (
                CachedValue::Boolean(val == "1" || val.eq_ignore_ascii_case("true")),
                None,
            )
        }
        Some("e") => (CachedValue::Error(content_str.into_owned()), None),
        _ => {
            let trimmed = content_str.trim();
            if let Ok(num) = trimmed.parse::<f64>() {
                (CachedValue::Number(num), Some(trimmed.to_string()))
            } else {
                (CachedValue::String(content_str.into_owned()), None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cached_value_number() {
        let (value, raw) = parse_cached_value(b"42.5", None);
        assert_eq!(value, CachedValue::Number(42.5));
        assert_eq!(raw.as_deref(), Some("42.5"));
    }

    #[test]
    fn parse_cached_value_string_types() {
        assert_eq!(
            parse_cached_value(b"Hello", Some("s")).0,
            CachedValue::String("Hello".to_string())
        );
        assert_eq!(
            parse_cached_value(b"World", Some("str")).0,
            CachedValue::String("World".to_string())
        );
    }

    #[test]
    fn parse_cached_value_boolean() {
        assert_eq!(
            parse_cached_value(b"1", Some("b")).0,
            CachedValue::Boolean(true)
        );
        assert_eq!(
            parse_cached_value(b"true", Some("b")).0,
            CachedValue::Boolean(true)
        );
        assert_eq!(
            parse_cached_value(b"0", Some("b")).0,
            CachedValue::Boolean(false)
        );
    }

    #[test]
    fn parse_cached_value_error_and_empty() {
        assert_eq!(
            parse_cached_value(b"#REF!", Some("e")).0,
            CachedValue::Error("#REF!".to_string())
        );
        assert_eq!(parse_cached_value(b"", None).0, CachedValue::Empty);
    }
}
