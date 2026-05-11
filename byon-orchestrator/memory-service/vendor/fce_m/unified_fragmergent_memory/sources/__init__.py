"""Passthrough namespaces for the three source projects.

Each subpackage extends sys.path or constructs a deferred-import handle so
that source primitives are reachable through the unified namespace without
modifying the source files (R1).
"""
