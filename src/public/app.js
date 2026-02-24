(() => {
  const $id = (id) => document.getElementById(id);

  // Elements
  const dropZone = $id("dropZone");
  const preview = $id("preview");
  const previewImg = $id("previewImg");
  const discardBtn = $id("discardBtn");
  const sendBar = $id("sendBar");
  const promptInput = $id("promptInput");
  const sendBtn = $id("sendBtn");
  const historyList = $id("historyList");
  const historyEmpty = $id("historyEmpty");
  const historyCount = $id("historyCount");
  const clearAllBtn = $id("clearAllBtn");
  const connectionStatus = $id("connectionStatus");
  const toastContainer = $id("toastContainer");
  const projectTabs = $id("projectTabs");
  const projectTabsInner = $id("projectTabsInner");
  const lightbox = $id("lightbox");
  const lightboxImg = $id("lightboxImg");
  const lightboxCaption = $id("lightboxCaption");
  const lightboxClose = $id("lightboxClose");
  const markupContainer = $id("markupContainer");
  const markupOverlay = $id("markupOverlay");
  const markupToolbar = $id("markupToolbar");
  const markupClearBtn = $id("markupClearBtn");
  const micBtn = $id("micBtn");
  const clipboardBtn = $id("clipboardBtn");
  const projectStatus = $id("projectStatus");
  const projectStatusName = $id("projectStatusName");
  const projectStatusSessions = $id("projectStatusSessions");
  const searchInput = $id("searchInput");
  const searchClear = $id("searchClear");
  const filterStatus = $id("filterStatus");

  let currentDataUrl = null;
  let markup = null;
  let ws = null;
  let wsReconnectTimer = null;
  let sessionCounts = {};

  // ─── Project State ───

  let currentProject = "default";
  const projectSet = new Set();

  function apiUrl(path) {
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}project=${encodeURIComponent(currentProject)}`;
  }

  function updateProjectStatus() {
    projectStatusName.textContent = currentProject;
    const count = sessionCounts[currentProject] || 0;
    if (count > 0) {
      projectStatusSessions.textContent = `${count} agent${count !== 1 ? "s" : ""} connected`;
      projectStatusSessions.classList.add("connected");
    } else {
      projectStatusSessions.textContent = "no agents connected";
      projectStatusSessions.classList.remove("connected");
    }
  }

  function renderTabs() {
    const projects = [...projectSet].sort();
    const showTabs = projects.length > 1;
    projectTabs.hidden = !showTabs;

    // Clear existing tabs
    while (projectTabsInner.firstChild) {
      projectTabsInner.removeChild(projectTabsInner.firstChild);
    }

    if (!showTabs) return;

    for (const name of projects) {
      const btn = document.createElement("button");
      btn.className = `project-tab${name === currentProject ? " active" : ""}`;
      btn.textContent = name;
      if (sessionCounts[name] > 0) {
        const dot = document.createElement("span");
        dot.className = "tab-agent-dot";
        btn.appendChild(dot);
      }
      btn.addEventListener("click", () => switchProject(name));
      projectTabsInner.appendChild(btn);
    }

    updateProjectStatus();
  }

  function switchProject(name) {
    if (name === currentProject) return;
    currentProject = name;
    renderTabs();
    updateProjectStatus();
    loadHistory();
  }

  function addProject(name) {
    if (projectSet.has(name)) return;
    projectSet.add(name);
    renderTabs();
  }

  // ─── Search ───

  let searchTimer = null;

  function getSearchParams() {
    const q = searchInput.value.trim();
    const status = filterStatus.value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    return params;
  }

  function hasActiveSearch() {
    return searchInput.value.trim() !== "" || filterStatus.value !== "";
  }

  function triggerSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchClear.hidden = !hasActiveSearch();
      loadHistory();
    }, 250);
  }

  searchInput.addEventListener("input", triggerSearch);
  filterStatus.addEventListener("change", triggerSearch);

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      filterStatus.value = "";
      searchClear.hidden = true;
      loadHistory();
    }
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    filterStatus.value = "";
    searchClear.hidden = true;
    loadHistory();
  });

  // ─── Toast ───

  function toast(message, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type === "error" ? "toast-error" : ""}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add("toast-out");
      setTimeout(() => el.remove(), 200);
    }, 3000);
  }

  // ─── Image Handling ───

  function handleImageData(dataUrl) {
    currentDataUrl = dataUrl;
    previewImg.src = dataUrl;
    preview.hidden = false;
    sendBar.hidden = false;
    markupToolbar.hidden = false;
    dropZone.classList.add("has-preview");
    promptInput.focus();

    // Initialize markup tools
    if (!markup) {
      markup = window.createMarkupTools(
        markupContainer,
        markupOverlay,
        previewImg,
      );
    } else {
      markup.clear();
      markup.setTool(null);
    }
    markup.attachToImage(previewImg);
    updateToolbarButtons();
  }

  function discardPreview() {
    currentDataUrl = null;
    previewImg.src = "";
    preview.hidden = true;
    sendBar.hidden = true;
    markupToolbar.hidden = true;
    promptInput.value = "";
    dropZone.classList.remove("has-preview");
    if (markup) {
      markup.clear();
      markup.setTool(null);
      updateToolbarButtons();
    }
  }

  function readFileAsDataUrl(file) {
    if (!file.type.startsWith("image/")) {
      toast("Only image files are supported", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => handleImageData(e.target.result);
    reader.readAsDataURL(file);
  }

  // Paste handler (global)
  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        readFileAsDataUrl(item.getAsFile());
        return;
      }
    }
  });

  // Drag and drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) readFileAsDataUrl(file);
  });

  // Click to open file picker
  dropZone.addEventListener("click", () => {
    if (currentDataUrl) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      if (input.files[0]) readFileAsDataUrl(input.files[0]);
    };
    input.click();
  });

  discardBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    discardPreview();
  });

  // ─── Send ───

  async function sendScreenshot() {
    if (!currentDataUrl) return;
    sendBtn.disabled = true;
    try {
      const res = await fetch(apiUrl("/api/screenshots"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: currentDataUrl,
          prompt: promptInput.value.trim(),
          annotations: markup ? markup.serialize() : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      discardPreview();
      toast("Screenshot sent");
      loadHistory();
    } catch (err) {
      toast(`Failed to send: ${err.message}`, "error");
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", sendScreenshot);
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendScreenshot();
    }
  });

  // ─── History ───

  function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function createDeleteSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("fill", "none");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M2 4h10M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M9 7v4M5 7v4M3 4l.5 7.5a1 1 0 001 .5h5a1 1 0 001-.5L11 4",
    );
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function createHistoryItem(item) {
    const div = document.createElement("div");
    div.className = "history-item";
    div.dataset.id = item.id;

    // Thumbnail
    const img = document.createElement("img");
    img.className = "history-thumb";
    img.src = `/api/screenshots/${encodeURIComponent(item.id)}/image`;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(item.id, item.prompt || item.description || "");
    });
    div.appendChild(img);

    // Info section
    const info = document.createElement("div");
    info.className = "history-info";

    const meta = document.createElement("div");
    meta.className = "history-meta";

    const badge = document.createElement("span");
    if (item.source === "agent") {
      badge.className = "badge badge-agent";
      badge.textContent = "agent";
    } else {
      badge.className = `badge badge-${item.status}`;
      badge.textContent = item.status;
    }
    meta.appendChild(badge);

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatTime(item.createdAt);
    meta.appendChild(time);

    if (item.git?.branch) {
      const gitBadge = document.createElement("span");
      gitBadge.className = "badge badge-git";
      gitBadge.textContent = item.git.branch;
      gitBadge.title = item.git.commit
        ? `${item.git.branch} @ ${item.git.commitShort}`
        : item.git.branch;
      meta.appendChild(gitBadge);
    }

    info.appendChild(meta);

    if (item.prompt) {
      const prompt = document.createElement("div");
      prompt.className = "history-prompt";
      prompt.textContent = item.prompt;
      prompt.title = item.prompt;
      info.appendChild(prompt);
    }

    // Description (AI-generated or user-edited)
    const descRow = document.createElement("div");
    descRow.className = "history-description";
    if (item.description) {
      descRow.textContent = item.description;
      descRow.title = "Click to edit description";
    } else {
      descRow.textContent = "No description yet";
      descRow.classList.add("history-description-empty");
      descRow.title = "Click to add description";
    }
    descRow.dataset.id = item.id;
    descRow.addEventListener("click", (e) => {
      e.stopPropagation();
      startEditDescription(
        descRow,
        item.id,
        item.description || "",
        item.source === "agent",
      );
    });
    info.appendChild(descRow);

    div.appendChild(info);

    // Delete button
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete";
    delBtn.title = "Delete";
    delBtn.dataset.id = item.id;
    delBtn.appendChild(createDeleteSvg());
    actions.appendChild(delBtn);
    div.appendChild(actions);

    return div;
  }

  function startEditDescription(descEl, id, currentText, isAgent) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "description-edit";
    input.value = currentText;
    input.placeholder = isAgent
      ? "Describe this image..."
      : "Describe this screenshot...";

    descEl.textContent = "";
    descEl.appendChild(input);
    input.focus();

    async function save() {
      const value = input.value.trim();
      try {
        const res = await fetch(`/api/screenshots/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: value }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        descEl.textContent = value || "No description yet";
        descEl.classList.toggle("history-description-empty", !value);
      } catch (err) {
        toast(`Failed to save description: ${err.message}`, "error");
        descEl.textContent = currentText || "No description yet";
        descEl.classList.toggle("history-description-empty", !currentText);
      }
    }

    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        descEl.textContent = currentText || "No description yet";
        descEl.classList.toggle("history-description-empty", !currentText);
      }
    });
  }

  function updateHistoryCount(count) {
    historyCount.textContent = count > 0 ? `${count}` : "";
    historyEmpty.style.display = count > 0 ? "none" : "block";
  }

  async function loadHistory() {
    try {
      const search = getSearchParams();
      const searchStr = search.toString();
      const url = searchStr
        ? apiUrl(`/api/screenshots?${searchStr}`)
        : apiUrl("/api/screenshots");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = await res.json();

      for (const el of historyList.querySelectorAll(".history-item")) {
        el.remove();
      }

      for (const item of items) {
        historyList.appendChild(createHistoryItem(item));
      }
      updateHistoryCount(items.length);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  }

  // Delete handlers (event delegation)
  historyList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-delete");
    if (!btn) return;
    const id = btn.dataset.id;
    try {
      const res = await fetch(`/api/screenshots/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      toast(`Delete failed: ${err.message}`, "error");
    }
  });

  clearAllBtn.addEventListener("click", async () => {
    const items = historyList.querySelectorAll(".history-item");
    if (items.length === 0) return;
    try {
      const res = await fetch(apiUrl("/api/screenshots"), { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      toast(`Clear failed: ${err.message}`, "error");
    }
  });

  // ─── WebSocket ───

  function connectWs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.addEventListener("open", () => {
      connectionStatus.classList.add("connected");
      connectionStatus.title = "Connected";
    });

    ws.addEventListener("close", () => {
      connectionStatus.classList.remove("connected");
      connectionStatus.title = "Disconnected";
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      ws.close();
    });

    ws.addEventListener("message", (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        handleWsEvent(event, data);
      } catch {
        /* ignore malformed messages */
      }
    });
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectWs, 3000);
  }

  function handleWsEvent(event, data) {
    const eventProject = data?.project || "default";

    switch (event) {
      case "project:created":
        addProject(eventProject);
        break;

      case "screenshot:added":
        addProject(eventProject);
        if (eventProject === currentProject) {
          loadHistory();
        }
        if (data.source === "agent") {
          toast("Agent sent an image");
        }
        break;

      case "session:connected":
        sessionCounts[eventProject] = data.count || 0;
        renderTabs();
        updateProjectStatus();
        break;

      case "session:disconnected":
        sessionCounts[eventProject] = data.count || 0;
        if (sessionCounts[eventProject] === 0)
          delete sessionCounts[eventProject];
        renderTabs();
        updateProjectStatus();
        break;

      case "screenshot:updated": {
        if (eventProject !== currentProject) break;
        const item = historyList.querySelector(
          `[data-id="${CSS.escape(data.id)}"]`,
        );
        if (item) {
          if (data.status) {
            const badge = item.querySelector(".badge");
            if (badge) {
              badge.className = `badge badge-${data.status === "delivered" ? "delivered" : "pending"}`;
              badge.textContent = data.status;
              if (data.status === "delivered") {
                badge.classList.add("badge-just-delivered");
                setTimeout(
                  () => badge.classList.remove("badge-just-delivered"),
                  600,
                );
                toast("Agent picked up a screenshot");
              }
            }
          }
          if (data.description !== undefined) {
            const descEl = item.querySelector(".history-description");
            if (descEl) {
              descEl.textContent = data.description || "No description yet";
              descEl.classList.toggle(
                "history-description-empty",
                !data.description,
              );
            }
          }
        }
        break;
      }

      case "screenshot:deleted": {
        if (eventProject !== currentProject) break;
        const item = historyList.querySelector(
          `[data-id="${CSS.escape(data.id)}"]`,
        );
        if (item) {
          item.classList.add("removing");
          setTimeout(() => {
            item.remove();
            updateHistoryCount(
              historyList.querySelectorAll(".history-item").length,
            );
          }, 200);
        }
        break;
      }

      case "screenshots:cleared":
        if (eventProject !== currentProject) break;
        for (const el of historyList.querySelectorAll(".history-item")) {
          el.classList.add("removing");
          setTimeout(() => el.remove(), 200);
        }
        setTimeout(() => updateHistoryCount(0), 220);
        break;

      case "canvas:execute": {
        // Local dev tool: intentional dynamic code execution for agent-driven canvas rendering.
        // Wrapped in async IIFE so agent code can use await, fetch(), load images, etc.
        const { requestId, code, width, height } = data;
        (async () => {
          try {
            const offscreen = document.createElement("canvas");
            offscreen.width = width || 800;
            offscreen.height = height || 600;
            const ctx = offscreen.getContext("2d");
            const render = new Function(
              "canvas",
              "ctx",
              `return (async () => { ${code} })();`,
            );
            await render(offscreen, ctx);
            const dataUrl = offscreen.toDataURL("image/png");
            ws.send(
              JSON.stringify({
                event: "canvas:result",
                data: { requestId, dataUrl },
              }),
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                event: "canvas:result",
                data: { requestId, error: err.message },
              }),
            );
          }
        })();
        break;
      }
    }
  }

  // ─── Lightbox ───

  function openLightbox(id, caption) {
    lightboxImg.src = `/api/screenshots/${encodeURIComponent(id)}/image`;
    lightboxCaption.textContent = caption || "";
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = "";
  }

  lightboxClose.addEventListener("click", closeLightbox);
  lightbox
    .querySelector(".lightbox-backdrop")
    .addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) {
      closeLightbox();
    }
  });

  // ─── Markup Toolbar ───

  function updateToolbarButtons() {
    const active = markup ? markup.getActiveTool() : null;
    for (const btn of markupToolbar.querySelectorAll(".markup-tool-btn")) {
      btn.classList.toggle("active", btn.dataset.tool === active);
    }
  }

  markupToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".markup-tool-btn");
    if (!btn || !markup) return;
    const tool = btn.dataset.tool;
    const current = markup.getActiveTool();
    markup.setTool(current === tool ? null : tool);
    updateToolbarButtons();
  });

  markupClearBtn.addEventListener("click", () => {
    if (markup) {
      markup.clear();
      markup.setTool(null);
      updateToolbarButtons();
    }
  });

  // Keyboard shortcuts for tools (when prompt not focused)
  document.addEventListener("keydown", (e) => {
    if (!markup || markupToolbar.hidden) return;
    if (document.activeElement === promptInput) return;
    if (document.activeElement?.tagName === "INPUT") return;

    // Undo/Redo
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      markup.undo();
      return;
    }
    if (
      mod &&
      ((e.key.toLowerCase() === "z" && e.shiftKey) ||
        e.key.toLowerCase() === "y")
    ) {
      e.preventDefault();
      markup.redo();
      return;
    }

    const key = e.key.toLowerCase();
    const toolMap = { m: "move", a: "arrow", b: "box", t: "text", p: "pin" };
    if (toolMap[key]) {
      e.preventDefault();
      const current = markup.getActiveTool();
      markup.setTool(current === toolMap[key] ? null : toolMap[key]);
      updateToolbarButtons();
    }
    if (e.key === "Escape") {
      markup.setTool(null);
      updateToolbarButtons();
    }
  });

  // ─── Clipboard Read ───

  if (navigator.clipboard?.read) {
    clipboardBtn.hidden = false;
    clipboardBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onload = (ev) => handleImageData(ev.target.result);
            reader.readAsDataURL(blob);
            return;
          }
        }
        toast("No image found in clipboard", "error");
      } catch (err) {
        if (err.name === "NotAllowedError") {
          toast("Clipboard access denied — allow in browser settings", "error");
        } else {
          toast(`Clipboard read failed: ${err.message}`, "error");
        }
      }
    });
  }

  // ─── Voice Input ───

  if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
    micBtn.hidden = false;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;

    micBtn.addEventListener("click", () => {
      if (recognition) {
        recognition.stop();
        return;
      }
      recognition = new SpeechRecognition();
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.lang = navigator.language || "en-US";

      recognition.onstart = () => {
        micBtn.classList.add("listening");
      };
      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        promptInput.value = promptInput.value
          ? `${promptInput.value} ${transcript}`
          : transcript;
      };
      recognition.onerror = () => {
        micBtn.classList.remove("listening");
        recognition = null;
      };
      recognition.onend = () => {
        micBtn.classList.remove("listening");
        recognition = null;
      };
      recognition.start();
    });
  }

  // ─── Init ───

  // Mac keyboard hint
  if (navigator.platform.includes("Mac")) {
    const mod = $id("pasteModifier");
    if (mod) mod.textContent = "Cmd";
  }

  async function init() {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const projects = await res.json();
        for (const p of projects) {
          projectSet.add(p);
        }
      }
    } catch {
      // Server may not have projects yet
    }

    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        sessionCounts = await res.json();
      }
    } catch {
      // Server may not support sessions endpoint yet
    }

    if (projectSet.size === 0) {
      projectSet.add("default");
    }
    if (!projectSet.has(currentProject)) {
      currentProject = [...projectSet][0];
    }

    renderTabs();
    updateProjectStatus();
    loadHistory();
    connectWs();
  }

  init();
})();
