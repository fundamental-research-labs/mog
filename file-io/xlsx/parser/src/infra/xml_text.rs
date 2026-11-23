//! Text content helpers for quick-xml readers.
//!
//! Since quick-xml 0.38 a text run such as `a &amp; b` arrives as `Text("a ")`,
//! `GeneralRef("amp")`, `Text(" b")` instead of one `Text` event that callers
//! unescape. These helpers turn the pieces back into the string the old
//! `BytesText::unescape()` produced (predefined entities and character
//! references only; unknown entities are an error).

use std::borrow::Cow;

use quick_xml::escape::{EscapeError, unescape};
use quick_xml::events::{BytesRef, BytesText};

/// Decode a `Text` event. Its content holds no entity references.
pub(crate) fn decode_text<'a>(text: &BytesText<'a>) -> Result<Cow<'a, str>, String> {
    text.decode().map_err(|err| err.to_string())
}

/// Resolve a `GeneralRef` event (`&name;` or `&#N;`) to its replacement text.
pub(crate) fn resolve_general_ref(reference: &BytesRef<'_>) -> Result<String, String> {
    let name = reference.decode().map_err(|err| err.to_string())?;
    let raw = format!("&{name};");
    unescape(&raw)
        .map(Cow::into_owned)
        .map_err(|err: EscapeError| err.to_string())
}

#[cfg(test)]
mod tests {
    use quick_xml::Reader;
    use quick_xml::events::Event;

    use super::*;

    fn collect(xml: &str) -> Result<String, String> {
        let mut reader = Reader::from_str(xml);
        let mut out = String::new();
        loop {
            match reader.read_event().map_err(|err| err.to_string())? {
                Event::Text(text) => out.push_str(&decode_text(&text)?),
                Event::GeneralRef(reference) => out.push_str(&resolve_general_ref(&reference)?),
                Event::Eof => return Ok(out),
                _ => {}
            }
        }
    }

    #[test]
    fn rebuilds_text_split_around_references() {
        assert_eq!(
            collect("<a>x &amp; y &lt;&gt;&quot;&apos;</a>").unwrap(),
            "x & y <>\"'"
        );
        assert_eq!(collect("<a>&#65;&#x42;c</a>").unwrap(), "ABc");
    }

    #[test]
    fn rejects_unknown_entities() {
        assert!(collect("<a>&nope;</a>").is_err());
    }
}
