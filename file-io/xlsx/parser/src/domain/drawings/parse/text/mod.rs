//! Text body parsing for drawings.
//!
//! This module handles parsing of text body elements (txBody) including
//! paragraphs, text runs, and text properties.

mod body_props;
mod bullets;
mod common;
mod enums;
mod list_style;
mod para_props;
mod paragraph;
mod run_props;

#[cfg(test)]
mod tests;

pub use self::enums::{parse_text_align, parse_text_anchor, parse_text_wrap};

use self::body_props::parse_body_props as parse_body_props_impl;
use self::list_style::parse_list_style as parse_list_style_impl;
use self::paragraph::parse_paragraph as parse_paragraph_impl;
use super::super::reader::elements::direct_child_elements;
use super::super::types::TextBody as TextBodyModel;

#[cfg(test)]
pub(super) use self::body_props::parse_body_props;
#[cfg(test)]
pub(super) use self::common::parse_ext_lst;
#[cfg(test)]
pub(super) use self::list_style::parse_list_style;
#[cfg(test)]
pub(super) use self::para_props::parse_para_props;
#[cfg(test)]
pub(super) use self::paragraph::parse_paragraph;
#[cfg(test)]
pub(super) use self::run_props::parse_run_props;
#[cfg(test)]
pub(super) use super::super::types::{
    BulletColor, BulletSize, BulletType, DrawingColor, Fill, TextAlign, TextAutofit, TextCapsType,
    TextFontAlignType, TextHorzOverflow, TextRunContent, TextSpacing, TextStrikeType,
    TextTabAlignType, TextUnderlineType, TextVertOverflow, TextVerticalType, TextWrap,
    UnderlineFill, UnderlineLine,
};

/// Parse text body
pub fn parse_text_body(xml: &[u8]) -> Option<TextBodyModel> {
    let mut body = TextBodyModel::default();

    for child in direct_child_elements(xml) {
        let child_xml = child.full_slice(xml);
        match child.local_name {
            b"bodyPr" => body.body_props = parse_body_props_impl(child_xml),
            b"lstStyle" => body.list_style = parse_list_style_impl(child_xml),
            b"p" => {
                if let Some(para) = parse_paragraph_impl(child_xml) {
                    body.paragraphs.push(para);
                }
            }
            _ => {}
        }
    }

    Some(body)
}
