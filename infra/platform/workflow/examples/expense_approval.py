"""
Expense Approval Workflow validation example.

This workflow demonstrates the full capabilities of the durable workflow engine:

1. Auto-approve small expenses (< $500) - runs locally, fast
2. Manager approval for larger expenses - promotes to cloud
3. @wait_for with 7-day timeout for manager response
4. Escalation to CFO if no response
5. @wait_for with 3-day timeout for CFO response
6. Email notifications with action buttons
7. Toast notifications for the employee

This is the canonical example from the workflow plan (lines 662-778).

Flow:
    record:created (expenses)
           |
           v
       evaluate()
           |
    +------+------+
    |             |
    v             v
 <= $500       > $500
    |             |
    v             v
 auto_approve  request_approval
    |             |
    v             v
 complete()   wait_for_decision (7d timeout)
                  |
        +---------+---------+
        |         |         |
        v         v         v
     approved  rejected   timeout
        |         |         |
        v         v         v
     approve   reject    escalate
        |         |         |
        v         v         v
     complete  complete  wait_for_cfo (3d timeout)
                              |
                    +---------+---------+
                    |         |         |
                    v         v         v
                 approved  rejected   timeout
                    |         |         |
                    v         v         v
                 approve   reject    reject
                    |         |         |
                    v         v         v
                 complete  complete  complete
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from workflow_engine import workflow, step, wait_for
from workflow_engine.testing.harness import complete


@workflow(
    trigger="record:created",
    table="expenses",
    runtime="auto",
    version="1.0.0",
    description="Multi-step expense approval workflow with manager escalation.",
    idempotency_key="event.recordId",
)
class ExpenseApproval:
    """
    Multi-step expense approval workflow.

    - Small expenses (<=500): auto-approve (runs locally, fast)
    - Large expenses (>500): manager approval with escalation (promotes to cloud)

    Demonstrates:
    - Durable execution with step persistence
    - Auto-promotion to cloud on @wait_for with timeout
    - Human-in-the-loop approval flow
    - Timeout handling and escalation
    - Email notifications with action buttons
    - Toast notifications for the employee
    """

    # Workflow instance state (persisted between steps)
    expense: Optional[Dict[str, Any]] = None
    employee: Optional[Dict[str, Any]] = None
    manager: Optional[Dict[str, Any]] = None

    @step
    def evaluate(self, event: Dict[str, Any], ctx: Any) -> Any:
        """
        First step: evaluate the expense and decide approval path.

        Args:
            event: The triggering event with recordId
            ctx: Workflow context with records API

        Returns:
            Transition to auto_approve or request_approval
        """
        self.expense = ctx.records.get("expenses", event["recordId"])
        if self.expense is None:
            return complete()

        self.employee = ctx.records.get("employees", self.expense.get("employee_id"))
        if self.employee is None:
            return complete()

        # Decision logic: auto-approve small expenses
        if self.expense.get("amount", 0) <= 500:
            return self.auto_approve
        else:
            return self.request_approval

    @step
    def auto_approve(self, ctx: Any) -> Any:
        """
        Auto-approve small expenses.

        Completes locally without cloud promotion.
        """
        ctx.records.update("expenses", self.expense["id"], {
            "status": "approved",
            "approved_by": "auto",
            "approved_at": ctx.now().isoformat(),
        })

        # Notify the employee
        ctx.notify.toast(
            user=self.employee["id"],
            message=f"Your expense for ${self.expense['amount']} was auto-approved!",
        )

        return complete()

    @step
    def request_approval(self, ctx: Any) -> Any:
        """
        Request manager approval for large expenses.

        Sends email to manager and transitions to wait_for_decision.
        """
        # Get the manager
        self.manager = ctx.records.get("employees", self.employee.get("manager_id"))
        if self.manager is None:
            # No manager? Auto-approve.
            return self.auto_approve

        # Update expense status
        ctx.records.update("expenses", self.expense["id"], {
            "status": "pending_approval",
            "approver_id": self.manager["id"],
        })

        # Send approval request email with action buttons
        ctx.notify.email(
            to=self.manager["email"],
            subject=f"Expense approval needed: ${self.expense['amount']}",
            body=f"{self.employee['name']} submitted an expense for ${self.expense['amount']}.\n\n"
                 f"Description: {self.expense.get('description', 'N/A')}\n\n"
                 f"Please review and approve or reject.",
            actions=[
                {"label": "Approve", "event": "expense:approved"},
                {"label": "Reject", "event": "expense:rejected"},
            ],
        )

        # Notify employee that request is pending
        ctx.notify.toast(
            user=self.employee["id"],
            message=f"Your expense for ${self.expense['amount']} is pending manager approval.",
        )

        # THIS TRIGGERS AUTO-PROMOTION TO CLOUD
        return self.wait_for_decision

    @step
    @wait_for(["expense:approved", "expense:rejected"], timeout="7d")
    def wait_for_decision(self, event: Optional[Dict[str, Any]], ctx: Any) -> Any:
        """
        Wait for manager's decision or timeout.

        Args:
            event: The approval/rejection event, or None if timeout
            ctx: Workflow context

        Returns:
            Transition to approve, reject, or escalate
        """
        if event is None:
            # Timeout - escalate to CFO
            return self.escalate
        elif event.get("type") == "expense:approved":
            return self.approve(ctx, approved_by=self.manager["id"])
        else:
            # Rejected
            reason = event.get("reason", "Rejected by manager")
            return self.reject(ctx, reason=reason)

    @step
    def escalate(self, ctx: Any) -> Any:
        """
        Escalate to CFO after 7 days with no manager response.
        """
        # Update expense status
        ctx.records.update("expenses", self.expense["id"], {
            "status": "escalated",
        })

        # Notify the manager about escalation
        ctx.notify.email(
            to=self.manager["email"],
            subject=f"Escalated: Expense ${self.expense['amount']} needs approval",
            body=f"This expense request has been escalated to CFO due to no response in 7 days.",
        )

        # Send to CFO
        ctx.notify.email(
            to="cfo@company.com",
            subject=f"Escalation: Expense ${self.expense['amount']} needs approval",
            body=f"Manager {self.manager['name']} hasn't responded in 7 days.\n\n"
                 f"Employee: {self.employee['name']}\n"
                 f"Amount: ${self.expense['amount']}\n"
                 f"Description: {self.expense.get('description', 'N/A')}",
            actions=[
                {"label": "Approve", "event": "expense:approved"},
                {"label": "Reject", "event": "expense:rejected"},
            ],
        )

        # Notify the employee about escalation
        ctx.notify.toast(
            user=self.employee["id"],
            message=f"Your expense has been escalated to CFO for approval.",
        )

        return self.wait_for_cfo

    @step
    @wait_for(["expense:approved", "expense:rejected"], timeout="3d")
    def wait_for_cfo(self, event: Optional[Dict[str, Any]], ctx: Any) -> Any:
        """
        Wait for CFO's decision or timeout (3 days).

        Args:
            event: The approval/rejection event, or None if timeout
            ctx: Workflow context

        Returns:
            Transition to approve or reject
        """
        if event is None:
            # Timeout after CFO escalation - auto-reject
            return self.reject(ctx, reason="No response after escalation to CFO")
        elif event.get("type") == "expense:approved":
            return self.approve(ctx, approved_by="cfo")
        else:
            reason = event.get("reason", "Rejected by CFO")
            return self.reject(ctx, reason=reason)

    @step
    def approve(self, ctx: Any, approved_by: str) -> Any:
        """
        Approve the expense.

        Args:
            ctx: Workflow context
            approved_by: ID of approver or "auto"/"cfo"

        Returns:
            Complete transition
        """
        ctx.records.update("expenses", self.expense["id"], {
            "status": "approved",
            "approved_by": approved_by,
            "approved_at": ctx.now().isoformat(),
        })

        # Notify the employee
        ctx.notify.toast(
            user=self.employee["id"],
            message=f"Your expense for ${self.expense['amount']} was approved!",
        )

        return complete()

    @step
    def reject(self, ctx: Any, reason: str) -> Any:
        """
        Reject the expense.

        Args:
            ctx: Workflow context
            reason: Rejection reason

        Returns:
            Complete transition
        """
        ctx.records.update("expenses", self.expense["id"], {
            "status": "rejected",
            "rejection_reason": reason,
            "rejected_at": ctx.now().isoformat(),
        })

        # Email the employee
        ctx.notify.email(
            to=self.employee["email"],
            subject=f"Expense rejected: ${self.expense['amount']}",
            body=f"Your expense request for ${self.expense['amount']} has been rejected.\n\n"
                 f"Reason: {reason}",
        )

        # Toast notification
        ctx.notify.toast(
            user=self.employee["id"],
            message=f"Your expense for ${self.expense['amount']} was rejected: {reason}",
        )

        return complete()
