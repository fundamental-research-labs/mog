# Workflow Engine

Durable Python workflow engine for Data OS. This package provides the testing infrastructure and cloud runtime for long-lived, durable workflows that can survive restarts, wait for external events, and orchestrate across multiple apps.

## Installation

```bash
# Install with pip
pip install -e .

# Install with dev dependencies
pip install -e ".[dev]"
```

## Quick Start

### Testing Workflows

The testing infrastructure enables comprehensive testing of workflows without running actual services:

```python
from workflow_engine.testing import WorkflowTest, MockContext

class TestExpenseApproval(WorkflowTest):
    workflow = ExpenseApprovalWorkflow

    def test_auto_approve_small_expense(self):
        # Set up mock data
        ctx = MockContext({
            "expenses": {
                "exp1": {"id": "exp1", "amount": 100, "employee_id": "emp1"}
            },
            "employees": {
                "emp1": {"id": "emp1", "name": "Alice", "manager_id": "mgr1"}
            }
        })

        # Trigger the workflow
        instance = self.trigger(ctx, event={
            "type": "record:created",
            "table": "expenses",
            "recordId": "exp1"
        })

        # Verify completion
        assert instance.status == "completed"
        assert ctx.records.updates["expenses"]["exp1"]["status"] == "approved"

    def test_manager_approval_with_timeout(self):
        ctx = MockContext({...})

        instance = self.trigger(ctx, event={...})

        # Advance time to trigger timeout
        ctx.time.advance(days=7)

        # Verify escalation happened
        assert instance.current_step == "escalate"
        assert any("cfo@" in e["to"] for e in ctx.emails)
```

### MockContext Features

```python
ctx = MockContext({
    # In-memory records by table
    "deals": {"deal1": {...}},
    "contacts": {"c1": {...}, "c2": {...}}
})

# Mock app API responses
ctx.apps.crm.mock_responses({
    "get_deal": {"id": "deal1", "name": "Acme", "value": 50000},
    "create_deal": {"id": "deal2", "name": "New Deal"}
})

# Capture all API calls for verification
assert ctx.apps.crm.calls["get_deal"][0]["deal_id"] == "deal1"

# Time travel for testing sleeps/timeouts
ctx.time.advance(hours=24)
ctx.time.advance(days=7)

# Inject events
ctx.events.inject({
    "type": "expense:approved",
    "expense_id": "exp1"
})

# Verify notifications
assert len(ctx.emails) == 1
assert len(ctx.slack_messages) == 2
assert len(ctx.toasts) == 1
```

## Package Structure

```
src/workflow_engine/
    __init__.py              # Package exports
    testing/
        __init__.py          # Testing module exports
        mock_context.py      # MockContext for mocking all APIs
        harness.py           # WorkflowTest base class
        time_travel.py       # Time manipulation utilities
        event_simulation.py  # Event injection and simulation
        assertions.py        # Custom workflow assertions
```

## Testing Infrastructure API

### MockContext

The `MockContext` class provides a complete mock implementation of the workflow context API:

- **Kernel APIs**: `ctx.records`, `ctx.tables`, `ctx.relations`
- **App APIs**: `ctx.apps.crm`, `ctx.apps.finance`, `ctx.apps.spreadsheet`, `ctx.apps.analytics`
- **External APIs**: `ctx.http`, `ctx.notify`, `ctx.secrets`
- **Time**: `ctx.now()`, `ctx.sleep()`, `ctx.time.advance()`
- **Workflows**: `ctx.spawn()`, `ctx.emit()`, `ctx.workflows`

### WorkflowTest

Base class for workflow test cases:

```python
class WorkflowTest:
    workflow: Type[Workflow]  # Set this to your workflow class

    def trigger(self, ctx: MockContext, event: dict) -> WorkflowInstance:
        """Start a workflow with the given event."""

    def advance_to_step(self, instance: WorkflowInstance, step_name: str) -> None:
        """Run the workflow until it reaches the specified step."""

    def inject_event(self, instance: WorkflowInstance, event: dict) -> None:
        """Send an event to a waiting workflow."""

    def assert_completed(self, instance: WorkflowInstance) -> None:
        """Assert the workflow has completed successfully."""

    def assert_step_history(self, instance: WorkflowInstance, expected: list[str]) -> None:
        """Assert the workflow executed the expected steps in order."""
```

### Time Travel

Test workflows with sleeps and timeouts:

```python
from workflow_engine.testing import TimeTraveler

# Advance time
ctx.time.advance(days=7)
ctx.time.advance(hours=24)
ctx.time.advance(minutes=30)

# Set specific time
ctx.time.set(datetime(2026, 3, 15, 10, 0, 0))

# Get current test time
now = ctx.now()
```

### Event Simulation

Inject external events into waiting workflows:

```python
from workflow_engine.testing import EventSimulator

# Inject event
ctx.events.inject({
    "type": "expense:approved",
    "expense_id": "exp1",
    "approved_by": "mgr1"
})

# Inject multiple events
ctx.events.inject_sequence([
    {"type": "step1:completed"},
    {"type": "step2:completed"},
])
```

## Development

```bash
# Run tests
pytest

# Run tests with coverage
pytest --cov=workflow_engine

# Type checking
mypy src/

# Lint
ruff check src/

# Format
black src/ tests/
```

## Related Documentation

- [Repository instructions](../../../AGENTS.md) - Development principles
