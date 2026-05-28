use compute_text_measurement::FontDb;

#[test]
fn all_default_fonts_load_successfully() {
    let db = FontDb::with_defaults();
    for family in &[
        "Carlito",
        "Caladea",
        "Liberation Sans",
        "Liberation Serif",
        "Liberation Mono",
    ] {
        let result = db.resolve(family);
        assert!(result.is_some(), "Font '{family}' should be loaded");
        let (_, entry) = result.unwrap();
        assert!(
            entry.face().is_some(),
            "Font '{family}' should parse to a valid Face"
        );
    }
}

#[test]
fn font_fallback_chains_resolve() {
    let db = FontDb::with_defaults();
    let chains = [
        ("Calibri", "carlito"),
        ("Cambria", "caladea"),
        ("Arial", "liberation sans"),
        ("Helvetica", "liberation sans"),
        ("Times New Roman", "liberation serif"),
        ("Times", "liberation serif"),
        ("Courier New", "liberation mono"),
        ("Courier", "liberation mono"),
    ];
    for (commercial, oss) in chains {
        let (id_via_fallback, _) = db.resolve(commercial).unwrap();
        let (id_direct, _) = db.resolve(oss).unwrap();
        assert_eq!(
            id_via_fallback, id_direct,
            "{commercial} should resolve to same font_id as {oss}"
        );
    }
}

#[test]
fn font_unknown_family_falls_back_to_carlito() {
    let db = FontDb::with_defaults();
    let (id_unknown, _) = db.resolve("Totally Unknown Font").unwrap();
    let (id_carlito, _) = db.resolve("Carlito").unwrap();
    assert_eq!(
        id_unknown, id_carlito,
        "Unknown font should default to Carlito"
    );
}

#[test]
fn resolve_styled_falls_through_to_base() {
    let db = FontDb::with_defaults();
    let result = db.resolve_styled("Calibri", true, false);
    assert!(result.is_some(), "Calibri bold should resolve via fallback");
}

#[test]
fn resolve_styled_returns_correct_variant() {
    let db = FontDb::with_defaults();
    let (id_regular, _) = db.resolve_styled("Carlito", false, false).unwrap();
    let (id_bold, _) = db.resolve_styled("Carlito", true, false).unwrap();
    let (id_italic, _) = db.resolve_styled("Carlito", false, true).unwrap();
    let (id_bi, _) = db.resolve_styled("Carlito", true, true).unwrap();

    let ids = [id_regular, id_bold, id_italic, id_bi];
    for i in 0..ids.len() {
        for j in (i + 1)..ids.len() {
            assert_ne!(ids[i], ids[j], "Variant {i} and {j} should differ");
        }
    }
}

#[test]
fn cjk_detection_covers_all_ranges() {
    assert!(FontDb::needs_cjk("你"));
    assert!(FontDb::needs_cjk("\u{3400}"));
    assert!(FontDb::needs_cjk("あ"));
    assert!(FontDb::needs_cjk("ア"));
    assert!(FontDb::needs_cjk("한"));
    assert!(FontDb::needs_cjk("\u{FF21}"));
    assert!(FontDb::needs_cjk("\u{3001}"));

    assert!(!FontDb::needs_cjk("Hello"));
    assert!(!FontDb::needs_cjk("123"));
    assert!(!FontDb::needs_cjk("αβγ"));
    assert!(!FontDb::needs_cjk(""));
}

#[test]
fn load_defaults_idempotent() {
    let mut db = FontDb::new();
    db.load_defaults();
    let (id1, _) = db.resolve("Carlito").unwrap();
    db.load_defaults();
    let (id2, _) = db.resolve("Carlito").unwrap();
    assert_eq!(id1, id2, "load_defaults should be idempotent");
}

#[test]
fn font_db_default_has_no_fonts() {
    let db = FontDb::default();
    assert!(
        db.resolve("Anything").is_none(),
        "Empty FontDb should resolve nothing"
    );
}

#[test]
fn case_insensitive_resolution() {
    let db = FontDb::with_defaults();
    let (id_lower, _) = db.resolve("carlito").unwrap();
    let (id_upper, _) = db.resolve("CARLITO").unwrap();
    let (id_mixed, _) = db.resolve("Carlito").unwrap();
    assert_eq!(id_lower, id_upper);
    assert_eq!(id_lower, id_mixed);
}

#[test]
fn load_cjk_registers_font() {
    let mut db = FontDb::with_defaults();
    assert!(
        db.resolve("noto sans cjk sc").is_none()
            || db.resolve("noto sans cjk sc").unwrap().0 == db.resolve("carlito").unwrap().0,
        "Before load_cjk, 'noto sans cjk sc' should not be directly registered"
    );

    let carlito_bytes = include_bytes!("../../../fonts/Carlito-Regular.ttf").to_vec();
    db.load_cjk(carlito_bytes);

    let result = db.resolve("noto sans cjk sc");
    assert!(
        result.is_some(),
        "After load_cjk, 'noto sans cjk sc' should resolve"
    );
    let (_, entry) = result.unwrap();
    assert!(
        entry.face().is_some(),
        "CJK font entry should parse to a Face"
    );
}
