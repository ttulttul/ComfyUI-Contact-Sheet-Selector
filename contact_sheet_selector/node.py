from __future__ import annotations

import base64
import hashlib
import logging
from io import BytesIO
from typing import List

import torch
from PIL import Image
from aiohttp import web
from typing_extensions import override

from comfy_api.latest import ComfyExtension, io
from comfy_execution.utils import get_executing_context

try:  # pragma: no cover - server import is optional in tests
    from server import PromptServer
except ModuleNotFoundError:  # pragma: no cover - running outside ComfyUI
    PromptServer = None

from .state import (
    resolve_selection_for_execution,
    queue_pending_selection,
    inspect_state,
    get_preview_cache,
    update_preview_cache,
)

logger = logging.getLogger(__name__)


def _ensure_int(value) -> int:
    if isinstance(value, torch.Tensor):
        return int(value.item())
    if isinstance(value, (list, tuple)):
        if not value:
            return 0
        return _ensure_int(value[0])
    return int(value)


def _encode_tensor_to_data_url(image_tensor: torch.Tensor) -> str:
    """Convert a single image tensor to a PNG data URL for UI preview."""
    tensor = image_tensor.detach().to(device="cpu")

    if tensor.dim() == 4 and tensor.shape[0] == 1:
        tensor = tensor[0]

    if tensor.dim() != 3:
        raise ValueError(f"Unexpected tensor shape for preview encoding: {tensor.shape}")

    array = torch.clamp(tensor, 0.0, 1.0).mul(255).byte().numpy()
    pil_image = Image.fromarray(array)
    buffer = BytesIO()
    pil_image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _gather_selected_images(images: torch.Tensor, selection: List[int]) -> torch.Tensor:
    """Return a batch containing only the selected indices."""
    if len(selection) == 0:
        return images[0:0]
    index_tensor = torch.tensor(selection, dtype=torch.long, device=images.device)
    return torch.index_select(images, 0, index_tensor)


def _compute_preview_signature(images: torch.Tensor) -> str:
    """Create a lightweight signature so we can reuse previously encoded previews."""
    tensor = images.detach()
    shape = tuple(int(dim) for dim in tensor.shape)
    numel = tensor.numel()
    sample_size = min(numel, 4096)
    if sample_size == 0:
        return f"{shape}|empty"
    sample = tensor.flatten()[:sample_size].to(dtype=torch.float32, device="cpu", copy=True)
    digest = hashlib.sha1(sample.numpy().tobytes()).hexdigest()
    return f"{shape}|{sample_size}|{digest}"


class ContactSheetSelector(io.ComfyNode):
    """A node that presents a grid of images and lets the user pick which ones to output next run."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ContactSheetSelector",
            display_name="Contact Sheet Selector",
            category="image/batch",
            description=(
                "Display the incoming batch as a contact sheet and let the user choose "
                "which images should be forwarded on the next execution."
            ),
            inputs=[
                io.Image.Input("images"),
                io.Int.Input(
                    "columns",
                    default=0,
                    min=0,
                    max=12,
                    step=1,
                    tooltip="Number of columns to display in the contact sheet (0 = auto).",
                    lazy=True,
                ),
            ],
            outputs=[
                io.Image.Output(display_name="selected_images"),
            ],
        )

    @classmethod
    def execute(cls, images: torch.Tensor, columns) -> io.NodeOutput:
        if not isinstance(images, torch.Tensor):
            raise TypeError("Contact Sheet Selector expects a torch.Tensor batch for images input")

        batch_size = images.shape[0]
        columns_value = max(0, _ensure_int(columns))

        executing_context = get_executing_context()
        node_id = executing_context.node_id if executing_context else "ContactSheetSelector"
        if executing_context is None:
            logger.warning("Executing ContactSheetSelector without execution context; selections will be shared")

        selection_for_output, selection_for_next = resolve_selection_for_execution(
            node_id, batch_size
        )

        logger.info(
            "ContactSheetSelector execute node=%s batch=%s columns=%s output_selection=%s next_selection=%s",
            node_id,
            batch_size,
            columns_value,
            selection_for_output,
            selection_for_next,
        )

        if batch_size and not selection_for_output:
            logger.warning(
                "ContactSheetSelector node=%s produced empty selection for non-empty batch",
                node_id,
            )

        selected_images = _gather_selected_images(images, selection_for_output)

        preview_signature = _compute_preview_signature(images)
        cached_signature, cached_data = get_preview_cache(node_id)

        if cached_signature == preview_signature and cached_data:
            preview_data = cached_data
            logger.debug("Reusing cached previews for node %s", node_id)
        else:
            try:
                preview_data = [_encode_tensor_to_data_url(images[idx]) for idx in range(batch_size)]
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception("Failed to encode preview images for node %s: %s", node_id, exc)
                preview_data = []
            else:
                update_preview_cache(node_id, preview_signature, preview_data)

        ui_payload = {
            "contact_sheet": [
                {
                    "images": preview_data,
                    "selected_active": selection_for_output,
                    "selected_next": selection_for_next,
                    "columns": columns_value,
                    "batch_size": batch_size,
                }
            ]
        }

        return io.NodeOutput(selected_images, ui=ui_payload)

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> tuple[int, ...] | None:
        """
        Ensure ComfyUI's execution cache is invalidated when the selection state changes.
        """
        executing_context = get_executing_context()
        node_id = executing_context.node_id if executing_context else "ContactSheetSelector"
        snapshot = inspect_state(node_id)
        if snapshot is None:
            return None

        if snapshot.pending is not None:
            selection = tuple(snapshot.pending)
        else:
            selection = tuple(snapshot.active)

        batch_size = snapshot.last_batch_size
        columns_value = 0
        if "columns" in kwargs:
            try:
                columns_value = max(0, _ensure_int(kwargs["columns"]))
            except Exception:  # pragma: no cover - defensive
                columns_value = 0
        return selection + (batch_size, columns_value)


class ContactSheetExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [ContactSheetSelector]


if PromptServer is not None:
    @PromptServer.instance.routes.post("/contact-sheet-selector/selection")
    async def update_selection(request: web.Request) -> web.Response:
        try:
            data = await request.json()
        except Exception as exc:
            logger.warning("Invalid JSON payload for contact sheet selection: %s", exc)
            return web.json_response({"error": "invalid_json"}, status=400)

        node_id = data.get("node_id")
        selection_raw = data.get("selection", [])

        if not node_id:
            return web.json_response({"error": "missing_node_id"}, status=400)

        if not isinstance(selection_raw, list):
            return web.json_response({"error": "selection_must_be_list"}, status=400)

        try:
            selection = [int(idx) for idx in selection_raw]
        except (TypeError, ValueError):
            return web.json_response({"error": "selection_contains_non_int"}, status=400)

        sanitized = queue_pending_selection(str(node_id), selection)
        logger.info(
            "Received UI selection for node %s (raw=%s, sanitized=%s)",
            node_id,
            selection,
            sanitized,
        )
        return web.json_response({"selection": sanitized})


async def comfy_entrypoint() -> ContactSheetExtension:
    return ContactSheetExtension()
