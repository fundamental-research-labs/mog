//! Raw XML preservation helpers for pivot parts.

use crate::domain::pivot::reader::elements::first_element_span;

pub(crate) fn raw_element(xml: &[u8], name: &[u8]) -> Option<Vec<u8>> {
    let span = first_element_span(xml, name, 0)?;
    Some(xml[span.start..span.end].to_vec())
}
