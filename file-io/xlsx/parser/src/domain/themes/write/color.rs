use crate::write::xml_writer::XmlWriter;
use ooxml_types::drawings::{ColorTransform, DrawingColor};
use ooxml_types::themes::ColorScheme;

/// Write the color scheme section.
pub(super) fn write_color_scheme(xml: &mut XmlWriter, color_scheme: &ColorScheme) {
    xml.start_element_ns("a", "clrScheme")
        .attr("name", &color_scheme.name)
        .end_attrs();

    write_slot_color(xml, "dk1", &color_scheme.dk1);
    write_slot_color(xml, "lt1", &color_scheme.lt1);
    write_slot_color(xml, "dk2", &color_scheme.dk2);
    write_slot_color(xml, "lt2", &color_scheme.lt2);
    write_slot_color(xml, "accent1", &color_scheme.accent1);
    write_slot_color(xml, "accent2", &color_scheme.accent2);
    write_slot_color(xml, "accent3", &color_scheme.accent3);
    write_slot_color(xml, "accent4", &color_scheme.accent4);
    write_slot_color(xml, "accent5", &color_scheme.accent5);
    write_slot_color(xml, "accent6", &color_scheme.accent6);
    write_slot_color(xml, "hlink", &color_scheme.hlink);
    write_slot_color(xml, "folHlink", &color_scheme.fol_hlink);

    xml.end_element_ns("a", "clrScheme");
}

/// Write a DrawingColor inside a named slot element (e.g., `<a:dk1>...<a:sysClr .../></a:dk1>`).
///
/// This is used for color scheme slots where the color is wrapped in a named element.
fn write_slot_color(xml: &mut XmlWriter, slot_name: &str, color: &DrawingColor) {
    xml.start_element_ns("a", slot_name).end_attrs();
    write_drawing_color(xml, color);
    xml.end_element_ns("a", slot_name);
}

// ========================================================================
// DrawingColor serializer
// ========================================================================

/// Write a `DrawingColor` to XML (ECMA-376 EG_ColorChoice).
pub(super) fn write_drawing_color(xml: &mut XmlWriter, color: &DrawingColor) {
    match color {
        DrawingColor::SrgbClr { val, transforms } => {
            if transforms.is_empty() {
                xml.start_element_ns("a", "srgbClr")
                    .attr("val", val)
                    .self_close();
            } else {
                xml.start_element_ns("a", "srgbClr")
                    .attr("val", val)
                    .end_attrs();
                write_color_transforms(xml, transforms);
                xml.end_element_ns("a", "srgbClr");
            }
        }
        DrawingColor::SchemeClr { val, transforms } => {
            if transforms.is_empty() {
                xml.start_element_ns("a", "schemeClr")
                    .attr("val", val.to_ooxml())
                    .self_close();
            } else {
                xml.start_element_ns("a", "schemeClr")
                    .attr("val", val.to_ooxml())
                    .end_attrs();
                write_color_transforms(xml, transforms);
                xml.end_element_ns("a", "schemeClr");
            }
        }
        DrawingColor::SysClr {
            val,
            last_clr,
            transforms,
        } => {
            let elem = xml.start_element_ns("a", "sysClr");
            elem.attr("val", val.to_ooxml());
            if let Some(lc) = last_clr {
                elem.attr("lastClr", lc);
            }
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_color_transforms(xml, transforms);
                xml.end_element_ns("a", "sysClr");
            }
        }
        DrawingColor::HslClr {
            hue,
            sat,
            lum,
            transforms,
        } => {
            let elem = xml.start_element_ns("a", "hslClr");
            elem.attr("hue", &hue.to_string());
            elem.attr("sat", &sat.to_string());
            elem.attr("lum", &lum.to_string());
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_color_transforms(xml, transforms);
                xml.end_element_ns("a", "hslClr");
            }
        }
        DrawingColor::PrstClr { val, transforms } => {
            if transforms.is_empty() {
                xml.start_element_ns("a", "prstClr")
                    .attr("val", val.to_ooxml())
                    .self_close();
            } else {
                xml.start_element_ns("a", "prstClr")
                    .attr("val", val.to_ooxml())
                    .end_attrs();
                write_color_transforms(xml, transforms);
                xml.end_element_ns("a", "prstClr");
            }
        }
        DrawingColor::ScrgbClr {
            r,
            g,
            b,
            transforms,
        } => {
            let elem = xml.start_element_ns("a", "scrgbClr");
            elem.attr("r", &r.to_string());
            elem.attr("g", &g.to_string());
            elem.attr("b", &b.to_string());
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_color_transforms(xml, transforms);
                xml.end_element_ns("a", "scrgbClr");
            }
        }
    }
}

/// Write color transform children.
fn write_color_transforms(xml: &mut XmlWriter, transforms: &[ColorTransform]) {
    for t in transforms {
        let name = t.to_ooxml_name();
        match t.val() {
            Some(v) => {
                xml.start_element_ns("a", name)
                    .attr("val", &v.to_string())
                    .self_close();
            }
            None => {
                // Value-less transforms: comp, inv, gray, gamma, invGamma
                xml.start_element_ns("a", name).self_close();
            }
        }
    }
}
