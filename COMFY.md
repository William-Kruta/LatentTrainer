● ComfyUI uses a shared model manager running inside a single process. It tracks every loaded model's VRAM footprint and, before loading a new model, automatically  
 evicts or CPU-offloads other models to make room. The key insight: because SDXL and Flux both live inside the same Python process, the manager can freely move  
 weights between GPU and CPU RAM at will, without tearing anything down.

This system runs them as separate subprocesses with isolated CUDA contexts. PyTorch has no cross-process VRAM coordination — process 738164 (SDXL) and the Flux  
 subprocess each see their own allocations and can't reach into each other's memory. The only way to free what the SDXL process holds is to kill it, which is what
the fix does.

The real solution to match ComfyUI behavior is to merge both models into the same process under a shared model manager. When switching from SDXL → Flux, the  
 manager would:

1. Move SDXL weights to CPU RAM (not kill the process — just model.to("cpu") + torch.cuda.empty_cache())
2. Move Flux weights onto GPU
3. Run Flux inference
4. Swap back if needed

That way the SDXL model stays "warm" in CPU RAM and can be moved back to GPU in a few seconds rather than the full cold-start reload. It's a significant  
 architectural change — essentially building a mini ComfyUI model scheduler — but it's why ComfyUI feels seamless while subprocess-per-model systems always have
this friction.

For now the stop-before-Flux approach is the right tradeoff: correct, simple, and the SDXL restart cost is a known quantity. If the round-trip time becomes  
 annoying, the next step would be collapsing the two workers into one process with explicit model.to("cpu") / model.to("cuda") swaps between them.
