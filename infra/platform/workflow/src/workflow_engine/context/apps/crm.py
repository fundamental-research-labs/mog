"""
CRMAPI - CRM app API for workflows.

This module provides the CRM API for managing sales-related data:
- Deals: Create, update, move through pipeline stages
- Contacts: Create, link to deals, enrich
- Companies: Create, manage company information
- Pipelines: Get pipeline information and metrics
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from workflow_engine.context.apps.client import AppClient


logger = logging.getLogger(__name__)


@dataclass
class Deal:
    """
    A CRM deal.

    Attributes:
        id: Unique deal identifier
        name: Deal name
        value: Deal value
        stage: Current pipeline stage
        owner: Deal owner info
        company: Associated company
        contacts: Associated contacts
        expected_close_date: Expected close date
        custom_fields: Custom field values
        created_at: Creation timestamp
        updated_at: Last update timestamp
    """

    id: str
    name: str
    value: float = 0.0
    stage: str = ""
    owner: Dict[str, Any] | None = None
    company: Dict[str, Any] | None = None
    contacts: List[Dict[str, Any]] = field(default_factory=list)
    expected_close_date: str | None = None
    custom_fields: Dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Deal":
        """Create Deal from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            value=data.get("value", 0.0),
            stage=data.get("stage", ""),
            owner=data.get("owner"),
            company=data.get("company"),
            contacts=data.get("contacts", []),
            expected_close_date=data.get("expected_close_date"),
            custom_fields=data.get("custom_fields", {}),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "value": self.value,
            "stage": self.stage,
            "owner": self.owner,
            "company": self.company,
            "contacts": self.contacts,
            "expected_close_date": self.expected_close_date,
            "custom_fields": self.custom_fields,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass
class Contact:
    """A CRM contact."""

    id: str
    name: str = ""
    email: str = ""
    phone: str = ""
    title: str = ""
    company_id: str | None = None
    company: Dict[str, Any] | None = None
    linkedin: str = ""
    enriched: bool = False
    custom_fields: Dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Contact":
        """Create Contact from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            email=data.get("email", ""),
            phone=data.get("phone", ""),
            title=data.get("title", ""),
            company_id=data.get("company_id"),
            company=data.get("company"),
            linkedin=data.get("linkedin", ""),
            enriched=data.get("enriched", False),
            custom_fields=data.get("custom_fields", {}),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


@dataclass
class Company:
    """A CRM company."""

    id: str
    name: str = ""
    domain: str = ""
    industry: str = ""
    size: str = ""
    segment: str = ""
    address: Dict[str, str] = field(default_factory=dict)
    custom_fields: Dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Company":
        """Create Company from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            domain=data.get("domain", ""),
            industry=data.get("industry", ""),
            size=data.get("size", ""),
            segment=data.get("segment", ""),
            address=data.get("address", {}),
            custom_fields=data.get("custom_fields", {}),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


