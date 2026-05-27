//! Unified floating object type hierarchy.
//!
//! One type system for all floating objects: shapes, pictures, textboxes,
//! connectors, charts, equations, diagrams, OLE objects, slicers, form controls.

use serde::de;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

mod anchor;
mod chart;
mod common;
mod drawing;
mod objects;
mod ooxml;
mod shape_type;
mod style;

pub use anchor::*;
pub use chart::*;
pub use common::*;
pub use drawing::*;
pub use objects::*;
pub use ooxml::*;
pub use shape_type::*;
pub use style::*;

// Keep the facade focused on the aggregate/wire contract. New per-domain
// floating-object types belong in the focused sibling modules above.

// ===========================================================================
// SECTION F: FloatingObjectData Enum
// ===========================================================================

/// The kind/type of a floating object, without any associated data.
///
/// Serializes to the same tag values as [`FloatingObjectData`] (e.g. `"shape"`,
/// `"diagram"`, `"oleObject"`). Used in change notifications where the full
/// data payload is not needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FloatingObjectKind {
    #[serde(rename = "shape")]
    Shape,
    #[serde(rename = "connector")]
    Connector,
    #[serde(rename = "picture")]
    Picture,
    #[serde(rename = "textbox")]
    Textbox,
    #[serde(rename = "chart")]
    Chart,
    #[serde(rename = "camera")]
    Camera,
    #[serde(rename = "equation")]
    Equation,
    #[serde(rename = "diagram")]
    Diagram,
    #[serde(rename = "drawing")]
    Drawing,
    #[serde(rename = "oleObject")]
    OleObject,
    #[serde(rename = "formControl")]
    FormControl,
    #[serde(rename = "slicer")]
    Slicer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum FloatingObjectData {
    #[serde(rename = "shape")]
    Shape(ShapeData),
    #[serde(rename = "connector")]
    Connector(ConnectorData),
    #[serde(rename = "picture")]
    Picture(PictureData),
    #[serde(rename = "textbox")]
    Textbox(TextboxData),
    #[serde(rename = "chart")]
    Chart(ChartData),
    #[serde(rename = "camera")]
    Camera(CameraData),
    #[serde(rename = "equation")]
    Equation(EquationData),
    #[serde(rename = "diagram")]
    Diagram(DiagramData),
    #[serde(rename = "drawing")]
    Drawing(DrawingData),
    #[serde(rename = "oleObject")]
    OleObject(OleObjectData),
    #[serde(rename = "formControl")]
    FormControl(FormControlData),
    #[serde(rename = "slicer")]
    Slicer(SlicerData),
}

// ===========================================================================
// SECTION G: FloatingObject Composite (Manual Serde)
// ===========================================================================

/// A floating object: common metadata + type-specific data, serialized flat.
#[derive(Debug, Clone, PartialEq)]
pub struct FloatingObject {
    pub common: FloatingObjectCommon,
    pub data: FloatingObjectData,
}

impl FloatingObject {
    pub fn object_type(&self) -> &str {
        self.kind().as_str()
    }

    /// Returns the [`FloatingObjectKind`] for this object.
    pub fn kind(&self) -> FloatingObjectKind {
        FloatingObjectKind::from(&self.data)
    }
}

impl FloatingObjectKind {
    /// Returns the serialized string representation (matches the serde tag values).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shape => "shape",
            Self::Connector => "connector",
            Self::Picture => "picture",
            Self::Textbox => "textbox",
            Self::Chart => "chart",
            Self::Camera => "camera",
            Self::Equation => "equation",
            Self::Diagram => "diagram",
            Self::Drawing => "drawing",
            Self::OleObject => "oleObject",
            Self::FormControl => "formControl",
            Self::Slicer => "slicer",
        }
    }
}

impl From<&FloatingObjectData> for FloatingObjectKind {
    fn from(data: &FloatingObjectData) -> Self {
        match data {
            FloatingObjectData::Shape(_) => Self::Shape,
            FloatingObjectData::Connector(_) => Self::Connector,
            FloatingObjectData::Picture(_) => Self::Picture,
            FloatingObjectData::Textbox(_) => Self::Textbox,
            FloatingObjectData::Chart(_) => Self::Chart,
            FloatingObjectData::Camera(_) => Self::Camera,
            FloatingObjectData::Equation(_) => Self::Equation,
            FloatingObjectData::Diagram(_) => Self::Diagram,
            FloatingObjectData::Drawing(_) => Self::Drawing,
            FloatingObjectData::OleObject(_) => Self::OleObject,
            FloatingObjectData::FormControl(_) => Self::FormControl,
            FloatingObjectData::Slicer(_) => Self::Slicer,
        }
    }
}

impl Serialize for FloatingObject {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let common_val = serde_json::to_value(&self.common).map_err(serde::ser::Error::custom)?;
        let data_val = serde_json::to_value(&self.data).map_err(serde::ser::Error::custom)?;

        let mut map = match data_val {
            Value::Object(m) => m,
            _ => serde_json::Map::new(),
        };
        if let Value::Object(common_map) = common_val {
            map.extend(common_map);
        }

        Value::Object(map).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for FloatingObject {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        let common: FloatingObjectCommon =
            serde_json::from_value(value.clone()).map_err(de::Error::custom)?;
        let data: FloatingObjectData = serde_json::from_value(value).map_err(de::Error::custom)?;
        Ok(FloatingObject { common, data })
    }
}

#[cfg(test)]
mod tests;
