"""
BugTrackerAPI - Bug Tracker app API for workflows.

This module provides the Bug Tracker API for issue management:
- Issues: Create, update, assign, transition
- Projects: Get project info and settings
- Sprints: Manage sprints and backlogs
- Comments: Add and retrieve comments
- Labels/Tags: Manage issue categorization
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
class Issue:
    """A bug tracker issue."""

    id: str
    key: str = ""
    title: str = ""
    description: str = ""
    status: str = "open"
    priority: str = "medium"
    type: str = "bug"  # bug, feature, task, story
    assignee: Dict[str, Any] | None = None
    reporter: Dict[str, Any] | None = None
    project: Dict[str, Any] | None = None
    sprint: Dict[str, Any] | None = None
    labels: List[str] = field(default_factory=list)
    story_points: int | None = None
    due_date: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    resolved_at: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Issue":
        """Create Issue from dictionary."""
        return cls(
            id=data["id"],
            key=data.get("key", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            status=data.get("status", "open"),
            priority=data.get("priority", "medium"),
            type=data.get("type", "bug"),
            assignee=data.get("assignee"),
            reporter=data.get("reporter"),
            project=data.get("project"),
            sprint=data.get("sprint"),
            labels=data.get("labels", []),
            story_points=data.get("story_points"),
            due_date=data.get("due_date"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
            resolved_at=data.get("resolved_at"),
        )


@dataclass
class Project:
    """A bug tracker project."""

    id: str
    key: str = ""
    name: str = ""
    description: str = ""
    lead: Dict[str, Any] | None = None
    issue_count: int = 0
    open_issue_count: int = 0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Project":
        """Create Project from dictionary."""
        return cls(
            id=data["id"],
            key=data.get("key", ""),
            name=data.get("name", ""),
            description=data.get("description", ""),
            lead=data.get("lead"),
            issue_count=data.get("issue_count", 0),
            open_issue_count=data.get("open_issue_count", 0),
        )


@dataclass
class Sprint:
    """A bug tracker sprint."""

    id: str
    name: str = ""
    status: str = "future"  # future, active, closed
    start_date: str | None = None
    end_date: str | None = None
    goal: str = ""
    issue_count: int = 0
    completed_count: int = 0
    story_points_total: int = 0
    story_points_completed: int = 0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Sprint":
        """Create Sprint from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            status=data.get("status", "future"),
            start_date=data.get("start_date"),
            end_date=data.get("end_date"),
            goal=data.get("goal", ""),
            issue_count=data.get("issue_count", 0),
            completed_count=data.get("completed_count", 0),
            story_points_total=data.get("story_points_total", 0),
            story_points_completed=data.get("story_points_completed", 0),
        )


