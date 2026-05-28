use crate::domain::styles::write::{BorderSideDef, BorderStyle, ColorDef, FillDef, StylesWriter};

pub(super) fn xml_string(writer: &StylesWriter) -> String {
    String::from_utf8(writer.to_xml()).unwrap()
}

pub(super) fn default_writer_xml() -> String {
    xml_string(&StylesWriter::with_defaults())
}

pub(super) fn rgb(value: &str) -> ColorDef {
    ColorDef::Rgb {
        val: value.to_string(),
        tint: None,
    }
}

pub(super) fn rgb_tint(value: &str, tint: &str) -> ColorDef {
    ColorDef::Rgb {
        val: value.to_string(),
        tint: Some(tint.to_string()),
    }
}

pub(super) fn theme(id: u32, tint: Option<&str>) -> ColorDef {
    ColorDef::Theme {
        id,
        tint: tint.map(str::to_string),
    }
}

pub(super) fn indexed(id: u32) -> ColorDef {
    ColorDef::Indexed { id, tint: None }
}

pub(super) fn indexed_tint(id: u32, tint: &str) -> ColorDef {
    ColorDef::Indexed {
        id,
        tint: Some(tint.to_string()),
    }
}

pub(super) fn thin_side(color: Option<ColorDef>) -> BorderSideDef {
    BorderSideDef {
        style: BorderStyle::Thin,
        color,
    }
}

pub(super) fn solid_fill(value: &str) -> FillDef {
    FillDef::Solid {
        fg_color: rgb(value),
    }
}

pub(super) fn assert_contains_all(xml: &str, needles: &[&str]) {
    for needle in needles {
        assert!(xml.contains(needle), "missing XML snippet: {needle}");
    }
}

pub(super) fn assert_in_order(xml: &str, needles: &[&str]) {
    let mut previous = 0;
    for needle in needles {
        let absolute = xml[previous..]
            .find(needle)
            .map(|offset| previous + offset)
            .unwrap_or_else(|| panic!("missing XML snippet: {needle}"));
        assert!(
            previous <= absolute,
            "XML snippet appeared out of order: {needle}"
        );
        previous = absolute + needle.len();
    }
}
