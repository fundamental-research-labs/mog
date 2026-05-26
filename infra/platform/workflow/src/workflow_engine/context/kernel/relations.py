"""
RelationsAPI - Relation traversal operations for workflows.

This module provides the RelationsAPI for working with relations:
- Get related records (follow a relation)
- Get backlinks (find records pointing to a record)
- Link/unlink records
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)


# Type aliases
RecordData = Dict[str, Any]


@dataclass
class RelationInfo:
    """
    Information about a relation.

    Attributes:
        source_table: Table containing the relation column
        source_column: Column name of the relation
        target_table: Table being referenced
        is_many_to_many: Whether this is a many-to-many relation
    """

    source_table: str
    source_column: str
    target_table: str
    is_many_to_many: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "source_table": self.source_table,
            "source_column": self.source_column,
            "target_table": self.target_table,
            "is_many_to_many": self.is_many_to_many,
        }


@dataclass
class Backlink:
    """
    A backlink - a record that references another record.

    Attributes:
        source_table: Table containing the referencing record
        source_column: Column containing the reference
        source_id: ID of the referencing record
        source_record: Optional full record data
    """

    source_table: str
    source_column: str
    source_id: str
    source_record: Optional[RecordData] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "source_table": self.source_table,
            "source_column": self.source_column,
            "source_id": self.source_id,
        }
        if self.source_record:
            result["source_record"] = self.source_record
        return result


class RelationsAPI:
    """
    API for relation traversal and linking.

    Provides access to relations between records. This is the
    kernel-level API for following links between tables.

    Example:
        # Get related records
        contacts = ctx.relations.get_related("deals", deal_id, "contact_ids")

        # Get backlinks (who references this record)
        referencing = ctx.relations.get_backlinks("contacts", contact_id)

        # Link records
        ctx.relations.link("deals", deal_id, "contact_ids", "contacts", contact_id)

        # Unlink records
        ctx.relations.unlink("deals", deal_id, "contact_ids", "contacts", contact_id)
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        """
        Initialize the Relations API.

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

        logger.debug(f"Relations API request: {method} {url}")

        response = client.request(method, url, **kwargs)
        response.raise_for_status()

        if response.status_code == 204:
            return None
        return response.json()

    def get_related(
        self,
        table: str,
        record_id: str,
        column: str,
        include_records: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> List[RecordData]:
        """
        Get records related to a record via a relation column.

        Args:
            table: Source table name or ID
            record_id: Source record ID
            column: Relation column name
            include_records: Whether to include full record data
            limit: Maximum records to return
            offset: Offset for pagination

        Returns:
            List of related records

        Example:
            # Get contacts linked to a deal
            contacts = ctx.relations.get_related("deals", deal_id, "contact_ids")
            for contact in contacts:
                print(f"- {contact['name']}: {contact['email']}")
        """
        params = {
            "include_records": include_records,
            "limit": limit,
            "offset": offset,
        }

        data = self._make_request(
            "GET",
            f"/tables/{table}/records/{record_id}/relations/{column}",
            params=params,
        )

        return data.get("records", [])

    def get_backlinks(
        self,
        table: str,
        record_id: str,
        source_table: Optional[str] = None,
        source_column: Optional[str] = None,
        include_records: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Backlink]:
        """
        Get records that reference this record (backlinks).

        Args:
            table: Target table name or ID
            record_id: Target record ID
            source_table: Optional - filter to specific source table
            source_column: Optional - filter to specific column
            include_records: Whether to include full record data
            limit: Maximum backlinks to return
            offset: Offset for pagination

        Returns:
            List of Backlink objects

        Example:
            # Find all records that reference this contact
            backlinks = ctx.relations.get_backlinks("contacts", contact_id)
            for link in backlinks:
                print(f"Referenced by {link.source_table}.{link.source_id}")

            # Find only deals that reference this contact
            deal_links = ctx.relations.get_backlinks(
                "contacts", contact_id,
                source_table="deals"
            )
        """
        params: Dict[str, Any] = {
            "include_records": include_records,
            "limit": limit,
            "offset": offset,
        }

        if source_table:
            params["source_table"] = source_table
        if source_column:
            params["source_column"] = source_column

        data = self._make_request(
            "GET",
            f"/tables/{table}/records/{record_id}/backlinks",
            params=params,
        )

        backlinks = []
        for item in data.get("backlinks", []):
            backlinks.append(Backlink(
                source_table=item["source_table"],
                source_column=item["source_column"],
                source_id=item["source_id"],
                source_record=item.get("source_record"),
            ))

        return backlinks

    def link(
        self,
        source_table: str,
        source_id: str,
        column: str,
        target_table: str,
        target_id: str,
    ) -> None:
        """
        Create a relation between two records.

        Args:
            source_table: Table containing the relation column
            source_id: ID of the source record
            column: Relation column name
            target_table: Table of the target record
            target_id: ID of the target record

        Example:
            # Link a contact to a deal
            ctx.relations.link(
                "deals", deal_id, "contact_ids",
                "contacts", contact_id
            )
        """
        logger.info(
            "Creating relation",
            extra={
                "source_table": source_table,
                "source_id": source_id,
                "column": column,
                "target_table": target_table,
                "target_id": target_id,
            }
        )

        self._make_request(
            "POST",
            f"/tables/{source_table}/records/{source_id}/relations/{column}",
            json={
                "target_table": target_table,
                "target_id": target_id,
            },
        )

    def unlink(
        self,
        source_table: str,
        source_id: str,
        column: str,
        target_table: str,
        target_id: str,
    ) -> bool:
        """
        Remove a relation between two records.

        Args:
            source_table: Table containing the relation column
            source_id: ID of the source record
            column: Relation column name
            target_table: Table of the target record
            target_id: ID of the target record

        Returns:
            True if relation was removed, False if not found

        Example:
            # Unlink a contact from a deal
            ctx.relations.unlink(
                "deals", deal_id, "contact_ids",
                "contacts", contact_id
            )
        """
        logger.info(
            "Removing relation",
            extra={
                "source_table": source_table,
                "source_id": source_id,
                "column": column,
                "target_table": target_table,
                "target_id": target_id,
            }
        )

        try:
            self._make_request(
                "DELETE",
                f"/tables/{source_table}/records/{source_id}/relations/{column}/{target_id}",
            )
            return True
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return False
            raise

    def get_relation_info(
        self,
        table: str,
        column: str,
    ) -> Optional[RelationInfo]:
        """
        Get information about a relation column.

        Args:
            table: Table containing the relation column
            column: Column name

        Returns:
            RelationInfo if found, None otherwise

        Example:
            info = ctx.relations.get_relation_info("deals", "contact_ids")
            if info:
                print(f"Links to: {info.target_table}")
        """
        try:
            data = self._make_request(
                "GET",
                f"/tables/{table}/relations/{column}",
            )

            return RelationInfo(
                source_table=data["source_table"],
                source_column=data["source_column"],
                target_table=data["target_table"],
                is_many_to_many=data.get("is_many_to_many", False),
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def batch_link(
        self,
        source_table: str,
        source_id: str,
        column: str,
        target_table: str,
        target_ids: List[str],
    ) -> int:
        """
        Create multiple relations at once.

        Args:
            source_table: Table containing the relation column
            source_id: ID of the source record
            column: Relation column name
            target_table: Table of the target records
            target_ids: List of target record IDs

        Returns:
            Number of relations created

        Example:
            # Link multiple contacts to a deal
            ctx.relations.batch_link(
                "deals", deal_id, "contact_ids",
                "contacts", [contact1_id, contact2_id, contact3_id]
            )
        """
        logger.info(
            "Batch creating relations",
            extra={
                "source_table": source_table,
                "source_id": source_id,
                "column": column,
                "target_table": target_table,
                "count": len(target_ids),
            }
        )

        result = self._make_request(
            "POST",
            f"/tables/{source_table}/records/{source_id}/relations/{column}/batch",
            json={
                "target_table": target_table,
                "target_ids": target_ids,
            },
        )

        return result.get("linked", 0)

    def batch_unlink(
        self,
        source_table: str,
        source_id: str,
        column: str,
        target_ids: List[str],
    ) -> int:
        """
        Remove multiple relations at once.

        Args:
            source_table: Table containing the relation column
            source_id: ID of the source record
            column: Relation column name
            target_ids: List of target record IDs to unlink

        Returns:
            Number of relations removed

        Example:
            # Unlink multiple contacts from a deal
            ctx.relations.batch_unlink(
                "deals", deal_id, "contact_ids",
                [contact1_id, contact2_id]
            )
        """
        logger.info(
            "Batch removing relations",
            extra={
                "source_table": source_table,
                "source_id": source_id,
                "column": column,
                "count": len(target_ids),
            }
        )

        result = self._make_request(
            "DELETE",
            f"/tables/{source_table}/records/{source_id}/relations/{column}/batch",
            json={"target_ids": target_ids},
        )

        return result.get("unlinked", 0)

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
