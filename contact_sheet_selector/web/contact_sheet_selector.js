import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const EXTENSION_NAMESPACE = "ContactSheetSelector";
console.log(`[${EXTENSION_NAMESPACE}] frontend script loaded`);

const pointerDownEvent = LiteGraph.pointerevents_method + "down";
const pointerMoveEvent = LiteGraph.pointerevents_method + "move";

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
    });
}

function createContactSheetWidget(node) {
    const widget = {
        name: "contact_sheet_preview",
        type: "contact_sheet",
        lastWidgetY: 0,
        cachedHeight: 72,
        cachedWidth: 0,
        padding: 10,
        gap: 8,
        headerHeight: 32,
        images: [],
        bitmaps: [],
        layouts: [],
        selectedActive: new Set(),
        selectedNext: new Set(),
        columns: 0,
        loading: false,
        node,
        selectionPostPromise: null,
        hoverIndex: null,
    };

    widget.updateData = async function updateData(data) {
        if (window.DEBUG_CONTACT_SHEET_SELECTOR) {
            console.debug(`[${EXTENSION_NAMESPACE}] updateData payload`, data);
        }
        const imageSources = Array.isArray(data?.images) ? data.images : [];
        widget.images = imageSources;
        widget.selectedActive = new Set((data?.selected_active || []).map(Number));
        widget.selectedNext = new Set((data?.selected_next || []).map(Number));
        widget.columns = Number(data?.columns || 0);
        widget.hoverIndex = null;

        if (imageSources.length === 0) {
            widget.bitmaps = [];
            widget.loading = false;
            widget.layouts = [];
            widget.cachedHeight = 72;
            node.setSize?.(node.computeSize());
            node.setDirtyCanvas(true, true);
            return;
        }

        widget.loading = true;
        try {
            const bitmaps = await Promise.all(imageSources.map(loadImage));
            widget.bitmaps = bitmaps;
        } catch (error) {
            console.error("ContactSheetSelector: failed to load thumbnails", error);
            widget.bitmaps = [];
        } finally {
            widget.loading = false;
            node.setSize?.(node.computeSize());
            node.setDirtyCanvas(true, true);
        }
    };

    widget.recomputeLayout = function recomputeLayout(width) {
        widget.cachedWidth = width;
        const count = widget.images.length;
        const cols =
            count === 0
                ? 1
                : Math.max(
                      1,
                      Math.min(
                          widget.columns > 0 ? widget.columns : Math.ceil(Math.sqrt(count)),
                          count
                      )
                  );
        widget.currentColumns = cols;

        const padding = widget.padding;
        const gap = widget.gap;
        const headerHeight = widget.headerHeight;
        const interiorWidth = Math.max(width - padding * 2, 40);
        const tileWidth = count
            ? Math.max(48, (interiorWidth - gap * (cols - 1)) / cols)
            : interiorWidth;
        const tileHeight = tileWidth;
        const rows = count ? Math.ceil(count / cols) : 1;
        const gridHeight = count ? rows * tileHeight + gap * Math.max(rows - 1, 0) : 0;
        const totalHeight = headerHeight + gridHeight + padding * 2;

        widget.cachedHeight = Math.max(totalHeight, 72);
        widget.layouts = [];
        widget.gridOrigin = { x: padding, y: padding + headerHeight };

        for (let index = 0; index < count; index += 1) {
            const row = Math.floor(index / cols);
            const col = index % cols;
            const x = padding + col * (tileWidth + gap);
            const y = padding + headerHeight + row * (tileHeight + gap);
            widget.layouts.push({
                index,
                x,
                y,
                width: tileWidth,
                height: tileHeight,
            });
        }

        return widget.cachedHeight;
    };

    widget.computeSize = function computeSize(width) {
        return [width, widget.recomputeLayout(width || widget.cachedWidth || node.size[0])];
    };

    widget.ensureSelectionVisible = function ensureSelectionVisible() {
        const available = widget.images.length;
        const sanitize = (set) =>
            new Set(
                [...set].filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < available)
            );
        widget.selectedActive = sanitize(widget.selectedActive);
        widget.selectedNext = sanitize(widget.selectedNext);
    };

    widget.renderTile = function renderTile(ctx, layout, index) {
        const image = widget.bitmaps[index];
        ctx.save();

        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        ctx.fillRect(layout.x, layout.y, layout.width, layout.height);

        if (image) {
            const scale = Math.min(layout.width / image.width, layout.height / image.height);
            const drawW = image.width * scale;
            const drawH = image.height * scale;
            const offsetX = layout.x + (layout.width - drawW) / 2;
            const offsetY = layout.y + (layout.height - drawH) / 2;
            ctx.drawImage(image, offsetX, offsetY, drawW, drawH);
        } else if (widget.loading) {
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.font = "12px sans-serif";
            ctx.fillText("Loading…", layout.x + 10, layout.y + layout.height / 2);
        }

        const isNext = widget.selectedNext.has(index);
        const wasActive = widget.selectedActive.has(index);

        if (!isNext) {
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
        }

        if (wasActive) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 2;
            ctx.strokeRect(layout.x + 2, layout.y + 2, layout.width - 4, layout.height - 4);
            ctx.setLineDash([]);
        }

        if (isNext) {
            ctx.strokeStyle = "#4caf50";
            ctx.lineWidth = 3;
            ctx.strokeRect(layout.x + 1.5, layout.y + 1.5, layout.width - 3, layout.height - 3);
        }

        if (widget.hoverIndex === index) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
            ctx.lineWidth = 1;
            ctx.strokeRect(layout.x + 0.5, layout.y + 0.5, layout.width - 1, layout.height - 1);
        }

        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(layout.x, layout.y, 28, 20);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "12px sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(`#${index}`, layout.x + 6, layout.y + 10);

        ctx.restore();
    };

    widget.draw = function draw(ctx, node, widgetWidth, y) {
        widget.lastWidgetY = y;
        widget.ensureSelectionVisible();
        const height = widget.recomputeLayout(widgetWidth);

        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
        ctx.fillRect(widget.padding / 2, y, widgetWidth - widget.padding, height);

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "12px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText("Click thumbnails to toggle the next-run selection.", widget.padding, y + 6);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(
            "Solid border: next run  •  Dashed border: output from this run",
            widget.padding,
            y + 20
        );

        if (widget.images.length === 0) {
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillText("No images received yet.", widget.padding, y + 40);
            ctx.restore();
            return y + height;
        }

        widget.layouts.forEach((layout) => widget.renderTile(ctx, layout, layout.index));

        ctx.restore();
        return y + height;
    };

    widget.notifySelectionChange = async function notifySelectionChange() {
        const selection = [...widget.selectedNext].sort((a, b) => a - b);
        const payload = {
            node_id: String(widget.node.id),
            selection,
        };

        try {
            widget.selectionPostPromise = api.fetchApi("/contact-sheet-selector/selection", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            await widget.selectionPostPromise;
        } catch (error) {
            console.error("ContactSheetSelector: failed to persist selection", error);
        } finally {
            widget.selectionPostPromise = null;
        }
    };

    widget.toggleSelection = function toggleSelection(index) {
        if (widget.selectedNext.has(index)) {
            widget.selectedNext.delete(index);
        } else {
            widget.selectedNext.add(index);
        }
        widget.node.setDirtyCanvas(true, true);
        void widget.notifySelectionChange();
    };

    widget.updateHover = function updateHover(index) {
        const nextHover = index ?? null;
        if (widget.hoverIndex !== nextHover) {
            widget.hoverIndex = nextHover;
            widget.node.setDirtyCanvas(true, true);
        }
    };

    widget.mouse = function mouse(event, pos, node) {
        if (!widget.layouts.length) {
            return false;
        }

        const localX = pos[0] - node.pos[0];
        const localY = pos[1] - node.pos[1];

        const pointerOverWidget =
            localX >= widget.padding &&
            localX <= widget.cachedWidth - widget.padding &&
            localY >= widget.lastWidgetY &&
            localY <= widget.lastWidgetY + widget.cachedHeight;

        if (!pointerOverWidget) {
            if (event.type === pointerMoveEvent) {
                widget.updateHover(null);
            }
            return false;
        }

        for (const layout of widget.layouts) {
            const inside =
                localX >= layout.x &&
                localX <= layout.x + layout.width &&
                localY >= layout.y &&
                localY <= layout.y + layout.height;
            if (!inside) {
                continue;
            }

            if (event.type === pointerDownEvent) {
                widget.toggleSelection(layout.index);
                return true;
            }

            if (event.type === pointerMoveEvent) {
                widget.updateHover(layout.index);
            }

            return false;
        }

        if (event.type === pointerMoveEvent) {
            widget.updateHover(null);
        }

        return false;
    };

    widget.onRemove = function onRemove() {
        widget.images = [];
        widget.bitmaps = [];
        widget.layouts = [];
        widget.selectedActive.clear();
        widget.selectedNext.clear();
    };

    return widget;
}

