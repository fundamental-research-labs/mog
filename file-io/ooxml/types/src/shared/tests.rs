use super::*;

#[test]
fn facade_reexports_shared_types() {
    use crate::shared::*;

    let _ = (
        OnOff::default(),
        OnOff1::default(),
        TrueFalse::default(),
        TrueFalseBlank::default(),
        Guid::new("{not-normalized}"),
        HexColorRgb::new("not-hex"),
        XAlign::default(),
        YAlign::default(),
        ConformanceClass::default(),
        AlgClass::default(),
        AlgType::default(),
        CryptProv::default(),
        Percentage::default(),
        FixedPercentage::default(),
        PositivePercentage::default(),
        PositiveFixedPercentage::default(),
        VerticalAlignRun::default(),
        OpcRelationship {
            id: "rId1".to_owned(),
            rel_type: "type".to_owned(),
            target: "target".to_owned(),
            target_mode: None,
        },
    );
}

// ------------------------------------------------------------------------
// Booleans
// ------------------------------------------------------------------------

#[test]
fn on_off_default() {
    assert_eq!(OnOff::default(), OnOff::Off);
}

#[test]
fn on_off_from_ooxml_all_forms() {
    assert_eq!(OnOff::from_ooxml("true"), OnOff::On);
    assert_eq!(OnOff::from_ooxml("1"), OnOff::On);
    assert_eq!(OnOff::from_ooxml("on"), OnOff::On);
    assert_eq!(OnOff::from_ooxml("false"), OnOff::Off);
    assert_eq!(OnOff::from_ooxml("0"), OnOff::Off);
    assert_eq!(OnOff::from_ooxml("off"), OnOff::Off);
}

#[test]
fn on_off_unknown_defaults_to_off() {
    assert_eq!(OnOff::from_ooxml("yes"), OnOff::Off);
    assert_eq!(OnOff::from_ooxml(""), OnOff::Off);
}

#[test]
fn on_off_roundtrip() {
    assert_eq!(OnOff::from_ooxml(OnOff::On.to_ooxml()), OnOff::On);
    assert_eq!(OnOff::from_ooxml(OnOff::Off.to_ooxml()), OnOff::Off);
}

#[test]
fn on_off_from_bytes() {
    assert_eq!(OnOff::from_bytes(b"true"), OnOff::On);
    assert_eq!(OnOff::from_bytes(b"1"), OnOff::On);
    assert_eq!(OnOff::from_bytes(b"on"), OnOff::On);
    assert_eq!(OnOff::from_bytes(b"false"), OnOff::Off);
    assert_eq!(OnOff::from_bytes(b"0"), OnOff::Off);
    assert_eq!(OnOff::from_bytes(b"off"), OnOff::Off);
}

#[test]
fn on_off_as_str() {
    assert_eq!(OnOff::On.as_str(), "true");
    assert_eq!(OnOff::Off.as_str(), "false");
}

#[test]
fn on_off1_default() {
    assert_eq!(OnOff1::default(), OnOff1::Off);
}

#[test]
fn on_off1_roundtrip() {
    assert_eq!(OnOff1::from_ooxml(OnOff1::On.to_ooxml()), OnOff1::On);
    assert_eq!(OnOff1::from_ooxml(OnOff1::Off.to_ooxml()), OnOff1::Off);
}

#[test]
fn on_off1_unknown_defaults_to_off() {
    assert_eq!(OnOff1::from_ooxml("true"), OnOff1::Off);
}

#[test]
fn true_false_default() {
    assert_eq!(TrueFalse::default(), TrueFalse::False);
}

#[test]
fn true_false_from_ooxml() {
    assert_eq!(TrueFalse::from_ooxml("t"), TrueFalse::True);
    assert_eq!(TrueFalse::from_ooxml("true"), TrueFalse::True);
    assert_eq!(TrueFalse::from_ooxml("f"), TrueFalse::False);
    assert_eq!(TrueFalse::from_ooxml("false"), TrueFalse::False);
}

#[test]
fn true_false_roundtrip() {
    assert_eq!(
        TrueFalse::from_ooxml(TrueFalse::True.to_ooxml()),
        TrueFalse::True
    );
    assert_eq!(
        TrueFalse::from_ooxml(TrueFalse::False.to_ooxml()),
        TrueFalse::False
    );
}

#[test]
fn true_false_unknown_defaults_to_false() {
    assert_eq!(TrueFalse::from_ooxml("yes"), TrueFalse::False);
}

#[test]
fn true_false_blank_default() {
    assert_eq!(TrueFalseBlank::default(), TrueFalseBlank::Blank);
}

