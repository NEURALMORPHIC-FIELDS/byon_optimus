#!/usr/bin/env python3
"""
BYON Optimus Memory Bootstrap Script

This script initializes the Memory Service with system knowledge about BYON Optimus.
It loads the byon-system-knowledge.json and stores each section as facts in the
FHRSS+FCPE memory system.

Usage:
    python bootstrap-memory.py [--url http://localhost:8001]
"""

import json
import requests
import sys
import time
from pathlib import Path
from typing import Any

MEMORY_SERVICE_URL = "http://localhost:8001"

def store_fact(content: str, metadata: dict[str, Any]) -> dict:
    """Store a fact in the memory service."""
    # Server expects: data: {fact, source, tags}
    response = requests.post(
        MEMORY_SERVICE_URL,
        json={
            "action": "store",
            "type": "fact",
            "data": {
                "fact": content,
                "source": f"{metadata.get('category', 'system')}/{metadata.get('type', 'unknown')}",
                "tags": [metadata.get("type", "unknown"), metadata.get("category", "system")]
            }
        },
        timeout=30
    )
    return response.json()

def store_code(content: str, metadata: dict[str, Any]) -> dict:
    """Store code in the memory service."""
    # Server expects: data: {code, file_path, line_number, tags}
    response = requests.post(
        MEMORY_SERVICE_URL,
        json={
            "action": "store",
            "type": "code",
            "data": {
                "code": content,
                "file_path": metadata.get("filename", "unknown"),
                "line_number": 0,
                "tags": [metadata.get("language", "unknown")]
            }
        },
        timeout=30
    )
    return response.json()

def flatten_dict(d: dict, parent_key: str = "", sep: str = ".") -> list[tuple[str, str]]:
    """Flatten a nested dictionary into key-value pairs."""
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep))
        elif isinstance(v, list):
            if all(isinstance(item, str) for item in v):
                items.append((new_key, "\n".join(f"- {item}" for item in v)))
            elif all(isinstance(item, dict) for item in v):
                for i, item in enumerate(v):
                    items.extend(flatten_dict(item, f"{new_key}[{i}]", sep))
            else:
                items.append((new_key, json.dumps(v, indent=2)))
        else:
            items.append((new_key, str(v)))
    return items

def create_component_facts(components: list[dict]) -> list[dict]:
    """Create facts for each system component."""
    facts = []
    for comp in components:
        name = comp.get("name", "Unknown")
        role = comp.get("role", "")
        port = comp.get("port", "N/A")

        # Main component description
        content = f"BYON Component: {name}\nPort: {port}\nRole: {role}"
        if "capabilities" in comp:
            content += "\n\nCapabilities:\n" + "\n".join(f"- {c}" for c in comp["capabilities"])

        facts.append({
            "content": content,
            "metadata": {
                "category": "architecture",
                "component": name,
                "type": "component_description"
            }
        })

        # Endpoints if available
        if "endpoints" in comp:
            endpoint_content = f"{name} API Endpoints:\n"
            for endpoint, desc in comp["endpoints"].items():
                endpoint_content += f"  {endpoint}: {desc}\n"
            facts.append({
                "content": endpoint_content,
                "metadata": {
                    "category": "api",
                    "component": name,
                    "type": "endpoints"
                }
            })

        # API routes if available
        if "api_routes" in comp:
            routes_content = f"{name} API Routes:\n"
            for route, desc in comp["api_routes"].items():
                routes_content += f"  {route}: {desc}\n"
            facts.append({
                "content": routes_content,
                "metadata": {
                    "category": "api",
                    "component": name,
                    "type": "routes"
                }
            })

        # Security info if available
        if "security" in comp:
            sec = comp["security"]
            sec_content = f"{name} Security:\n"
            for k, v in sec.items():
                if isinstance(v, list):
                    sec_content += f"  {k}: {', '.join(v)}\n"
                else:
                    sec_content += f"  {k}: {v}\n"
            facts.append({
                "content": sec_content,
                "metadata": {
                    "category": "security",
                    "component": name,
                    "type": "security_config"
                }
            })

    return facts

