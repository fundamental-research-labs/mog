"""
SpreadsheetAPI - Spreadsheet app API for workflows.

This module provides the Spreadsheet API for spreadsheet operations:
- Cells: Get, set, clear cells and ranges
- Rows: Append, insert, delete rows
- Formulas: Set formulas, evaluate
- Sheets: Create, duplicate, delete sheets
- Charts: Create and update charts
- Data operations: Filter, sort, pivot tables
- Import/Export: CSV, PDF
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union, TYPE_CHECKING

if TYPE_CHECKING:
    from workflow_engine.context.apps.client import AppClient


logger = logging.getLogger(__name__)


# Type alias for cell values
CellValue = Union[str, int, float, bool, None]


@dataclass
class Sheet:
    """A spreadsheet sheet."""

    id: str
    name: str
    row_count: int = 0
    column_count: int = 0
    frozen_rows: int = 0
    frozen_columns: int = 0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Sheet":
        """Create Sheet from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            row_count=data.get("row_count", 0),
            column_count=data.get("column_count", 0),
            frozen_rows=data.get("frozen_rows", 0),
            frozen_columns=data.get("frozen_columns", 0),
        )


@dataclass
class Chart:
    """A spreadsheet chart."""

    id: str
    sheet: str
    type: str = "bar"
    title: str = ""
    data_range: str = ""
    position: Dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Chart":
        """Create Chart from dictionary."""
        return cls(
            id=data["id"],
            sheet=data.get("sheet", ""),
            type=data.get("type", "bar"),
            title=data.get("title", ""),
            data_range=data.get("data_range", ""),
            position=data.get("position", {}),
        )


@dataclass
class ChartConfig:
    """Configuration for creating a chart."""

    type: str  # bar, line, pie, scatter, etc.
    data_range: str
    title: str = ""
    x_axis: str = ""
    y_axis: str = ""
    position: Dict[str, int] | None = None
    options: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "type": self.type,
            "data_range": self.data_range,
        }
        if self.title:
            result["title"] = self.title
        if self.x_axis:
            result["x_axis"] = self.x_axis
        if self.y_axis:
            result["y_axis"] = self.y_axis
        if self.position:
            result["position"] = self.position
        if self.options:
            result["options"] = self.options
        return result


@dataclass
class FilterConfig:
    """Configuration for filtering."""

    column: str
    condition: str  # equals, contains, greater_than, etc.
    value: Any

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "column": self.column,
            "condition": self.condition,
            "value": self.value,
        }


@dataclass
class SortConfig:
    """Configuration for sorting."""

    column: str
    direction: str = "asc"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {"column": self.column, "direction": self.direction}


