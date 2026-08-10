const state = {
  data: null, queue: "pending", currentMessage: null, reviewAction: null,
  settleResult: null, settleWasEdit: false,
  authToken: sessionStorage.getItem("davie_access_token") || ""
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const APP_BASE = window.location.hostname.endsWith("github.io")
  ? "https://liangzai666.com/davie"
  : window.location.pathname === "/davie" || window.location.pathname.startsWith("/davie/") ? "/davie" : "";
const apiUrl = (path) => `${APP_BASE}${path}`;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
function formatTime(ms, options = {}) {
  const d = new Date(Number(ms));
  return d.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    ...options
  });
}
function number(value, fallback = "—") {
  return value === null || value === undefined ? fallback : Number(value).toLocaleString("zh-CN");
}
function directionLabel(direction) {
  return direction === "long" ? "做多" : direction === "short" ? "做空" : "待判断";
}
function categoryLabel(category) {
  return ({ signal: "疑似开仓", close: "疑似平仓", update: "风控补充", watch: "价位观点", context: "上下文" })[category] || category;
}
function resultLabel(result) {
  return ({ win: "判断对", loss: "判断错", partial: "部分判断对", breakeven: "保本", cancelled: "未触发/取消", unknown: "待人工判断" })[result] || "待结算";
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.authToken ? { "X-Dashboard-Token": state.authToken } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}
function showAuth(message = "") {
  $("#auth-error").textContent = message;
  $("#auth-token").value = "";
  if (!$("#auth-dialog").open) $("#auth-dialog").showModal();
  setTimeout(() => $("#auth-token").focus(), 0);
}
async function loadData(showToast = false) {
  $("#refresh-btn").disabled = true;
  try {
    state.data = await request(apiUrl(`/api/dashboard?queue=${state.queue}&limit=120`));
    renderAll();
    if (showToast) toast(`同步完成，新入库 ${state.data.sync.inserted} 条`);
    return true;
  } catch (error) {
    if (error.status === 401) {
      state.authToken = "";
      sessionStorage.removeItem("davie_access_token");
      showAuth("令牌不正确，请重新输入");
    }
    toast(error.message);
    return false;
  } finally {
    $("#refresh-btn").disabled = false;
  }
}
function renderAll() {
  const { metrics, performance } = state.data;
  $("#nav-pending").textContent = metrics.pending_candidates || 0;
  $("#nav-open").textContent = metrics.open_signals || 0;
  $("#metric-pending").textContent = number(metrics.pending_candidates, "0");
  $("#metric-open").textContent = number(metrics.open_signals, "0");
  $("#metric-total").textContent = number(metrics.total_signals, "0");
  const settled = performance.settled_count || 0;
  const wins = performance.wins || 0;
  const rate = settled ? Math.round(wins / settled * 100) : null;
  $("#metric-winrate").textContent = rate === null ? "—" : `${rate}%`;
  $("#metric-winrate-note").textContent = settled ? `${wins} 胜 / ${settled} 已结算` : "结算后自动计算";
  $("#analysis-settled").textContent = settled;
  $("#analysis-r").textContent = performance.avg_r == null ? "—" : `${Number(performance.avg_r).toFixed(2)}R`;
  $("#analysis-win-text").textContent = settled ? `${rate}% 胜率 · ${wins} 次成功` : "暂无胜率样本";
  $("#win-bar").style.width = `${rate || 0}%`;
  $("#last-sync").textContent = `更新于 ${new Date(state.data.generated_at).toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"})}`;
  renderMessages();
  renderSignals();
}
function renderMessages() {
  const root = $("#message-list");
  if (!state.data.messages.length) {
    root.innerHTML = `<div class="empty">这组队列已经处理干净。</div>`;
    return;
  }
  root.innerHTML = state.data.messages.map(message => {
    const d = new Date(Number(message.sent_at));
    const badgeClass = message.direction || "neutral";
    const reviewed = message.decision !== "pending" && message.decision !== "watching";
    const actionHtml = reviewed
      ? `<div class="decision-chip">${message.decision === "rejected" ? "已标记：不是喊单" : `已关联 ${escapeHtml(message.signal_id || "")}`}</div>`
      : `<div class="message-actions">
          <button class="new" data-action="new" data-id="${message.id}">新建喊单</button>
          <button class="link" data-action="link" data-id="${message.id}">关联已有</button>
          <button data-action="reject" data-id="${message.id}">不是喊单</button>
          <button data-action="watch" data-id="${message.id}">继续观察</button>
        </div>`;
    return `<article class="message-card">
      <div class="message-time"><strong>${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}</strong><span>${d.getMonth()+1}月${d.getDate()}日</span></div>
      <div class="message-body">
        <div class="message-meta">
          <span class="badge ${badgeClass}">${message.direction ? directionLabel(message.direction) : categoryLabel(message.category)}</span>
          <span class="confidence">AI ${Math.round(Number(message.confidence) * 100)}%</span>
          ${message.extracted_prices?.length ? `<span class="confidence">价位 ${message.extracted_prices.join(" / ")}</span>` : ""}
        </div>
        <p class="message-text">${escapeHtml(message.text)}</p>
        <div class="ai-note">✦ ${escapeHtml(message.reason)}</div>
      </div>${actionHtml}
    </article>`;
  }).join("");
}
function renderSignals() {
  const root = $("#signal-board");
  if (!state.data.signals.length) {
    root.innerHTML = `<div class="empty">确认第一条独立喊单后，台账会出现在这里。</div>`;
    return;
  }
  root.innerHTML = state.data.signals.map(signal => {
    const result = signal.status === "settled"
      ? `<div class="signal-result-actions"><span class="settled-result ${signal.result}">${resultLabel(signal.result)}${signal.r_multiple == null ? "" : ` · ${Number(signal.r_multiple).toFixed(2)}R`}</span><button class="secondary settle-btn" data-signal="${signal.id}">人工改判</button></div>`
      : `<button class="secondary settle-btn" data-signal="${signal.id}">人工结算</button>`;
    return `<article class="signal-card ${signal.direction}">
      <div class="signal-top"><div><div class="signal-id">${signal.id}</div><h3>${escapeHtml(signal.symbol)} · ${directionLabel(signal.direction)}</h3><span class="signal-state">${signal.status === "open" ? "进行中" : "已结算"} · ${formatTime(signal.opened_at)}</span></div><span class="badge ${signal.direction}">${directionLabel(signal.direction)}</span></div>
      <div class="signal-prices">
        <div><span>入场</span><strong>${number(signal.entry_price)}</strong></div>
        <div><span>止损</span><strong>${number(signal.stop_loss)}</strong></div>
        <div><span>止盈</span><strong>${number(signal.take_profit)}</strong></div>
      </div>
      <div class="signal-events">${signal.events.map(event => `<div class="signal-event"><time>${new Date(Number(event.sent_at)).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</time><p>${escapeHtml(event.text)}</p></div>`).join("")}</div>
      <footer><span class="signal-state">${signal.event_count} 条关联言论</span>${result}</footer>
    </article>`;
  }).join("");
}
function openReview(message, action) {
  state.currentMessage = message; state.reviewAction = action;
  $("#dialog-message-id").value = message.id;
  $("#dialog-message").textContent = message.text;
  $("#field-note").value = "";
  $("#new-fields").classList.toggle("hidden", action !== "new");
  $("#link-fields").classList.toggle("hidden", action !== "link");
  if (action === "new") {
    $("#dialog-title").textContent = "创建一条独立喊单";
    $("#field-direction").value = message.direction || "long";
    $("#field-symbol").value = "";
    $("#field-entry").value = message.extracted_prices?.[0] || "";
    $("#field-stop").value = "";
    $("#field-target").value = "";
  } else if (action === "link") {
    $("#dialog-title").textContent = "归并到已有喊单";
    const openSignals = state.data.signals.filter(s => s.status === "open");
    $("#field-signal").innerHTML = openSignals.map(s =>
      `<option value="${s.id}">${s.id} · ${escapeHtml(s.symbol)} · ${directionLabel(s.direction)}</option>`
    ).join("");
    if (!openSignals.length) return toast("当前没有进行中的喊单，请先新建");
  } else {
    $("#dialog-title").textContent = action === "reject" ? "确认不是喊单" : "放入观察区";
  }
  $("#review-dialog").showModal();
}
async function submitReview(event) {
  event.preventDefault();
  const action = state.reviewAction;
  const payload = { action, note: $("#field-note").value };
  if (action === "new") Object.assign(payload, {
    direction: $("#field-direction").value, symbol: $("#field-symbol").value,
    entry_price: $("#field-entry").value, stop_loss: $("#field-stop").value,
    take_profit: $("#field-target").value
  });
  if (action === "link") Object.assign(payload, {
    signal_id: $("#field-signal").value, event_type: $("#field-event-type").value
  });
  try {
    const result = await request(apiUrl(`/api/messages/${state.currentMessage.id}/decision`), {
      method: "POST", body: JSON.stringify(payload)
    });
    $("#review-dialog").close();
    toast(result.signal_id ? `已写入 ${result.signal_id}` : "确认结果已保存");
    await loadData();
  } catch (error) { toast(error.message); }
}
async function quickReject(message) {
  try {
    await request(apiUrl(`/api/messages/${message.id}/decision`), {
      method: "POST", body: JSON.stringify({ action: "reject", note: "" })
    });
    toast("已标记：不是喊单");
    await loadData();
  } catch (error) { toast(error.message); }
}
function openSettle(signalId) {
  const signal = state.data.signals.find(item => item.id === signalId);
  if (!signal) return toast("未找到这条喊单");
  state.settleWasEdit = signal.status === "settled";
  state.settleResult = state.settleWasEdit ? signal.result : null;
  $("#settle-signal-id").value = signalId;
  $("#settle-kicker").textContent = state.settleWasEdit ? "人工修改历史结果" : "人工结算";
  $("#settle-title").textContent = `${state.settleWasEdit ? "改判" : "结算"} ${signalId}`;
  $("#settle-close").value = signal.close_price ?? "";
  $("#settle-r").value = signal.r_multiple ?? "";
  $("#settle-note").value = signal.notes || "";
  $("#settle-submit").textContent = state.settleWasEdit ? "保存改判" : "完成结算";
  $$("#result-options button").forEach(btn => btn.classList.toggle("selected", btn.dataset.result === state.settleResult));
  $("#settle-dialog").showModal();
}
async function submitSettle(event) {
  event.preventDefault();
  if (!state.settleResult) return toast("请先选择结算结果");
  const id = $("#settle-signal-id").value;
  try {
    await request(apiUrl(`/api/signals/${id}/settle`), {
      method: "POST", body: JSON.stringify({
        result: state.settleResult, close_price: $("#settle-close").value,
        r_multiple: $("#settle-r").value, notes: $("#settle-note").value
      })
    });
    $("#settle-dialog").close();
    toast(state.settleWasEdit ? `${id} 改判已保存` : `${id} 已结算`);
    await loadData();
  } catch (error) { toast(error.message); }
}
document.addEventListener("click", event => {
  const close = event.target.closest("[data-close-dialog]");
  if (close) document.getElementById(close.dataset.closeDialog).close();
  const action = event.target.closest("[data-action]");
  if (action) {
    const message = state.data.messages.find(m => m.id === action.dataset.id);
    if (message && action.dataset.action === "reject") quickReject(message);
    else if (message) openReview(message, action.dataset.action);
  }
  const settle = event.target.closest(".settle-btn");
  if (settle) openSettle(settle.dataset.signal);
});
$("#message-list").addEventListener("dblclick", event => {
  const card = event.target.closest(".message-card");
  if (!card) return;
});
$("#review-form").addEventListener("submit", submitReview);
$("#settle-form").addEventListener("submit", submitSettle);
$("#auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  state.authToken = $("#auth-token").value.trim();
  if (!state.authToken) return showAuth("请输入访问令牌");
  const ok = await loadData();
  if (ok) {
    sessionStorage.setItem("davie_access_token", state.authToken);
    $("#auth-dialog").close();
  }
});
$("#logout-btn").addEventListener("click", () => {
  state.authToken = "";
  sessionStorage.removeItem("davie_access_token");
  showAuth("已退出工作台");
});
$("#refresh-btn").addEventListener("click", () => loadData(true));
$("#queue-tabs").addEventListener("click", event => {
  const button = event.target.closest("[data-queue]"); if (!button) return;
  state.queue = button.dataset.queue;
  $$("#queue-tabs button").forEach(b => b.classList.toggle("active", b === button));
  loadData();
});
$("#result-options").addEventListener("click", event => {
  const button = event.target.closest("[data-result]"); if (!button) return;
  state.settleResult = button.dataset.result;
  $$("#result-options button").forEach(b => b.classList.toggle("selected", b === button));
});
$$(".nav-item").forEach(button => button.addEventListener("click", () => {
  $$(".nav-item").forEach(b => b.classList.toggle("active", b === button));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${button.dataset.view}`));
  const copy = {
    inbox: ["人工确认工作台", "今天，有哪些话值得记一笔？"],
    signals: ["喊单生命周期", "每一次判断，都保留原始依据。"],
    analytics: ["统计与复盘", "把感觉，变成可以验证的数据。"]
  }[button.dataset.view];
  $("#page-kicker").textContent = copy[0]; $("#page-title").textContent = copy[1];
}));
if (state.authToken) loadData(); else showAuth();
setInterval(() => {
  if (state.authToken) loadData();
}, 30000);
