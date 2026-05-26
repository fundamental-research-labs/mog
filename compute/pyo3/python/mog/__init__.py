"""Mog spreadsheet engine -- Python SDK.

A thin Pythonic wrapper over the Rust compute engine, providing ergonomic
access to cells, formulas, formatting, tables, charts, and more.

Quick start::

    import mog

    wb = mog.create_workbook()
    ws = wb.active_sheet

    ws.set_cell("A1", 42)
    ws.set_cell("A2", "=A1*2")
    wb.calculate()

    assert ws.get_value("A1") == 42
    assert ws.get_value("A2") == 84

    with wb.batch():
        ws.set_cell("B1", "hello")
        ws.set_cell("B2", True)

    wb.history.undo()  # reverts both B1 and B2 at once
"""
from __future__ import annotations

from typing import List, Optional

from mog.errors import AddressError, ComputeError, MogError
from mog.sub_apis.security import AccessLevel, Principal, Target, Template
from mog.types import CellError, CellInfo, CellValue, DataBounds, MutationResult
from mog.workbook import Workbook
from mog.worksheet import Worksheet


def create_workbook(principal: Optional[List[str]] = None) -> Workbook:
    """Create a new empty workbook with one blank sheet (``Sheet1``).

    Parameters
    ----------
    principal:
        Optional list of tag strings for the session's active principal.
        When provided, the principal is interned through the Rust pool
        and set as the session's active principal before the workbook is
        returned. Omit to leave the principal unset (same semantics as
        pre-R5 workbooks — the document decides whether enforcement is
        on, and ``None`` only blocks when the document already has
        policies).
    """
    wb = Workbook.create()
    if principal is not None:
        wb.set_active_principal(principal)
    return wb


def open_workbook(path: str, principal: Optional[List[str]] = None) -> Workbook:
    """Open a workbook from an XLSX file.

    Parameters
    ----------
    path : str
        Path to the ``.xlsx`` file on disk.
    principal:
        Optional list of tag strings for the session's active principal.

    Returns
    -------
    Workbook
        A workbook populated with the data from the XLSX file.
    """
    wb = Workbook.from_xlsx(path)
    if principal is not None:
        wb.set_active_principal(principal)
    return wb


__all__ = [
    # Factory functions
    "create_workbook",
    "open_workbook",
    # Core classes
    "Workbook",
    "Worksheet",
    # Types
    "CellValue",
    "CellError",
    "CellInfo",
    "DataBounds",
    "MutationResult",
    # Security types (R5.3)
    "AccessLevel",
    "Principal",
    "Target",
    "Template",
    # Errors
    "MogError",
    "ComputeError",
    "AddressError",
]
