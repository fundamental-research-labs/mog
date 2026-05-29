//! Shared drawing primitives for `domain-types`.
//!
//! Lossless domain-level representation of the DrawingML primitives (Scene3D,
//! Shape3D, ShapeStyle, ManualLayout, CT_EffectLst siblings) so picture,
//! shape, connector, and chart elevation can build lossless domain-owned shapes
//! without embedding `ooxml_types::*` fields on domain structs.
//!
//! Every primitive in this module:
//! - has camelCase JSON serialization,
//! - has a `Default` implementation that emits **no** JSON keys (matching
//!   the established serde shape in `domain-types`),
//! - ships with `From<&ooxml_types::…> for DomainType` and
//!   `From<DomainType> for ooxml_types::…` converters covering the full
//!   structural content of the mirrored OOXML struct.

pub mod audits;
pub mod black_white_mode;
pub mod blip_effect;
pub mod color;
pub mod compression;
pub mod drawing_fill;
pub mod effect_properties;
pub mod effects;
pub mod fill_mode;
pub mod group_shape;
pub mod hyperlink;
pub mod locking;
pub mod manual_layout;
pub mod ole_object;
pub mod outline;
pub mod scene;
pub mod shape_3d;
pub mod shape_style;
pub mod source_rect;
pub mod text_body;
pub mod text_body_convert;
pub mod transform;
pub mod vml_shape;

pub use audits::{
    AdjustValue, ClientDataFlags, DashStop, Duotone, EditAsKind, LineCap, LineDashSpec, LineFill,
    LineGradientStop, LineJoin, PenAlignment, PresetShape, ShapeGeometry,
};
pub use black_white_mode::BlackWhiteMode;
pub use blip_effect::{
    BlipEffect, BlurEffect as BlipBlurEffect, FillOverlayEffect as BlipFillOverlayEffect,
};
pub use color::{ColorTransformKind, ColorTransformSpec, DomainDrawingColor};
pub use compression::CompressionState;
pub use drawing_fill::{
    BlipFillSpec, DrawingFill, GradientFillSpec, GradientPathType, GradientStopSpec,
    PatternFillSpec,
};
pub use effect_properties::{EffectListSpec, EffectProperties};
pub use effects::{BlurEffect, GlowEffect, InnerShadowEffect, ReflectionEffect, SoftEdgeEffect};
pub use fill_mode::{FillMode, TileAlign, TileFlip};
pub use group_shape::{DrawingContent, GroupShapeData, OpaqueDrawingContent, SmartArtGraphicFrame};
pub use hyperlink::HyperlinkRef;
pub use locking::DrawingLocking;
pub use manual_layout::{LayoutMode, LayoutTarget, ManualLayout};
pub use ole_object::{OleAnchorPoint, OleObjectAnchor, OleObjectProperties};
pub use outline::{CompoundLine, LineEndDecoration, LineEndSizeKind, LineEndSpec, Outline};
pub use scene::{Backdrop, Camera, LightRig, Point3D, Rotation3D, SceneSettings};
pub use shape_3d::{Bevel, BevelPreset, Shape3DSettings};
pub use shape_style::{FontReference, ShapeStyle, StyleRef};
pub use source_rect::SourceRect;
pub use text_body::{
    BulletColor, BulletFont, BulletProps, BulletSize, BulletVariant, GeomGuide, ParagraphContent,
    PresetTextWarp, TextAutofit, TextBody, TextBodyProps, TextFontRef, TextListStyle,
    TextParagraph, TextParagraphProps, TextRunData, TextRunProps, TextSpacing, TextTabStop,
};
pub use transform::Transform2D;
pub use vml_shape::VmlShapeProps;
