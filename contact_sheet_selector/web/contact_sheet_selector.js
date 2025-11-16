import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const EXTENSION_NAMESPACE = "ContactSheetSelector";
const PERSISTED_SELECTION_PROPERTY = "__contact_sheet_pending_selection";
console.log(`[${EXTENSION_NAMESPACE}] frontend script loaded`);

const pointerDownEvent =
  (window.LiteGraph?.pointerevents_method || "pointer") + "down";
const pointerMoveEvent =
  (window.LiteGraph?.pointerevents_method || "pointer") + "move";

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

    const arraysEqual = (left = [], right = []) => {
        if (!Array.isArray(left) || !Array.isArray(right)) {
            return false;
        }
        if (left.length !== right.length) {
            return false;
        }
        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) {
                return false;
            }
        }
        return true;
    };

    const persistSelectionOnNode = (selection) => {
        if (!node) {
            return;
        }
        const graph = node.graph;
        const properties = node.properties || (node.properties = {});
        const previous = Array.isArray(properties[PERSISTED_SELECTION_PROPERTY])
            ? properties[PERSISTED_SELECTION_PROPERTY].map((value) => Number(value))
            : [];
        const normalized = Array.isArray(selection)
            ? selection.map((value) => Number(value))
            : [];
        if (arraysEqual(previous, normalized)) {
            return;
        }
        try {
            graph?.beforeChange?.();
        } catch (error) {
            console.warn(`[${EXTENSION_NAMESPACE}] beforeChange hook failed`, error);
        }
        properties[PERSISTED_SELECTION_PROPERTY] = normalized.slice();
        try {
            graph?.afterChange?.();
        } catch (error) {
            console.warn(`[${EXTENSION_NAMESPACE}] afterChange hook failed`, error);
        }
        graph?.setDirtyCanvas?.(true, true);
    };

    widget.updateData = async function updateData(data) {
        console.log(`[${EXTENSION_NAMESPACE}] updateData payload`, data);
        const imageSources = Array.isArray(data?.images) ? data.images : [];
        widget.images = imageSources;
        widget.selectedActive = new Set((data?.selected_active || []).map(Number));
        widget.selectedNext = new Set((data?.selected_next || []).map(Number));
        widget.columns = Number(data?.columns || 0);
        widget.hoverIndex = null;

        if (imageSources.length === 0) {
            console.log(
                `[${EXTENSION_NAMESPACE}] no images provided in payload; clearing widget`
            );
            widget.bitmaps = [];
            widget.loading = false;
            widget.layouts = [];
            widget.cachedHeight = 72;
            node.setSize?.(node.computeSize());
            node.setDirtyCanvas(true, true);
            return;
        }

        widget.loading = true;
        console.log(
            `[${EXTENSION_NAMESPACE}] loading ${imageSources.length} thumbnail(s)`
        );
        try {
            const bitmaps = await Promise.all(imageSources.map(loadImage));
            widget.bitmaps = bitmaps;
            console.log(
                `[${EXTENSION_NAMESPACE}] loaded ${bitmaps.length} thumbnail(s)`
            );
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
            console.log(
                `[${EXTENSION_NAMESPACE}] layout ${index} -> col=${col} row=${row} x=${x} y=${y} w=${tileWidth} h=${tileHeight}`
            );
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
        console.log(
            `[${EXTENSION_NAMESPACE}] notifySelectionChange payload`,
            payload
        );

        persistSelectionOnNode(selection);

        try {
            widget.selectionPostPromise = api.fetchApi("/contact-sheet-selector/selection", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            const response = await widget.selectionPostPromise;
            let sanitizedSelection = selection;
            if (response && typeof response.json === "function") {
                try {
                    const data = await response.json();
                    if (data && Array.isArray(data.selection)) {
                        sanitizedSelection = data.selection.map((value) => Number(value));
                    }
                } catch (error) {
                    console.warn(
                        `[${EXTENSION_NAMESPACE}] failed to parse selection POST response`,
                        error
                    );
                }
            }
            if (!arraysEqual(selection, sanitizedSelection)) {
                console.log(
                    `[${EXTENSION_NAMESPACE}] selection sanitized by backend`,
                    sanitizedSelection
                );
                widget.selectedNext = new Set(sanitizedSelection);
                persistSelectionOnNode(sanitizedSelection);
                widget.node.setDirtyCanvas(true, true);
            }
            console.log(`[${EXTENSION_NAMESPACE}] selection POST completed`);
        } catch (error) {
            console.error("ContactSheetSelector: failed to persist selection", error);
        } finally {
            widget.selectionPostPromise = null;
        }
    };

    widget.toggleSelection = function toggleSelection(index) {
        console.log(`[${EXTENSION_NAMESPACE}] toggleSelection called with index`, index);
        if (widget.selectedNext.has(index)) {
            widget.selectedNext.delete(index);
        } else {
            widget.selectedNext.add(index);
        }
        console.log(
            `[${EXTENSION_NAMESPACE}] toggled index ${index}; next selection now`,
            Array.from(widget.selectedNext.values()).sort((a, b) => a - b)
        );
        console.log(
            `[${EXTENSION_NAMESPACE}] active selection currently`,
            Array.from(widget.selectedActive.values()).sort((a, b) => a - b)
        );
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
        console.log(`[${EXTENSION_NAMESPACE}] mouse event`, event?.type, pos, node?.id ?? "(unknown)");
        if (!widget.layouts.length) {
            console.log(`[${EXTENSION_NAMESPACE}] mouse event ignored; no layouts available`);
            return false;
        }

        const layoutBounds = widget.layouts.reduce(
            (bounds, layout) => {
                const maxX = layout.x + layout.width;
                const maxY = layout.y + layout.height;
                return {
                    minX: Math.min(bounds.minX, layout.x),
                    maxX: Math.max(bounds.maxX, maxX),
                    minY: Math.min(bounds.minY, layout.y),
                    maxY: Math.max(bounds.maxY, maxY),
                };
            },
            {
                minX: Number.POSITIVE_INFINITY,
                maxX: Number.NEGATIVE_INFINITY,
                minY: Number.POSITIVE_INFINITY,
                maxY: Number.NEGATIVE_INFINITY,
            }
        );

        const hasLayoutBounds = Number.isFinite(layoutBounds.minX);
        const layoutPadding = widget.padding + widget.gap;
        const layoutSpanX = hasLayoutBounds
            ? layoutBounds.maxX - layoutBounds.minX + layoutPadding * 2
            : 0;
        const layoutSpanY = hasLayoutBounds
            ? layoutBounds.maxY - layoutBounds.minY + layoutPadding * 2
            : 0;
        const maxWidgetWidth =
            layoutSpanX ||
            widget.cachedWidth ||
            node.size?.[0] ||
            320;
        const maxWidgetHeight =
            layoutSpanY ||
            widget.cachedHeight ||
            node.size?.[1] ||
            320;

        const baselineToleranceX = Math.max(24, layoutPadding);
        const baselineToleranceY = Math.max(24, layoutPadding);
        const isWithinX = (value) => {
            if (!Number.isFinite(value)) {
                return false;
            }
            if (hasLayoutBounds) {
                return (
                    value >= layoutBounds.minX - baselineToleranceX &&
                    value <= layoutBounds.maxX + baselineToleranceX
                );
            }
            return Math.abs(value) <= maxWidgetWidth;
        };
        const isWithinY = (value) => {
            if (!Number.isFinite(value)) {
                return false;
            }
            if (hasLayoutBounds) {
                return (
                    value >= layoutBounds.minY - baselineToleranceY &&
                    value <= layoutBounds.maxY + baselineToleranceY
                );
            }
            return Math.abs(value) <= maxWidgetHeight;
        };

        const nodeCanvasDS = node.graph?.canvas?.ds;
        const parentCanvasDS = node.graph?.parent_graph?.canvas?.ds;
        const appCanvasDS = app?.canvas?.ds;
        const toPlainPair = (value) =>
            value && (Array.isArray(value) || ArrayBuffer.isView(value))
                ? [Number(value[0] ?? 0), Number(value[1] ?? 0)]
                : null;
        const formatDS = (ds) =>
            ds
                ? {
                      scale: typeof ds.scale === "number" ? ds.scale : Number(ds.scale ?? 1),
                      offset: toPlainPair(ds.offset),
                      view_offset: toPlainPair(ds.view_offset),
                      extra_offset: toPlainPair(ds.extra_offset),
                      has_convert: typeof ds.convertCanvasToOffset === "function",
                  }
                : null;

        console.log(
            `[${EXTENSION_NAMESPACE}] pointer context`,
            {
                nodePos: node.pos,
                nodeSize: node.size,
                pointerCanvasPos: pos,
                lastWidgetY: widget.lastWidgetY,
                nodeCanvasDS: formatDS(nodeCanvasDS),
                parentCanvasDS: formatDS(parentCanvasDS),
                appCanvasDS: formatDS(appCanvasDS),
            }
        );

        const candidateSummaries = [];

        const registerCandidate = (label, result) => {
            const [localXRaw, localYRaw] = result?.local || [NaN, NaN];
            const localX = Number(localXRaw);
            const localY = Number(localYRaw);
            const relativeY = Number(localY) - widget.lastWidgetY;
            const withinX = isWithinX(localX);
            const withinY = isWithinY(relativeY);
            candidateSummaries.push({
                label,
                localX,
                localY,
                relativeY,
                withinX,
                withinY,
                source: result,
            });
        };

        registerCandidate("widgetPosArgument", { local: pos });

        registerCandidate("graphCoordinatesRaw", {
            local: [pos?.[0] - node.pos[0], pos?.[1] - node.pos[1]],
        });

        const dsCandidates = [
            { label: "nodeCanvasDS", ds: nodeCanvasDS },
            { label: "parentCanvasDS", ds: parentCanvasDS },
            { label: "appCanvasDS", ds: appCanvasDS },
        ].filter((candidate) => !!candidate.ds);

        const convertWithDS = (ds, coordinates) => {
            if (!ds) {
                return null;
            }
            if (typeof ds.convertCanvasToOffset === "function") {
                try {
                    return ds.convertCanvasToOffset(coordinates);
                } catch (error) {
                    console.warn(
                        `[${EXTENSION_NAMESPACE}] convertCanvasToOffset threw`,
                        error
                    );
                }
            }

            const scale = Number(ds.scale ?? 1);
            if (!Number.isFinite(scale) || scale === 0) {
                return null;
            }

            const offset = toPlainPair(ds.offset) || [0, 0];
            const viewOffset = toPlainPair(ds.view_offset) || [0, 0];
            const extraOffset = toPlainPair(ds.extra_offset) || [0, 0];

            const aggregateOffsetX = offset[0] + viewOffset[0] + extraOffset[0];
            const aggregateOffsetY = offset[1] + viewOffset[1] + extraOffset[1];

            const canvasX = coordinates[0] - aggregateOffsetX;
            const canvasY = coordinates[1] - aggregateOffsetY;

            return [canvasX / scale, canvasY / scale];
        };

        const dsDiagnostics = dsCandidates.map(({ label, ds }) => {
            const graphCoords = convertWithDS(ds, pos);
            return {
                label,
                ds: formatDS(ds),
                graphCoords: graphCoords ? [graphCoords[0], graphCoords[1]] : null,
                localCoords: graphCoords
                    ? [graphCoords[0] - node.pos[0], graphCoords[1] - node.pos[1]]
                    : null,
            };
        });

        console.log(
            `[${EXTENSION_NAMESPACE}] ds conversion attempts`,
            dsDiagnostics
        );

        for (const entry of dsDiagnostics) {
            registerCandidate(entry.label, {
                local: entry.localCoords,
                graphCoords: entry.graphCoords,
                ds: entry.ds,
            });
        }

        const plausibleCandidates = candidateSummaries.filter(
            (candidate) =>
                Number.isFinite(candidate.localX) &&
                Number.isFinite(candidate.localY) &&
                Number.isFinite(candidate.relativeY) &&
                candidate.withinX &&
                candidate.withinY
        );

        const fallbackCandidates = candidateSummaries.filter(
            (candidate) =>
                Number.isFinite(candidate.localX) &&
                Number.isFinite(candidate.localY) &&
                Number.isFinite(candidate.relativeY)
        );

        const chosenCandidate =
            plausibleCandidates[0] ??
            fallbackCandidates[0] ?? {
                label: "default-zero",
                localX: 0,
                localY: widget.lastWidgetY,
                relativeY: 0,
            };

        console.log(
            `[${EXTENSION_NAMESPACE}] pointer resolution`,
            {
                candidates: candidateSummaries,
                chosen: {
                    label: chosenCandidate.label,
                    localX: chosenCandidate.localX,
                    localY: chosenCandidate.localY,
                    relativeY: chosenCandidate.relativeY,
                },
            }
        );

        const localX = chosenCandidate.localX;
        const localY = chosenCandidate.localY;
        const relativeY = chosenCandidate.relativeY;

        console.log(
            `[${EXTENSION_NAMESPACE}] local coords x=${localX} y=${localY} relativeY=${relativeY} nodePos=(${node.pos?.[0]}, ${node.pos?.[1]})`
        );

        let handled = false;
        for (const layout of widget.layouts) {
            console.log(
                `[${EXTENSION_NAMESPACE}] checking layout index=${layout.index} x=${layout.x}-${layout.x + layout.width} y=${layout.y}-${layout.y + layout.height}`
            );
            const withinX =
                localX >= layout.x && localX <= layout.x + layout.width;
            const withinY =
                relativeY >= layout.y && relativeY <= layout.y + layout.height;
            const inside = withinX && withinY;
            if (!inside) {
                console.log(
                    `[${EXTENSION_NAMESPACE}] point outside layout`,
                    layout.index,
                    {
                        localX,
                        localY,
                        relativeY,
                        withinX,
                        withinY,
                    }
                );
            }
            if (!inside) {
                continue;
            }

            if (event.type === pointerDownEvent) {
                console.log(
                    `[${EXTENSION_NAMESPACE}] pointer down on tile`,
                    layout.index,
                    "local coords",
                    localX,
                    localY
                );
                widget.toggleSelection(layout.index);
                handled = true;
                break;
            }

            if (event.type === pointerMoveEvent) {
                widget.updateHover(layout.index);
                handled = true;
                break;
            }
        }

        if (!handled && event.type === pointerMoveEvent) {
            widget.updateHover(null);
        }

        return handled;
    };

    widget.onRemove = function onRemove() {
        widget.images = [];
        widget.bitmaps = [];
        widget.layouts = [];
        widget.selectedActive.clear();
        widget.selectedNext.clear();
        console.log(`[${EXTENSION_NAMESPACE}] widget removed`);
    };

    console.log(
        `[${EXTENSION_NAMESPACE}] widget created for node`,
        node?.id ?? "(unknown)"
    );
    return widget;
}

function mergeContactSheetEntries(entries) {
    const merged = {
        images: [],
        selected_active: [],
        selected_next: [],
        columns: 0,
        batch_size: 0,
    };

    entries.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") {
            return;
        }
        if (Array.isArray(entry.images)) {
            merged.images.push(...entry.images);
        }
        if (Array.isArray(entry.selected_active)) {
            merged.selected_active = entry.selected_active.slice();
        }
        if (Array.isArray(entry.selected_next)) {
            merged.selected_next = entry.selected_next.slice();
        }
        if (typeof entry.columns === "number") {
            merged.columns = entry.columns;
        }
        if (typeof entry.batch_size === "number") {
            merged.batch_size = Math.max(merged.batch_size, entry.batch_size, merged.images.length);
        } else {
            merged.batch_size = Math.max(merged.batch_size, merged.images.length);
        }
        console.log(
            `[${EXTENSION_NAMESPACE}] merged entry ${index} -> images=${merged.images.length} selections=${merged.selected_next.length}`
        );
    });

    return merged;
}

function extractUiData(message) {
    if (!message) {
        return null;
    }
    console.log(`[${EXTENSION_NAMESPACE}] onExecuted message`, message);
    const raw =
        message?.contact_sheet ??
        message?.ui?.contact_sheet ??
        (Array.isArray(message?.ui) ? message.ui[0] : undefined) ??
        message?.ui_data;
    if (Array.isArray(raw)) {
        return mergeContactSheetEntries(raw);
    }
    if (raw && typeof raw === "object") {
        return mergeContactSheetEntries([raw]);
    }
    return null;
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
                    console.log(
                        `[${EXTENSION_NAMESPACE}] prototype handler updating widget for node`,
                        this?.id ?? "(unknown)"
                    );
                    widget.updateData(uiData);
                } else {
                    console.log(
                        `[${EXTENSION_NAMESPACE}] prototype handler received message without contact sheet data`
                    );
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
                    console.log(
                        `[${EXTENSION_NAMESPACE}] instance handler updating widget for node`,
                        this?.id ?? "(unknown)"
                    );
                    this.contactSheetWidget?.updateData(uiData);
                } else {
                    console.log(
                        `[${EXTENSION_NAMESPACE}] instance handler received message without contact sheet data`
                    );
                }
            };
        };
    },
});
