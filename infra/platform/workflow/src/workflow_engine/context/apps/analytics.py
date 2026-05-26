"""
AnalyticsAPI - Analytics app API for workflows.

This module provides the Analytics API for tracking and reporting:
- Events: Track user events and conversions
- Metrics: Query metrics and aggregations
- Funnels: Analyze conversion funnels
- Cohorts: Define and analyze user cohorts
- Dashboards: Get dashboard data
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from workflow_engine.context.apps.client import AppClient


logger = logging.getLogger(__name__)


@dataclass
class MetricResult:
    """Result of a metric query."""

    name: str
    value: float
    unit: str = ""
    change: float | None = None
    change_percent: float | None = None
    breakdown: Dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MetricResult":
        """Create MetricResult from dictionary."""
        return cls(
            name=data.get("name", ""),
            value=data.get("value", 0.0),
            unit=data.get("unit", ""),
            change=data.get("change"),
            change_percent=data.get("change_percent"),
            breakdown=data.get("breakdown", {}),
        )


@dataclass
class FunnelStep:
    """A step in a conversion funnel."""

    name: str
    event: str
    users: int = 0
    conversion_rate: float = 0.0
    drop_off_rate: float = 0.0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FunnelStep":
        """Create FunnelStep from dictionary."""
        return cls(
            name=data.get("name", ""),
            event=data.get("event", ""),
            users=data.get("users", 0),
            conversion_rate=data.get("conversion_rate", 0.0),
            drop_off_rate=data.get("drop_off_rate", 0.0),
        )


@dataclass
class FunnelResult:
    """Result of a funnel analysis."""

    name: str
    steps: List[FunnelStep]
    total_conversion: float = 0.0
    total_users: int = 0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FunnelResult":
        """Create FunnelResult from dictionary."""
        return cls(
            name=data.get("name", ""),
            steps=[FunnelStep.from_dict(s) for s in data.get("steps", [])],
            total_conversion=data.get("total_conversion", 0.0),
            total_users=data.get("total_users", 0),
        )


@dataclass
class Cohort:
    """A user cohort."""

    id: str
    name: str
    description: str = ""
    user_count: int = 0
    criteria: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Cohort":
        """Create Cohort from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            description=data.get("description", ""),
            user_count=data.get("user_count", 0),
            criteria=data.get("criteria", {}),
        )


