"""Cross-project adapters.

shape_translators: convert between symbolic (entity_id, attr_type, value_idx)
records and numerical (vector, MI) entries.

convention_translators: map enum classes, key formats, scoring scales between
source-project conventions.

Bridges are pure translation. They contain no business logic.
"""

from unified_fragmergent_memory.bridges.shape_translators import (
    husimi_vector_to_value_emb,
    symbolic_to_numerical_skeleton,
    numerical_to_symbolic_skeleton,
    is_symbolic_entry,
    is_numerical_entry,
)
from unified_fragmergent_memory.bridges.convention_translators import (
    canonicalize_attr_family,
    serialize_slot_key,
    parse_slot_key,
    enum_value_to_string,
)
from unified_fragmergent_memory.bridges.cross_substrate_pressure import (
    consolidation_to_tf_perturbation,
    apply_mi_perturbations_to_bank,
    tf_result_to_synthetic_signals,
    audit_and_tf_to_signals,
    pressure_to_query_seed,
    tag_pressure_origin,
    get_pressure_origin,
    SlotPressureVector,
    consolidation_to_pressure_vectors,
    pressure_vectors_to_perturbation_dict,
    apply_pressure_vectors_to_bank,
    OPERATION_PROMOTE,
    OPERATION_RETROGRADE,
    OPERATION_PRUNE,
    OPERATION_RECONCILE,
    OPERATION_PERSISTENT_CONFLICT,
    DIRECTION_AMPLIFY,
    DIRECTION_ATTENUATE,
    DIRECTION_MASK,
    DIRECTION_NEUTRAL,
)

__all__ = [
    "husimi_vector_to_value_emb",
    "symbolic_to_numerical_skeleton",
    "numerical_to_symbolic_skeleton",
    "is_symbolic_entry",
    "is_numerical_entry",
    "canonicalize_attr_family",
    "serialize_slot_key",
    "parse_slot_key",
    "enum_value_to_string",
    "consolidation_to_tf_perturbation",
    "apply_mi_perturbations_to_bank",
    "tf_result_to_synthetic_signals",
    "audit_and_tf_to_signals",
    "pressure_to_query_seed",
    "tag_pressure_origin",
    "get_pressure_origin",
    "SlotPressureVector",
    "consolidation_to_pressure_vectors",
    "pressure_vectors_to_perturbation_dict",
    "apply_pressure_vectors_to_bank",
    "OPERATION_PROMOTE",
    "OPERATION_RETROGRADE",
    "OPERATION_PRUNE",
    "OPERATION_RECONCILE",
    "OPERATION_PERSISTENT_CONFLICT",
    "DIRECTION_AMPLIFY",
    "DIRECTION_ATTENUATE",
    "DIRECTION_MASK",
    "DIRECTION_NEUTRAL",
]
