# Learnings

- Implementing delayed selections required splitting state into `active` and `pending`, with the promotion happening only after each execution so the UI can remain synchronous with ComfyUI's execution loop. The helper module now keeps the behaviour testable without the ComfyUI runtime.
- Canvas coordinate discrepancies surfaced because the frontend was mixing global canvas coordinates with node-local offsets. Added detailed logging (covering every drag-and-scale candidate plus the resolved graph coordinates) so we can capture the exact transforms—scale, offsets, widget baseline—during manual repros.