#[test]
fn true_false_blank_from_ooxml() {
    assert_eq!(TrueFalseBlank::from_ooxml("t"), TrueFalseBlank::True);
    assert_eq!(TrueFalseBlank::from_ooxml("true"), TrueFalseBlank::True);
    assert_eq!(TrueFalseBlank::from_ooxml("True"), TrueFalseBlank::True);
    assert_eq!(TrueFalseBlank::from_ooxml("f"), TrueFalseBlank::False);
    assert_eq!(TrueFalseBlank::from_ooxml("false"), TrueFalseBlank::False);
    assert_eq!(TrueFalseBlank::from_ooxml("False"), TrueFalseBlank::False);
}

#[test]
fn true_false_blank_empty_is_blank() {
    assert_eq!(TrueFalseBlank::from_ooxml(""), TrueFalseBlank::Blank);
}

#[test]
fn true_false_blank_unknown_is_blank() {
    assert_eq!(TrueFalseBlank::from_ooxml("xyz"), TrueFalseBlank::Blank);
}

#[test]
fn true_false_blank_roundtrip() {
    assert_eq!(
        TrueFalseBlank::from_ooxml(TrueFalseBlank::True.to_ooxml()),
        TrueFalseBlank::True
    );
    assert_eq!(
        TrueFalseBlank::from_ooxml(TrueFalseBlank::False.to_ooxml()),
        TrueFalseBlank::False
    );
    assert_eq!(
        TrueFalseBlank::from_ooxml(TrueFalseBlank::Blank.to_ooxml()),
        TrueFalseBlank::Blank
    );
}

// ------------------------------------------------------------------------
// String wrappers
// ------------------------------------------------------------------------

#[test]
fn guid_new_and_as_str() {
    let guid = Guid::new("{12345678-1234-1234-1234-123456789ABC}");
    assert_eq!(guid.as_str(), "{12345678-1234-1234-1234-123456789ABC}");
}

#[test]
fn guid_from_ooxml_roundtrip() {
    let s = "{ABCDEF01-2345-6789-ABCD-EF0123456789}";
    let guid = Guid::from_ooxml(s);
    assert_eq!(guid.to_ooxml(), s);
}

#[test]
fn guid_from_bytes() {
    let guid = Guid::from_bytes(b"{00000000-0000-0000-0000-000000000000}");
    assert_eq!(guid.as_str(), "{00000000-0000-0000-0000-000000000000}");
}

#[test]
fn guid_display() {
    let guid = Guid::new("{AABBCCDD-1122-3344-5566-778899AABBCC}");
    assert_eq!(format!("{guid}"), "{AABBCCDD-1122-3344-5566-778899AABBCC}");
}

#[test]
fn raw_string_wrappers_preserve_invalid_input() {
    let guid = Guid::from_ooxml("not a guid");
    let color = HexColorRgb::from_ooxml("xyz");
    assert_eq!(guid.as_str(), "not a guid");
    assert_eq!(guid.to_ooxml(), "not a guid");
    assert_eq!(color.as_str(), "xyz");
    assert_eq!(color.to_ooxml(), "xyz");
}

#[test]
fn hex_color_rgb_new_and_as_str() {
    let color = HexColorRgb::new("FF0000");
    assert_eq!(color.as_str(), "FF0000");
}

#[test]
fn hex_color_rgb_from_ooxml_roundtrip() {
    let color = HexColorRgb::from_ooxml("00FF00");
    assert_eq!(color.to_ooxml(), "00FF00");
}

#[test]
fn hex_color_rgb_from_bytes() {
    let color = HexColorRgb::from_bytes(b"0000FF");
    assert_eq!(color.as_str(), "0000FF");
}

#[test]
fn hex_color_rgb_display() {
    let color = HexColorRgb::new("ABCDEF");
    assert_eq!(format!("{color}"), "ABCDEF");
}

// ------------------------------------------------------------------------
// Alignment
// ------------------------------------------------------------------------

#[test]
fn x_align_default() {
    assert_eq!(XAlign::default(), XAlign::Left);
}

#[test]
fn x_align_roundtrip() {
    for variant in [
        XAlign::Left,
        XAlign::Center,
        XAlign::Right,
        XAlign::Inside,
        XAlign::Outside,
    ] {
        assert_eq!(XAlign::from_ooxml(variant.to_ooxml()), variant);
    }
}

#[test]
fn y_align_default() {
    assert_eq!(YAlign::default(), YAlign::Top);
}