def create_technology_facts(technologies: dict) -> list[dict]:
    """Create facts for each technology."""
    facts = []
    for tech_name, tech_info in technologies.items():
        content = f"Technology: {tech_name}\n"
        content += f"Full Name: {tech_info.get('full_name', tech_name)}\n"
        content += f"Description: {tech_info.get('description', '')}\n"

        for key, value in tech_info.items():
            if key not in ["full_name", "description"]:
                if isinstance(value, list):
                    content += f"{key}: {', '.join(value)}\n"
                else:
                    content += f"{key}: {value}\n"

        facts.append({
            "content": content,
            "metadata": {
                "category": "technology",
                "technology": tech_name,
                "type": "tech_description"
            }
        })

    return facts

def create_dataflow_facts(data_flow: dict) -> list[dict]:
    """Create facts for data flow documentation."""
    facts = []

    # Message processing flow
    if "message_processing" in data_flow:
        content = "BYON Message Processing Flow:\n\n"
        content += "\n".join(data_flow["message_processing"])
        facts.append({
            "content": content,
            "metadata": {
                "category": "architecture",
                "type": "data_flow"
            }
        })

    # Handoff directories
    if "handoff_directories" in data_flow:
        content = "BYON Handoff Directories:\n\n"
        for path, desc in data_flow["handoff_directories"].items():
            content += f"{path}: {desc}\n"
        facts.append({
            "content": content,
            "metadata": {
                "category": "architecture",
                "type": "handoff_directories"
            }
        })

    return facts

def create_security_facts(security: dict) -> list[dict]:
    """Create facts for security model."""
    facts = []

    # Security principles
    if "principles" in security:
        content = "BYON Security Principles:\n\n"
        content += "\n".join(f"- {p}" for p in security["principles"])
        facts.append({
            "content": content,
            "metadata": {
                "category": "security",
                "type": "principles"
            }
        })

    # Risk assessment
    if "risk_assessment" in security:
        content = "BYON Risk Assessment Levels:\n\n"
        for level, desc in security["risk_assessment"].items():
            content += f"- {level.upper()}: {desc}\n"
        facts.append({
            "content": content,
            "metadata": {
                "category": "security",
                "type": "risk_levels"
            }
        })

    # Approval flow
    if "approval_flow" in security:
        content = "BYON Approval Flow:\n\n"
        for flow_type, desc in security["approval_flow"].items():
            content += f"- {flow_type}: {desc}\n"
        facts.append({
            "content": content,
            "metadata": {
                "category": "security",
                "type": "approval_flow"
            }
        })

    return facts

def create_config_facts(config: dict) -> list[dict]:
    """Create facts for configuration."""
    facts = []

    # Environment variables
    if "environment_variables" in config:
        content = "BYON Environment Variables:\n\n"
        for var, desc in config["environment_variables"].items():
            content += f"- {var}: {desc}\n"
        facts.append({
            "content": content,
            "metadata": {
                "category": "configuration",
                "type": "environment_variables"
            }
        })

    # Docker compose info
    if "docker_compose" in config:
        dc = config["docker_compose"]
        content = "BYON Docker Configuration:\n\n"
        content += f"Network: {dc.get('network', 'N/A')}\n"
        if "volumes" in dc:
            content += "Volumes:\n"
            for vol in dc["volumes"]:
                content += f"  - {vol}\n"
        facts.append({
            "content": content,
            "metadata": {
                "category": "configuration",
                "type": "docker"
            }
        })

    return facts

def create_api_example_facts(examples: dict) -> list[dict]:
    """Create facts for API examples."""
    facts = []

    for example_name, example_data in examples.items():
        content = f"BYON Memory API Example - {example_name}:\n\n"
        content += "```json\n"
        content += json.dumps(example_data, indent=2)
        content += "\n```"
        facts.append({
            "content": content,
            "metadata": {
                "category": "api",
                "type": "example",
                "example_name": example_name
            }
        })

    return facts

