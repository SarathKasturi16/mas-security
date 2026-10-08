"""Load a capability manifest into a graph + risk-weight vector.

The manifest is the single source of truth for one multi-agent system. See
``manifests/SCHEMA.md`` for the file format. Weights are a pure table lookup on
operator-declared capabilities (never inferred from behaviour), so a compromised
agent cannot change its own weight.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import networkx as nx

# Weight formula coefficients (brief §4.3). w(v) = 1 + sum(coeff for each cap held).
CAP_WEIGHTS: dict[str, float] = {
    "shell": 2.0,
    "credentials": 2.0,
    "tool_exec": 1.5,
    "egress": 1.5,
    "spawn": 1.0,
    "file_write": 1.0,
}
ALLOWED_CAPS = frozenset(CAP_WEIGHTS)
BASE_WEIGHT = 1.0
MAX_WEIGHT = BASE_WEIGHT + sum(CAP_WEIGHTS.values())  # = 10.0


def weight_of(caps) -> float:
    """Risk weight w(v) for an agent holding ``caps`` (a table lookup)."""
    bad = set(caps) - ALLOWED_CAPS
    if bad:
        raise ValueError(f"unknown capabilities {sorted(bad)}; allowed {sorted(ALLOWED_CAPS)}")
    return BASE_WEIGHT + sum(CAP_WEIGHTS[c] for c in set(caps))


@dataclass
class Manifest:
    """A parsed, validated multi-agent system."""

    name: str
    graph: nx.DiGraph           # nodes carry 'label', 'caps', 'weight'
    entry: list[str]
    budget: float = 10.0
    description: str = ""
    source: str = ""

    @property
    def nodes(self) -> list[str]:
        return list(self.graph.nodes)

    def weight(self, v: str) -> float:
        return self.graph.nodes[v]["weight"]

    @property
    def weights(self) -> dict[str, float]:
        return {v: self.graph.nodes[v]["weight"] for v in self.graph.nodes}

    def undirected(self) -> nx.Graph:
        """Undirected skeleton used for elimination ordering / decomposition."""
        return self.graph.to_undirected()


def load_manifest(path: str | Path) -> Manifest:
    """Parse and validate a manifest JSON file into a :class:`Manifest`."""
    path = Path(path)
    data = json.loads(path.read_text())

    for key in ("name", "agents", "edges"):
        if key not in data:
            raise ValueError(f"manifest {path} missing required key '{key}'")

    g = nx.DiGraph()
    for node, spec in data["agents"].items():
        caps = list(spec.get("caps", []))
        g.add_node(
            node,
            label=spec.get("label", node),
            caps=caps,
            weight=weight_of(caps),
        )

    for e in data["edges"]:
        u, v = e["from"], e["to"]
        for endpoint in (u, v):
            if endpoint not in g:
                raise ValueError(f"edge references undeclared agent '{endpoint}' in {path}")
        g.add_edge(u, v, source=e.get("source", ""))

    entry = list(data.get("entry", []))
    for a in entry:
        if a not in g:
            raise ValueError(f"entry references undeclared agent '{a}' in {path}")

    return Manifest(
        name=data["name"],
        graph=g,
        entry=entry,
        budget=float(data.get("budget", 10.0)),
        description=data.get("description", ""),
        source=data.get("source", ""),
    )
