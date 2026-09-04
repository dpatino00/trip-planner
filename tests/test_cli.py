"""Tests for trip_planner.cli."""

from trip_planner.cli import app


# @spec OPS-PROC-008
def test_cli_entrypoint_is_available() -> None:
    """The existing Python entrypoint remains importable alongside the web app."""
    assert callable(app)
