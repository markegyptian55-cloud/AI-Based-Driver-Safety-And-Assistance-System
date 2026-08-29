"""
utils/gpu_utils.py
------------------
Small helpers for choosing and monitoring the compute device.
"""

import torch


def select_device(device_str=None):
    """
    device_str : "cuda:0", "cuda:1", "cpu", or None (auto).
    Returns a torch.device, printing what was chosen. Falls back to CPU.
    """
    if device_str is None:
        device_str = "cuda:0" if torch.cuda.is_available() else "cpu"

    if device_str.startswith("cuda") and not torch.cuda.is_available():
        print("[gpu] CUDA not available -> using CPU")
        device_str = "cpu"

    device = torch.device(device_str)
    if device.type == "cuda":
        idx = device.index if device.index is not None else 0
        print(f"[gpu] using {device_str}  ({torch.cuda.get_device_name(idx)})")
    else:
        print("[gpu] using CPU")
    return device


def print_gpu_memory(device):
    """Print current allocated / reserved GPU memory in MB."""
    if device.type != "cuda":
        return
    idx = device.index if device.index is not None else 0
    alloc = torch.cuda.memory_allocated(idx) / 1024**2
    reserved = torch.cuda.memory_reserved(idx) / 1024**2
    print(f"[gpu] memory: allocated {alloc:.0f} MB | reserved {reserved:.0f} MB")


def clear_cache(device):
    """Release cached (unused) GPU memory. Use sparingly, not every batch."""
    if device.type == "cuda":
        torch.cuda.empty_cache()


def list_gpus():
    """Print all visible CUDA devices."""
    if not torch.cuda.is_available():
        print("[gpu] no CUDA devices found")
        return
    for i in range(torch.cuda.device_count()):
        print(f"  cuda:{i} -> {torch.cuda.get_device_name(i)}")
