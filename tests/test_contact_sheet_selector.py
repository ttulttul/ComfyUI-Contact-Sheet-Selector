import torch
import pytest

from contact_sheet_selector.node import ContactSheetSelector
from contact_sheet_selector import state
from comfy_execution.utils import CurrentNodeContext


@pytest.fixture(autouse=True)
def cleanup_state():
    state.reset_state()
    yield
    state.reset_state()


def test_state_defaults_to_full_batch():
    batch_size = 4
    selection_state = state.get_state("node-a", batch_size)
    assert selection_state.active == list(range(batch_size))
    assert selection_state.pending is None


def test_pending_selection_promoted_on_next_run():
    batch_size = 5
    node_id = "node-b"

    first_selection, _ = state.resolve_selection_for_execution(node_id, batch_size)
    assert first_selection == list(range(batch_size))

    state.queue_pending_selection(node_id, [4, 1, 99])
    second_selection, next_selection = state.resolve_selection_for_execution(node_id, batch_size)

    assert second_selection == [1, 4]
    assert next_selection == [1, 4]


def test_execute_uses_previous_selection():
    node_id = "node-c"
    images = torch.rand((3, 8, 8, 3))

    with CurrentNodeContext(prompt_id="prompt-1", node_id=node_id):
        initial_output = ContactSheetSelector.execute(images, torch.tensor([0]))

    assert isinstance(initial_output[0], torch.Tensor)
    assert initial_output[0].shape[0] == 3
    ui_payload_initial = initial_output.ui.get("contact_sheet")
    assert isinstance(ui_payload_initial, list)
    assert ui_payload_initial[0]["preview_token"]
    assert len(ui_payload_initial[0]["images"]) == 3

    state.queue_pending_selection(node_id, [2])

    with CurrentNodeContext(prompt_id="prompt-1", node_id=node_id):
        second_output = ContactSheetSelector.execute(images, torch.tensor([0]))

    assert second_output[0].shape[0] == 1
    assert torch.allclose(second_output[0], images[2:3])

    ui_payload = second_output.ui.get("contact_sheet")
    assert isinstance(ui_payload, list)
    assert ui_payload[0]["selected_active"] == [2]
    assert ui_payload[0]["selected_next"] == [2]
    assert ui_payload[0]["preview_token"]
    assert ui_payload[0]["images"] == []


def test_out_of_range_selection_falls_back_to_active():
    node_id = "node-d"
    images_first = torch.rand((2, 8, 8, 3))
    images_second = torch.rand((1, 8, 8, 3))

    with CurrentNodeContext(prompt_id="prompt-2", node_id=node_id):
        first_output = ContactSheetSelector.execute(images_first, torch.tensor([0]))

    # Initial run should emit the full batch.
    assert first_output[0].shape[0] == 2

    # Queue a selection that will be out of range for the next, smaller batch.
    state.queue_pending_selection(node_id, [5])

    with CurrentNodeContext(prompt_id="prompt-2", node_id=node_id):
        second_output = ContactSheetSelector.execute(images_second, torch.tensor([0]))

    # The invalid selection should be ignored and the node should fall back to the new active set.
    assert second_output[0].shape[0] == 1
    ui_payload = second_output.ui.get("contact_sheet")
    assert isinstance(ui_payload, list)
    assert ui_payload[0]["selected_active"] == [0]
    assert ui_payload[0]["selected_next"] == [0]


def test_pending_selection_expands_batch_estimate():
    node_id = "node-e"
    images_first = torch.rand((1, 8, 8, 3))
    images_second = torch.rand((2, 8, 8, 3))

    with CurrentNodeContext(prompt_id="prompt-3", node_id=node_id):
        initial_output = ContactSheetSelector.execute(images_first, torch.tensor([0]))

    assert initial_output[0].shape[0] == 1

    # User selects both indices; the backend should expand the inferred batch size.
    state.queue_pending_selection(node_id, [0, 1])
    pending_state = state.inspect_state(node_id)
    assert pending_state is not None
    assert pending_state.pending == [0, 1]

    with CurrentNodeContext(prompt_id="prompt-3", node_id=node_id):
        second_output = ContactSheetSelector.execute(images_second, torch.tensor([0]))

    assert second_output[0].shape[0] == 2
    ui_payload = second_output.ui.get("contact_sheet")
    assert isinstance(ui_payload, list)
    assert ui_payload[0]["selected_active"] == [0, 1]
    assert ui_payload[0]["selected_next"] == [0, 1]


def test_fingerprint_reflects_pending_selection():
    node_id = "node-f"
    images = torch.rand((2, 8, 8, 3))

    state.queue_pending_selection(node_id, [0])
    with CurrentNodeContext(prompt_id="prompt-4", node_id=node_id):
        base_fp = ContactSheetSelector.fingerprint_inputs(images=images, columns=torch.tensor([0]))

    state.queue_pending_selection(node_id, [1])
    with CurrentNodeContext(prompt_id="prompt-4", node_id=node_id):
        updated_fp = ContactSheetSelector.fingerprint_inputs(images=images, columns=torch.tensor([0]))

    assert base_fp != updated_fp


def test_preview_cache_reused(monkeypatch):
    node_id = "node-g"
    images = torch.rand((2, 8, 8, 3))
    encode_calls = {"count": 0}

    def fake_encode(image_tensor):
        encode_calls["count"] += 1
        return f"data:image/png;base64,fake{encode_calls['count']}"

    monkeypatch.setattr("contact_sheet_selector.node._encode_tensor_to_data_url", fake_encode)

    with CurrentNodeContext(prompt_id="prompt-5", node_id=node_id):
        first_output = ContactSheetSelector.execute(images, torch.tensor([0]))

    with CurrentNodeContext(prompt_id="prompt-5", node_id=node_id):
        second_output = ContactSheetSelector.execute(images, torch.tensor([0]))

    # Encoding should happen only once per image (first execution only).
    assert encode_calls["count"] == images.shape[0]
    first_payload = first_output.ui["contact_sheet"][0]
    second_payload = second_output.ui["contact_sheet"][0]
    assert first_payload["preview_token"] == second_payload["preview_token"]
    assert len(first_payload["images"]) == images.shape[0]
    assert second_payload["images"] == []


def test_preview_cache_includes_order(monkeypatch):
    node_id = "node-h"
    images = torch.rand((2, 8, 8, 3))
    encode_calls = {"count": 0}

    def fake_encode(image_tensor):
        encode_calls["count"] += 1
        return f"data:image/png;base64,order{encode_calls['count']}"

    monkeypatch.setattr("contact_sheet_selector.node._encode_tensor_to_data_url", fake_encode)

    with CurrentNodeContext(prompt_id="prompt-6", node_id=node_id):
        ContactSheetSelector.execute(images, torch.tensor([0]))

    with CurrentNodeContext(prompt_id="prompt-6", node_id=node_id):
        ContactSheetSelector.execute(images.flip(0), torch.tensor([0]))

    # Both executions should encode because the order change invalidates the cache.
    assert encode_calls["count"] == images.shape[0] * 2