@dataclass
class Pipeline:
    """A CRM pipeline."""

    id: str
    name: str
    stages: List[Dict[str, Any]] = field(default_factory=list)
    is_default: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Pipeline":
        """Create Pipeline from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            stages=data.get("stages", []),
            is_default=data.get("is_default", False),
        )


@dataclass
class PipelineMetrics:
    """Pipeline metrics."""

    total_value: float = 0.0
    total_deals: int = 0
    deals_by_stage: Dict[str, int] = field(default_factory=dict)
    value_by_stage: Dict[str, float] = field(default_factory=dict)
    average_deal_size: float = 0.0
    conversion_rate: float = 0.0


class CRMAPI:
    """
    CRM API for workflow access.

    Provides domain-specific operations for CRM functionality:
    - Deals: CRUD, stage management, assignments
    - Contacts: CRUD, linking, enrichment
    - Companies: CRUD, company information
    - Pipelines: Metrics, stage information

    Example:
        # Create a deal
        deal = ctx.apps.crm.create_deal(
            name="Acme Corp Deal",
            value=50000,
            stage="Qualification",
            owner="alice@company.com"
        )

        # Move deal to next stage
        deal = ctx.apps.crm.move_deal_to_stage(deal["id"], "Proposal")

        # Get deal with relations
        deal = ctx.apps.crm.get_deal(deal_id, include=["company", "contacts"])
    """

    def __init__(self, client: "AppClient") -> None:
        """
        Initialize the CRM API.

        Args:
            client: App client for gateway communication
        """
        self._client = client
        self._app = "crm"

    # =========================================================================
    # Deals
    # =========================================================================

    def create_deal(
        self,
        name: str,
        value: float = 0.0,
        stage: str | None = None,
        owner: str | None = None,
        pipeline: str | None = None,
        company: str | None = None,
        expected_close_date: date | str | None = None,
        custom_fields: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """
        Create a new deal.

        Args:
            name: Deal name
            value: Deal value in dollars
            stage: Stage name (human-readable, resolved to ID)
            owner: Owner email (resolved to user ID)
            pipeline: Pipeline name (resolved to ID)
            company: Company name or ID
            expected_close_date: Expected close date
            custom_fields: Custom field values

        Returns:
            Created deal data

        Example:
            deal = ctx.apps.crm.create_deal(
                name="Acme Enterprise",
                value=100000,
                stage="Qualification",
                owner="alice@company.com"
            )
        """
        logger.info(f"Creating CRM deal: {name}")

        payload: Dict[str, Any] = {"name": name, "value": value}

        if stage:
            payload["stage"] = stage
        if owner:
            payload["owner"] = owner
        if pipeline:
            payload["pipeline"] = pipeline
        if company:
            payload["company"] = company
        if expected_close_date:
            if isinstance(expected_close_date, date):
                payload["expected_close_date"] = expected_close_date.isoformat()
            else:
                payload["expected_close_date"] = expected_close_date
        if custom_fields:
            payload["custom_fields"] = custom_fields

        response = self._client.post(self._app, "/deals", json=payload)
        return response.data

    def get_deal(
        self,
        deal_id: str,
        include: List[str] | None = None,
    ) -> Dict[str, Any]:
        """
        Get a deal by ID.

        Args:
            deal_id: Deal ID
            include: Relations to include (company, contacts, owner)

        Returns:
            Deal data

        Example:
            deal = ctx.apps.crm.get_deal(deal_id, include=["company", "contacts"])
        """
        params = {}
        if include:
            params["include"] = ",".join(include)

        response = self._client.get(self._app, f"/deals/{deal_id}", params=params or None)
        return response.data

    def update_deal(
        self,
        deal_id: str,
        updates: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Update a deal.

        Args:
            deal_id: Deal ID
            updates: Fields to update

        Returns:
            Updated deal data

        Example:
            ctx.apps.crm.update_deal(deal_id, {"value": 75000})
        """
        logger.info(f"Updating CRM deal: {deal_id}")
        response = self._client.patch(self._app, f"/deals/{deal_id}", json=updates)
        return response.data

    def move_deal_to_stage(
        self,
        deal_id: str,
        stage: str,
    ) -> Dict[str, Any]:
        """
        Move a deal to a new pipeline stage.

        Args:
            deal_id: Deal ID
            stage: Stage name (human-readable)

        Returns:
            Updated deal data

        Example:
            deal = ctx.apps.crm.move_deal_to_stage(deal_id, "Won")
        """
        logger.info(f"Moving deal {deal_id} to stage: {stage}")
        response = self._client.post(
            self._app,
            f"/deals/{deal_id}/move",
            json={"stage": stage},
        )
        return response.data

    def assign_deal_owner(
        self,
        deal_id: str,
        owner_email: str,
    ) -> Dict[str, Any]:
        """
        Assign a deal to an owner.

        Args:
            deal_id: Deal ID
            owner_email: Email of the new owner

        Returns:
            Updated deal data

        Example:
            ctx.apps.crm.assign_deal_owner(deal_id, "bob@company.com")
        """
        logger.info(f"Assigning deal {deal_id} to: {owner_email}")
        response = self._client.post(
            self._app,
            f"/deals/{deal_id}/assign",
            json={"owner": owner_email},
        )
        return response.data

    def get_deals_in_stage(
        self,
        stage: str,
        pipeline: str | None = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Get all deals in a pipeline stage.

        Args:
            stage: Stage name
            pipeline: Optional pipeline name
            limit: Maximum deals to return

        Returns:
            List of deals
        """
        params: Dict[str, Any] = {"stage": stage, "limit": limit}
        if pipeline:
            params["pipeline"] = pipeline

        response = self._client.get(self._app, "/deals", params=params)
        return response.data.get("deals", [])

    def get_deals_closing_soon(
        self,
        days: int = 30,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Get deals expected to close soon.

        Args:
            days: Number of days to look ahead
            limit: Maximum deals to return

        Returns:
            List of deals
        """
        response = self._client.get(
            self._app,
            "/deals/closing-soon",
            params={"days": days, "limit": limit},
        )
        return response.data.get("deals", [])

    # =========================================================================
    # Contacts
    # =========================================================================

    def create_contact(
        self,
        name: str,
        email: str,
        phone: str = "",
        title: str = "",
        company: str | None = None,
        custom_fields: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """
        Create a new contact.

        Args:
            name: Contact name
            email: Contact email
            phone: Contact phone
            title: Job title
            company: Company name or ID
            custom_fields: Custom field values

        Returns:
            Created contact data
        """
        logger.info(f"Creating CRM contact: {name}")

        payload: Dict[str, Any] = {"name": name, "email": email}
        if phone:
            payload["phone"] = phone
        if title:
            payload["title"] = title
        if company:
            payload["company"] = company
        if custom_fields:
            payload["custom_fields"] = custom_fields

        response = self._client.post(self._app, "/contacts", json=payload)
        return response.data

    def get_contact(
        self,
        contact_id: str,
        include: List[str] | None = None,
    ) -> Dict[str, Any]:
        """
        Get a contact by ID.

        Args:
            contact_id: Contact ID
            include: Relations to include (company)

        Returns:
            Contact data
        """
        params = {}
        if include:
            params["include"] = ",".join(include)

        response = self._client.get(self._app, f"/contacts/{contact_id}", params=params or None)
        return response.data

    def link_contact_to_deal(
        self,
        contact_id: str,
        deal_id: str,
    ) -> None:
        """
        Link a contact to a deal.

        Args:
            contact_id: Contact ID
            deal_id: Deal ID
        """
        logger.info(f"Linking contact {contact_id} to deal {deal_id}")
        self._client.post(
            self._app,
            f"/contacts/{contact_id}/deals",
            json={"deal_id": deal_id},
        )

    def enrich_contact(
        self,
        contact_id: str,
    ) -> Dict[str, Any]:
        """
        Enrich a contact with external data (e.g., from Clearbit).

        Args:
            contact_id: Contact ID

        Returns:
            Enriched contact data
        """
        logger.info(f"Enriching contact: {contact_id}")
        response = self._client.post(self._app, f"/contacts/{contact_id}/enrich")
        return response.data

    def get_contacts_by_company(
        self,
        company_id: str,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Get all contacts for a company.

        Args:
            company_id: Company ID
            limit: Maximum contacts to return

        Returns:
            List of contacts
        """
        response = self._client.get(
            self._app,
            "/contacts",
            params={"company_id": company_id, "limit": limit},
        )
        return response.data.get("contacts", [])

    # =========================================================================
    # Companies
    # =========================================================================

    def create_company(
        self,
        name: str,
        domain: str = "",
        industry: str = "",
        size: str = "",
        segment: str = "",
        custom_fields: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """
        Create a new company.

        Args:
            name: Company name
            domain: Company domain
            industry: Industry
            size: Company size
            segment: Market segment
            custom_fields: Custom field values

        Returns:
            Created company data
        """
        logger.info(f"Creating CRM company: {name}")

        payload: Dict[str, Any] = {"name": name}
        if domain:
            payload["domain"] = domain
        if industry:
            payload["industry"] = industry
        if size:
            payload["size"] = size
        if segment:
            payload["segment"] = segment
        if custom_fields:
            payload["custom_fields"] = custom_fields

        response = self._client.post(self._app, "/companies", json=payload)
        return response.data

    def get_company(
        self,
        company_id: str,
    ) -> Dict[str, Any]:
        """
        Get a company by ID.

        Args:
            company_id: Company ID

        Returns:
            Company data
        """
        response = self._client.get(self._app, f"/companies/{company_id}")
        return response.data

    # =========================================================================
    # Pipelines
    # =========================================================================

    def get_pipeline(
        self,
        name: str,
    ) -> Dict[str, Any]:
        """
        Get a pipeline by name.

        Args:
            name: Pipeline name

        Returns:
            Pipeline data with stages
        """
        response = self._client.get(self._app, "/pipelines", params={"name": name})
        pipelines = response.data.get("pipelines", [])
        if pipelines:
            return pipelines[0]
        return {}

    def get_pipeline_metrics(
        self,
        pipeline_id: str,
    ) -> Dict[str, Any]:
        """
        Get metrics for a pipeline.

        Args:
            pipeline_id: Pipeline ID

        Returns:
            Pipeline metrics (total value, deals by stage, etc.)
        """
        response = self._client.get(self._app, f"/pipelines/{pipeline_id}/metrics")
        return response.data
