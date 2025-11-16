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

    state.queue_pending_selection(node_id, [2])

    with CurrentNodeContext(prompt_id="prompt-1", node_id=node_id):
        second_output = ContactSheetSelector.execute(images, torch.tensor([0]))

    assert second_output[0].shape[0] == 1
    assert torch.allclose(second_output[0], images[2:3])

    ui_payload = second_output.ui.get("contact_sheet")
    assert ui_payload["selected_active"] == [2]
    assert ui_payload["selected_next"] == [2]
