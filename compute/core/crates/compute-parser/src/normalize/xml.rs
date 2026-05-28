// Entity marker positions are ASCII byte boundaries by construction.
#![allow(clippy::string_slice)]

use std::borrow::Cow;

/// Decode the 5 standard XML entities + numeric character references.
/// Suitable for use on arbitrary strings (sheet names, formula text, etc.).
///
/// # Examples
///
/// ```
/// use compute_parser::decode_xml_entities_str;
///
/// assert_eq!(decode_xml_entities_str("A &amp; B"), "A & B");
/// assert_eq!(decode_xml_entities_str("&lt;hello&gt;"), "<hello>");
/// ```
#[must_use]
pub fn decode_xml_entities_str(s: &str) -> String {
    decode_xml_entities(s).into_owned()
}

/// Decode XML entities: `&amp;`→`&`, `&lt;`→`<`, `&gt;`→`>`, `&quot;`→`"`,
/// `&apos;`→`'`, `&#NN;`→char, `&#xHH;`→char.
pub(super) fn decode_xml_entities(s: &str) -> Cow<'_, str> {
    if !s.contains('&') {
        return Cow::Borrowed(s);
    }

    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'&' {
            // Find the closing ';'
            if let Some(semi_offset) = bytes[i..].iter().position(|&b| b == b';') {
                let entity = &s[i + 1..i + semi_offset]; // between & and ;
                if let Some(ch) = resolve_entity(entity) {
                    out.push(ch);
                    i += semi_offset + 1;
                    continue;
                }
            }
            // Not a recognized entity — emit '&' literally
            out.push('&');
            i += 1;
        } else if let Some(ch) = s[i..].chars().next() {
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    Cow::Owned(out)
}

/// Resolve the content between `&` and `;` to a char.
fn resolve_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => {
            // Numeric character references: &#NN; or &#xHH;
            entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|dec| dec.parse::<u32>().ok())
                })
                .and_then(char::from_u32)
        }
    }
}
