"""
Integration tests for the workflow engine.

These tests exercise the full workflow engine against in-memory stores,
testing complete scenarios including:
- Engine lifecycle (start/stop/recovery)
- Durable execution (crash recovery, replay)
- Step transitions (all types)
- @wait_for with events and timeouts
- @retry with all backoff strategies
- @parallel execution
- Version strategies (replace, parallel, migrate)
- Cancellation with compensation
- Dead letter queue handling
- All trigger types
- High volume scenarios
"""
