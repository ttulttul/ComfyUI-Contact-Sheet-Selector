# ComfyUI Contact Sheet Selector

The Contact Sheet Selector is a ComfyUI custom node that displays an input image batch as a clickable contact sheet. Use it to curate batches quickly: run your workflow once, choose the images you like directly on the node, and they will be forwarded to downstream nodes on the next execution.

## Features

- Renders the incoming `IMAGE` batch as a grid inside the node UI.
- Highlights the images that were produced on the last run (dashed border) and the ones queued for the next run (solid border).
- Persists your selection between executions, updating output batches only after you confirm on the next workflow run.
- Provides a lightweight REST endpoint so the frontend can store pending selections without blocking the main queue.

## Installation

1. Clone or copy this repository into `ComfyUI/custom_nodes/ComfyUI-Contact-Sheet-Selector`.
2. Restart ComfyUI so the new node and frontend widget are registered.
3. Look for **Contact Sheet Selector** under the `image/batch` category.

## Usage

1. Connect any batched `IMAGE` output to the **Contact Sheet Selector** node.
2. Execute your workflow. The node will output the full batch on the first run and display thumbnails in the grid.
3. Click thumbnails to toggle which images should be forwarded next time (solid borders indicate the selection for the next run).
4. Re-run the workflow; the node will now emit only the selected subset.
5. Repeat the process whenever you want to adjust the batch.

The optional **columns** input lets you customise the number of thumbnails shown per row (set to `0` to auto-balance the layout).

## Development

- Backend logic lives in `contact_sheet_selector/node.py`, with selection state helpers in `contact_sheet_selector/state.py`.
- The custom frontend widget is implemented in `contact_sheet_selector/web/contact_sheet_selector.js`.
- Pointer-coordinate diagnostics in the frontend widget now capture both the raw widget-relative coordinates (which LiteGraph already supplies) and every drag-and-scale context so we can confirm when we must fall back to canvas conversions.
- The backend emits INFO-level logs whenever selections arrive or resolve, making it easier to trace why a run might produce an empty batch.
- Automated tests cover the state lifecycles and the delayed-selection behaviour (`tests/test_contact_sheet_selector.py`). Run them with:

```bash
pytest
```

## License

This project inherits ComfyUI's AGPLv3 license.
