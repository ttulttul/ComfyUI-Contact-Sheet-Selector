import logging
from dataclasses import dataclass, field
from threading import Lock
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class NodeSelectionState:
    """Holds the selection lifecycle and lightweight preview cache for a node."""

    active: List[int] = field(default_factory=list)
    pending: Optional[List[int]] = None
    last_batch_size: int = 0
    preview_token: Optional[tuple[str, ...]] = None
    preview_data: List[str] = field(default_factory=list)


_selection_state: Dict[str, NodeSelectionState] = {}
_state_lock = Lock()


def _sanitize_selection(selection: List[int], batch_size: int) -> List[int]:
    """Normalize a selection to unique, sorted, in-range indices."""
    sanitized = sorted({idx for idx in selection if 0 <= idx < batch_size})
    if not sanitized:
        return []

    if len(sanitized) < len(selection):
        logger.debug(
            "Selection pruned to in-range values: %s -> %s (batch size=%s)",
            selection,
            sanitized,
            batch_size,
        )
    return sanitized


def get_state(node_id: str, batch_size: int) -> NodeSelectionState:
    """
    Fetch or initialise the state for a node.

    If no active selection exists yet, default to the full batch so that
    the first execution returns every image.
    """
    with _state_lock:
        state = _selection_state.setdefault(node_id, NodeSelectionState())
        if not state.active:
            state.active = list(range(batch_size))
            logger.debug(
                "Initialising default selection for node %s to full batch of size %s",
                node_id,
                batch_size,
            )
        state.active = _sanitize_selection(state.active, batch_size) or list(range(batch_size))
        state.last_batch_size = batch_size
        return state


def resolve_selection_for_execution(node_id: str, batch_size: int) -> tuple[List[int], List[int]]:
    """
    Resolve the selection that should be used for the current execution.

    Returns a tuple of (selection_for_output, selection_for_next_run).
    """
    with _state_lock:
        state = _selection_state.get(node_id)
        if state is None:
            state = _selection_state.setdefault(node_id, NodeSelectionState())

        if not state.active:
            state.active = list(range(batch_size))

        active = _sanitize_selection(state.active, batch_size) or list(range(batch_size))
        original_pending = state.pending
        pending = (
            _sanitize_selection(state.pending, batch_size)
            if state.pending is not None
            else None
        )

        if original_pending is not None and pending == []:
            logger.info(
                "Dropping stale pending selection for node %s (original=%s, batch size=%s)",
                node_id,
                original_pending,
                batch_size,
            )
            pending = None

        selection_for_output = list(pending if pending is not None else active)
        state.active = selection_for_output
        state.pending = None
        state.last_batch_size = batch_size

        logger.debug(
            "Resolved selection for node %s: output=%s next=%s (batch size=%s)",
            node_id,
            selection_for_output,
            state.active,
            batch_size,
        )

        return selection_for_output, list(state.active)


def queue_pending_selection(node_id: str, selection: List[int]) -> List[int]:
    """
    Store a pending selection uploaded from the UI.

    Returns the sanitized selection so the caller can reflect it back if needed.
    """
    with _state_lock:
        state = _selection_state.setdefault(node_id, NodeSelectionState())
        # Use the larger of the last known batch size or what the UI selection implies.
        last_known = state.last_batch_size or 0
        highest_index = max(selection, default=-1)
        inferred_size = highest_index + 1 if highest_index >= 0 else 0
        batch_size = max(last_known, inferred_size)
        sanitized = _sanitize_selection(selection, batch_size)

        if selection and not sanitized:
            logger.warning(
                "Discarding selection outside batch bounds for node %s (incoming=%s, last batch size=%s, inferred size=%s)",
                node_id,
                selection,
                state.last_batch_size,
                inferred_size,
            )
            state.pending = None
        elif not selection:
            logger.info("Clearing pending selection for node %s", node_id)
            state.pending = []
        else:
            logger.info(
                "Queued pending selection for node %s: %s (incoming=%s, effective batch size=%s)",
                node_id,
                sanitized,
                selection,
                batch_size,
            )
            state.pending = sanitized
        return sanitized


def inspect_state(node_id: str) -> Optional[NodeSelectionState]:
    """Return a copy of the raw state for diagnostics and tests."""
    with _state_lock:
        state = _selection_state.get(node_id)
        if state is None:
            return None
        return NodeSelectionState(
            active=list(state.active),
            pending=None if state.pending is None else list(state.pending),
            last_batch_size=state.last_batch_size,
            preview_token=tuple(state.preview_token) if state.preview_token else None,
            preview_data=list(state.preview_data),
        )


def reset_state() -> None:
    """Clear all cached selections (used in tests)."""
    with _state_lock:
        _selection_state.clear()
        logger.debug("Cleared all contact sheet selection state")


def get_preview_cache(node_id: str) -> tuple[Optional[tuple[str, ...]], Optional[List[str]]]:
    """Return the cached preview token and data for a node, if available."""
    with _state_lock:
        state = _selection_state.get(node_id)
        if state is None or not state.preview_data:
            return None, None
        return (
            tuple(state.preview_token) if state.preview_token else None,
            list(state.preview_data),
        )


def update_preview_cache(node_id: str, token: tuple[str, ...], data: List[str]) -> None:
    """Persist the preview token and data for reuse across executions."""
    with _state_lock:
        state = _selection_state.setdefault(node_id, NodeSelectionState())
        state.preview_token = tuple(token)
        state.preview_data = list(data)
