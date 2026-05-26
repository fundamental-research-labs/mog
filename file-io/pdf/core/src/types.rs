//! PDF 1.7 typed object model.
//!
//! Implements the fundamental PDF value types per ISO 32000-1:2008 section 7.3:
//! - Boolean, Integer, Real, String, Name, Array, Dictionary, Stream, Null, Indirect Reference

use std::collections::BTreeMap;
use std::fmt;

/// An indirect object reference: object number + generation number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PdfRef {
    pub obj_num: u32,
    pub gen_num: u16,
}

impl PdfRef {
    pub fn new(obj_num: u32, gen_num: u16) -> Self {
        Self { obj_num, gen_num }
    }
}

impl fmt::Display for PdfRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {} R", self.obj_num, self.gen_num)
    }
}

/// A PDF name object (e.g., /Type, /Pages).
/// Stored without the leading `/`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PdfName(pub String);

impl PdfName {
    pub fn new(name: impl Into<String>) -> Self {
        Self(name.into())
    }

    /// Returns the name string without leading `/`.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PdfName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "/{}", self.0)
    }
}

impl From<&str> for PdfName {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl From<String> for PdfName {
    fn from(s: String) -> Self {
        Self(s)
    }
}

/// A PDF dictionary — ordered map of Name -> PdfValue.
/// Uses BTreeMap for deterministic serialization order.
#[derive(Debug, Clone, PartialEq)]
pub struct PdfDict {
    entries: BTreeMap<PdfName, PdfValue>,
}

impl PdfDict {
    pub fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
        }
    }

    /// Set a key-value pair in the dictionary.
    pub fn set(&mut self, key: impl Into<PdfName>, value: PdfValue) {
        self.entries.insert(key.into(), value);
    }

    /// Get a value by name.
    pub fn get(&self, key: &str) -> Option<&PdfValue> {
        self.entries.get(&PdfName::new(key))
    }

    /// Get a name value.
    pub fn get_name(&self, key: &str) -> Option<&str> {
        match self.get(key) {
            Some(PdfValue::Name(n)) => Some(n.as_str()),
            _ => None,
        }
    }

    /// Get an indirect reference value.
    pub fn get_ref(&self, key: &str) -> Option<PdfRef> {
        match self.get(key) {
            Some(PdfValue::Ref(r)) => Some(*r),
            _ => None,
        }
    }

    /// Get an array value.
    pub fn get_array(&self, key: &str) -> Option<&[PdfValue]> {
        match self.get(key) {
            Some(PdfValue::Array(arr)) => Some(arr),
            _ => None,
        }
    }

    /// Get an integer value.
    pub fn get_integer(&self, key: &str) -> Option<i64> {
        match self.get(key) {
            Some(PdfValue::Integer(i)) => Some(*i),
            _ => None,
        }
    }

    /// Get a real (float) value.
    pub fn get_real(&self, key: &str) -> Option<f64> {
        match self.get(key) {
            Some(PdfValue::Real(r)) => Some(*r),
            // PDF spec: integers may be used where reals are expected
            Some(PdfValue::Integer(i)) => Some(*i as f64),
            _ => None,
        }
    }

    /// Get a boolean value.
    pub fn get_boolean(&self, key: &str) -> Option<bool> {
        match self.get(key) {
            Some(PdfValue::Boolean(b)) => Some(*b),
            _ => None,
        }
    }

    /// Get a string value (raw bytes).
    pub fn get_str(&self, key: &str) -> Option<&[u8]> {
        match self.get(key) {
            Some(PdfValue::Str(s)) => Some(s),
            _ => None,
        }
    }

    /// Get a dictionary value.
    pub fn get_dict(&self, key: &str) -> Option<&PdfDict> {
        match self.get(key) {
            Some(PdfValue::Dict(d)) => Some(d),
            _ => None,
        }
    }

    /// Remove a key from the dictionary.
    pub fn remove(&mut self, key: &str) -> Option<PdfValue> {
        self.entries.remove(&PdfName::new(key))
    }

    /// Returns true if the dictionary contains the given key.
    pub fn contains_key(&self, key: &str) -> bool {
        self.entries.contains_key(&PdfName::new(key))
    }

    /// Returns the number of entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns true if the dictionary is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Iterate over entries.
    pub fn iter(&self) -> impl Iterator<Item = (&PdfName, &PdfValue)> {
        self.entries.iter()
    }
}

