"""
TablesAPI - Table operations for workflows.

This module provides the TablesAPI for table-level operations:
- Finding tables by name
- Listing all tables
- Getting table metadata and schema
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    pass


logger = logging.getLogger(__name__)


@dataclass
class TableSchema:
    """
    Schema definition for a table.

    Attributes:
        columns: List of column definitions
        primary_key: Name of the primary key column
        indexes: List of indexed columns
    """

    columns: List[Dict[str, Any]] = field(default_factory=list)
    primary_key: str = "id"
    indexes: List[str] = field(default_factory=list)


@dataclass
class TableInfo:
    """
    Information about a table.

    Attributes:
        id: Unique table identifier
        name: Human-readable table name
        schema: Table schema definition
        record_count: Approximate number of records
        created_at: When the table was created
        updated_at: When the table was last modified
    """

    id: str
    name: str
    schema: Optional[TableSchema] = None
    record_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TableInfo":
        """Create TableInfo from dictionary."""
        schema = None
        if "schema" in data:
            schema = TableSchema(
                columns=data["schema"].get("columns", []),
                primary_key=data["schema"].get("primary_key", "id"),
                indexes=data["schema"].get("indexes", []),
            )
        return cls(
            id=data["id"],
            name=data["name"],
            schema=schema,
            record_count=data.get("record_count", 0),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "id": self.id,
            "name": self.name,
            "record_count": self.record_count,
        }
        if self.schema:
            result["schema"] = {
                "columns": self.schema.columns,
                "primary_key": self.schema.primary_key,
                "indexes": self.schema.indexes,
            }
        if self.created_at:
            result["created_at"] = self.created_at
        if self.updated_at:
            result["updated_at"] = self.updated_at
        return result


class TablesAPI:
    """
    API for table-level operations.

    Provides access to table metadata and schema information.
    This is a low-level API - for domain operations use App APIs.

    Example:
        # Find a specific table
        table = ctx.tables.find_by_name("Expenses")
        if table:
            print(f"Table {table.name} has {table.record_count} records")

        # List all tables
        for table in ctx.tables.list():
            print(f"- {table.name}")
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        """
        Initialize the Tables API.

        Args:
            gateway_url: URL of the unified gateway
            http_client: Optional HTTP client (for testing/mocking)
        """
        self._gateway_url = gateway_url.rstrip("/")
        self._http_client = http_client
        self._cache: Dict[str, TableInfo] = {}

    def _get_client(self) -> httpx.Client:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.Client(timeout=30.0)
        return self._http_client

    def _make_request(
        self,
        method: str,
        endpoint: str,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """
        Make a request to the gateway.

        Args:
            method: HTTP method
            endpoint: API endpoint
            **kwargs: Additional arguments for httpx

        Returns:
            Response JSON data

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        client = self._get_client()
        url = f"{self._gateway_url}/api/data{endpoint}"

        logger.debug(f"Tables API request: {method} {url}")

        response = client.request(method, url, **kwargs)
        response.raise_for_status()
        return response.json()

    def find_by_name(self, name: str, use_cache: bool = True) -> Optional[TableInfo]:
        """
        Find a table by its name.

        Args:
            name: The table name to search for
            use_cache: Whether to use cached results

        Returns:
            TableInfo if found, None otherwise

        Example:
            table = ctx.tables.find_by_name("Expenses")
            if table:
                print(f"Found table: {table.id}")
        """
        # Check cache first
        if use_cache and name in self._cache:
            return self._cache[name]

        try:
            data = self._make_request("GET", f"/tables/by-name/{name}")
            table_info = TableInfo.from_dict(data)
            self._cache[name] = table_info
            return table_info
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def find_by_id(self, table_id: str) -> Optional[TableInfo]:
        """
        Find a table by its ID.

        Args:
            table_id: The table ID

        Returns:
            TableInfo if found, None otherwise
        """
        try:
            data = self._make_request("GET", f"/tables/{table_id}")
            table_info = TableInfo.from_dict(data)
            self._cache[table_info.name] = table_info
            return table_info
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def list(self) -> List[TableInfo]:
        """
        List all tables.

        Returns:
            List of TableInfo for all tables

        Example:
            tables = ctx.tables.list()
            for table in tables:
                print(f"- {table.name}: {table.record_count} records")
        """
        data = self._make_request("GET", "/tables")
        tables = [TableInfo.from_dict(t) for t in data.get("tables", [])]

        # Update cache
        for table in tables:
            self._cache[table.name] = table

        return tables

    def get_schema(self, table: str) -> Optional[TableSchema]:
        """
        Get the schema for a table.

        Args:
            table: Table name or ID

        Returns:
            TableSchema if found, None otherwise

        Example:
            schema = ctx.tables.get_schema("Expenses")
            if schema:
                for col in schema.columns:
                    print(f"- {col['name']}: {col['type']}")
        """
        # Try to find by name first
        table_info = self.find_by_name(table)
        if table_info is None:
            # Try by ID
            table_info = self.find_by_id(table)

        if table_info:
            return table_info.schema
        return None

    def exists(self, table: str) -> bool:
        """
        Check if a table exists.

        Args:
            table: Table name or ID

        Returns:
            True if table exists, False otherwise
        """
        return self.find_by_name(table) is not None or self.find_by_id(table) is not None

    def clear_cache(self) -> None:
        """Clear the table cache."""
        self._cache.clear()

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
