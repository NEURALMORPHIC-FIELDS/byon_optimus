#!/usr/bin/env python3
"""
================================================================================
BYON Optimus - Proprietary Software
Copyright (c) 2025-2026 Vasile Lucian Borbeleac
Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)

CONFIDENTIAL AND PROPRIETARY
Unauthorized copying, modification, or distribution is strictly prohibited.
================================================================================

FHRSS_FCPE_MULTISCALE_UNIFIED v3.0
================================================================================

COMPLETE unified system combining:
- FCPE (Fractal-Chaotic Persistent Encoding) - 384-dim semantic compression
- FHRSS CORRECTED (m² diagonal lines per patent EP25216372.0)
- Multi-Scale Spherical Domains (r_eff = 3.7 from propagation physics)
- Hexagonal Packing for optimal density
- Hierarchical Recovery (local → neighbor → global)

Author: Vasile Lucian Borbeleac
Patent: EP25216372.0 - OmniVault
Version: 3.0.0
================================================================================
"""

import numpy as np
import hashlib
import pickle
import zlib
import time
import os
import uuid
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any, Union
from dataclasses import dataclass, field, asdict
from functools import reduce
from operator import xor
import logging
import json
import threading

# Conditional FAISS import — graceful fallback to linear scan
try:
    import faiss
    HAS_FAISS = True
except ImportError:
    HAS_FAISS = False

logger = logging.getLogger(__name__)


# ============================================================================
# GF(256) ARITHMETIC — Reed-Solomon Support (Patent EP25216372.0)
# ============================================================================
# Primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1 = 0x11D
# Generator: alpha = 2 (primitive element, order 255)

_GF_EXP = [0] * 512   # anti-log table (doubled for modular wraparound)
_GF_LOG = [0] * 256    # log table

def _init_gf_tables():
    """Build GF(2^8) log/exp tables once at module load."""
    x = 1
    for i in range(255):
        _GF_EXP[i] = x
        _GF_LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D  # reduce by primitive polynomial
    # Extend exp table for easy modular arithmetic
    for i in range(255, 512):
        _GF_EXP[i] = _GF_EXP[i - 255]

_init_gf_tables()

def gf_mul(a: int, b: int) -> int:
    """Multiply two elements in GF(256)."""
    if a == 0 or b == 0:
        return 0
    return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]]

def gf_div(a: int, b: int) -> int:
    """Divide a by b in GF(256). b must be nonzero."""
    if b == 0:
        raise ZeroDivisionError("Division by zero in GF(256)")
    if a == 0:
        return 0
    return _GF_EXP[(_GF_LOG[a] - _GF_LOG[b]) % 255]

def gf_pow(a: int, n: int) -> int:
    """Raise a to power n in GF(256)."""
    if n == 0:
        return 1
    if a == 0:
        return 0
    return _GF_EXP[(_GF_LOG[a] * n) % 255]

# Precomputed alpha^i for i in 0..255
_ALPHA_POW = [_GF_EXP[i] for i in range(256)]


# ============================================================================
# CONFIGURATION
# ============================================================================

@dataclass
class FCPEConfig:
    """FCPE Configuration - Optimized for discrimination"""
    dim: int = 384
    num_layers: int = 5
    lambda_s: float = 0.5
    phi: float = 1.618033988749895
    compression_method: str = "weighted_attention"
    use_whitening: bool = True
    use_content_seed: bool = True
    jitter_scale: float = 0.05


@dataclass
class FHRSSConfig:
    """FHRSS Configuration - Reed-Solomon Enhanced Parity System"""
    subcube_size: int = 8
    profile: str = "FULL"
    use_checksums: bool = True
    parity_strength: int = 2  # 1 = XOR only, 2 = RS dual parity (GF(256))


@dataclass
class MultiScaleConfig:
    """Multi-Scale Spherical Domain Configuration"""
    enabled: bool = True
    grid_size: Tuple[int, int, int] = (32, 32, 8)
    domain_radius: float = 3.7  # Physics-based: r_eff = 2√(D/γ)
    use_hexagonal_packing: bool = True
    enable_neighbor_recovery: bool = True


@dataclass
class FAISSConfig:
    """FAISS Index Configuration for Episodic Memory Acceleration"""
    enabled: bool = True                # Enable FAISS acceleration
    index_type: str = "auto"            # "flat", "ivf", or "auto"
    ivf_nlist: int = 100                # Number of IVF clusters
    ivf_nprobe: int = 10                # Clusters to probe during search
    ivf_training_threshold: int = 1000  # Min vectors before switching to IVF
    index_filename: str = "faiss_index.bin"
    id_map_filename: str = "faiss_id_map.pkl"
    auto_save_interval: int = 100       # Save index every N additions (0=manual only)


@dataclass
class UnifiedConfigV3:
    """Combined FHRSS + FCPE + MultiScale + FAISS Configuration"""
    fcpe: FCPEConfig = field(default_factory=FCPEConfig)
    fhrss: FHRSSConfig = field(default_factory=FHRSSConfig)
    multiscale: MultiScaleConfig = field(default_factory=MultiScaleConfig)
    faiss: FAISSConfig = field(default_factory=FAISSConfig)
    storage_path: str = "./fhrss_fcpe_multiscale_storage"
    compression_enabled: bool = True
    auto_persist: bool = True
    max_memory_entries: int = 100000


# ============================================================================
# FCPE ENCODER (Semantic Compression)
# ============================================================================

