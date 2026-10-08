"""Shared fixtures."""
from pathlib import Path

import pytest

from engine.manifest import load_manifest

FIXTURE = Path(__file__).resolve().parent.parent / "manifests" / "worked_example_5agent.json"


@pytest.fixture
def manifest():
    """The canonical 5-agent chain manifest."""
    return load_manifest(FIXTURE)
