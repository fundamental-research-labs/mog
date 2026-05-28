#[inline]
pub(super) fn validated_xml_text(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes)
        .expect("worksheet XML was validated as UTF-8 at the archive boundary")
        .to_owned()
}