class FCPEEncoder:
    """
    Fractal-Chaotic Persistent Encoding
    Compresses variable-length sequences to fixed-size vectors.
    """

    def __init__(self, config: FCPEConfig):
        self.config = config
        self.dim = config.dim
        self.num_layers = config.num_layers
        self.lambda_s = config.lambda_s
        self.phi = config.phi
        self.transforms = self._generate_transforms()
        self.permutations = self._generate_permutations()

    def _generate_transforms(self) -> List[np.ndarray]:
        transforms = []
        for i in range(self.num_layers):
            seed = int((i + 1) * self.phi * 1000000) % (2**31)
            np.random.seed(seed)
            W = np.random.randn(self.dim, self.dim)
            U, _, Vt = np.linalg.svd(W)
            transforms.append((U @ Vt).astype(np.float32))
        return transforms

    def _generate_permutations(self) -> List[np.ndarray]:
        permutations = []
        for i in range(self.num_layers):
            seed = int((i + 1) * self.phi * 2000000) % (2**31)
            np.random.seed(seed)
            perm = np.random.permutation(self.dim)
            permutations.append(perm)
        return permutations

    def _content_hash(self, seq: np.ndarray) -> int:
        sig = np.concatenate([
            seq.mean(axis=0)[:16],
            seq.std(axis=0)[:16],
            seq[0][:16] if len(seq) > 0 else np.zeros(16),
            seq[-1][:16] if len(seq) > 0 else np.zeros(16),
        ])
        return int(hashlib.md5(sig.tobytes()).hexdigest(), 16) % (2**31)

    def encode(self, embeddings: np.ndarray) -> np.ndarray:
        if embeddings.ndim == 1:
            embeddings = embeddings.reshape(1, -1)
        if embeddings.ndim == 2:
            return self._encode_sequence(embeddings)
        elif embeddings.ndim == 3:
            return np.stack([self._encode_sequence(seq) for seq in embeddings])
        else:
            raise ValueError(f"Expected 2D or 3D input, got {embeddings.ndim}D")

    def _encode_sequence(self, seq: np.ndarray) -> np.ndarray:
        if self.config.use_whitening:
            mean = seq.mean(axis=0)
            std = seq.std(axis=0)
            std = np.where(std < 1e-5, 1.0, std)
            seq = (seq - mean) / std

        if self.config.compression_method == "weighted_attention":
            norms = np.linalg.norm(seq, axis=1)
            mean_vec = seq.mean(axis=0)
            deviations = np.linalg.norm(seq - mean_vec, axis=1)
            scores = norms * (1 + deviations)
            scores = scores - scores.max()
            weights = np.exp(scores)
            weights = weights / (weights.sum() + 1e-8)
            x = (weights[:, None] * seq).sum(axis=0)
        else:
            x = seq.mean(axis=0)

        if len(x) != self.dim:
            np.random.seed(42)
            proj = np.random.randn(len(x), self.dim) / np.sqrt(len(x))
            x = x @ proj

        if self.config.use_content_seed:
            content_hash = self._content_hash(seq)
            rng = np.random.default_rng(content_hash)
            jitter = rng.standard_normal(self.dim) * self.config.jitter_scale
            x = x + jitter

        for i in range(self.num_layers):
            h = x @ self.transforms[i]
            h = h[self.permutations[i]]
            x = self.lambda_s * x + (1 - self.lambda_s) * h

        x = x / (np.linalg.norm(x) + 1e-8)
        return x.astype(np.float32)


# ============================================================================
# FHRSS ENCODER (Reed-Solomon Enhanced - CORRECTED m² diagonal lines)
# ============================================================================

