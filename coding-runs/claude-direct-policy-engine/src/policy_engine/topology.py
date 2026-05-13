"""Shared topological sort used by both WorkflowEngine and Planner.

Extracted so the ordering logic has a single authoritative implementation.
"""
from __future__ import annotations

from typing import Dict, List

from .models import Step


def topological_order(steps: List[Step]) -> List[Step]:
    """Return *steps* in dependency-resolved order (Kahn's algorithm).

    Assumes the dependency graph is a DAG (the loader guarantees this).
    """
    step_map: Dict[str, Step] = {s.id: s for s in steps}
    in_degree:  Dict[str, int]       = {s.id: 0  for s in steps}
    dependents: Dict[str, List[str]] = {s.id: [] for s in steps}

    for step in steps:
        for dep in step.depends_on:
            in_degree[step.id] += 1
            dependents[dep].append(step.id)

    queue = [s.id for s in steps if in_degree[s.id] == 0]
    order: List[Step] = []
    while queue:
        node = queue.pop(0)
        order.append(step_map[node])
        for dep in dependents[node]:
            in_degree[dep] -= 1
            if in_degree[dep] == 0:
                queue.append(dep)

    return order