//! Custom `Serialize` and `Deserialize` implementations for [`CellValue`].
//!
//! Errors serialize as `{"type":"error","value":"<variant>"}` with an optional
//! `"message"` field. All other variants map to plain JSON primitives. Arrays
//! serialize as a JSON array-of-arrays (row-major).

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::sync::Arc;

use super::CellValue;
use crate::CellError;
use crate::cell_array::CellArray;

impl Serialize for CellValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match self {
            CellValue::Number(n) => serializer.serialize_f64(n.get()),
            CellValue::Text(s) => serializer.serialize_str(s),
            CellValue::Boolean(b) => serializer.serialize_bool(*b),
            CellValue::Null => serializer.serialize_unit(),
            CellValue::Error(e, msg) => {
                let entries = if msg.is_some() { 3 } else { 2 };
                let mut map = serializer.serialize_map(Some(entries))?;
                map.serialize_entry("type", "error")?;
                map.serialize_entry("value", e)?;
                if let Some(m) = msg {
                    map.serialize_entry("message", m.as_ref())?;
                }
                map.end()
            }
            CellValue::Array(arr) => {
                use serde::ser::SerializeSeq;
                let mut outer = serializer.serialize_seq(Some(arr.rows()))?;
                for row in arr.rows_iter() {
                    // Serialize each row as a JSON array of CellValues
                    let row_vec: Vec<&CellValue> = row.iter().collect();
                    outer.serialize_element(&row_vec)?;
                }
                outer.end()
            }
            CellValue::Control(c) => {
                let mut map = serializer.serialize_map(Some(4))?;
                map.serialize_entry("type", "control")?;
                map.serialize_entry("controlType", &c.control_type)?;
                map.serialize_entry("checked", &c.checked)?;
                map.serialize_entry("value", &c.value)?;
                map.end()
            }
            CellValue::Image(image) => {
                let mut map = serializer.serialize_map(Some(6))?;
                map.serialize_entry("type", "image")?;
                map.serialize_entry("source", image.source.as_ref())?;
                map.serialize_entry("altText", &image.alt_text.as_deref())?;
                map.serialize_entry("sizing", &image.sizing)?;
                map.serialize_entry("height", &image.height)?;
                map.serialize_entry("width", &image.width)?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for CellValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(CellValueVisitor)
    }
}

struct CellValueVisitor;

