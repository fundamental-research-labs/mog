"""
RecordsAPI - Record CRUD operations for workflows.

This module provides the RecordsAPI for record-level operations:
- Get: Retrieve a record by ID
- List: Query records with filtering, pagination
- Create: Create new records
- Update: Update existing records
- Delete: Delete records
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Union

import httpx


logger = logging.getLogger(__name__)


# Type aliases
RecordData = Dict[str, Any]
FilterOperator = Literal["equals", "not_equals", "contains", "gt", "lt", "gte", "lte", "in", "not_in", "is_null", "is_not_null"]


@dataclass
class FilterCondition:
    """
    A single filter condition.

    Attributes:
        field: Field name to filter on
        operator: Comparison operator
        value: Value to compare against
    """

    field: str
    operator: FilterOperator = "equals"
    value: Any = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "field": self.field,
            "operator": self.operator,
            "value": self.value,
        }


@dataclass
class SortConfig:
    """
    Sort configuration.

    Attributes:
        field: Field name to sort by
        direction: Sort direction
    """

    field: str
    direction: Literal["asc", "desc"] = "asc"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "field": self.field,
            "direction": self.direction,
        }


@dataclass
class ListResult:
    """
    Result of a list query.

    Attributes:
        records: List of records
        total: Total count (may be approximate)
        has_more: Whether there are more records
        next_offset: Offset for next page
    """

    records: List[RecordData]
    total: int = 0
    has_more: bool = False
    next_offset: Optional[int] = None


class RecordsAPI:
    """
    API for record-level CRUD operations.

    Provides low-level access to records in tables. This is the
    kernel-level API - for domain operations use App APIs.

    Example:
        # Get a single record
        expense = ctx.records.get("expenses", record_id)

        # List with filters
        pending = ctx.records.list(
            "expenses",
            filter={"status": "pending"},
            limit=50
        )

        # Create a record
        new_expense = ctx.records.create("expenses", {
            "amount": 100,
            "description": "Office supplies"
        })

        # Update a record
        ctx.records.update("expenses", record_id, {"status": "approved"})

        # Delete a record
        ctx.records.delete("expenses", record_id)
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        """
        Initialize the Records API.

        Args:
            gateway_url: URL of the unified gateway
            http_client: Optional HTTP client (for testing/mocking)
        """
        self._gateway_url = gateway_url.rstrip("/")
        self._http_client = http_client

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
    ) -> Any:
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

        logger.debug(f"Records API request: {method} {url}")

        response = client.request(method, url, **kwargs)
        response.raise_for_status()

        if response.status_code == 204:
            return None
        return response.json()

    def get(self, table: str, record_id: str) -> Optional[RecordData]:
        """
        Get a record by ID.

        Args:
            table: Table name or ID
            record_id: Record ID

        Returns:
            Record data if found, None otherwise

        Example:
            expense = ctx.records.get("expenses", "exp_123")
            if expense:
                print(f"Amount: {expense['amount']}")
        """
        try:
            return self._make_request("GET", f"/tables/{table}/records/{record_id}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def list(
        self,
        table: str,
        filter: Optional[Union[Dict[str, Any], List[FilterCondition]]] = None,
        sort: Optional[Union[List[SortConfig], SortConfig]] = None,
        limit: int = 100,
        offset: int = 0,
        fields: Optional[List[str]] = None,
    ) -> ListResult:
        """
        List records with optional filtering and pagination.

        Args:
            table: Table name or ID
            filter: Filter conditions (dict for simple, list for complex)
            sort: Sort configuration
            limit: Maximum records to return
            offset: Offset for pagination
            fields: Optional list of fields to include

        Returns:
            ListResult with records and pagination info

        Example:
            # Simple filter
            pending = ctx.records.list("expenses", filter={"status": "pending"})

            # Complex filter
            high_value = ctx.records.list("expenses", filter=[
                FilterCondition("amount", "gte", 1000),
                FilterCondition("status", "equals", "pending"),
            ])

            # With sorting and pagination
            recent = ctx.records.list(
                "expenses",
                sort=SortConfig("created_at", "desc"),
                limit=10,
                offset=0
            )
        """
        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }

        # Build filter
        if filter:
            if isinstance(filter, list):
                # List of FilterCondition
                params["filter"] = [f.to_dict() for f in filter]
            elif isinstance(filter, dict):
                # Simple dict filter - convert to conditions
                conditions = []
                for key, value in filter.items():
                    if isinstance(value, dict) and "operator" in value:
                        conditions.append({
                            "field": key,
                            "operator": value["operator"],
                            "value": value.get("value"),
                        })
                    else:
                        conditions.append({
                            "field": key,
                            "operator": "equals",
                            "value": value,
                        })
                params["filter"] = conditions

        # Build sort
        if sort:
            if isinstance(sort, list):
                params["sort"] = [s.to_dict() for s in sort]
            else:
                params["sort"] = [sort.to_dict()]

        # Fields selection
        if fields:
            params["fields"] = fields

        data = self._make_request("GET", f"/tables/{table}/records", params=params)

        return ListResult(
            records=data.get("records", []),
            total=data.get("total", len(data.get("records", []))),
            has_more=data.get("has_more", False),
            next_offset=data.get("next_offset"),
        )

    def create(self, table: str, data: RecordData) -> RecordData:
        """
        Create a new record.

        Args:
            table: Table name or ID
            data: Record data

        Returns:
            Created record with generated ID

        Example:
            expense = ctx.records.create("expenses", {
                "amount": 100,
                "description": "Office supplies",
                "employee_id": "emp_123"
            })
            print(f"Created expense: {expense['id']}")
        """
        logger.info(
            "Creating record",
            extra={"table": table, "data_keys": list(data.keys())}
        )
        return self._make_request("POST", f"/tables/{table}/records", json=data)

    def update(
        self,
        table: str,
        record_id: str,
        data: RecordData,
        merge: bool = True,
    ) -> RecordData:
        """
        Update an existing record.

        Args:
            table: Table name or ID
            record_id: Record ID
            data: Fields to update
            merge: If True, merge with existing data. If False, replace.

        Returns:
            Updated record

        Example:
            ctx.records.update("expenses", "exp_123", {
                "status": "approved",
                "approved_at": ctx.now().isoformat()
            })
        """
        logger.info(
            "Updating record",
            extra={
                "table": table,
                "record_id": record_id,
                "data_keys": list(data.keys()),
                "merge": merge,
            }
        )

        method = "PATCH" if merge else "PUT"
        return self._make_request(method, f"/tables/{table}/records/{record_id}", json=data)

    def delete(self, table: str, record_id: str) -> bool:
        """
        Delete a record.

        Args:
            table: Table name or ID
            record_id: Record ID

        Returns:
            True if deleted, False if not found

        Example:
            if ctx.records.delete("expenses", "exp_123"):
                print("Expense deleted")
        """
        logger.info(
            "Deleting record",
            extra={"table": table, "record_id": record_id}
        )

        try:
            self._make_request("DELETE", f"/tables/{table}/records/{record_id}")
            return True
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return False
            raise

    def batch_create(
        self,
        table: str,
        records: List[RecordData],
    ) -> List[RecordData]:
        """
        Create multiple records in a batch.

        Args:
            table: Table name or ID
            records: List of record data

        Returns:
            List of created records

        Example:
            new_records = ctx.records.batch_create("expenses", [
                {"amount": 100, "description": "Expense 1"},
                {"amount": 200, "description": "Expense 2"},
            ])
        """
        logger.info(
            "Batch creating records",
            extra={"table": table, "count": len(records)}
        )
        return self._make_request("POST", f"/tables/{table}/records/batch", json={"records": records})

    def batch_update(
        self,
        table: str,
        updates: List[Dict[str, Any]],
    ) -> List[RecordData]:
        """
        Update multiple records in a batch.

        Args:
            table: Table name or ID
            updates: List of {"id": record_id, "data": {...}}

        Returns:
            List of updated records

        Example:
            ctx.records.batch_update("expenses", [
                {"id": "exp_1", "data": {"status": "approved"}},
                {"id": "exp_2", "data": {"status": "approved"}},
            ])
        """
        logger.info(
            "Batch updating records",
            extra={"table": table, "count": len(updates)}
        )
        return self._make_request("PATCH", f"/tables/{table}/records/batch", json={"updates": updates})

    def batch_delete(
        self,
        table: str,
        record_ids: List[str],
    ) -> int:
        """
        Delete multiple records in a batch.

        Args:
            table: Table name or ID
            record_ids: List of record IDs to delete

        Returns:
            Number of records deleted

        Example:
            deleted = ctx.records.batch_delete("expenses", ["exp_1", "exp_2"])
            print(f"Deleted {deleted} records")
        """
        logger.info(
            "Batch deleting records",
            extra={"table": table, "count": len(record_ids)}
        )
        result = self._make_request("DELETE", f"/tables/{table}/records/batch", json={"ids": record_ids})
        return result.get("deleted", 0)

    def count(
        self,
        table: str,
        filter: Optional[Dict[str, Any]] = None,
    ) -> int:
        """
        Count records in a table.

        Args:
            table: Table name or ID
            filter: Optional filter conditions

        Returns:
            Number of matching records

        Example:
            pending_count = ctx.records.count("expenses", {"status": "pending"})
        """
        params = {}
        if filter:
            conditions = []
            for key, value in filter.items():
                if isinstance(value, dict) and "operator" in value:
                    conditions.append({
                        "field": key,
                        "operator": value["operator"],
                        "value": value.get("value"),
                    })
                else:
                    conditions.append({
                        "field": key,
                        "operator": "equals",
                        "value": value,
                    })
            params["filter"] = conditions

        result = self._make_request("GET", f"/tables/{table}/records/count", params=params)
        return result.get("count", 0)

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
