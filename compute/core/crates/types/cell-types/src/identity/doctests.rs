use super::base_ids::{CellId, SheetId};

// Doc-tests for identity types.
// Added as separate impl blocks because doc-tests in macro-generated code
// do not run as doc-tests. These thin wrappers carry runnable examples.

impl CellId {
    /// Create a [`CellId`] from raw u128 bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::CellId;
    ///
    /// let id = CellId::from_raw(42);
    /// assert_eq!(id.as_u128(), 42);
    /// ```
    #[doc(hidden)]
    pub fn _doctest_from_raw() {}

    /// Parse a [`CellId`] from a UUID string at the IPC boundary.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::CellId;
    ///
    /// let id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    /// assert_eq!(id.to_uuid_string(), "550e8400e29b41d4a716446655440000");
    ///
    /// assert!(CellId::from_uuid_str("not-a-uuid").is_err());
    /// ```
    #[doc(hidden)]
    pub fn _doctest_from_uuid_str() {}

    /// Convert a [`CellId`] back to a UUID string (simple format, no dashes).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::CellId;
    ///
    /// let id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    /// let s = id.to_uuid_string();
    /// assert_eq!(s, "550e8400e29b41d4a716446655440000");
    /// ```
    #[doc(hidden)]
    pub fn _doctest_to_uuid_string() {}
}

impl SheetId {
    /// Create and compare [`SheetId`] values.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetId;
    ///
    /// let s1 = SheetId::from_raw(1);
    /// let s2 = SheetId::from_raw(2);
    /// assert_ne!(s1, s2);
    /// assert_eq!(s1, SheetId::from_raw(1));
    /// ```
    #[doc(hidden)]
    pub fn _doctest_sheet_id() {}
}
