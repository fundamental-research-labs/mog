"""Comment operations -- ``ws.comments.add()``, ``ws.comments.list()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result, parse_a1
from mog.errors import NativeApiError
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


_COMMENT_TYPE_NOTE = "note"
_COMMENT_TYPE_THREADED = "threadedComment"


def _extract_text(comment: Dict[str, Any]) -> str:
    """Extract plain text from a comment dict (handles runs-based format)."""
    if comment.get("content"):
        return comment["content"]
    runs = comment.get("runs")
    if isinstance(runs, list):
        return "".join(r.get("text", "") for r in runs if isinstance(r, dict))
    return ""


class CommentsAPI:
    """Threaded comment operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_to_row_col(self, address: str):
        """Resolve an A1 address to (row, col)."""
        return parse_a1(address)

    def _normalize_comment(self, c: Dict[str, Any]) -> Dict[str, Any]:
        """Add a 'text' convenience field if not already present."""
        if "text" not in c:
            c = dict(c)
            c["text"] = _extract_text(c)
        return c

    def _mutation_dict(self, raw: Any) -> Dict[str, Any]:
        """Extract the MutationResult dict from a native mutation result."""
        if isinstance(raw, tuple):
            raw = raw[1] if len(raw) > 1 else raw[0]
        return raw if isinstance(raw, dict) else {}

    def _created_comment(self, raw: Any) -> Dict[str, Any]:
        """Extract and normalize the comment payload from a mutation result."""
        mutation_dict = self._mutation_dict(raw)
        data = mutation_dict.get("data")
        if isinstance(data, dict):
            return self._normalize_comment(data)
        return mutation_dict

    def _add_by_position(
        self,
        row: int,
        col: int,
        text: str,
        author: str,
        author_id: Optional[str],
        parent_id: Optional[str],
        comment_type: str,
    ) -> Any:
        return self._bridge.call_json(
            "compute_add_comment_by_position",
            self._sheet_id_json,
            row,
            col,
            text,
            author,
            json.dumps(author_id),
            json.dumps(parent_id),
            json.dumps(comment_type),
        )

    def _add_by_cell_id(
        self,
        cell_id: str,
        text: str,
        author: str,
        author_id: Optional[str],
        parent_id: Optional[str],
        comment_type: str,
    ) -> Any:
        return self._bridge.call_json(
            "compute_add_comment",
            self._sheet_id_json,
            cell_id,
            text,
            author,
            json.dumps(author_id),
            json.dumps(parent_id),
            json.dumps(comment_type),
        )

    def _is_note(self, comment: Dict[str, Any]) -> bool:
        return comment.get("commentType", comment.get("comment_type")) == _COMMENT_TYPE_NOTE

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def add(
        self,
        address_or_cell_id: str,
        text: str,
        author: str = "User",
        author_id: Optional[str] = None,
        parent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add a comment to a cell.

        Parameters
        ----------
        address_or_cell_id:
            An A1-style address (``"A1"``) or the cell's hex ID.
        text:
            Comment text.
        author:
            Author name.
        author_id:
            Optional author identifier.
        parent_id:
            Optional parent comment ID for threaded replies.

        Returns
        -------
        dict
            The created comment object with ``id``, ``author``, ``text``, etc.
        """
        import re
        if re.match(r"^[A-Za-z]+\d+$", address_or_cell_id):
            row, col = parse_a1(address_or_cell_id)
            raw = self._add_by_position(
                row,
                col,
                text,
                author,
                author_id,
                parent_id,
                _COMMENT_TYPE_THREADED,
            )
        else:
            raw = self._add_by_cell_id(
                address_or_cell_id,
                text,
                author,
                author_id,
                parent_id,
                _COMMENT_TYPE_THREADED,
            )

        return self._created_comment(raw)

    def add_reply(
        self,
        parent_id: str,
        text: str,
        author: str = "User",
        author_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add a reply to an existing comment thread.

        Parameters
        ----------
        parent_id:
            The ID of the comment to reply to (becomes the threadId).
        text:
            Reply text.
        author:
            Author name.
        author_id:
            Optional author identifier.
        """
        # Look up the parent comment to find its cell position
        parent = self._bridge.call_json(
            "compute_get_comment", self._sheet_id_json, parent_id
        )
        if not isinstance(parent, dict):
            raise ValueError(f"Parent comment {parent_id!r} not found")
        thread_id = parent.get("threadId", parent_id)
        cell_ref = parent.get("cellRef", "")

        # Use add_comment with parent_id to create a reply
        raw = self._add_by_cell_id(
            cell_ref,
            text,
            author,
            author_id,
            thread_id,
            _COMMENT_TYPE_THREADED,
        )
        return self._created_comment(raw)

    def add_threaded(
        self,
        address: str,
        text: str,
        author: str = "User",
    ) -> Dict[str, Any]:
        """Add a threaded comment (alias for :meth:`add` with explicit author).

        Parameters
        ----------
        address:
            A1-style address.
        text:
            Comment text.
        author:
            Author name.
        """
        return self.add(address, text, author=author)

    def list(self) -> List[Dict[str, Any]]:
        """Get all comments in this sheet."""
        result = self._bridge.get_all_comments(self._sheet_id_json)
        if isinstance(result, list):
            return [self._normalize_comment(c) for c in result if isinstance(c, dict)]
        return []

    def count(self) -> int:
        """Return the number of comments on this sheet."""
        return self._bridge.call("compute_get_comment_count", self._sheet_id_json)

    def get(self, address_or_id: str) -> Optional[Dict[str, Any]]:
        """Get comment(s) for a cell address, or a single comment by ID.

        Parameters
        ----------
        address_or_id:
            An A1-style address (returns first comment at that cell)
            or a comment ID string.

        Returns
        -------
        dict or None
            The comment dict, or ``None`` if not found.
        """
        import re
        if re.match(r"^[A-Za-z]+\d+$", address_or_id):
            row, col = parse_a1(address_or_id)
            comments = self._bridge.call_json(
                "compute_get_comments_for_cell_by_position",
                self._sheet_id_json, row, col,
            )
            if isinstance(comments, list) and len(comments) > 0:
                return self._normalize_comment(comments[0])
            return None
        else:
            result = self._bridge.call_json(
                "compute_get_comment", self._sheet_id_json, address_or_id,
            )
            if isinstance(result, dict):
                return self._normalize_comment(result)
            return None

    def update(
        self,
        address_or_id: str,
        text: str,
    ) -> MutationResult:
        """Update the text of a comment.

        Parameters
        ----------
        address_or_id:
            An A1-style address (updates the first comment on that cell)
            or a comment ID.
        text:
            New comment text.
        """
        import re
        comment_id = address_or_id
        if re.match(r"^[A-Za-z]+\d+$", address_or_id):
            row, col = parse_a1(address_or_id)
            comments = self._bridge.call_json(
                "compute_get_comments_for_cell_by_position",
                self._sheet_id_json, row, col,
            )
            if isinstance(comments, list) and len(comments) > 0:
                comment_id = comments[0]["id"]
            else:
                raise ValueError(f"No comment found at {address_or_id!r}")

        raw = self._bridge.call_json(
            "compute_update_comment", self._sheet_id_json, comment_id, text
        )
        return deserialize_mutation_result(raw)

    def delete(self, comment_id: str) -> MutationResult:
        """Delete a comment by ID."""
        raw = self._bridge.delete_comment(self._sheet_id_json, comment_id)
        return deserialize_mutation_result(raw)

    def get_for_cell(self, address: str) -> List[Dict[str, Any]]:
        """Get all comments attached to a specific cell.

        Parameters
        ----------
        address:
            A1-style address (``"A1"``).

        Returns a list of comment dicts for that cell.
        """
        row, col = parse_a1(address)
        comments = self._bridge.call_json(
            "compute_get_comments_for_cell_by_position",
            self._sheet_id_json, row, col,
        )
        if isinstance(comments, list):
            return [self._normalize_comment(c) for c in comments if isinstance(c, dict)]
        return []

    # ------------------------------------------------------------------
    # Notes (simplified comments -- single comment per cell, no threading)
    # ------------------------------------------------------------------

    def add_note(
        self,
        address: str,
        text: Any,
        author: str = "User",
        author_id: Optional[str] = None,
    ) -> MutationResult:
        """Add a simple note to a cell.

        Notes are implemented as comments without threading.

        Parameters
        ----------
        address:
            A1-style address.
        text:
            Note text, or an options dict with ``text`` and optional
            ``author`` / ``authorId`` fields.
        """
        if isinstance(text, dict):
            options = text
            text = str(options.get("text", ""))
            author = str(options.get("author", author))
            author_id = options.get("authorId", options.get("author_id", author_id))

        row, col = parse_a1(address)
        raw = self._add_by_position(
            row,
            col,
            str(text),
            author,
            author_id,
            None,
            _COMMENT_TYPE_NOTE,
        )
        return deserialize_mutation_result(self._mutation_dict(raw))

    def set_note(
        self,
        address: str,
        text: str,
        author: str = "User",
    ) -> MutationResult:
        """Set or replace the note text for a cell."""
        try:
            self.remove_note(address)
        except ValueError:
            pass
        return self.add_note(address, text, author=author)

    def get_note(self, address: str) -> Optional[str]:
        """Get the note text for a cell, or ``None`` if no note.

        Parameters
        ----------
        address:
            A1-style address.
        """
        row, col = parse_a1(address)
        comments = self._bridge.call_json(
            "compute_get_comments_for_cell_by_position",
            self._sheet_id_json, row, col,
        )
        if isinstance(comments, list) and len(comments) > 0:
            for comment in comments:
                if isinstance(comment, dict) and self._is_note(comment):
                    return _extract_text(comment)
        return None

    def remove_note(self, address: str) -> MutationResult:
        """Remove the note from a cell.

        Parameters
        ----------
        address:
            A1-style address.
        """
        row, col = parse_a1(address)
        comments = self._bridge.call_json(
            "compute_get_comments_for_cell_by_position",
            self._sheet_id_json,
            row,
            col,
        )
        if not isinstance(comments, list):
            raise NativeApiError(
                "compute_get_comments_for_cell_by_position returned a non-list response"
            )

        raw: Any = None
        for comment in comments:
            if isinstance(comment, dict) and self._is_note(comment):
                raw = self._bridge.call_json(
                    "compute_delete_comment",
                    self._sheet_id_json,
                    comment.get("id", ""),
                )
        if raw is None:
            raise ValueError(f"No note found at {address!r}")
        return deserialize_mutation_result(self._mutation_dict(raw))
