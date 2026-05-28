use super::super::super::reader::elements::direct_child_slice;
use super::super::super::types::TextListStyle;
use super::para_props::parse_para_props;

pub(in crate::domain::drawings::parse) fn parse_list_style(xml: &[u8]) -> Option<TextListStyle> {
    let mut style = TextListStyle::default();

    if let Some(def_ppr) = direct_child_slice(xml, b"defPPr") {
        style.def_ppr = Some(parse_para_props(def_ppr));
    }

    for level in 1..=9u8 {
        let tag = format!("lvl{}pPr", level);
        if let Some(lvl_ppr) = direct_child_slice(xml, tag.as_bytes()) {
            style.level_ppr[level as usize - 1] = Some(parse_para_props(lvl_ppr));
        }
    }

    // Always return Some if the lstStyle tag was found (even if empty),
    // so that the writer can faithfully reproduce <a:lstStyle/>.
    Some(style)
}
