# Learnings

- Implementing delayed selections required splitting state into `active` and `pending`, with the promotion happening only after each execution so the UI can remain synchronous with ComfyUI's execution loop. The helper module now keeps the behaviour testable without the ComfyUI runtime.
