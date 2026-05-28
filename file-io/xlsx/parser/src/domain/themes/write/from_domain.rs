use super::{ColorSchemeExt, ThemeColorIndex, ThemeWriter};

/// Build theme XML from a `domain_types::ThemeData`.
pub fn theme_writer_from_domain(theme: &domain_types::ThemeData) -> Vec<u8> {
    use ooxml_types::drawings::{DrawingColor, SystemColorVal};

    let mut tw = ThemeWriter::default_office_theme();

    // Apply theme name from ThemeData (parsed from original file).
    if let Some(ref name) = theme.name {
        tw.set_name(name);
    }

    if let Some(ref color_scheme) = theme.color_scheme {
        tw.set_color_scheme(color_scheme.clone());
    } else {
        for tc in &theme.colors {
            let index = match tc.name.as_str() {
                "dk1" => ThemeColorIndex::Dark1,
                "lt1" => ThemeColorIndex::Light1,
                "dk2" => ThemeColorIndex::Dark2,
                "lt2" => ThemeColorIndex::Light2,
                "accent1" => ThemeColorIndex::Accent1,
                "accent2" => ThemeColorIndex::Accent2,
                "accent3" => ThemeColorIndex::Accent3,
                "accent4" => ThemeColorIndex::Accent4,
                "accent5" => ThemeColorIndex::Accent5,
                "accent6" => ThemeColorIndex::Accent6,
                "hlink" => ThemeColorIndex::Hyperlink,
                "folHlink" => ThemeColorIndex::FollowedHyperlink,
                _ => continue,
            };
            match &tc.source {
                Some(domain_types::ThemeColorSource::SysClr { val, last_clr }) => {
                    let sys_val = SystemColorVal::from_ooxml(val);
                    tw.color_scheme_mut().set(
                        index,
                        DrawingColor::SysClr {
                            val: sys_val,
                            last_clr: Some(last_clr.clone()),
                            transforms: vec![],
                        },
                    );
                }
                _ => {
                    let hex = tc.color.strip_prefix('#').unwrap_or(&tc.color);
                    tw.set_color(index, hex);
                }
            }
        }
    }

    if let Some(ref font_scheme) = theme.font_scheme {
        tw.set_font_scheme(font_scheme.clone());
    } else {
        if let Some(ref major) = theme.major_font {
            tw.set_major_font(major);
        }
        if let Some(ref minor) = theme.minor_font {
            tw.set_minor_font(minor);
        }
    }

    if let Some(ref format_scheme) = theme.format_scheme {
        tw.set_format_scheme(format_scheme.clone());
    }
    if let Some(ref object_defaults_xml) = theme.object_defaults_xml {
        tw.set_object_defaults_xml(object_defaults_xml.clone());
    }
    if let Some(ref extra_clr_scheme_lst_xml) = theme.extra_clr_scheme_lst_xml {
        tw.set_extra_clr_scheme_lst_xml(extra_clr_scheme_lst_xml.clone());
    }
    if let Some(ref ext_lst_xml) = theme.ext_lst_xml {
        tw.set_ext_lst_xml(ext_lst_xml.clone());
    }
    if let Some(ref cust_clr_lst_xml) = theme.cust_clr_lst_xml {
        tw.set_cust_clr_lst_xml(cust_clr_lst_xml.clone());
    }
    if let Some(ref root_sibling_order) = theme.root_sibling_order {
        tw.set_root_sibling_order(root_sibling_order.clone());
    }

    tw.to_xml()
}