@dataclass
class Comment:
    """An issue comment."""

    id: str
    body: str = ""
    author: Dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Comment":
        """Create Comment from dictionary."""
        return cls(
            id=data["id"],
            body=data.get("body", ""),
            author=data.get("author"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


class BugTrackerAPI:
    """
    Bug Tracker API for workflow access.

    Provides domain-specific operations for issue tracking:
    - Issues: CRUD, transitions, assignments
    - Projects: Project information
    - Sprints: Sprint management
    - Comments: Add and manage comments

    Example:
        # Create an issue
        issue = ctx.apps.bug_tracker.create_issue(
            project="MAIN",
            title="Fix login bug",
            type="bug",
            priority="high"
        )

        # Transition issue status
        ctx.apps.bug_tracker.transition_issue(issue["id"], "in_progress")

        # Assign to user
        ctx.apps.bug_tracker.assign_issue(issue["id"], "alice@company.com")
    """

    def __init__(self, client: "AppClient") -> None:
        """
        Initialize the Bug Tracker API.

        Args:
            client: App client for gateway communication
        """
        self._client = client
        self._app = "bug_tracker"

    # =========================================================================
    # Issues
    # =========================================================================

    def create_issue(
        self,
        project: str,
        title: str,
        type: str = "bug",
        priority: str = "medium",
        description: str = "",
        assignee: str | None = None,
        sprint: str | None = None,
        labels: List[str] | None = None,
        story_points: int | None = None,
        due_date: date | str | None = None,
    ) -> Dict[str, Any]:
        """
        Create a new issue.

        Args:
            project: Project key or ID
            title: Issue title
            type: Issue type (bug, feature, task, story)
            priority: Priority (low, medium, high, critical)
            description: Issue description
            assignee: Assignee email
            sprint: Sprint name or ID
            labels: List of labels
            story_points: Story point estimate
            due_date: Due date

        Returns:
            Created issue data

        Example:
            issue = ctx.apps.bug_tracker.create_issue(
                project="MAIN",
                title="API returns 500 on /users endpoint",
                type="bug",
                priority="high",
                description="When calling /users with invalid params...",
                labels=["backend", "api"]
            )
        """
        logger.info(f"Creating issue in project {project}: {title}")

        payload: Dict[str, Any] = {
            "project": project,
            "title": title,
            "type": type,
            "priority": priority,
        }

        if description:
            payload["description"] = description
        if assignee:
            payload["assignee"] = assignee
        if sprint:
            payload["sprint"] = sprint
        if labels:
            payload["labels"] = labels
        if story_points is not None:
            payload["story_points"] = story_points
        if due_date:
            if isinstance(due_date, date):
                payload["due_date"] = due_date.isoformat()
            else:
                payload["due_date"] = due_date

        response = self._client.post(self._app, "/issues", json=payload)
        return response.data

    def get_issue(
        self,
        issue_key: str,
        include: List[str] | None = None,
    ) -> Dict[str, Any]:
        """
        Get an issue by key.

        Args:
            issue_key: Issue key (e.g., "MAIN-123") or ID
            include: Relations to include (comments, attachments)

        Returns:
            Issue data
        """
        params = {}
        if include:
            params["include"] = ",".join(include)

        response = self._client.get(
            self._app,
            f"/issues/{issue_key}",
            params=params or None,
        )
        return response.data

    def update_issue(
        self,
        issue_key: str,
        updates: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Update an issue.

        Args:
            issue_key: Issue key or ID
            updates: Fields to update

        Returns:
            Updated issue data
        """
        logger.info(f"Updating issue: {issue_key}")
        response = self._client.patch(
            self._app,
            f"/issues/{issue_key}",
            json=updates,
        )
        return response.data

    def transition_issue(
        self,
        issue_key: str,
        status: str,
        resolution: str | None = None,
    ) -> Dict[str, Any]:
        """
        Transition an issue to a new status.

        Args:
            issue_key: Issue key or ID
            status: Target status (open, in_progress, review, resolved, closed)
            resolution: Resolution type for closed issues

        Returns:
            Updated issue data

        Example:
            ctx.apps.bug_tracker.transition_issue("MAIN-123", "resolved", resolution="fixed")
        """
        logger.info(f"Transitioning issue {issue_key} to: {status}")

        payload: Dict[str, Any] = {"status": status}
        if resolution:
            payload["resolution"] = resolution

        response = self._client.post(
            self._app,
            f"/issues/{issue_key}/transition",
            json=payload,
        )
        return response.data

    def assign_issue(
        self,
        issue_key: str,
        assignee: str,
    ) -> Dict[str, Any]:
        """
        Assign an issue to a user.

        Args:
            issue_key: Issue key or ID
            assignee: Assignee email

        Returns:
            Updated issue data
        """
        logger.info(f"Assigning issue {issue_key} to: {assignee}")
        response = self._client.post(
            self._app,
            f"/issues/{issue_key}/assign",
            json={"assignee": assignee},
        )
        return response.data

    def add_labels(
        self,
        issue_key: str,
        labels: List[str],
    ) -> Dict[str, Any]:
        """
        Add labels to an issue.

        Args:
            issue_key: Issue key or ID
            labels: Labels to add

        Returns:
            Updated issue data
        """
        response = self._client.post(
            self._app,
            f"/issues/{issue_key}/labels",
            json={"labels": labels},
        )
        return response.data

    def remove_labels(
        self,
        issue_key: str,
        labels: List[str],
    ) -> Dict[str, Any]:
        """
        Remove labels from an issue.

        Args:
            issue_key: Issue key or ID
            labels: Labels to remove

        Returns:
            Updated issue data
        """
        response = self._client.delete(
            self._app,
            f"/issues/{issue_key}/labels",
            params={"labels": ",".join(labels)},
        )
        return response.data

    def search_issues(
        self,
        project: str | None = None,
        status: str | List[str] | None = None,
        assignee: str | None = None,
        type: str | None = None,
        labels: List[str] | None = None,
        sprint: str | None = None,
        query: str | None = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Search for issues.

        Args:
            project: Filter by project
            status: Filter by status (string or list)
            assignee: Filter by assignee email
            type: Filter by issue type
            labels: Filter by labels (all must match)
            sprint: Filter by sprint
            query: Full-text search query
            limit: Maximum results

        Returns:
            List of matching issues

        Example:
            bugs = ctx.apps.bug_tracker.search_issues(
                project="MAIN",
                status=["open", "in_progress"],
                type="bug",
                labels=["backend"]
            )
        """
        params: Dict[str, Any] = {"limit": limit}

        if project:
            params["project"] = project
        if status:
            if isinstance(status, list):
                params["status"] = ",".join(status)
            else:
                params["status"] = status
        if assignee:
            params["assignee"] = assignee
        if type:
            params["type"] = type
        if labels:
            params["labels"] = ",".join(labels)
        if sprint:
            params["sprint"] = sprint
        if query:
            params["query"] = query

        response = self._client.get(self._app, "/issues", params=params)
        return response.data.get("issues", [])

    # =========================================================================
    # Projects
    # =========================================================================

    def get_project(
        self,
        project_key: str,
    ) -> Dict[str, Any]:
        """
        Get a project by key.

        Args:
            project_key: Project key or ID

        Returns:
            Project data
        """
        response = self._client.get(self._app, f"/projects/{project_key}")
        return response.data

    def get_project_stats(
        self,
        project_key: str,
    ) -> Dict[str, Any]:
        """
        Get project statistics.

        Args:
            project_key: Project key or ID

        Returns:
            Statistics (issue counts by status, type, etc.)

        Example:
            stats = ctx.apps.bug_tracker.get_project_stats("MAIN")
            print(f"Open bugs: {stats['bugs']['open']}")
        """
        response = self._client.get(self._app, f"/projects/{project_key}/stats")
        return response.data

    # =========================================================================
    # Sprints
    # =========================================================================

    def get_sprint(
        self,
        sprint_id: str,
    ) -> Dict[str, Any]:
        """
        Get a sprint by ID.

        Args:
            sprint_id: Sprint ID

        Returns:
            Sprint data
        """
        response = self._client.get(self._app, f"/sprints/{sprint_id}")
        return response.data

    def get_active_sprint(
        self,
        project_key: str,
    ) -> Dict[str, Any] | None:
        """
        Get the active sprint for a project.

        Args:
            project_key: Project key

        Returns:
            Active sprint data, or None if no active sprint
        """
        response = self._client.get(
            self._app,
            f"/projects/{project_key}/sprints/active",
        )
        return response.data if response.data else None

    def get_sprint_issues(
        self,
        sprint_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Get all issues in a sprint.

        Args:
            sprint_id: Sprint ID

        Returns:
            List of issues
        """
        response = self._client.get(self._app, f"/sprints/{sprint_id}/issues")
        return response.data.get("issues", [])

    def add_to_sprint(
        self,
        issue_key: str,
        sprint_id: str,
    ) -> Dict[str, Any]:
        """
        Add an issue to a sprint.

        Args:
            issue_key: Issue key or ID
            sprint_id: Sprint ID

        Returns:
            Updated issue data
        """
        logger.info(f"Adding issue {issue_key} to sprint {sprint_id}")
        response = self._client.post(
            self._app,
            f"/sprints/{sprint_id}/issues",
            json={"issue_key": issue_key},
        )
        return response.data

    def remove_from_sprint(
        self,
        issue_key: str,
        sprint_id: str,
    ) -> Dict[str, Any]:
        """
        Remove an issue from a sprint.

        Args:
            issue_key: Issue key or ID
            sprint_id: Sprint ID

        Returns:
            Updated issue data
        """
        logger.info(f"Removing issue {issue_key} from sprint {sprint_id}")
        response = self._client.delete(
            self._app,
            f"/sprints/{sprint_id}/issues/{issue_key}",
        )
        return response.data

    def start_sprint(
        self,
        sprint_id: str,
        start_date: date | str | None = None,
        end_date: date | str | None = None,
        goal: str = "",
    ) -> Dict[str, Any]:
        """
        Start a sprint.

        Args:
            sprint_id: Sprint ID
            start_date: Sprint start date
            end_date: Sprint end date
            goal: Sprint goal

        Returns:
            Updated sprint data
        """
        logger.info(f"Starting sprint: {sprint_id}")

        payload: Dict[str, Any] = {}
        if start_date:
            payload["start_date"] = start_date.isoformat() if isinstance(start_date, date) else start_date
        if end_date:
            payload["end_date"] = end_date.isoformat() if isinstance(end_date, date) else end_date
        if goal:
            payload["goal"] = goal

        response = self._client.post(
            self._app,
            f"/sprints/{sprint_id}/start",
            json=payload or None,
        )
        return response.data

    def complete_sprint(
        self,
        sprint_id: str,
        move_incomplete_to: str | None = None,
    ) -> Dict[str, Any]:
        """
        Complete a sprint.

        Args:
            sprint_id: Sprint ID
            move_incomplete_to: Sprint ID to move incomplete issues to

        Returns:
            Completion summary
        """
        logger.info(f"Completing sprint: {sprint_id}")

        payload = {}
        if move_incomplete_to:
            payload["move_incomplete_to"] = move_incomplete_to

        response = self._client.post(
            self._app,
            f"/sprints/{sprint_id}/complete",
            json=payload or None,
        )
        return response.data

    # =========================================================================
    # Comments
    # =========================================================================

    def add_comment(
        self,
        issue_key: str,
        body: str,
    ) -> Dict[str, Any]:
        """
        Add a comment to an issue.

        Args:
            issue_key: Issue key or ID
            body: Comment body (supports markdown)

        Returns:
            Created comment data

        Example:
            ctx.apps.bug_tracker.add_comment(
                "MAIN-123",
                "Investigated - this is caused by the recent API change"
            )
        """
        response = self._client.post(
            self._app,
            f"/issues/{issue_key}/comments",
            json={"body": body},
        )
        return response.data

    def get_comments(
        self,
        issue_key: str,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Get comments for an issue.

        Args:
            issue_key: Issue key or ID
            limit: Maximum comments

        Returns:
            List of comments
        """
        response = self._client.get(
            self._app,
            f"/issues/{issue_key}/comments",
            params={"limit": limit},
        )
        return response.data.get("comments", [])