#[test]
fn y_align_roundtrip() {
    for variant in [
        YAlign::Inline,
        YAlign::Top,
        YAlign::Center,
        YAlign::Bottom,
        YAlign::Inside,
        YAlign::Outside,
    ] {
        assert_eq!(YAlign::from_ooxml(variant.to_ooxml()), variant);
    }
}

// ------------------------------------------------------------------------
// Document conformance
// ------------------------------------------------------------------------

#[test]
fn conformance_class_default() {
    assert_eq!(ConformanceClass::default(), ConformanceClass::Transitional);
}

#[test]
fn conformance_class_roundtrip() {
    assert_eq!(
        ConformanceClass::from_ooxml(ConformanceClass::Strict.to_ooxml()),
        ConformanceClass::Strict
    );
    assert_eq!(
        ConformanceClass::from_ooxml(ConformanceClass::Transitional.to_ooxml()),
        ConformanceClass::Transitional
    );
}

// ------------------------------------------------------------------------
// Crypto vocabulary
// ------------------------------------------------------------------------

#[test]
fn alg_class_default() {
    assert_eq!(AlgClass::default(), AlgClass::Hash);
}

#[test]
fn alg_class_roundtrip() {
    assert_eq!(
        AlgClass::from_ooxml(AlgClass::Hash.to_ooxml()),
        AlgClass::Hash
    );
    assert_eq!(
        AlgClass::from_ooxml(AlgClass::Custom.to_ooxml()),
        AlgClass::Custom
    );
}

#[test]
fn alg_type_default() {
    assert_eq!(AlgType::default(), AlgType::TypeAny);
}

#[test]
fn alg_type_roundtrip() {
    assert_eq!(
        AlgType::from_ooxml(AlgType::TypeAny.to_ooxml()),
        AlgType::TypeAny
    );
    assert_eq!(
        AlgType::from_ooxml(AlgType::Custom.to_ooxml()),
        AlgType::Custom
    );
}

#[test]
fn alg_type_camel_case() {
    assert_eq!(AlgType::from_ooxml("typeAny"), AlgType::TypeAny);
    assert_eq!(AlgType::TypeAny.to_ooxml(), "typeAny");
}

#[test]
fn crypt_prov_default() {
    assert_eq!(CryptProv::default(), CryptProv::RsaAes);
}

#[test]
fn crypt_prov_roundtrip() {
    assert_eq!(
        CryptProv::from_ooxml(CryptProv::RsaAes.to_ooxml()),
        CryptProv::RsaAes
    );
    assert_eq!(
        CryptProv::from_ooxml(CryptProv::RsaFull.to_ooxml()),
        CryptProv::RsaFull
    );
    assert_eq!(
        CryptProv::from_ooxml(CryptProv::Custom.to_ooxml()),
        CryptProv::Custom
    );
}

#[test]
fn crypt_prov_case_sensitive() {
    assert_eq!(CryptProv::from_ooxml("rsaAES"), CryptProv::RsaAes);
    assert_eq!(CryptProv::from_ooxml("rsaFull"), CryptProv::RsaFull);
    assert_eq!(CryptProv::RsaAes.to_ooxml(), "rsaAES");
    assert_eq!(CryptProv::RsaFull.to_ooxml(), "rsaFull");
}

// ------------------------------------------------------------------------
// Percentages
// ------------------------------------------------------------------------

#[test]
fn percentage_default() {
    assert!((Percentage::default().value() - 0.0).abs() < f64::EPSILON);
}

#[test]
fn percentage_new_and_value() {
    let p = Percentage::new(50.0);
    assert!((p.value() - 50.0).abs() < f64::EPSILON);
}

#[test]
fn percentage_from_ooxml() {
    let p = Percentage::from_ooxml("50%");
    assert!((p.value() - 50.0).abs() < f64::EPSILON);

    let p = Percentage::from_ooxml("-10.5%");
    assert!((p.value() - (-10.5)).abs() < f64::EPSILON);
}

#[test]
fn percentage_trims_all_trailing_percent_signs() {
    let p = Percentage::from_ooxml("50%%");
    assert!((p.value() - 50.0).abs() < f64::EPSILON);
}

#[test]
fn percentage_to_ooxml() {
    let p = Percentage::new(50.0);
    assert_eq!(p.to_ooxml(), "50%");
}

#[test]
fn percentage_invalid_defaults_to_zero() {
    let p = Percentage::from_ooxml("abc%");
    assert!((p.value() - 0.0).abs() < f64::EPSILON);
}

#[test]
fn percentage_from_bytes() {
    let p = Percentage::from_bytes(b"75%");
    assert!((p.value() - 75.0).abs() < f64::EPSILON);
}