class AnalyticsAPI:
    """
    Analytics API for workflow access.

    Provides domain-specific operations for analytics functionality:
    - Event tracking: Track user events and properties
    - Metrics: Query metrics with aggregations
    - Funnels: Analyze conversion paths
    - Cohorts: Define and analyze user groups
    - Dashboards: Access dashboard data

    Example:
        # Track an event
        ctx.apps.analytics.track_event("deal_closed", {
            "value": 50000,
            "owner": "alice@company.com"
        })

        # Get a metric
        revenue = ctx.apps.analytics.get_metric("revenue", period="month")

        # Analyze a funnel
        funnel = ctx.apps.analytics.analyze_funnel("signup_to_purchase")
    """

    def __init__(self, client: "AppClient") -> None:
        """
        Initialize the Analytics API.

        Args:
            client: App client for gateway communication
        """
        self._client = client
        self._app = "analytics"

    # =========================================================================
    # Event Tracking
    # =========================================================================

    def track_event(
        self,
        event_name: str,
        properties: Dict[str, Any] | None = None,
        user_id: str | None = None,
        timestamp: datetime | str | None = None,
    ) -> None:
        """
        Track a custom event.

        Args:
            event_name: Name of the event
            properties: Event properties
            user_id: User ID (optional, uses current user if not specified)
            timestamp: Event timestamp (optional, uses current time)

        Example:
            ctx.apps.analytics.track_event("deal_closed", {
                "value": 50000,
                "pipeline": "Enterprise",
                "duration_days": 30
            })
        """
        logger.debug(f"Tracking analytics event: {event_name}")

        payload: Dict[str, Any] = {
            "event": event_name,
            "properties": properties or {},
        }

        if user_id:
            payload["user_id"] = user_id
        if timestamp:
            if isinstance(timestamp, datetime):
                payload["timestamp"] = timestamp.isoformat()
            else:
                payload["timestamp"] = timestamp

        self._client.post(self._app, "/events", json=payload)

    def track_conversion(
        self,
        conversion_name: str,
        value: float | None = None,
        properties: Dict[str, Any] | None = None,
        user_id: str | None = None,
    ) -> None:
        """
        Track a conversion event.

        Args:
            conversion_name: Name of the conversion
            value: Conversion value (e.g., revenue)
            properties: Additional properties
            user_id: User ID

        Example:
            ctx.apps.analytics.track_conversion("purchase", value=99.99)
        """
        props = properties or {}
        if value is not None:
            props["value"] = value

        self.track_event(f"conversion:{conversion_name}", props, user_id)

    def identify_user(
        self,
        user_id: str,
        traits: Dict[str, Any],
    ) -> None:
        """
        Update user traits/properties.

        Args:
            user_id: User ID
            traits: User traits to set

        Example:
            ctx.apps.analytics.identify_user(user_id, {
                "name": "Alice Smith",
                "email": "alice@company.com",
                "plan": "enterprise"
            })
        """
        self._client.post(
            self._app,
            "/users/identify",
            json={"user_id": user_id, "traits": traits},
        )

    # =========================================================================
    # Metrics
    # =========================================================================

    def get_metric(
        self,
        metric_name: str,
        period: str = "day",
        start_date: date | str | None = None,
        end_date: date | str | None = None,
        breakdown_by: str | None = None,
    ) -> MetricResult:
        """
        Get a metric value.

        Args:
            metric_name: Name of the metric
            period: Aggregation period (hour, day, week, month, year)
            start_date: Period start date
            end_date: Period end date
            breakdown_by: Optional dimension to break down by

        Returns:
            MetricResult with value and optional breakdown

        Example:
            revenue = ctx.apps.analytics.get_metric("revenue", period="month")
            print(f"Revenue: ${revenue.value}")
        """
        params: Dict[str, Any] = {"period": period}

        if start_date:
            params["start_date"] = start_date.isoformat() if isinstance(start_date, date) else start_date
        if end_date:
            params["end_date"] = end_date.isoformat() if isinstance(end_date, date) else end_date
        if breakdown_by:
            params["breakdown_by"] = breakdown_by

        response = self._client.get(
            self._app,
            f"/metrics/{metric_name}",
            params=params,
        )
        return MetricResult.from_dict(response.data)

    def get_timeseries(
        self,
        metric_name: str,
        period: str = "day",
        start_date: date | str | None = None,
        end_date: date | str | None = None,
    ) -> List[Dict[str, Any]]:
        """
        Get metric values over time.

        Args:
            metric_name: Name of the metric
            period: Aggregation period
            start_date: Period start date
            end_date: Period end date

        Returns:
            List of {timestamp, value} points

        Example:
            data = ctx.apps.analytics.get_timeseries("signups", period="day")
            for point in data:
                print(f"{point['timestamp']}: {point['value']}")
        """
        params: Dict[str, Any] = {"period": period}

        if start_date:
            params["start_date"] = start_date.isoformat() if isinstance(start_date, date) else start_date
        if end_date:
            params["end_date"] = end_date.isoformat() if isinstance(end_date, date) else end_date

        response = self._client.get(
            self._app,
            f"/metrics/{metric_name}/timeseries",
            params=params,
        )
        return response.data.get("data", [])

    # =========================================================================
    # Funnels
    # =========================================================================

    def analyze_funnel(
        self,
        funnel_name: str,
        start_date: date | str | None = None,
        end_date: date | str | None = None,
    ) -> FunnelResult:
        """
        Analyze a conversion funnel.

        Args:
            funnel_name: Name of the funnel
            start_date: Analysis start date
            end_date: Analysis end date

        Returns:
            FunnelResult with step-by-step conversion data

        Example:
            funnel = ctx.apps.analytics.analyze_funnel("signup_to_purchase")
            print(f"Overall conversion: {funnel.total_conversion}%")
            for step in funnel.steps:
                print(f"  {step.name}: {step.conversion_rate}%")
        """
        params: Dict[str, Any] = {}

        if start_date:
            params["start_date"] = start_date.isoformat() if isinstance(start_date, date) else start_date
        if end_date:
            params["end_date"] = end_date.isoformat() if isinstance(end_date, date) else end_date

        response = self._client.get(
            self._app,
            f"/funnels/{funnel_name}",
            params=params or None,
        )
        return FunnelResult.from_dict(response.data)

    def create_funnel(
        self,
        name: str,
        steps: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """
        Create a new funnel definition.

        Args:
            name: Funnel name
            steps: List of funnel steps [{name, event}, ...]

        Returns:
            Created funnel data

        Example:
            ctx.apps.analytics.create_funnel("onboarding", [
                {"name": "Sign Up", "event": "user_signup"},
                {"name": "Profile", "event": "profile_completed"},
                {"name": "First Action", "event": "first_action"},
            ])
        """
        logger.info(f"Creating funnel: {name}")

        response = self._client.post(
            self._app,
            "/funnels",
            json={"name": name, "steps": steps},
        )
        return response.data

    # =========================================================================
    # Cohorts
    # =========================================================================

    def get_cohort(
        self,
        cohort_id: str,
    ) -> Cohort:
        """
        Get a cohort by ID.

        Args:
            cohort_id: Cohort ID

        Returns:
            Cohort data
        """
        response = self._client.get(self._app, f"/cohorts/{cohort_id}")
        return Cohort.from_dict(response.data)

    def create_cohort(
        self,
        name: str,
        criteria: Dict[str, Any],
        description: str = "",
    ) -> Dict[str, Any]:
        """
        Create a new cohort.

        Args:
            name: Cohort name
            criteria: Filter criteria for cohort membership
            description: Cohort description

        Returns:
            Created cohort data

        Example:
            ctx.apps.analytics.create_cohort(
                "Power Users",
                criteria={"events_count": {"gte": 100}},
                description="Users with 100+ events"
            )
        """
        logger.info(f"Creating cohort: {name}")

        response = self._client.post(
            self._app,
            "/cohorts",
            json={"name": name, "criteria": criteria, "description": description},
        )
        return response.data

    def get_cohort_metrics(
        self,
        cohort_id: str,
        metrics: List[str],
        period: str = "day",
    ) -> Dict[str, MetricResult]:
        """
        Get metrics for a specific cohort.

        Args:
            cohort_id: Cohort ID
            metrics: List of metric names
            period: Aggregation period

        Returns:
            Dict of metric_name -> MetricResult

        Example:
            metrics = ctx.apps.analytics.get_cohort_metrics(
                cohort_id, ["revenue", "retention"], period="week"
            )
        """
        response = self._client.get(
            self._app,
            f"/cohorts/{cohort_id}/metrics",
            params={"metrics": ",".join(metrics), "period": period},
        )

        return {
            name: MetricResult.from_dict(data)
            for name, data in response.data.get("metrics", {}).items()
        }

    # =========================================================================
    # Dashboards
    # =========================================================================

    def get_dashboard(
        self,
        dashboard_name: str,
    ) -> Dict[str, Any]:
        """
        Get dashboard data.

        Args:
            dashboard_name: Dashboard name

        Returns:
            Dashboard data with widgets and values

        Example:
            dashboard = ctx.apps.analytics.get_dashboard("executive")
            for widget in dashboard["widgets"]:
                print(f"{widget['name']}: {widget['value']}")
        """
        response = self._client.get(
            self._app,
            f"/dashboards/{dashboard_name}",
        )
        return response.data

    def refresh_dashboard(
        self,
        dashboard_name: str,
    ) -> None:
        """
        Trigger a dashboard refresh.

        Args:
            dashboard_name: Dashboard name
        """
        logger.info(f"Refreshing dashboard: {dashboard_name}")
        self._client.post(self._app, f"/dashboards/{dashboard_name}/refresh")

    # =========================================================================
    # Reports
    # =========================================================================

    def generate_report(
        self,
        report_type: str,
        config: Dict[str, Any],
        output_format: str = "json",
    ) -> Dict[str, Any]:
        """
        Generate an analytics report.

        Args:
            report_type: Type of report (retention, attribution, etc.)
            config: Report configuration
            output_format: Output format (json, csv, pdf)

        Returns:
            Report data

        Example:
            report = ctx.apps.analytics.generate_report(
                "retention",
                config={"cohort_date": "signup", "period": "week"},
                output_format="json"
            )
        """
        logger.info(f"Generating {report_type} report")

        response = self._client.post(
            self._app,
            f"/reports/{report_type}",
            json={"config": config, "format": output_format},
        )
        return response.data
