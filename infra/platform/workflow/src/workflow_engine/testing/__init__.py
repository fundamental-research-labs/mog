"""
Testing Infrastructure for Workflow Engine.

This module provides comprehensive testing utilities for workflow development:
- MockContext: Mock implementation of all workflow APIs
- WorkflowTest: Base class for workflow test cases
- TimeTraveler: Fast-forward through sleeps and timeouts
- EventSimulator: Inject external events
- WorkflowAssertions: Custom assertions for workflow testing

Example:
    from workflow_engine.testing import WorkflowTest, MockContext

    class TestExpenseApproval(WorkflowTest):
        workflow = ExpenseApprovalWorkflow

        def test_auto_approve_small_expense(self):
            ctx = MockContext({
                "expenses": {"exp1": {"id": "exp1", "amount": 100}}
            })

            instance = self.trigger(ctx, event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp1"
            })

            self.assert_completed(instance)

        def test_manager_approval_with_timeout(self):
            ctx = MockContext({...})
            instance = self.trigger(ctx, event={...})

            # Advance time to trigger timeout
            ctx.time.advance(days=7)

            # Verify escalation
            self.assert_current_step(instance, "escalate")
"""

from workflow_engine.testing.mock_context import (
    MockContext,
    MockRecordsAPI,
    MockTablesAPI,
    MockRelationsAPI,
    MockAppAPI,
    MockAppsRegistry,
    MockHttpClient,
    MockHttpResponse,
    MockNotificationService,
    MockSecretsManager,
    MockWorkflowsAPI,
    MockConfig,
)

from workflow_engine.testing.harness import (
    WorkflowTest,
    WorkflowInstance,
    WorkflowExecutor,
    complete,
    wait_for,
)

from workflow_engine.testing.time_travel import (
    TimeTraveler,
    PendingTimer,
    PendingSleep,
)

from workflow_engine.testing.event_simulation import (
    EventSimulator,
    SimulatedEvent,
    EventMatcher,
)

from workflow_engine.testing.assertions import (
    WorkflowAssertions,
    WorkflowAssertionError,
)

__all__ = [
    # Main classes
    "MockContext",
    "WorkflowTest",
    "TimeTraveler",
    "EventSimulator",
    "WorkflowAssertions",
    # Mock APIs
    "MockRecordsAPI",
    "MockTablesAPI",
    "MockRelationsAPI",
    "MockAppAPI",
    "MockAppsRegistry",
    "MockHttpClient",
    "MockHttpResponse",
    "MockNotificationService",
    "MockSecretsManager",
    "MockWorkflowsAPI",
    "MockConfig",
    # Harness utilities
    "WorkflowInstance",
    "WorkflowExecutor",
    "complete",
    "wait_for",
    # Time travel
    "PendingTimer",
    "PendingSleep",
    # Event simulation
    "SimulatedEvent",
    "EventMatcher",
    # Assertions
    "WorkflowAssertionError",
]
