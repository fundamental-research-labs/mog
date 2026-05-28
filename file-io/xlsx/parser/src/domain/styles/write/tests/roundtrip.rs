use crate::domain::styles::read::parse_known_fonts;
use crate::domain::styles::write::StylesWriter;

#[test]
fn test_known_fonts_roundtrip_via_parse() {
    let mut writer = StylesWriter::with_defaults();
    writer.known_fonts = true;
    let xml_bytes = writer.to_xml();

    let parsed = parse_known_fonts(&xml_bytes);
    assert!(
        parsed,
        "parse_known_fonts should return true for XML with x14ac:knownFonts=\"1\""
    );

    let mut writer2 = StylesWriter::with_defaults();
    writer2.known_fonts = false;
    let xml_bytes2 = writer2.to_xml();
    let parsed2 = parse_known_fonts(&xml_bytes2);
    assert!(
        !parsed2,
        "parse_known_fonts should return false for XML without knownFonts"
    );
}