class SpreadsheetAPI:
    """
    Spreadsheet API for workflow access.

    Provides domain-specific operations for spreadsheet functionality:
    - Cell operations: Get, set, clear
    - Row operations: Append, insert, delete
    - Formulas: Set, evaluate
    - Sheets: Create, manage
    - Charts: Create, update
    - Data operations: Filter, sort, pivot

    Example:
        # Set a cell value
        ctx.apps.spreadsheet.set_cell("Sheet1", "A1", "Hello")

        # Append a row
        row_num = ctx.apps.spreadsheet.append_row("Log", [date, value, status])

        # Get a range
        data = ctx.apps.spreadsheet.get_range("Data", "A1:D100")
    """

    def __init__(self, client: "AppClient") -> None:
        """
        Initialize the Spreadsheet API.

        Args:
            client: App client for gateway communication
        """
        self._client = client
        self._app = "spreadsheet"

    # =========================================================================
    # Cell Operations
    # =========================================================================

    def get_cell(
        self,
        sheet: str,
        cell: str,
    ) -> CellValue:
        """
        Get the value of a cell.

        Args:
            sheet: Sheet name
            cell: Cell reference (e.g., "A1")

        Returns:
            Cell value

        Example:
            value = ctx.apps.spreadsheet.get_cell("Sheet1", "A1")
        """
        response = self._client.get(
            self._app,
            f"/sheets/{sheet}/cells/{cell}",
        )
        return response.data.get("value")

    def set_cell(
        self,
        sheet: str,
        cell: str,
        value: CellValue,
    ) -> None:
        """
        Set the value of a cell.

        Args:
            sheet: Sheet name
            cell: Cell reference (e.g., "A1")
            value: Value to set

        Example:
            ctx.apps.spreadsheet.set_cell("Sheet1", "A1", "Hello World")
            ctx.apps.spreadsheet.set_cell("Sheet1", "B1", 42)
        """
        self._client.put(
            self._app,
            f"/sheets/{sheet}/cells/{cell}",
            json={"value": value},
        )

    def get_range(
        self,
        sheet: str,
        range_ref: str,
    ) -> List[List[CellValue]]:
        """
        Get values from a range of cells.

        Args:
            sheet: Sheet name
            range_ref: Range reference (e.g., "A1:D10")

        Returns:
            2D list of cell values

        Example:
            data = ctx.apps.spreadsheet.get_range("Data", "A1:D100")
            for row in data:
                print(row)
        """
        response = self._client.get(
            self._app,
            f"/sheets/{sheet}/ranges/{range_ref}",
        )
        return response.data.get("values", [])

    def set_range(
        self,
        sheet: str,
        range_ref: str,
        values: List[List[CellValue]],
    ) -> None:
        """
        Set values in a range of cells.

        Args:
            sheet: Sheet name
            range_ref: Range reference (e.g., "A1:D10")
            values: 2D list of values

        Example:
            ctx.apps.spreadsheet.set_range("Sheet1", "A1:C3", [
                ["Name", "Age", "City"],
                ["Alice", 30, "NYC"],
                ["Bob", 25, "LA"]
            ])
        """
        self._client.put(
            self._app,
            f"/sheets/{sheet}/ranges/{range_ref}",
            json={"values": values},
        )

    def clear_range(
        self,
        sheet: str,
        range_ref: str,
    ) -> None:
        """
        Clear values in a range of cells.

        Args:
            sheet: Sheet name
            range_ref: Range reference (e.g., "A1:D10")
        """
        self._client.delete(
            self._app,
            f"/sheets/{sheet}/ranges/{range_ref}",
        )

    # =========================================================================
    # Row Operations
    # =========================================================================

    def append_row(
        self,
        sheet: str,
        values: List[CellValue],
    ) -> int:
        """
        Append a row to the sheet.

        Args:
            sheet: Sheet name
            values: Row values

        Returns:
            Row number of the appended row

        Example:
            row_num = ctx.apps.spreadsheet.append_row("Log", [
                ctx.now().isoformat(),
                "User action",
                "Success"
            ])
        """
        response = self._client.post(
            self._app,
            f"/sheets/{sheet}/rows",
            json={"values": values},
        )
        return response.data.get("row_number", 0)

    def insert_rows(
        self,
        sheet: str,
        after_row: int,
        count: int = 1,
    ) -> None:
        """
        Insert rows after a specific row.

        Args:
            sheet: Sheet name
            after_row: Row number to insert after (0 for beginning)
            count: Number of rows to insert
        """
        self._client.post(
            self._app,
            f"/sheets/{sheet}/rows/insert",
            json={"after_row": after_row, "count": count},
        )

    def delete_rows(
        self,
        sheet: str,
        start_row: int,
        count: int = 1,
    ) -> None:
        """
        Delete rows from the sheet.

        Args:
            sheet: Sheet name
            start_row: First row to delete
            count: Number of rows to delete
        """
        self._client.post(
            self._app,
            f"/sheets/{sheet}/rows/delete",
            json={"start_row": start_row, "count": count},
        )

    # =========================================================================
    # Formulas
    # =========================================================================

    def set_formula(
        self,
        sheet: str,
        cell: str,
        formula: str,
    ) -> None:
        """
        Set a formula in a cell.

        Args:
            sheet: Sheet name
            cell: Cell reference
            formula: Formula string (with or without leading =)

        Example:
            ctx.apps.spreadsheet.set_formula("Sheet1", "C1", "=A1+B1")
            ctx.apps.spreadsheet.set_formula("Sheet1", "D1", "=SUM(A1:C1)")
        """
        # Ensure formula starts with =
        if not formula.startswith("="):
            formula = "=" + formula

        self._client.put(
            self._app,
            f"/sheets/{sheet}/cells/{cell}",
            json={"formula": formula},
        )

    def evaluate_formula(
        self,
        formula: str,
        context: Dict[str, Any] | None = None,
    ) -> CellValue:
        """
        Evaluate a formula and return the result.

        Args:
            formula: Formula to evaluate
            context: Optional context (sheet, cell references)

        Returns:
            Evaluated result

        Example:
            result = ctx.apps.spreadsheet.evaluate_formula("=1+2+3")
        """
        response = self._client.post(
            self._app,
            "/formulas/evaluate",
            json={"formula": formula, "context": context or {}},
        )
        return response.data.get("result")

    # =========================================================================
    # Sheets
    # =========================================================================

    def create_sheet(
        self,
        name: str,
        rows: int = 1000,
        columns: int = 26,
    ) -> Dict[str, Any]:
        """
        Create a new sheet.

        Args:
            name: Sheet name
            rows: Initial row count
            columns: Initial column count

        Returns:
            Sheet data
        """
        logger.info(f"Creating sheet: {name}")
        response = self._client.post(
            self._app,
            "/sheets",
            json={"name": name, "rows": rows, "columns": columns},
        )
        return response.data

    def get_sheet(
        self,
        name: str,
    ) -> Dict[str, Any]:
        """
        Get sheet information.

        Args:
            name: Sheet name

        Returns:
            Sheet data
        """
        response = self._client.get(self._app, f"/sheets/{name}")
        return response.data

    def duplicate_sheet(
        self,
        sheet_name: str,
        new_name: str,
    ) -> Dict[str, Any]:
        """
        Duplicate a sheet.

        Args:
            sheet_name: Source sheet name
            new_name: New sheet name

        Returns:
            New sheet data
        """
        logger.info(f"Duplicating sheet {sheet_name} to {new_name}")
        response = self._client.post(
            self._app,
            f"/sheets/{sheet_name}/duplicate",
            json={"new_name": new_name},
        )
        return response.data

    def delete_sheet(
        self,
        sheet_name: str,
    ) -> None:
        """
        Delete a sheet.

        Args:
            sheet_name: Sheet name to delete
        """
        logger.info(f"Deleting sheet: {sheet_name}")
        self._client.delete(self._app, f"/sheets/{sheet_name}")

    # =========================================================================
    # Charts
    # =========================================================================

    def create_chart(
        self,
        sheet: str,
        config: ChartConfig | Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Create a chart.

        Args:
            sheet: Sheet name
            config: Chart configuration

        Returns:
            Chart data
        """
        logger.info(f"Creating chart in sheet: {sheet}")

        if isinstance(config, ChartConfig):
            config_dict = config.to_dict()
        else:
            config_dict = config

        response = self._client.post(
            self._app,
            f"/sheets/{sheet}/charts",
            json=config_dict,
        )
        return response.data

    def update_chart(
        self,
        chart_id: str,
        config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Update a chart.

        Args:
            chart_id: Chart ID
            config: Partial chart configuration

        Returns:
            Updated chart data
        """
        response = self._client.patch(
            self._app,
            f"/charts/{chart_id}",
            json=config,
        )
        return response.data

    # =========================================================================
    # Data Operations
    # =========================================================================

    def apply_filter(
        self,
        sheet: str,
        range_ref: str,
        filters: List[FilterConfig | Dict[str, Any]],
    ) -> None:
        """
        Apply filters to a range.

        Args:
            sheet: Sheet name
            range_ref: Range to filter
            filters: Filter configurations
        """
        filter_dicts = [
            f.to_dict() if isinstance(f, FilterConfig) else f
            for f in filters
        ]

        self._client.post(
            self._app,
            f"/sheets/{sheet}/filter",
            json={"range": range_ref, "filters": filter_dicts},
        )

    def clear_filter(
        self,
        sheet: str,
    ) -> None:
        """
        Clear all filters from a sheet.

        Args:
            sheet: Sheet name
        """
        self._client.delete(self._app, f"/sheets/{sheet}/filter")

    def sort_range(
        self,
        sheet: str,
        range_ref: str,
        sort_by: List[SortConfig | Dict[str, Any]],
    ) -> None:
        """
        Sort a range.

        Args:
            sheet: Sheet name
            range_ref: Range to sort
            sort_by: Sort configurations
        """
        sort_dicts = [
            s.to_dict() if isinstance(s, SortConfig) else s
            for s in sort_by
        ]

        self._client.post(
            self._app,
            f"/sheets/{sheet}/sort",
            json={"range": range_ref, "sort_by": sort_dicts},
        )

    def create_pivot_table(
        self,
        source_range: str,
        config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Create a pivot table.

        Args:
            source_range: Source data range (e.g., "Sheet1!A1:D100")
            config: Pivot table configuration (rows, columns, values, filters)

        Returns:
            Pivot table data
        """
        logger.info(f"Creating pivot table from: {source_range}")

        response = self._client.post(
            self._app,
            "/pivot-tables",
            json={"source_range": source_range, **config},
        )
        return response.data

    # =========================================================================
    # Import/Export
    # =========================================================================

    def import_csv(
        self,
        sheet: str,
        csv: str,
        options: Dict[str, Any] | None = None,
    ) -> None:
        """
        Import data from CSV.

        Args:
            sheet: Target sheet name
            csv: CSV content
            options: Import options (delimiter, has_headers, etc.)
        """
        logger.info(f"Importing CSV to sheet: {sheet}")

        self._client.post(
            self._app,
            f"/sheets/{sheet}/import/csv",
            json={"csv": csv, "options": options or {}},
        )

    def export_to_csv(
        self,
        sheet: str,
        range_ref: str | None = None,
    ) -> str:
        """
        Export sheet or range to CSV.

        Args:
            sheet: Sheet name
            range_ref: Optional range to export

        Returns:
            CSV content
        """
        params = {}
        if range_ref:
            params["range"] = range_ref

        response = self._client.get(
            self._app,
            f"/sheets/{sheet}/export/csv",
            params=params or None,
        )
        return response.data.get("csv", "")

    def export_to_pdf(
        self,
        sheets: List[str] | None = None,
    ) -> bytes:
        """
        Export sheets to PDF.

        Args:
            sheets: Optional list of sheet names (all if not specified)

        Returns:
            PDF content as bytes
        """
        response = self._client.post(
            self._app,
            "/export/pdf",
            json={"sheets": sheets} if sheets else None,
        )
        # Note: In real implementation, this would return binary PDF data
        return response.data.get("pdf_base64", "").encode()
