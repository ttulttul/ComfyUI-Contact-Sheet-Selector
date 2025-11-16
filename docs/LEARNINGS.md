# Learnings

- Implementing delayed selections required splitting state into `active` and `pending`, with the promotion happening only after each execution so the UI can remain synchronous with ComfyUI's execution loop. The helper module now keeps the behaviour testable without the ComfyUI runtime.
- Canvas coordinate discrepancies surfaced because the frontend was mixing global canvas coordinates with node-local offsets. LiteGraph already hands widget handlers node-local coordinates, so the fix is to trust those first and only fall back to drag-and-scale transforms (still logged in detail) when the raw values look implausible.