impl Default for PdfDict {
    fn default() -> Self {
        Self::new()
    }
}

/// A PDF stream object: dictionary + raw byte data.
/// The `/Length` entry is auto-calculated during serialization.
/// The `/Filter` entry is set when compression is applied.
#[derive(Debug, Clone, PartialEq)]
pub struct PdfStream {
    pub dict: PdfDict,
    pub data: Vec<u8>,
}

impl PdfStream {
    /// Create a new stream with the given raw data.
    pub fn new(data: Vec<u8>) -> Self {
        Self {
            dict: PdfDict::new(),
            data,
        }
    }

    /// Create a new stream with data and additional dictionary entries.
    pub fn with_dict(data: Vec<u8>, dict: PdfDict) -> Self {
        Self { dict, data }
    }

    /// Returns the length of the stream data (before compression, if any).
    pub fn data_len(&self) -> usize {
        self.data.len()
    }
}

/// A PDF value — the fundamental sum type for all PDF objects.
#[derive(Debug, Clone, PartialEq)]
pub enum PdfValue {
    /// Boolean value: `true` or `false`.
    Boolean(bool),
    /// Integer value (up to ±2^63).
    Integer(i64),
    /// Real (floating-point) value.
    Real(f64),
    /// Byte string (literal or hex). Used for text strings, dates, etc.
    Str(Vec<u8>),
    /// Name object (e.g., `/Type`, `/Pages`).
    Name(PdfName),
    /// Array of PDF values.
    Array(Vec<PdfValue>),
    /// Dictionary of name-value pairs.
    Dict(PdfDict),
    /// Stream: dictionary + raw bytes.
    Stream(PdfStream),
    /// Indirect object reference.
    Ref(PdfRef),
    /// The null object.
    Null,
}

impl PdfValue {
    /// Convenience: create a Name value.
    pub fn name(n: impl Into<String>) -> Self {
        PdfValue::Name(PdfName::new(n))
    }

    /// Convenience: create a Ref value.
    pub fn reference(obj_num: u32, gen_num: u16) -> Self {
        PdfValue::Ref(PdfRef::new(obj_num, gen_num))
    }

    /// Convenience: create a String value from a UTF-8 str (PDFDocEncoding for ASCII).
    pub fn text_string(s: &str) -> Self {
        PdfValue::Str(s.as_bytes().to_vec())
    }

