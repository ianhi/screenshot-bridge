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

  let currentDataUrl = null;
  let ws = null;
  let wsReconnectTimer = null;

  // ─── Project State ───

  let currentProject = "default";
  const projectSet = new Set();

  function apiUrl(path) {
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}project=${encodeURIComponent(currentProject)}`;
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
      btn.addEventListener("click", () => switchProject(name));
      projectTabsInner.appendChild(btn);
    }
  }

  function switchProject(name) {
    if (name === currentProject) return;
    currentProject = name;
    renderTabs();
    loadHistory();
  }

  function addProject(name) {
    if (projectSet.has(name)) return;
    projectSet.add(name);
    renderTabs();
  }

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
    dropZone.classList.add("has-preview");
    promptInput.focus();
  }

  function discardPreview() {
    currentDataUrl = null;
    previewImg.src = "";
    preview.hidden = true;
    sendBar.hidden = true;
    promptInput.value = "";
    dropZone.classList.remove("has-preview");
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
    div.appendChild(img);

    // Info section
    const info = document.createElement("div");
    info.className = "history-info";

    const meta = document.createElement("div");
    meta.className = "history-meta";

    const badge = document.createElement("span");
    badge.className = `badge badge-${item.status}`;
    badge.textContent = item.status;
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
      startEditDescription(descRow, item.id, item.description || "");
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

  function startEditDescription(descEl, id, currentText) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "description-edit";
    input.value = currentText;
    input.placeholder = "Describe this screenshot...";

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
      const res = await fetch(apiUrl("/api/screenshots"));
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
    }
  }

  // ─── Init ───

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

    if (projectSet.size === 0) {
      projectSet.add("default");
    }
    if (!projectSet.has(currentProject)) {
      currentProject = [...projectSet][0];
    }

    renderTabs();
    loadHistory();
    connectWs();
  }

  init();
})();
