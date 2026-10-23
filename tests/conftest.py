"""Shared fixtures."""
from pathlib import Path

import pytest

from engine.manifest import load_manifest

FIXTURE = Path(__file__).resolve().parent.parent / "manifests" / "worked_example_5agent.json"


@pytest.fixture
def manifest():
    """The canonical 5-agent chain manifest."""
    return load_manifest(FIXTURE)


@pytest.fixture(autouse=True)
def _hermetic_env(monkeypatch):
    """Tests never read demo/.env or use a real key: no network, no spend."""
    import demo.agents

    monkeypatch.setattr(demo.agents, "_load_env", lambda: None)
    for var in ("GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY",
                "GEMINI_GUARD_MODEL", "MAS_BACKEND"):
        monkeypatch.delenv(var, raising=False)
