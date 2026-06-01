"""Source-only import smoke for environments that have not built mog._native."""
from __future__ import annotations


def test_source_imports_without_native_extension() -> None:
    import mog
    from mog.errors import UnsupportedApiError

    assert mog.Workbook is not None
    assert mog.Worksheet is not None
    assert issubclass(UnsupportedApiError, mog.MogError)
