use super::super::super::helpers::{extract_attr_value_in_element, parse_u32};
use super::super::super::reader::elements::direct_child_slice;
use super::super::super::types::{
    BulletColor, BulletProperties, BulletSize, BulletType, DrawingColor, TextFont,
};
use super::super::styling::parse_color;
use ooxml_types::drawings::{StPitchFamily, TextAutonumberType};

pub(super) fn parse_bullet_props(xml: &[u8]) -> Option<BulletProperties> {
    let mut bullet = BulletProperties::default();
    let mut found = false;

    if direct_child_slice(xml, b"buClrTx").is_some() {
        bullet.color = Some(BulletColor::FollowText);
        found = true;
    } else if let Some(bu_clr) = direct_child_slice(xml, b"buClr") {
        let c = parse_color(bu_clr);
        let is_empty = matches!(&c, DrawingColor::SrgbClr { val, .. } if val.is_empty());
        if !is_empty {
            bullet.color = Some(BulletColor::Custom(c));
            found = true;
        }
    }

    if direct_child_slice(xml, b"buSzTx").is_some() {
        bullet.size = Some(BulletSize::FollowText);
        found = true;
    } else if let Some(bu_sz_pct) = direct_child_slice(xml, b"buSzPct") {
        if let Some(val) =
            extract_attr_value_in_element(bu_sz_pct, b"val=\"").and_then(|v| parse_u32(v))
        {
            bullet.size = Some(BulletSize::Percent(val));
            found = true;
        }
    } else if let Some(bu_sz_pts) = direct_child_slice(xml, b"buSzPts") {
        if let Some(val) =
            extract_attr_value_in_element(bu_sz_pts, b"val=\"").and_then(|v| parse_u32(v))
        {
            bullet.size = Some(BulletSize::Points(val));
            found = true;
        }
    }

    if direct_child_slice(xml, b"buFontTx").is_some() {
        bullet.font_follows_text = true;
        found = true;
    } else if let Some(bu_font) = direct_child_slice(xml, b"buFont") {
        if let Some(typeface) = extract_attr_value_in_element(bu_font, b"typeface=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned())
        {
            let panose = extract_attr_value_in_element(bu_font, b"panose=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
            let pitch_family = extract_attr_value_in_element(bu_font, b"pitchFamily=\"")
                .and_then(|v| std::str::from_utf8(v).ok()?.parse::<u8>().ok())
                .map(StPitchFamily::new);
            let charset = extract_attr_value_in_element(bu_font, b"charset=\"")
                .and_then(|v| std::str::from_utf8(v).ok()?.parse().ok());
            bullet.font = Some(TextFont {
                typeface,
                panose,
                pitch_family,
                charset,
            });
            found = true;
        }
    }

    if direct_child_slice(xml, b"buNone").is_some() {
        bullet.bullet_type = Some(BulletType::None);
        found = true;
    } else if let Some(bu_char) = direct_child_slice(xml, b"buChar") {
        if let Some(ch) = extract_attr_value_in_element(bu_char, b"char=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned())
        {
            bullet.bullet_type = Some(BulletType::Char(ch));
            found = true;
        }
    } else if let Some(bu_auto_num) = direct_child_slice(xml, b"buAutoNum") {
        if let Some(type_val) = extract_attr_value_in_element(bu_auto_num, b"type=\"") {
            let s = std::str::from_utf8(type_val).unwrap_or("");
            let scheme = TextAutonumberType::from_ooxml(s);
            let start_at = extract_attr_value_in_element(bu_auto_num, b"startAt=\"")
                .and_then(|v| parse_u32(v));
            bullet.bullet_type = Some(BulletType::AutoNum { scheme, start_at });
            found = true;
        }
    } else if let Some(bu_blip) = direct_child_slice(xml, b"buBlip") {
        if let Some(blip) = direct_child_slice(bu_blip, b"blip") {
            if let Some(rid) = extract_attr_value_in_element(blip, b"r:embed=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned())
            {
                bullet.bullet_type = Some(BulletType::Blip(rid));
                found = true;
            }
        }
    }

    if found { Some(bullet) } else { None }
}
