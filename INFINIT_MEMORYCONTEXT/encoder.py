"""
FCPE Encoder - Main Interface
=============================

High-level encoder interface that automatically selects the best backend.
"""

import numpy as np
from dataclasses import dataclass
from typing import Union, Optional

# Check for PyTorch
try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


@dataclass
class FCPEConfig:
    """
    Configuration for FCPE Encoder.

    Attributes:
        dim: Output dimension (default: 384, matches sentence-transformers)
        num_layers: Number of fractal encoding layers (default: 5)
        lambda_s: Stabilization factor (default: 0.5, optimized value)
        phi: Golden ratio for deterministic generation (default: 1.618...)
        compression_method: Pooling method ("weighted_attention" recommended)
        use_whitening: Apply feature whitening (default: True)
        use_content_seed: Use content-aware jitter (default: True)
        jitter_scale: Magnitude of content jitter (default: 0.05)
    """
    dim: int = 384
    num_layers: int = 5
    lambda_s: float = 0.5
    phi: float = 1.618033988749895
    compression_method: str = "weighted_attention"
    use_whitening: bool = True
    use_content_seed: bool = True
    jitter_scale: float = 0.05

    def __post_init__(self):
        """Validate configuration"""
        assert self.dim > 0, "dim must be positive"
        assert self.num_layers > 0, "num_layers must be positive"
        assert 0 < self.lambda_s < 1, "lambda_s must be in (0, 1)"
        assert self.jitter_scale >= 0, "jitter_scale must be non-negative"
        assert self.compression_method in [
            "mean", "max", "mean_max", "attention", "weighted_attention"
        ], f"Unknown compression_method: {self.compression_method}"


class FCPEEncoder:
    """
    FCPE Encoder - Main Interface

    Automatically selects NumPy or PyTorch backend based on input type.

    Example:
        >>> encoder = FCPEEncoder()

        # NumPy input
        >>> embeddings = np.random.randn(1000, 384)
        >>> compressed = encoder.encode(embeddings)

        # PyTorch input (if available)
        >>> embeddings = torch.randn(1000, 384)
        >>> compressed = encoder.encode(embeddings)

    Args:
        config: FCPEConfig instance or None for defaults
        backend: Force backend ("numpy", "torch", or "auto")
    """

    def __init__(self, config: Optional[FCPEConfig] = None, backend: str = "auto"):
        self.config = config or FCPEConfig()
        self.backend = backend

        # Initialize backends
        from .numpy_impl import FCPENumpy
        self._numpy_encoder = FCPENumpy(self.config)

        self._torch_encoder = None
        if HAS_TORCH and backend in ("auto", "torch"):
            try:
                from .torch_impl import FCPETorch
                self._torch_encoder = FCPETorch(self.config)
            except Exception:
                pass

    def encode(self, embeddings: Union[np.ndarray, "torch.Tensor"]) -> Union[np.ndarray, "torch.Tensor"]:
        """
        Compress sequence of embeddings to fixed-size vector.

        Args:
            embeddings: Input embeddings
                - NumPy: [seq_len, dim] or [batch, seq_len, dim]
                - PyTorch: [seq_len, dim] or [batch, seq_len, dim]

        Returns:
            Compressed vector(s) with same type as input
                - [dim] for single sequence
                - [batch, dim] for batch
        """
        # Determine input type
        is_torch = HAS_TORCH and isinstance(embeddings, torch.Tensor)

        if is_torch and self._torch_encoder is not None:
            return self._torch_encoder.encode(embeddings)
        else:
            # Convert to numpy if needed
            if is_torch:
                embeddings_np = embeddings.detach().cpu().numpy()
            else:
                embeddings_np = embeddings

            result = self._numpy_encoder.encode(embeddings_np)

            # Convert back to torch if input was torch
            if is_torch:
                return torch.from_numpy(result).to(embeddings.device)
            return result

    def __call__(self, embeddings):
        """Shortcut for encode()"""
        return self.encode(embeddings)

    def get_config(self) -> dict:
        """Get current configuration as dict"""
        return {
            "dim": self.config.dim,
            "num_layers": self.config.num_layers,
            "lambda_s": self.config.lambda_s,
            "compression_method": self.config.compression_method,
            "use_whitening": self.config.use_whitening,
            "use_content_seed": self.config.use_content_seed,
            "jitter_scale": self.config.jitter_scale,
            "backend": self.backend,
            "torch_available": self._torch_encoder is not None,
        }

    def __repr__(self):
        return f"FCPEEncoder(dim={self.config.dim}, backend={self.backend})"
