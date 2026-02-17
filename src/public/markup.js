/**
 * Markup tools for annotating screenshots.
 *
 * Usage:
 *   const markup = window.createMarkupTools(container, svg, img);
 *   markup.setTool("arrow");   // "arrow" | "box" | "text" | "pin" | null
 *   markup.serialize();        // returns annotation text string or null
 *   markup.clear();
 *   markup.attachToImage(img); // re-sync SVG viewBox to image dimensions
 *   markup.getActiveTool();
 */

window.createMarkupTools = function createMarkupTools(container, svg, img) {
  let activeTool = null;
  const annotations = []; // { type, el, data }
  let pinCounter = 0;
  let dragState = null;

  // Arrowhead marker definition
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "marker",
  );
  marker.setAttribute("id", "arrowhead");
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "3.5");
  marker.setAttribute("orient", "auto");
  const arrowPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  arrowPath.setAttribute("d", "M0,0 L10,3.5 L0,7 L2,3.5 Z");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  function syncViewBox() {
    if (!img.naturalWidth || !img.naturalHeight) return;
    svg.setAttribute("viewBox", `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
  }

  function toSvgCoords(clientX, clientY) {
    const rect = img.getBoundingClientRect();
    const natW = img.naturalWidth || 1;
    const natH = img.naturalHeight || 1;
    const scaleX = natW / rect.width;
    const scaleY = natH / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  }

  // Position SVG to match rendered image within container
  function positionOverlay() {
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    svg.style.left = `${imgRect.left - containerRect.left}px`;
    svg.style.top = `${imgRect.top - containerRect.top}px`;
    svg.style.width = `${imgRect.width}px`;
    svg.style.height = `${imgRect.height}px`;
  }

  function createDeleteHandle(x, y) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("delete-handle");
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", x);
    c.setAttribute("cy", y);
    c.setAttribute("r", "8");
    g.appendChild(c);
    const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l1.setAttribute("x1", x - 3);
    l1.setAttribute("y1", y - 3);
    l1.setAttribute("x2", x + 3);
    l1.setAttribute("y2", y + 3);
    const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l2.setAttribute("x1", x + 3);
    l2.setAttribute("y1", y - 3);
    l2.setAttribute("x2", x - 3);
    l2.setAttribute("y2", y + 3);
    g.appendChild(l1);
    g.appendChild(l2);
    return g;
  }

  function removeAnnotation(ann) {
    const idx = annotations.indexOf(ann);
    if (idx !== -1) annotations.splice(idx, 1);
    ann.el.remove();
    // Clean up any associated popover
    const pop = container.querySelector(".markup-pin-popover");
    if (pop) pop.remove();
  }

  // ─── Arrow ───

  function startArrow(coords) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("annotation-group");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("annotation-arrow");
    line.setAttribute("x1", coords.x);
    line.setAttribute("y1", coords.y);
    line.setAttribute("x2", coords.x);
    line.setAttribute("y2", coords.y);
    line.setAttribute("marker-end", "url(#arrowhead)");
    group.appendChild(line);
    svg.appendChild(group);
    dragState = { type: "arrow", line, group, x1: coords.x, y1: coords.y };
  }

  function moveArrow(coords) {
    if (!dragState || dragState.type !== "arrow") return;
    dragState.line.setAttribute("x2", coords.x);
    dragState.line.setAttribute("y2", coords.y);
  }

  function endArrow(coords) {
    if (!dragState || dragState.type !== "arrow") return;
    const { x1, y1, group } = dragState;
    const x2 = coords.x;
    const y2 = coords.y;
    // Ignore tiny drags
    if (Math.abs(x2 - x1) < 5 && Math.abs(y2 - y1) < 5) {
      group.remove();
      dragState = null;
      return;
    }
    const del = createDeleteHandle(x1, y1);
    group.appendChild(del);
    const ann = { type: "arrow", el: group, data: { x1, y1, x2, y2 } };
    annotations.push(ann);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAnnotation(ann);
    });
    dragState = null;
  }

  // ─── Box ───

  function startBox(coords) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("annotation-group");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.classList.add("annotation-box");
    rect.setAttribute("x", coords.x);
    rect.setAttribute("y", coords.y);
    rect.setAttribute("width", 0);
    rect.setAttribute("height", 0);
    group.appendChild(rect);
    svg.appendChild(group);
    dragState = { type: "box", rect, group, x1: coords.x, y1: coords.y };
  }

  function moveBox(coords) {
    if (!dragState || dragState.type !== "box") return;
    const { rect, x1, y1 } = dragState;
    const x = Math.min(x1, coords.x);
    const y = Math.min(y1, coords.y);
    const w = Math.abs(coords.x - x1);
    const h = Math.abs(coords.y - y1);
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
  }

  function endBox(coords) {
    if (!dragState || dragState.type !== "box") return;
    const { x1, y1, group } = dragState;
    const x2 = coords.x;
    const y2 = coords.y;
    if (Math.abs(x2 - x1) < 5 && Math.abs(y2 - y1) < 5) {
      group.remove();
      dragState = null;
      return;
    }
    const bx1 = Math.min(x1, x2);
    const by1 = Math.min(y1, y2);
    const bx2 = Math.max(x1, x2);
    const by2 = Math.max(y1, y2);
    const del = createDeleteHandle(bx1, by1);
    group.appendChild(del);
    const ann = {
      type: "box",
      el: group,
      data: { x1: bx1, y1: by1, x2: bx2, y2: by2 },
    };
    annotations.push(ann);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAnnotation(ann);
    });
    dragState = null;
  }

  // ─── Text ───

  function placeText(coords) {
    // Remove any existing text input
    const existing = container.querySelector(".markup-text-input");
    if (existing) existing.remove();

    const input = document.createElement("input");
    input.type = "text";
    input.className = "markup-text-input";
    input.placeholder = "Type label...";

    // Position relative to image
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const natW = img.naturalWidth || 1;
    const natH = img.naturalHeight || 1;
    const pxX =
      (coords.x / natW) * imgRect.width + (imgRect.left - containerRect.left);
    const pxY =
      (coords.y / natH) * imgRect.height + (imgRect.top - containerRect.top);
    input.style.left = `${pxX}px`;
    input.style.top = `${pxY}px`;
    container.appendChild(input);
    input.focus();

    function commit() {
      const label = input.value.trim();
      input.remove();
      if (!label) return;

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("annotation-group");
      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      text.classList.add("annotation-text");
      text.setAttribute("x", coords.x);
      text.setAttribute("y", coords.y);
      text.textContent = label;
      group.appendChild(text);

      const del = createDeleteHandle(coords.x, coords.y - 18);
      group.appendChild(del);
      svg.appendChild(group);

      const ann = {
        type: "text",
        el: group,
        data: { x: coords.x, y: coords.y, label },
      };
      annotations.push(ann);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        removeAnnotation(ann);
      });
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") input.remove();
      e.stopPropagation();
    });
    input.addEventListener("blur", commit);
  }

  // ─── Pin ───

  function placePin(coords) {
    pinCounter++;
    const num = pinCounter;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("annotation-group");
    const circle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    circle.classList.add("annotation-pin");
    circle.setAttribute("cx", coords.x);
    circle.setAttribute("cy", coords.y);
    circle.setAttribute("r", "12");
    group.appendChild(circle);

    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    label.classList.add("annotation-pin-label");
    label.setAttribute("x", coords.x);
    label.setAttribute("y", coords.y);
    label.textContent = num;
    group.appendChild(label);

    const del = createDeleteHandle(coords.x + 14, coords.y - 14);
    group.appendChild(del);
    svg.appendChild(group);

    const ann = {
      type: "pin",
      el: group,
      data: { x: coords.x, y: coords.y, num, note: "" },
    };
    annotations.push(ann);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAnnotation(ann);
    });

    // Show note popover
    showPinPopover(ann, coords);
  }

  function showPinPopover(ann, coords) {
    // Remove existing
    const existing = container.querySelector(".markup-pin-popover");
    if (existing) existing.remove();

    const pop = document.createElement("div");
    pop.className = "markup-pin-popover";

    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = `Pin #${ann.data.num} note (optional)`;
    inp.value = ann.data.note;

    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";

    pop.appendChild(inp);
    pop.appendChild(okBtn);

    // Position
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const natW = img.naturalWidth || 1;
    const natH = img.naturalHeight || 1;
    const pxX =
      (coords.x / natW) * imgRect.width + (imgRect.left - containerRect.left);
    const pxY =
      (coords.y / natH) * imgRect.height +
      (imgRect.top - containerRect.top) +
      20;
    pop.style.left = `${pxX}px`;
    pop.style.top = `${pxY}px`;
    container.appendChild(pop);
    inp.focus();

    function finish() {
      ann.data.note = inp.value.trim();
      pop.remove();
    }

    okBtn.addEventListener("click", finish);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish();
      }
      if (e.key === "Escape") {
        finish();
      }
      e.stopPropagation();
    });
  }

  // ─── Pointer Events ───

  svg.addEventListener("pointerdown", (e) => {
    if (!activeTool) return;
    e.preventDefault();
    const coords = toSvgCoords(e.clientX, e.clientY);

    if (activeTool === "arrow") startArrow(coords);
    else if (activeTool === "box") startBox(coords);
    else if (activeTool === "text") placeText(coords);
    else if (activeTool === "pin") placePin(coords);
  });

  svg.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    e.preventDefault();
    const coords = toSvgCoords(e.clientX, e.clientY);
    if (dragState.type === "arrow") moveArrow(coords);
    else if (dragState.type === "box") moveBox(coords);
  });

  svg.addEventListener("pointerup", (e) => {
    if (!dragState) return;
    e.preventDefault();
    const coords = toSvgCoords(e.clientX, e.clientY);
    if (dragState.type === "arrow") endArrow(coords);
    else if (dragState.type === "box") endBox(coords);
  });

  // ─── Public API ───

  function setTool(tool) {
    activeTool = tool;
    svg.classList.toggle("tool-active", !!tool);
    svg.classList.toggle("tool-text", tool === "text");
    svg.classList.toggle("tool-pin", tool === "pin");
  }

  function clear() {
    for (const ann of [...annotations]) {
      ann.el.remove();
    }
    annotations.length = 0;
    pinCounter = 0;
    // Remove any popovers/inputs
    for (const el of container.querySelectorAll(
      ".markup-text-input, .markup-pin-popover",
    )) {
      el.remove();
    }
  }

  function serialize() {
    if (annotations.length === 0) return null;
    const natW = img.naturalWidth || 1;
    const natH = img.naturalHeight || 1;
    const pct = (x, y) =>
      `${Math.round((x / natW) * 100)}%,${Math.round((y / natH) * 100)}%`;
    const lines = [`Image dimensions: ${natW}x${natH}`];
    for (const ann of annotations) {
      switch (ann.type) {
        case "arrow":
          lines.push(
            `Arrow from (${ann.data.x1},${ann.data.y1} / ${pct(ann.data.x1, ann.data.y1)}) to (${ann.data.x2},${ann.data.y2} / ${pct(ann.data.x2, ann.data.y2)})`,
          );
          break;
        case "box":
          lines.push(
            `Box at (${ann.data.x1},${ann.data.y1} / ${pct(ann.data.x1, ann.data.y1)})-(${ann.data.x2},${ann.data.y2} / ${pct(ann.data.x2, ann.data.y2)})`,
          );
          break;
        case "text":
          lines.push(
            `Text '${ann.data.label}' at (${ann.data.x},${ann.data.y} / ${pct(ann.data.x, ann.data.y)})`,
          );
          break;
        case "pin": {
          let s = `Pin #${ann.data.num} at (${ann.data.x},${ann.data.y} / ${pct(ann.data.x, ann.data.y)})`;
          if (ann.data.note) s += ` note: '${ann.data.note}'`;
          lines.push(s);
          break;
        }
      }
    }
    return lines.join("\n");
  }

  function attachToImage() {
    if (img.naturalWidth) {
      syncViewBox();
      positionOverlay();
    } else {
      img.addEventListener(
        "load",
        () => {
          syncViewBox();
          positionOverlay();
        },
        { once: true },
      );
    }
  }

  function getActiveTool() {
    return activeTool;
  }

  // Reposition on window resize
  window.addEventListener("resize", positionOverlay);

  return { serialize, clear, setTool, attachToImage, getActiveTool };
};
