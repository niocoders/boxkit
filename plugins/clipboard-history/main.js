const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const clearEl = document.getElementById("clear");

const MAX_ITEMS = 100;
let items = [];
let lastText = "";
let polling = null;

async function load() {
  const stored = await window.bk.db.get("items");
  items = Array.isArray(stored) ? stored : [];
  render();
}

async function persist() {
  await window.bk.db.put("items", items.slice(0, MAX_ITEMS));
}

function render() {
  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", items.length > 0);
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item";

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = item.text;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = new Date(item.ts).toLocaleString();

    row.appendChild(text);
    row.appendChild(meta);
    row.title = "点击复制";
    row.onclick = async () => {
      await window.bk.writeClipboardText(item.text);
      await window.bk.notify("已复制到剪贴板");
    };
    listEl.appendChild(row);
  }
}

async function poll() {
  try {
    const text = await window.bk.readClipboardText();
    if (!text || text === lastText) return;
    lastText = text;
    if (items[0]?.text === text) return;
    items = items.filter((i) => i.text !== text);
    items.unshift({ text, ts: Date.now() });
    await persist();
    render();
  } catch (e) {
    statusEl.textContent = "无法读取剪贴板（需要 clipboard 权限）";
    stopPolling();
  }
}

function startPolling() {
  stopPolling();
  statusEl.textContent = "监听中…";
  polling = setInterval(poll, 1000);
  void poll();
}

function stopPolling() {
  if (polling) clearInterval(polling);
  polling = null;
}

clearEl.onclick = async () => {
  items = [];
  await persist();
  render();
  await window.bk.notify("剪贴板历史已清空");
};

window.bk.onPluginEnter(async (args) => {
  if (args.code !== "history") return;
  await load();
  startPolling();
});

window.bk.onPluginOut(() => {
  stopPolling();
});

void load();