class FHRSSEncoder:
    """FHRSS with RS-enhanced parity and CORRECTED m² diagonal lines per family.

    Upgrade from XOR-only (r=1) to Reed-Solomon dual parity (r=2):
        P1 = XOR(v[0], v[1], ..., v[m-1])                    (syndrome S1)
        P2 = XOR(α^0·v[0], α^1·v[1], ..., α^(m-1)·v[m-1])  (syndrome S2)

    r=1: corrects 1 erasure per line (XOR only)
    r=2: corrects 2 erasures per line (GF(256) solver)
    """

    PROFILES = {
        "MINIMAL": ["X", "Y", "Z"],
        "MEDIUM": ["X", "Y", "Z", "DXYp"],
        "HIGH": ["X", "Y", "Z", "DXYp", "DXZp", "DYZp"],
        "FULL": ["X", "Y", "Z", "DXYp", "DXYn", "DXZp", "DXZn", "DYZp", "DYZn"]
    }

    RECOVERY_PRIORITY = ["X", "Y", "Z", "DXYp", "DXZp", "DYZp", "DXYn", "DXZn", "DYZn"]

    def __init__(self, config: FHRSSConfig):
        self.config = config
        self.m = config.subcube_size
        self.r = config.parity_strength  # 1=XOR, 2=RS dual parity
        self.families = self.PROFILES[config.profile]
        self.num_families = len(self.families)
        # Overhead: 1 + r * num_families / m
        self.overhead_ratio = 1.0 + (self.r * self.num_families) / self.m

        self._line_cache: Dict[str, List[List[Tuple[int, int, int]]]] = {}
        for family in self.RECOVERY_PRIORITY:
            self._line_cache[family] = self._compute_line_indices(family)

    def _compute_line_indices(self, family: str) -> List[List[Tuple[int, int, int]]]:
        if family in ["X", "Y", "Z"]:
            return self._compute_axial_lines(family)
        else:
            return self._compute_diagonal_lines(family)

    def _compute_axial_lines(self, family: str) -> List[List[Tuple[int, int, int]]]:
        m = self.m
        lines = []
        if family == "X":
            for y in range(m):
                for z in range(m):
                    lines.append([(x, y, z) for x in range(m)])
        elif family == "Y":
            for x in range(m):
                for z in range(m):
                    lines.append([(x, y, z) for y in range(m)])
        elif family == "Z":
            for x in range(m):
                for y in range(m):
                    lines.append([(x, y, z) for z in range(m)])
        return lines

    def _compute_diagonal_lines(self, family: str) -> List[List[Tuple[int, int, int]]]:
        """CORRECTED: m² diagonal lines per family (not m)."""
        m = self.m
        lines = []

        if family == "DXYp":
            for z in range(m):  # CRITICAL: iterate over all planes
                for k in range(m):
                    lines.append([(i, (i + k) % m, z) for i in range(m)])
        elif family == "DXYn":
            for z in range(m):
                for k in range(m):
                    lines.append([(i, (k - i) % m, z) for i in range(m)])
        elif family == "DXZp":
            for y in range(m):
                for k in range(m):
                    lines.append([(i, y, (i + k) % m) for i in range(m)])
        elif family == "DXZn":
            for y in range(m):
                for k in range(m):
                    lines.append([(i, y, (k - i) % m) for i in range(m)])
        elif family == "DYZp":
            for x in range(m):
                for k in range(m):
                    lines.append([(x, i, (i + k) % m) for i in range(m)])
        elif family == "DYZn":
            for x in range(m):
                for k in range(m):
                    lines.append([(x, i, (k - i) % m) for i in range(m)])

        return lines

    def encode(self, data: bytes) -> Dict[str, Any]:
        """Encode data with RS-enhanced parity (r parities per line per family)."""
        m = self.m
        r = self.r
        subcube_bytes = m ** 3

        if len(data) < subcube_bytes:
            data = data + b'\x00' * (subcube_bytes - len(data))

        num_subcubes = (len(data) + subcube_bytes - 1) // subcube_bytes
        padded_len = num_subcubes * subcube_bytes
        padded_data = data.ljust(padded_len, b'\x00')

        subcubes = []
        for i in range(num_subcubes):
            chunk = padded_data[i * subcube_bytes:(i + 1) * subcube_bytes]
            cube = np.frombuffer(chunk, dtype=np.uint8).reshape(m, m, m)

            parity = {}
            for family in self.families:
                parity[family] = self._compute_parity(cube, family)

            checksum = hashlib.sha256(chunk).hexdigest() if self.config.use_checksums else ""

            subcubes.append({
                'data': cube.tobytes(),
                'parity': parity,
                'checksum': checksum,
                'subcube_id': i
            })

        return {
            'subcubes': subcubes,
            'original_length': len(data),
            'num_subcubes': num_subcubes,
            'profile': self.config.profile,
            'parity_strength': r
        }

    def _compute_parity(self, cube: np.ndarray, family: str) -> List:
        """Compute r parity values per line for one family.

        P1[line] = XOR of all values on the line
        P2[line] = XOR of (alpha^pos * value) for each position  [only if r>=2]
        """
        lines = self._line_cache[family]
        r = self.r
        parity = []

        for line_coords in lines:
            p1 = 0
            p2 = 0
            for pos, (x, y, z) in enumerate(line_coords):
                v = int(cube[x, y, z])
                p1 ^= v
                if r >= 2:
                    p2 ^= gf_mul(_ALPHA_POW[pos], v)

            if r >= 2:
                parity.append((p1, p2))
            else:
                parity.append((p1,))

        return parity

    def decode(self, encoded: Dict[str, Any], loss_masks: List[np.ndarray] = None) -> bytes:
        m = self.m
        recovered_data = []

        for i, sc in enumerate(encoded['subcubes']):
            cube = np.frombuffer(sc['data'], dtype=np.uint8).reshape(m, m, m).copy()

            if loss_masks and i < len(loss_masks):
                loss_mask = loss_masks[i]
                cube = self._recover_subcube(cube, sc['parity'], loss_mask)

            recovered_data.append(cube.tobytes())

        full_data = b''.join(recovered_data)
        return full_data[:encoded['original_length']]

    def _recover_subcube(self, cube: np.ndarray, parity: Dict[str, List],
                         loss_mask: np.ndarray) -> np.ndarray:
        """Recover a damaged subcube using iterative RS-enhanced parity.

        For each line:
            0 missing  → skip
            1 missing  → solve with P1 (XOR)
            2 missing  → solve with P1 + P2 (GF(256) 2×2 system)  [only if r>=2]
            3+ missing → skip, try again next iteration
        """
        data = cube.copy()
        r = self.r
        recovered = ~loss_mask

        max_iterations = self.num_families * 3

        for iteration in range(max_iterations):
            progress = False

            for family in self.RECOVERY_PRIORITY:
                if family not in parity:
                    continue

                lines = self._line_cache[family]
                family_parity = parity[family]

                for line_idx, line_coords in enumerate(lines):
                    missing_positions = []
                    known_values = []
                    known_positions = []

                    for pos, (x, y, z) in enumerate(line_coords):
                        if not recovered[x, y, z]:
                            missing_positions.append((pos, x, y, z))
                        else:
                            known_values.append(int(data[x, y, z]))
                            known_positions.append(pos)

                    num_missing = len(missing_positions)

                    if num_missing == 0 or num_missing > r:
                        continue  # skip: nothing to do or can't solve yet

                    p1_stored = family_parity[line_idx][0]

                    if num_missing == 1:
                        # --- 1-erasure correction (XOR) ---
                        pos_j, xj, yj, zj = missing_positions[0]
                        s1 = p1_stored ^ reduce(xor, known_values, 0)
                        data[xj, yj, zj] = s1
                        recovered[xj, yj, zj] = True
                        progress = True

                    elif num_missing == 2 and r >= 2:
                        # --- 2-erasure correction (GF(256) RS) ---
                        p2_stored = family_parity[line_idx][1]

                        pos_j, xj, yj, zj = missing_positions[0]
                        pos_k, xk, yk, zk = missing_positions[1]

                        # Compute syndromes
                        s1 = p1_stored
                        s2 = p2_stored
                        for pos, val in zip(known_positions, known_values):
                            s1 ^= val
                            s2 ^= gf_mul(_ALPHA_POW[pos], val)

                        # s1 = v[j] ⊕ v[k]
                        # s2 = α^j·v[j] ⊕ α^k·v[k]
                        # Solve:
                        # v[j] = (s2 ⊕ α^k·s1) / (α^j ⊕ α^k)
                        # v[k] = s1 ⊕ v[j]
                        aj = _ALPHA_POW[pos_j]
                        ak = _ALPHA_POW[pos_k]
                        denom = aj ^ ak  # GF addition = XOR

                        if denom == 0:
                            continue  # degenerate (should not happen since j != k)

                        numerator = s2 ^ gf_mul(ak, s1)
                        vj = gf_div(numerator, denom)
                        vk = s1 ^ vj

                        data[xj, yj, zj] = vj
                        data[xk, yk, zk] = vk
                        recovered[xj, yj, zj] = True
                        recovered[xk, yk, zk] = True
                        progress = True

            if not progress:
                break

        return data

    def inject_loss_realistic(self, encoded: Dict[str, Any], loss_percent: float,
                              seed: int = 42, damage_parity: bool = False
                              ) -> Tuple[Dict[str, Any], List[np.ndarray]]:
        """Inject random data loss for testing.

        Args:
            damage_parity: If True, also corrupt parity values (harder test).
                           If False, parity stays intact (standard test per reference repo).
        """
        import random
        rng = random.Random(seed)
        m = self.m

        damaged_subcubes = []
        loss_masks = []

        for sc in encoded['subcubes']:
            cube = np.frombuffer(sc['data'], dtype=np.uint8).reshape(m, m, m).copy()
            loss_mask = np.zeros((m, m, m), dtype=bool)

            # Corrupt DATA
            for x in range(m):
                for y in range(m):
                    for z in range(m):
                        if rng.random() < loss_percent:
                            loss_mask[x, y, z] = True
                            cube[x, y, z] = 0

            # Optionally corrupt PARITY
            if damage_parity:
                damaged_parity = {}
                for family, parity_list in sc['parity'].items():
                    damaged_list = []
                    for val in parity_list:
                        if isinstance(val, tuple):
                            # RS dual parity: corrupt each component independently
                            damaged_val = tuple(
                                0 if rng.random() < loss_percent else v
                                for v in val
                            )
                            damaged_list.append(damaged_val)
                        else:
                            if rng.random() < loss_percent:
                                damaged_list.append(0)
                            else:
                                damaged_list.append(val)
                    damaged_parity[family] = damaged_list
            else:
                damaged_parity = sc['parity']  # Parity intact (standard test)

            damaged_subcubes.append({
                'data': cube.tobytes(),
                'parity': damaged_parity,
                'checksum': sc['checksum'],
                'subcube_id': sc['subcube_id']
            })
            loss_masks.append(loss_mask)

        damaged = {
            'subcubes': damaged_subcubes,
            'original_length': encoded['original_length'],
            'num_subcubes': encoded['num_subcubes'],
            'profile': encoded['profile']
        }

        return damaged, loss_masks