function extractUiData(message) {
    if (!message) {
        return null;
    }
    if (window.DEBUG_CONTACT_SHEET_SELECTOR) {
        console.debug(`[${EXTENSION_NAMESPACE}] onExecuted message`, message);
    }
    const raw =
        message?.contact_sheet ??
        message?.ui?.contact_sheet ??
        (Array.isArray(message?.ui) ? message.ui[0] : undefined) ??
        message?.ui_data;
    if (Array.isArray(raw)) {
        return raw[0];
    }
    return raw || null;
}

app.registerExtension({
    name: "ContactSheetSelector.Widget",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "ContactSheetSelector") {
            return;
        }

        const originalPrototypeOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function contactSheetPrototypeOnExecuted(message) {
            originalPrototypeOnExecuted?.apply(this, arguments);
            const widget = this.contactSheetWidget;
            if (widget) {
                const uiData = extractUiData(message);
                if (uiData) {
                    widget.updateData(uiData);
                }
            }
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedWrapper() {
            onNodeCreated?.apply(this, arguments);
            this.widgets ??= [];
            this.contactSheetWidget = createContactSheetWidget(this);
            this.widgets.push(this.contactSheetWidget);
            this.setSize?.(this.computeSize());

            const originalOnExecuted = this.onExecuted;
            this.onExecuted = function contactSheetOnExecuted(message) {
                originalOnExecuted?.apply(this, arguments);
                const uiData = extractUiData(message);
                if (uiData) {
                    this.contactSheetWidget?.updateData(uiData);
                }
            };
        };
    },
});