impl<'de> Visitor<'de> for CellValueVisitor {
    type Value = CellValue;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a JSON primitive, array, or error object")
    }

    fn visit_bool<E: de::Error>(self, v: bool) -> Result<CellValue, E> {
        Ok(CellValue::Boolean(v))
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<CellValue, E> {
        // Safe: Excel's number type is f64 (53-bit mantissa). Integers beyond
        // 2^53 lose precision, matching Excel's behavior.
        #[allow(clippy::cast_precision_loss)]
        Ok(CellValue::number(v as f64))
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<CellValue, E> {
        // Safe: Excel's number type is f64 (53-bit mantissa). Integers beyond
        // 2^53 lose precision, matching Excel's behavior.
        #[allow(clippy::cast_precision_loss)]
        Ok(CellValue::number(v as f64))
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<CellValue, E> {
        Ok(CellValue::number(v))
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<CellValue, E> {
        Ok(CellValue::Text(Arc::from(v)))
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<CellValue, E> {
        Ok(CellValue::Text(Arc::from(v)))
    }

    fn visit_unit<E: de::Error>(self) -> Result<CellValue, E> {
        Ok(CellValue::Null)
    }

    fn visit_none<E: de::Error>(self) -> Result<CellValue, E> {
        Ok(CellValue::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<CellValue, A::Error> {
        // Deserialize as array of arrays (Vec<Vec<CellValue>>).
        // Jagged arrays are padded to uniform width with Null, matching Excel's
        // array semantics where all rows have the same column count.
        let mut rows: Vec<Vec<CellValue>> = Vec::new();
        while let Some(row) = seq.next_element::<Vec<CellValue>>()? {
            rows.push(row);
        }
        let num_cols = rows.iter().map(std::vec::Vec::len).max().unwrap_or(0);
        if num_cols == 0 {
            return Ok(CellValue::Array(Arc::new(CellArray::empty())));
        }
        // Pad jagged rows to uniform width with Null
        let mut data = Vec::with_capacity(rows.len() * num_cols);
        for mut row in rows {
            row.resize(num_cols, CellValue::Null);
            data.extend(row);
        }
        Ok(CellValue::Array(Arc::new(CellArray::new(data, num_cols))))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<CellValue, A::Error> {
        // Expect {"type":"error","value":"<variant>","message":"..."}
        // or     {"type":"control","controlType":"checkbox","checked":true,"value":true}
        let mut type_field: Option<String> = None;
        let mut value_field: Option<serde_json::Value> = None;
        let mut message_field: Option<String> = None;
        let mut control_type_field: Option<String> = None;
        let mut checked_field: Option<bool> = None;
        let mut source_field: Option<String> = None;
        let mut alt_text_field: Option<String> = None;
        let mut sizing_field: Option<crate::CellImageSizing> = None;
        let mut height_field: Option<u32> = None;
        let mut width_field: Option<u32> = None;

        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "type" => {
                    type_field = Some(map.next_value()?);
                }
                "value" => {
                    value_field = Some(map.next_value()?);
                }
                "message" => {
                    message_field = Some(map.next_value()?);
                }
                "controlType" => {
                    control_type_field = Some(map.next_value()?);
                }
                "checked" => {
                    checked_field = Some(map.next_value()?);
                }
                "source" => {
                    source_field = Some(map.next_value()?);
                }
                "altText" => {
                    alt_text_field = Some(map.next_value()?);
                }
                "sizing" => {
                    sizing_field = Some(map.next_value()?);
                }
                "height" => {
                    height_field = Some(map.next_value()?);
                }
                "width" => {
                    width_field = Some(map.next_value()?);
                }
                _ => {
                    // Skip unknown fields
                    let _ = map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
        }

        match type_field.as_deref() {
            Some("error") => {
                let msg = message_field.map(Arc::<str>::from);
                let variant = value_field
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();
                // Unknown error variants (e.g., from newer formats) fall back to Calc
                // to avoid deserialization failure. This is intentional: we prefer a
                // lossy but functional parse over a hard error.
                let error = serde_json::from_value::<CellError>(serde_json::Value::String(variant))
                    .unwrap_or(CellError::Calc);
                Ok(CellValue::Error(error, msg))
            }
            Some("control") => {
                use crate::cell_value::control::{CellControl, CellControlType};
                // Default to checkbox for forward compatibility
                let _ = control_type_field;
                let control_type = CellControlType::Checkbox;
                let checked = checked_field.unwrap_or(false);
                let value = value_field.and_then(|v| v.as_bool()).unwrap_or(checked);
                Ok(CellValue::Control(CellControl {
                    control_type,
                    checked,
                    value,
                }))
            }
            Some("image") => {
                let Some(source) = source_field else {
                    return Ok(CellValue::Error(CellError::Calc, None));
                };
                Ok(CellValue::Image(crate::CellImage::new(
                    source,
                    alt_text_field.map(Arc::<str>::from),
                    sizing_field.unwrap_or(crate::CellImageSizing::Fit),
                    height_field,
                    width_field,
                )))
            }
            // Unknown object type -- treat as Calc error
            _ => {
                let msg = message_field.map(Arc::<str>::from);
                Ok(CellValue::Error(CellError::Calc, msg))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cell_value::cv_number as n;

    #[test]
    fn serde_roundtrip_number() {
        let v = n(42.5);
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, "42.5");
        let v2: CellValue = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_roundtrip_text() {
        let v = CellValue::Text("hello world".into());
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, r#""hello world""#);
        let v2: CellValue = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_roundtrip_boolean() {
        for b in [true, false] {
            let v = CellValue::Boolean(b);
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, if b { "true" } else { "false" });
            let v2: CellValue = serde_json::from_str(&json).unwrap();
            assert_eq!(v, v2);
        }
    }

    #[test]
    fn serde_roundtrip_error() {
        let v = CellValue::Error(CellError::Div0, None);
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, r#"{"type":"error","value":"Div0"}"#);
        let v2: CellValue = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_roundtrip_null() {
        let v = CellValue::Null;
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, "null");
        let v2: CellValue = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_roundtrip_array() {
        let v = CellValue::from_rows(vec![
            vec![n(42.5), CellValue::Text("text".into())],
            vec![CellValue::Null, CellValue::Boolean(true)],
        ]);
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, r#"[[42.5,"text"],[null,true]]"#);
        let v2: CellValue = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_lambda_becomes_calc_error() {
        let json = r#"{"type":"error","value":"Calc"}"#;
        let v: CellValue = serde_json::from_str(json).unwrap();
        assert_eq!(v, CellValue::Error(CellError::Calc, None));
    }

    #[test]
    fn serde_deserialize_integer() {
        let v: CellValue = serde_json::from_str("42").unwrap();
        assert_eq!(v, n(42.0));
    }

    #[test]
    fn serde_deserialize_unknown_object() {
        let v: CellValue = serde_json::from_str(r#"{"foo":"bar"}"#).unwrap();
        assert_eq!(v, CellValue::Error(CellError::Calc, None));
    }

    #[test]
    fn serde_deserialize_empty_array() {
        let v: CellValue = serde_json::from_str("[]").unwrap();
        assert!(v.is_array());
        let arr = v.as_array().unwrap();
        assert_eq!(arr.rows(), 0);
    }

    #[test]
    fn serde_deserialize_unknown_error_variant() {
        let v: CellValue =
            serde_json::from_str(r#"{"type":"error","value":"UnknownVariant"}"#).unwrap();
        assert_eq!(v, CellValue::Error(CellError::Calc, None));
    }

    #[test]
    fn serde_roundtrip_error_with_message() {
        let v = CellValue::Error(CellError::Div0, Some("division by zero".into()));
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains("\"message\":\"division by zero\""));
        let v2: CellValue = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
        assert_eq!(v2.error_message(), Some("division by zero"));
    }

    #[test]
    fn serde_deserialize_jagged_array_padded() {
        let v: CellValue = serde_json::from_str("[[1,2,3],[4,5]]").unwrap();
        assert!(v.is_array());
        let arr = v.as_array().unwrap();
        assert_eq!(arr.rows(), 2);
        assert_eq!(arr.cols(), 3);
        // Row 1 intact
        assert_eq!(arr.get(0, 0), Some(&n(1.0)));
        assert_eq!(arr.get(0, 1), Some(&n(2.0)));
        assert_eq!(arr.get(0, 2), Some(&n(3.0)));
        // Row 2: two values + padded Null
        assert_eq!(arr.get(1, 0), Some(&n(4.0)));
        assert_eq!(arr.get(1, 1), Some(&n(5.0)));
        assert_eq!(arr.get(1, 2), Some(&CellValue::Null));
    }
}