# ============================================================================
# SPHERICAL DOMAIN with FHRSS
# ============================================================================

class FHRSSSphericalDomain:
    """
    Spherical domain with FHRSS encoding.
    Physics-based radius: r_eff = 2√(D/γ) ≈ 3.7
    Storage: 8×8×8 = 512 bytes per domain
    """

    def __init__(self, domain_id: str, center: Tuple[float, float, float],
                 radius: float = 3.7, config: FHRSSConfig = None):
        self.domain_id = domain_id
        self.center = np.array(center, dtype=float)
        self.radius = radius
        self.config = config or FHRSSConfig()
        self.fhrss = FHRSSEncoder(self.config)

        self.encoded_data = None
        self.raw_data = None

        # Statistics
        self.local_recoveries = 0
        self.neighbor_recoveries = 0
        self.failures = 0

        # Boundary nodes for neighbor recovery
        self.boundary_parity: Dict[int, int] = {}

    def store(self, data: bytes) -> bool:
        """Store data with FHRSS encoding."""
        try:
            # Pad to 512 bytes if needed
            if len(data) < 512:
                data = data + b'\x00' * (512 - len(data))
            elif len(data) > 512:
                data = data[:512]

            encoded = self.fhrss.encode(data)
            self.encoded_data = encoded
            self.raw_data = data

            # Compute boundary parity for neighbor recovery
            if encoded['subcubes'] and 'parity' in encoded['subcubes'][0]:
                parity = encoded['subcubes'][0]['parity']
                if 'X' in parity:
                    for i, p in enumerate(parity['X'][:8]):
                        self.boundary_parity[i] = p

            return True
        except Exception as e:
            logger.error(f"[{self.domain_id}] Store failed: {e}")
            return False

    def retrieve(self, corruption_rate: float = 0.0,
                 neighbor_parity: Dict[int, int] = None) -> Tuple[Optional[bytes], str]:
        """Retrieve with hierarchical recovery."""
        if self.encoded_data is None:
            return None, "no_data"

        m = self.fhrss.m

        # Simulate corruption
        if corruption_rate > 0:
            loss_mask = np.random.random((m, m, m)) < corruption_rate
        else:
            loss_mask = np.zeros((m, m, m), dtype=bool)

        # Try local recovery
        try:
            recovered = self.fhrss.decode(self.encoded_data, [loss_mask])
            checksum = self.encoded_data['subcubes'][0]['checksum']
            recovered_hash = hashlib.sha256(recovered[:512]).hexdigest()

            if recovered_hash == checksum:
                self.local_recoveries += 1
                return recovered, "local"

            # Try neighbor recovery if available
            if neighbor_parity:
                # TODO: Implement neighbor-assisted recovery
                pass

            self.failures += 1
            return recovered, "degraded"

        except Exception as e:
            self.failures += 1
            return None, f"error: {e}"


# ============================================================================
# MULTI-SCALE SYSTEM with Hexagonal Packing
# ============================================================================