def main():
    global MEMORY_SERVICE_URL

    # Parse command line args
    if len(sys.argv) > 1 and sys.argv[1] == "--url":
        MEMORY_SERVICE_URL = sys.argv[2]

    print(f"BYON Memory Bootstrap")
    print(f"=====================")
    print(f"Memory Service URL: {MEMORY_SERVICE_URL}")
    print()

    # Check memory service is available
    try:
        response = requests.post(
            MEMORY_SERVICE_URL,
            json={"action": "stats"},
            timeout=10
        )
        stats = response.json()
        print(f"Memory Service Status: Online")
        print(f"Current contexts: {stats.get('num_contexts', 0)}")
        print()
    except Exception as e:
        print(f"ERROR: Cannot connect to memory service: {e}")
        sys.exit(1)

    # Load knowledge file
    knowledge_file = Path(__file__).parent / "byon-system-knowledge.json"
    if not knowledge_file.exists():
        print(f"ERROR: Knowledge file not found: {knowledge_file}")
        sys.exit(1)

    with open(knowledge_file, "r", encoding="utf-8") as f:
        knowledge = json.load(f)

    print(f"Loaded knowledge from: {knowledge_file}")
    print()

    # Collect all facts to store
    all_facts = []

    # System identity
    identity = knowledge.get("system_identity", {})
    identity_content = f"""BYON Optimus System Identity

Name: {identity.get('name', 'BYON Optimus')}
Version: {identity.get('version', '1.0.0')}
Description: {identity.get('description', '')}
Patent Reference: {identity.get('patent_reference', '')}
Creator: {identity.get('creator', '')}"""

    all_facts.append({
        "content": identity_content,
        "metadata": {
            "category": "identity",
            "type": "system_identity"
        }
    })

    # Architecture overview
    arch = knowledge.get("architecture", {})
    if "overview" in arch:
        all_facts.append({
            "content": f"BYON Architecture Overview:\n\n{arch['overview']}",
            "metadata": {
                "category": "architecture",
                "type": "overview"
            }
        })

    # Components
    if "components" in arch:
        all_facts.extend(create_component_facts(arch["components"]))

    # Technologies
    if "technologies" in knowledge:
        all_facts.extend(create_technology_facts(knowledge["technologies"]))

    # Data flow
    if "data_flow" in knowledge:
        all_facts.extend(create_dataflow_facts(knowledge["data_flow"]))

    # Security
    if "security_model" in knowledge:
        all_facts.extend(create_security_facts(knowledge["security_model"]))

    # Configuration
    if "configuration" in knowledge:
        all_facts.extend(create_config_facts(knowledge["configuration"]))

    # API examples
    if "api_examples" in knowledge:
        all_facts.extend(create_api_example_facts(knowledge["api_examples"]))

    print(f"Prepared {len(all_facts)} facts to store")
    print()

    # Store all facts
    stored = 0
    errors = 0

    for i, fact in enumerate(all_facts):
        try:
            result = store_fact(fact["content"], fact["metadata"])
            if "ctx_id" in result:
                stored += 1
                category = fact["metadata"].get("category", "unknown")
                fact_type = fact["metadata"].get("type", "unknown")
                print(f"  [{i+1}/{len(all_facts)}] Stored: {category}/{fact_type} (ctx_id: {result['ctx_id']})")
            else:
                errors += 1
                print(f"  [{i+1}/{len(all_facts)}] WARN: No ctx_id in response: {result}")
        except Exception as e:
            errors += 1
            print(f"  [{i+1}/{len(all_facts)}] ERROR: {e}")

        # Small delay to avoid overwhelming the service
        time.sleep(0.1)

    print()
    print(f"Bootstrap Complete!")
    print(f"==================")
    print(f"Facts stored: {stored}")
    print(f"Errors: {errors}")

    # Verify by getting stats
    try:
        response = requests.post(
            MEMORY_SERVICE_URL,
            json={"action": "stats"},
            timeout=10
        )
        stats = response.json()
        print()
        print(f"Memory Service Stats After Bootstrap:")
        print(f"  Total contexts: {stats.get('num_contexts', 0)}")
        print(f"  By type: {stats.get('by_type', {})}")
    except Exception as e:
        print(f"Could not get final stats: {e}")

    # Test search
    print()
    print("Testing search...")
    try:
        response = requests.post(
            MEMORY_SERVICE_URL,
            json={
                "action": "search_all",
                "query": "what is BYON Optimus",
                "top_k": 3,
                "threshold": 0.3
            },
            timeout=30
        )
        results = response.json()
        total_results = len(results.get("facts", [])) + len(results.get("code", [])) + len(results.get("conversation", []))
        print(f"  Search for 'what is BYON Optimus': {total_results} results found")
        if results.get("facts"):
            print(f"  Top fact result similarity: {results['facts'][0].get('similarity', 0):.3f}")
    except Exception as e:
        print(f"  Search test failed: {e}")

if __name__ == "__main__":
    main()