#[test]
fn percentage_invalid_utf8_bytes_default_to_zero() {
    let p = Percentage::from_bytes(&[0xff, 0xfe]);
    assert!((p.value() - 0.0).abs() < f64::EPSILON);
}

#[test]
fn fixed_percentage_clamps_high() {
    let p = FixedPercentage::new(200.0);
    assert!((p.value() - 100.0).abs() < f64::EPSILON);
}

#[test]
fn fixed_percentage_clamps_low() {
    let p = FixedPercentage::new(-200.0);
    assert!((p.value() - (-100.0)).abs() < f64::EPSILON);
}

#[test]
fn fixed_percentage_in_range() {
    let p = FixedPercentage::new(50.0);
    assert!((p.value() - 50.0).abs() < f64::EPSILON);
}

#[test]
fn fixed_percentage_from_ooxml() {
    let p = FixedPercentage::from_ooxml("150%");
    assert!((p.value() - 100.0).abs() < f64::EPSILON);
}

#[test]
fn positive_percentage_clamps_negative() {
    let p = PositivePercentage::new(-50.0);
    assert!((p.value() - 0.0).abs() < f64::EPSILON);
}

#[test]
fn positive_percentage_allows_large() {
    let p = PositivePercentage::new(500.0);
    assert!((p.value() - 500.0).abs() < f64::EPSILON);
}

#[test]
fn positive_percentage_from_ooxml() {
    let p = PositivePercentage::from_ooxml("-25%");
    assert!((p.value() - 0.0).abs() < f64::EPSILON);
}

#[test]
fn positive_fixed_percentage_clamps_negative() {
    let p = PositiveFixedPercentage::new(-10.0);
    assert!((p.value() - 0.0).abs() < f64::EPSILON);
}

#[test]
fn positive_fixed_percentage_clamps_high() {
    let p = PositiveFixedPercentage::new(150.0);
    assert!((p.value() - 100.0).abs() < f64::EPSILON);
}

#[test]
fn positive_fixed_percentage_in_range() {
    let p = PositiveFixedPercentage::new(75.0);
    assert!((p.value() - 75.0).abs() < f64::EPSILON);
}

#[test]
fn positive_fixed_percentage_from_ooxml() {
    let p = PositiveFixedPercentage::from_ooxml("200%");
    assert!((p.value() - 100.0).abs() < f64::EPSILON);

    let p = PositiveFixedPercentage::from_ooxml("-5%");
    assert!((p.value() - 0.0).abs() < f64::EPSILON);
}

// ------------------------------------------------------------------------
// Rich-text vertical alignment
// ------------------------------------------------------------------------

#[test]
fn vertical_align_run_default() {
    assert_eq!(VerticalAlignRun::default(), VerticalAlignRun::Baseline);
}

#[test]
fn vertical_align_run_roundtrip() {
    for (s, v) in [
        ("baseline", VerticalAlignRun::Baseline),
        ("superscript", VerticalAlignRun::Superscript),
        ("subscript", VerticalAlignRun::Subscript),
    ] {
        assert_eq!(VerticalAlignRun::from_ooxml(s), v);
        assert_eq!(v.to_ooxml(), s);
        assert_eq!(VerticalAlignRun::from_bytes(s.as_bytes()), v);
        assert_eq!(v.as_str(), s);
    }
}

#[test]
fn vertical_align_run_unknown_defaults_to_baseline() {
    assert_eq!(
        VerticalAlignRun::from_ooxml("unknown"),
        VerticalAlignRun::Baseline
    );
    assert_eq!(
        VerticalAlignRun::from_bytes(b"unknown"),
        VerticalAlignRun::Baseline
    );
}

// ------------------------------------------------------------------------
// OPC relationship serde shape
// ------------------------------------------------------------------------

#[test]
fn opc_relationship_omits_none_target_mode() {
    let rel = OpcRelationship {
        id: "rId1".to_owned(),
        rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
            .to_owned(),
        target: "worksheets/sheet1.xml".to_owned(),
        target_mode: None,
    };

    let json = serde_json::to_string(&rel).unwrap();
    assert!(!json.contains("target_mode"));
}

#[test]
fn opc_relationship_preserves_target_mode() {
    let rel = OpcRelationship {
        id: "rId1".to_owned(),
        rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
            .to_owned(),
        target: "https://example.com".to_owned(),
        target_mode: Some("External".to_owned()),
    };

    let json = serde_json::to_string(&rel).unwrap();
    assert!(json.contains("\"target_mode\":\"External\""));
    let roundtrip: OpcRelationship = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtrip.target_mode.as_deref(), Some("External"));
}