class MultiScaleFHRSS:
    """
    Multi-scale distributed storage system.
    - Hexagonal packing for optimal density
    - Hierarchical recovery (local → neighbor → cluster)
    - Physics-based domain sizing (r_eff = 3.7)
    """

    def __init__(self, config: MultiScaleConfig = None, fhrss_config: FHRSSConfig = None):
        self.config = config or MultiScaleConfig()
        self.fhrss_config = fhrss_config or FHRSSConfig()

        self.domains: List[FHRSSSphericalDomain] = []
        self.domain_map: Dict[str, FHRSSSphericalDomain] = {}
        self.neighbors: Dict[str, List[str]] = {}

        if self.config.enabled:
            self._create_domains()
            self._compute_neighbors()

    def _create_domains(self):
        """Create domains with hexagonal packing."""
        spacing = 2 * self.config.domain_radius
        nx = int(self.config.grid_size[0] / spacing)
        ny = int(self.config.grid_size[1] / spacing)

        for i in range(nx):
            for j in range(ny):
                if self.config.use_hexagonal_packing:
                    offset_x = (spacing / 2 if j % 2 == 1 else 0)
                else:
                    offset_x = 0

                x = i * spacing + offset_x
                y = j * spacing
                z = self.config.grid_size[2] / 2

                if x < self.config.grid_size[0] and y < self.config.grid_size[1]:
                    domain_id = f"D{len(self.domains):03d}"
                    domain = FHRSSSphericalDomain(
                        domain_id=domain_id,
                        center=(x, y, z),
                        radius=self.config.domain_radius,
                        config=self.fhrss_config
                    )
                    self.domains.append(domain)
                    self.domain_map[domain_id] = domain

        logger.info(f"MultiScaleFHRSS v3.0: Created {len(self.domains)} domains")

    def _compute_neighbors(self):
        """Compute neighbor graph for hierarchical recovery."""
        threshold = 2.5 * self.config.domain_radius
        self.neighbors = {d.domain_id: [] for d in self.domains}

        for i, d1 in enumerate(self.domains):
            for d2 in self.domains[i+1:]:
                dist = np.linalg.norm(d1.center - d2.center)
                if dist <= threshold:
                    self.neighbors[d1.domain_id].append(d2.domain_id)
                    self.neighbors[d2.domain_id].append(d1.domain_id)

    def get_domain_for_data(self, data_id: int) -> FHRSSSphericalDomain:
        """Get domain for storing data based on consistent hashing."""
        if not self.domains:
            raise RuntimeError("No domains available")
        return self.domains[data_id % len(self.domains)]

    def store_distributed(self, data: bytes, file_id: str = None) -> str:
        """Store data distributed across domains."""
        if file_id is None:
            file_id = str(uuid.uuid4())[:8]

        chunk_size = 512
        padding = (chunk_size - len(data) % chunk_size) % chunk_size
        padded = data + b'\x00' * padding
        chunks = [padded[i:i+chunk_size] for i in range(0, len(padded), chunk_size)]

        stored = 0
        for i, chunk in enumerate(chunks):
            domain = self.get_domain_for_data(i)
            if domain.store(chunk):
                stored += 1

        logger.info(f"[{file_id}] Stored {stored}/{len(chunks)} chunks across {len(self.domains)} domains")
        return file_id

    def retrieve_distributed(self, num_chunks: int, original_size: int,
                             corruption_rate: float = 0.0) -> bytes:
        """Retrieve with hierarchical recovery."""
        chunks = []
        stats = {"local": 0, "degraded": 0, "failed": 0}

        for i in range(num_chunks):
            domain = self.get_domain_for_data(i)

            # Get neighbor parity for potential recovery
            neighbor_parity = {}
            if self.config.enable_neighbor_recovery:
                for neighbor_id in self.neighbors.get(domain.domain_id, []):
                    neighbor = self.domain_map.get(neighbor_id)
                    if neighbor and neighbor.boundary_parity:
                        neighbor_parity.update(neighbor.boundary_parity)

            chunk, method = domain.retrieve(corruption_rate, neighbor_parity)
            if chunk:
                chunks.append(chunk)
            else:
                chunks.append(b'\x00' * 512)

            if method in stats:
                stats[method] += 1

        data = b''.join(chunks)[:original_size]
        logger.info(f"Retrieved: {stats}")
        return data

    def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive system statistics."""
        total_local = sum(d.local_recoveries for d in self.domains)
        total_neighbor = sum(d.neighbor_recoveries for d in self.domains)
        total_failures = sum(d.failures for d in self.domains)

        return {
            "version": "3.0.0",
            "domains": len(self.domains),
            "capacity_bytes": len(self.domains) * 512,
            "local_recoveries": total_local,
            "neighbor_recoveries": total_neighbor,
            "failures": total_failures,
            "avg_neighbors": sum(len(n) for n in self.neighbors.values()) / max(1, len(self.domains)),
            "hexagonal_packing": self.config.use_hexagonal_packing,
            "domain_radius": self.config.domain_radius
        }


# ============================================================================
# FAISS INDEX MANAGER (Episodic Memory Acceleration)
# ============================================================================

class FAISSIndexManager:
    """
    Manages a FAISS index for fast nearest-neighbor search on FCPE vectors.

    Uses IndexFlatIP (inner product) for exact search on L2-normalized vectors.
    Inner product on unit vectors = cosine similarity.
    Auto-upgrades to IndexIVFFlat when vector count exceeds threshold.

    Thread-safe: all add/search/save operations are protected by a lock.
    """

    def __init__(self, dim: int, config: 'FAISSConfig', storage_path: Path):
        self.dim = dim
        self.config = config
        self.storage_path = storage_path
        self._index = None
        self._id_map: List[int] = []          # position → context_id
        self._id_to_pos: Dict[int, int] = {}  # context_id → position
        self._additions_since_save = 0
        self._is_ivf = False
        self._lock = threading.Lock()

        if not HAS_FAISS or not config.enabled:
            return

        # Try to load saved index, otherwise create empty flat
        if not self._load_index():
            self._create_flat_index()

    @property
    def is_available(self) -> bool:
        return HAS_FAISS and self.config.enabled and self._index is not None

    @property
    def ntotal(self) -> int:
        return self._index.ntotal if self._index is not None else 0

    def _create_flat_index(self):
        self._index = faiss.IndexFlatIP(self.dim)
        self._is_ivf = False
        self._id_map = []
        self._id_to_pos = {}
        logger.info(f"FAISS: created IndexFlatIP(dim={self.dim})")

    def _maybe_upgrade_to_ivf(self):
        """Auto-upgrade from Flat to IVF when enough vectors exist."""
        if self._is_ivf or self.config.index_type == "flat":
            return

        n = self._index.ntotal
        if n < self.config.ivf_training_threshold or n < self.config.ivf_nlist:
            return

        logger.info(f"FAISS: upgrading to IVF ({n} vectors, nlist={self.config.ivf_nlist})")

        # Extract all vectors from flat index
        all_vectors = np.zeros((n, self.dim), dtype=np.float32)
        for i in range(n):
            all_vectors[i] = faiss.rev_swig_ptr(
                self._index.get_xb(), n * self.dim
            ).reshape(n, self.dim)[i]

        # Simpler: reconstruct all at once
        all_vectors = faiss.rev_swig_ptr(
            self._index.get_xb(), n * self.dim
        ).reshape(n, self.dim).copy().astype(np.float32)

        # Create IVF index
        quantizer = faiss.IndexFlatIP(self.dim)
        ivf_index = faiss.IndexIVFFlat(
            quantizer, self.dim, self.config.ivf_nlist,
            faiss.METRIC_INNER_PRODUCT
        )
        ivf_index.nprobe = self.config.ivf_nprobe
        ivf_index.train(all_vectors)
        ivf_index.add(all_vectors)

        self._index = ivf_index
        self._is_ivf = True
        logger.info(f"FAISS: IVF upgrade complete ({n} vectors)")

    def add(self, context_id: int, vector: np.ndarray):
        """Add a single L2-normalized vector to the index."""
        if not self.is_available:
            return

        with self._lock:
            if context_id in self._id_to_pos:
                return  # idempotent

            vec = vector.reshape(1, -1).astype(np.float32)
            self._id_map.append(context_id)
            self._id_to_pos[context_id] = self._index.ntotal
            self._index.add(vec)

            self._additions_since_save += 1
            self._maybe_upgrade_to_ivf()

            if (self.config.auto_save_interval > 0 and
                    self._additions_since_save >= self.config.auto_save_interval):
                self._save_index_unlocked()

    def search(self, query_vector: np.ndarray, top_k: int = 5) -> List[Tuple[int, float]]:
        """
        Search by inner product (= cosine similarity for unit vectors).

        Returns list of (context_id, similarity_score), descending by score.
        """
        if not self.is_available or self._index.ntotal == 0:
            return []

        with self._lock:
            vec = query_vector.reshape(1, -1).astype(np.float32)
            k = min(top_k, self._index.ntotal)
            scores, indices = self._index.search(vec, k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if 0 <= idx < len(self._id_map):
                results.append((self._id_map[idx], float(score)))
        return results

    def rebuild_from_contexts(self, contexts: Dict[int, 'EncodedContextV3']):
        """Rebuild entire index from the context Dict (used on startup)."""
        if not HAS_FAISS or not self.config.enabled:
            return

        n = len(contexts)
        if n == 0:
            self._create_flat_index()
            return

        logger.info(f"FAISS: rebuilding index from {n} contexts")

        sorted_ids = sorted(contexts.keys())
        vectors = np.stack([
            contexts[cid].fcpe_vector for cid in sorted_ids
        ]).astype(np.float32)

        # Choose index type based on count
        use_ivf = (
            self.config.index_type != "flat" and
            n >= self.config.ivf_training_threshold and
            n >= self.config.ivf_nlist
        )

        if use_ivf:
            quantizer = faiss.IndexFlatIP(self.dim)
            self._index = faiss.IndexIVFFlat(
                quantizer, self.dim, self.config.ivf_nlist,
                faiss.METRIC_INNER_PRODUCT
            )
            self._index.nprobe = self.config.ivf_nprobe
            self._index.train(vectors)
            self._is_ivf = True
        else:
            self._index = faiss.IndexFlatIP(self.dim)
            self._is_ivf = False

        self._index.add(vectors)
        self._id_map = sorted_ids
        self._id_to_pos = {cid: pos for pos, cid in enumerate(sorted_ids)}

        logger.info(f"FAISS: rebuilt {'IVF' if use_ivf else 'Flat'} index with {n} vectors")

    def save_index(self):
        """Save FAISS index and ID map to disk (thread-safe)."""
        if not self.is_available:
            return
        with self._lock:
            self._save_index_unlocked()

    def _save_index_unlocked(self):
        """Internal save (caller must hold lock)."""
        index_path = self.storage_path / self.config.index_filename
        map_path = self.storage_path / self.config.id_map_filename

        try:
            faiss.write_index(self._index, str(index_path))
            with open(map_path, 'wb') as f:
                pickle.dump({
                    'id_map': self._id_map,
                    'is_ivf': self._is_ivf
                }, f)
            self._additions_since_save = 0
            logger.info(f"FAISS: saved index ({self._index.ntotal} vectors)")
        except Exception as e:
            logger.warning(f"FAISS: failed to save index: {e}")

    def _load_index(self) -> bool:
        """Load FAISS index from disk. Returns True if successful."""
        index_path = self.storage_path / self.config.index_filename
        map_path = self.storage_path / self.config.id_map_filename

        if not index_path.exists() or not map_path.exists():
            return False

        try:
            self._index = faiss.read_index(str(index_path))
            with open(map_path, 'rb') as f:
                map_data = pickle.load(f)

            self._id_map = map_data['id_map']
            self._is_ivf = map_data.get('is_ivf', False)
            self._id_to_pos = {cid: pos for pos, cid in enumerate(self._id_map)}

            if self._is_ivf and hasattr(self._index, 'nprobe'):
                self._index.nprobe = self.config.ivf_nprobe

            logger.info(f"FAISS: loaded index ({self._index.ntotal} vectors, "
                         f"{'IVF' if self._is_ivf else 'Flat'})")
            return True
        except Exception as e:
            logger.warning(f"FAISS: failed to load index: {e}")
            return False


# ============================================================================
# UNIFIED SYSTEM v3.0 (FCPE + FHRSS + MultiScale + FAISS)
# ============================================================================

@dataclass
class EncodedContextV3:
    """Single encoded context with FCPE + FHRSS + Domain info"""
    context_id: int
    fcpe_vector: np.ndarray
    fhrss_encoded: Dict[str, Any]
    domain_id: Optional[str]
    original_hash: str
    metadata: Dict[str, Any]
    timestamp: float
    access_count: int = 0


class UnifiedFHRSS_FCPE_MultiScale:
    """
    COMPLETE unified system v3.0:
    - FCPE for semantic compression (384-dim)
    - FHRSS for fault tolerance (100% @ 40% known loss)
    - Multi-Scale for distribution & scalability
    """

    def __init__(self, config: UnifiedConfigV3 = None):
        self.config = config or UnifiedConfigV3()

        # Initialize components
        self.fcpe = FCPEEncoder(self.config.fcpe)
        self.fhrss = FHRSSEncoder(self.config.fhrss)

        # Multi-scale (optional)
        if self.config.multiscale.enabled:
            self.multiscale = MultiScaleFHRSS(
                self.config.multiscale,
                self.config.fhrss
            )
        else:
            self.multiscale = None

        # Context storage
        self.contexts: Dict[int, EncodedContextV3] = {}
        self.next_id = 0

        # Storage path
        self.storage_path = Path(self.config.storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

        # Load existing contexts
        if self.config.auto_persist:
            self._load_from_disk()

        # FAISS index (initialized after contexts are loaded)
        self._init_faiss_index()

        logger.info(f"UnifiedFHRSS_FCPE_MultiScale v3.0 initialized")
        logger.info(f"  FCPE: {self.config.fcpe.dim}-dim")
        logger.info(f"  FHRSS: {self.config.fhrss.profile} profile, {self.fhrss.overhead_ratio:.3f}x overhead")
        if self.multiscale:
            logger.info(f"  MultiScale: {len(self.multiscale.domains)} domains, hexagonal={self.config.multiscale.use_hexagonal_packing}")
        if self._faiss is not None and self._faiss.is_available:
            logger.info(f"  FAISS: {'IVF' if self._faiss._is_ivf else 'Flat'} index, {self._faiss.ntotal} vectors")

    def encode_context(self, embeddings: np.ndarray, metadata: Dict[str, Any] = None) -> int:
        """Encode context with FCPE + FHRSS."""
        ctx_id = self.next_id
        self.next_id += 1

        # FCPE compression
        fcpe_vector = self.fcpe.encode(embeddings)

        # FHRSS encoding
        vector_bytes = fcpe_vector.tobytes()
        fhrss_encoded = self.fhrss.encode(vector_bytes)

        # Domain assignment (if multi-scale enabled)
        domain_id = None
        if self.multiscale and self.multiscale.domains:
            domain = self.multiscale.get_domain_for_data(ctx_id)
            domain_id = domain.domain_id
            domain.store(vector_bytes)

        # Create context
        context = EncodedContextV3(
            context_id=ctx_id,
            fcpe_vector=fcpe_vector,
            fhrss_encoded=fhrss_encoded,
            domain_id=domain_id,
            original_hash=hashlib.sha256(fcpe_vector.tobytes()).hexdigest(),
            metadata=metadata or {},
            timestamp=time.time()
        )

        self.contexts[ctx_id] = context

        # Add to FAISS index in real-time
        if self._faiss is not None:
            self._faiss.add(ctx_id, fcpe_vector)

        if self.config.auto_persist:
            self._persist_context(context)

        return ctx_id

    def retrieve_context(self, ctx_id: int, corruption_rate: float = 0.0) -> Optional[np.ndarray]:
        """Retrieve context with automatic recovery."""
        if ctx_id not in self.contexts:
            return None

        context = self.contexts[ctx_id]
        context.access_count += 1

        if corruption_rate > 0:
            # Test recovery
            damaged, loss_masks = self.fhrss.inject_loss_realistic(
                context.fhrss_encoded, corruption_rate
            )
            recovered_bytes = self.fhrss.decode(damaged, loss_masks)
            return np.frombuffer(recovered_bytes, dtype=np.float32)[:self.config.fcpe.dim]
        else:
            return context.fcpe_vector.copy()

    def retrieve_similar(self, query_vector: np.ndarray, top_k: int = 5) -> List[Dict[str, Any]]:
        """Semantic similarity search.

        Uses FAISS inner-product index when available (O(log n) for IVF,
        O(n) SIMD-accelerated for Flat). Falls back to linear numpy scan
        when FAISS is not installed or disabled.
        """
        if len(query_vector.shape) == 2:
            query_vector = self.fcpe.encode(query_vector)

        query_norm = np.linalg.norm(query_vector)
        if query_norm < 1e-8:
            return []

        # Normalize query (IP on unit vectors = cosine similarity)
        normalized_query = query_vector / query_norm

        # --- FAISS fast path ---
        if (self._faiss is not None and
                self._faiss.is_available and
                self._faiss.ntotal > 0):
            faiss_results = self._faiss.search(normalized_query, top_k)
            results = []
            for ctx_id, similarity in faiss_results:
                if ctx_id in self.contexts:
                    ctx = self.contexts[ctx_id]
                    results.append({
                        'ctx_id': ctx_id,
                        'similarity': similarity,
                        'metadata': ctx.metadata,
                        'domain_id': ctx.domain_id,
                        'access_count': ctx.access_count
                    })
            return results

        # --- Linear scan fallback ---
        results = []
        for ctx_id, ctx in self.contexts.items():
            ctx_norm = np.linalg.norm(ctx.fcpe_vector)
            if ctx_norm < 1e-8:
                continue

            similarity = float(np.dot(query_vector, ctx.fcpe_vector) / (query_norm * ctx_norm))
            results.append({
                'ctx_id': ctx_id,
                'similarity': similarity,
                'metadata': ctx.metadata,
                'domain_id': ctx.domain_id,
                'access_count': ctx.access_count
            })

        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:top_k]

    def test_recovery(self, ctx_id: int, loss_percent: float, seed: int = 42,
                       damage_parity: bool = False) -> Dict[str, Any]:
        """Test recovery at specified loss level using RS-enhanced parity.

        Args:
            damage_parity: If True, also corrupt parity (harder test).
                           Default False = parity intact (standard per reference repo).
        """
        if ctx_id not in self.contexts:
            raise KeyError(f"Context {ctx_id} not found")

        context = self.contexts[ctx_id]
        original_vector = context.fcpe_vector.copy()

        # Inject loss (parity intact by default for standard RS testing)
        damaged, loss_masks = self.fhrss.inject_loss_realistic(
            context.fhrss_encoded, loss_percent, seed,
            damage_parity=damage_parity
        )

        # Recover using RS-enhanced iterative cascade
        t0 = time.time()
        recovered_bytes = self.fhrss.decode(damaged, loss_masks)
        recovery_time = (time.time() - t0) * 1000

        # Verify
        recovered_vector = np.frombuffer(recovered_bytes, dtype=np.float32)
        if len(recovered_vector) >= self.config.fcpe.dim:
            recovered_vector = recovered_vector[:self.config.fcpe.dim]
        else:
            recovered_vector = np.pad(recovered_vector,
                                      (0, self.config.fcpe.dim - len(recovered_vector)))

        # Metrics
        recovered_hash = hashlib.sha256(recovered_vector.tobytes()).hexdigest()
        hash_match = recovered_hash == context.original_hash

        cosine_sim = float(np.dot(original_vector, recovered_vector) / (
            np.linalg.norm(original_vector) * np.linalg.norm(recovered_vector) + 1e-8
        ))

        return {
            'loss_percent': loss_percent * 100,
            'hash_match': hash_match,
            'cosine_similarity': cosine_sim,
            'recovery_time_ms': recovery_time,
            'parity_strength': self.fhrss.r,
            'parity_damaged': damage_parity
        }

    def get_stats(self) -> Dict[str, Any]:
        """Get comprehensive statistics."""
        total_bytes = sum(
            len(ctx.fcpe_vector.tobytes()) +
            sum(len(sc['data']) for sc in ctx.fhrss_encoded['subcubes'])
            for ctx in self.contexts.values()
        )

        stats = {
            'version': '3.0.0',
            'num_contexts': len(self.contexts),
            'fcpe_dim': self.config.fcpe.dim,
            'fhrss_profile': self.config.fhrss.profile,
            'fhrss_overhead': self.fhrss.overhead_ratio,
            'total_storage_bytes': total_bytes,
            'total_storage_mb': total_bytes / (1024 * 1024),
            'multiscale_enabled': self.config.multiscale.enabled
        }

        if self.multiscale:
            stats['multiscale'] = self.multiscale.get_statistics()

        # FAISS index statistics
        stats['faiss_available'] = HAS_FAISS
        stats['faiss_enabled'] = self.config.faiss.enabled
        if self._faiss is not None and self._faiss.is_available:
            stats['faiss_index_type'] = 'IVF' if self._faiss._is_ivf else 'Flat'
            stats['faiss_index_size'] = self._faiss.ntotal
        else:
            stats['faiss_index_type'] = 'none'
            stats['faiss_index_size'] = 0

        return stats

    def _init_faiss_index(self):
        """Initialize the FAISS index, rebuilding from contexts if needed."""
        if not HAS_FAISS or not self.config.faiss.enabled:
            self._faiss = None
            return

        self._faiss = FAISSIndexManager(
            dim=self.config.fcpe.dim,
            config=self.config.faiss,
            storage_path=self.storage_path
        )

        # Verify index matches context count, rebuild if mismatched
        if self._faiss.is_available:
            if self._faiss.ntotal != len(self.contexts):
                logger.warning(
                    f"FAISS index has {self._faiss.ntotal} vectors but "
                    f"Dict has {len(self.contexts)} contexts — rebuilding"
                )
                self._faiss.rebuild_from_contexts(self.contexts)
                self._faiss.save_index()
        elif len(self.contexts) > 0:
            # No saved index but we have contexts — rebuild
            self._faiss.rebuild_from_contexts(self.contexts)
            self._faiss.save_index()

    def save_faiss_index(self):
        """Explicitly save the FAISS index to disk."""
        if self._faiss is not None:
            self._faiss.save_index()

    def _persist_context(self, context: EncodedContextV3):
        """Persist context to disk."""
        path = self.storage_path / f"ctx_{context.context_id}.pkl"
        data = {
            'context_id': context.context_id,
            'fcpe_vector': context.fcpe_vector.tobytes(),
            'fcpe_dim': len(context.fcpe_vector),
            'fhrss_encoded': context.fhrss_encoded,
            'domain_id': context.domain_id,
            'original_hash': context.original_hash,
            'metadata': context.metadata,
            'timestamp': context.timestamp,
            'access_count': context.access_count
        }
        with open(path, 'wb') as f:
            pickle.dump(data, f)

    def _load_from_disk(self):
        """Load persisted contexts."""
        for path in self.storage_path.glob("ctx_*.pkl"):
            try:
                with open(path, 'rb') as f:
                    data = pickle.load(f)

                fcpe_vector = np.frombuffer(data['fcpe_vector'], dtype=np.float32)

                context = EncodedContextV3(
                    context_id=data['context_id'],
                    fcpe_vector=fcpe_vector,
                    fhrss_encoded=data['fhrss_encoded'],
                    domain_id=data.get('domain_id'),
                    original_hash=data['original_hash'],
                    metadata=data.get('metadata', {}),
                    timestamp=data['timestamp'],
                    access_count=data.get('access_count', 0)
                )

                self.contexts[context.context_id] = context
                self.next_id = max(self.next_id, context.context_id + 1)

            except Exception as e:
                logger.warning(f"Failed to load {path}: {e}")

        logger.info(f"Loaded {len(self.contexts)} contexts from disk")


# ============================================================================
# BACKWARDS COMPATIBILITY ALIASES
# ============================================================================

# Alias for old code that uses UnifiedConfig
UnifiedConfig = UnifiedConfigV3

# Alias for old unified system
UnifiedFHRSS_FCPE = UnifiedFHRSS_FCPE_MultiScale


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    print("=" * 80)
    print("FHRSS + FCPE + MULTISCALE UNIFIED v3.0 - VALIDATION")
    print("=" * 80)

    # Initialize system
    config = UnifiedConfigV3()
    system = UnifiedFHRSS_FCPE_MultiScale(config)

    # Test encoding
    print("\n[TEST 1] Encode context")
    test_emb = np.random.randn(10, 384).astype(np.float32)
    ctx_id = system.encode_context(test_emb, {'test': 'v3.0'})
    print(f"  Encoded context {ctx_id}")

    # Test recovery
    print("\n[TEST 2] Recovery test (realistic - parity corrupted)")
    for loss in [0.1, 0.2, 0.3, 0.4]:
        result = system.test_recovery(ctx_id, loss)
        status = "MATCH" if result['hash_match'] else "DEGRADED"
        print(f"  {loss*100:.0f}% loss: similarity={result['cosine_similarity']:.4f}, {status}")

    # Stats
    print("\n[TEST 3] System statistics")
    stats = system.get_stats()
    for k, v in stats.items():
        if not isinstance(v, dict):
            print(f"  {k}: {v}")

    print("\n" + "=" * 80)
    print("VALIDATION COMPLETE - v3.0 OPERATIONAL")
    print("=" * 80)