    /// Returns true if this value is Null.
    pub fn is_null(&self) -> bool {
        matches!(self, PdfValue::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pdf_ref_display() {
        let r = PdfRef::new(5, 0);
        assert_eq!(format!("{}", r), "5 0 R");
    }

    #[test]
    fn test_pdf_name() {
        let name = PdfName::new("Type");
        assert_eq!(name.as_str(), "Type");
        assert_eq!(format!("{}", name), "/Type");
    }

    #[test]
    fn test_pdf_name_from_str() {
        let name: PdfName = "Pages".into();
        assert_eq!(name.as_str(), "Pages");
    }

    #[test]
    fn test_pdf_dict_basic() {
        let mut dict = PdfDict::new();
        dict.set("Type", PdfValue::name("Catalog"));
        dict.set("Pages", PdfValue::reference(2, 0));

        assert_eq!(dict.get_name("Type"), Some("Catalog"));
        assert_eq!(dict.get_ref("Pages"), Some(PdfRef::new(2, 0)));
        assert_eq!(dict.len(), 2);
        assert!(!dict.is_empty());
    }

    #[test]
    fn test_pdf_dict_typed_accessors() {
        let mut dict = PdfDict::new();
        dict.set("Count", PdfValue::Integer(42));
        dict.set("Scale", PdfValue::Real(1.5));
        dict.set("Active", PdfValue::Boolean(true));
        dict.set("Title", PdfValue::Str(b"Hello".to_vec()));

        assert_eq!(dict.get_integer("Count"), Some(42));
        assert_eq!(dict.get_real("Scale"), Some(1.5));
        // Integer coerced to real
        assert_eq!(dict.get_real("Count"), Some(42.0));
        assert_eq!(dict.get_boolean("Active"), Some(true));
        assert_eq!(dict.get_str("Title"), Some(b"Hello".as_ref()));
    }

    #[test]
    fn test_pdf_dict_array() {
        let mut dict = PdfDict::new();
        dict.set(
            "Kids",
            PdfValue::Array(vec![PdfValue::reference(3, 0), PdfValue::reference(4, 0)]),
        );

        let kids = dict.get_array("Kids").unwrap();
        assert_eq!(kids.len(), 2);
        assert_eq!(kids[0], PdfValue::Ref(PdfRef::new(3, 0)));
    }

    #[test]
    fn test_pdf_dict_nested() {
        let mut inner = PdfDict::new();
        inner.set("Width", PdfValue::Integer(100));

        let mut outer = PdfDict::new();
        outer.set("Resources", PdfValue::Dict(inner));

        let res = outer.get_dict("Resources").unwrap();
        assert_eq!(res.get_integer("Width"), Some(100));
    }

    #[test]
    fn test_pdf_dict_remove() {
        let mut dict = PdfDict::new();
        dict.set("Key", PdfValue::Integer(1));
        assert!(dict.contains_key("Key"));
        dict.remove("Key");
        assert!(!dict.contains_key("Key"));
    }

    #[test]
    fn test_pdf_dict_missing_keys() {
        let dict = PdfDict::new();
        assert_eq!(dict.get_name("Missing"), None);
        assert_eq!(dict.get_ref("Missing"), None);
        assert_eq!(dict.get_array("Missing"), None);
        assert_eq!(dict.get_integer("Missing"), None);
        assert_eq!(dict.get_real("Missing"), None);
        assert_eq!(dict.get_boolean("Missing"), None);
        assert_eq!(dict.get_str("Missing"), None);
        assert_eq!(dict.get_dict("Missing"), None);
    }

    #[test]
    fn test_pdf_stream() {
        let data = b"Hello, PDF stream!".to_vec();
        let stream = PdfStream::new(data.clone());
        assert_eq!(stream.data_len(), 18);
        assert_eq!(stream.data, data);
        assert!(stream.dict.is_empty());
    }

    #[test]
    fn test_pdf_stream_with_dict() {
        let mut dict = PdfDict::new();
        dict.set("Filter", PdfValue::name("FlateDecode"));
        let stream = PdfStream::with_dict(vec![1, 2, 3], dict);
        assert_eq!(stream.dict.get_name("Filter"), Some("FlateDecode"));
        assert_eq!(stream.data_len(), 3);
    }

    #[test]
    fn test_pdf_value_variants() {
        assert!(PdfValue::Null.is_null());
        assert!(!PdfValue::Boolean(true).is_null());

        let name_val = PdfValue::name("Test");
        assert!(matches!(name_val, PdfValue::Name(n) if n.as_str() == "Test"));

        let ref_val = PdfValue::reference(10, 0);
        assert!(matches!(ref_val, PdfValue::Ref(r) if r.obj_num == 10 && r.gen_num == 0));

        let text_val = PdfValue::text_string("Hello");
        assert!(matches!(text_val, PdfValue::Str(s) if s == b"Hello"));
    }

    #[test]
    fn test_pdf_dict_deterministic_order() {
        let mut dict = PdfDict::new();
        dict.set("Zebra", PdfValue::Integer(1));
        dict.set("Alpha", PdfValue::Integer(2));
        dict.set("Middle", PdfValue::Integer(3));

        let keys: Vec<&str> = dict.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["Alpha", "Middle", "Zebra"]);
    }

    #[test]
    fn test_pdf_value_clone_eq() {
        let a = PdfValue::Array(vec![PdfValue::Integer(1), PdfValue::Real(2.0)]);
        let b = a.clone();
        assert_eq!(a, b);
    }
}
