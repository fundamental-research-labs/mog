//! Text types for DrawingML (ECMA-376 CT_TextBody and related).

mod body;
mod bullets;
mod enums;
mod extension;
mod numbering;
mod paragraph;
mod run_props;

pub use body::{
    FlatText, PresetTextWarp, TextAutofit, TextBody, TextBodyProperties, TextWarpPreset,
};
pub use bullets::{BulletColor, BulletProperties, BulletSize, BulletType};
pub use enums::{
    TextAlign, TextAnchor, TextFontAlignType, TextHorzOverflow, TextVertOverflow, TextVerticalType,
    TextWrap,
};
pub use extension::ExtensionList;
pub use numbering::TextAutonumberType;
pub use paragraph::{
    Paragraph, ParagraphProperties, TextListStyle, TextRun, TextRunContent, TextSpacing,
    TextTabAlignType, TextTabStop,
};
pub use run_props::{
    RunProperties, TextCapsType, TextFont, TextStrikeType, TextUnderlineType, UnderlineFill,
    UnderlineLine,
};
