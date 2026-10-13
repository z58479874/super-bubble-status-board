import { renderMealPage, renderMyMeal, renderNextMeals, tickMealClocks } from './meal-plans.js';
import { createActions } from "./mvp-actions.js";
import { areaNames, roleNames, employmentNames, modeNames, phaseNames, stateNames, actionNames, nextActionNames, areaLabel, positionLabel, assignmentLabel, handoffStage, statusLabel, label, businessError, dispatchCandidates } from "./displayLabels.js";

const config = window.__SB_CONFIG__ || {};
const sessionKey = "super_bubble_012_session";
const livePollMs = 5000;
const mealPollMs = 15000;
const managerRoles = new Set(["manager", "deputy", "supervisor"]);
const views = {
  login: document.getElementById("loginView"),
  changePin: document.getElementById("changePinView"),
  dashboard: document.getElementById("dashboardView")
};
const content = document.getElementById("content");
const banner = document.getElementById("connectionBanner");
const phaseBadge = document.getElementById("phaseBadge");
const pageCalls = {
  home: ["rpc_today_meal_plan", "rpc_today_overview", "rpc_today_alerts", "rpc_today_coverage", "rpc_today_handoffs", "rpc_today_staff", "rpc_today_positions"],
  dispatch: ["rpc_today_overview", "rpc_today_alerts", "rpc_today_coverage", "rpc_today_handoffs", "rpc_today_staff", "rpc_today_positions"],
  staff: ["rpc_today_overview", "rpc_today_staff", "rpc_today_positions"],
  positions: ["rpc_today_overview", "rpc_today_positions"],
  handoffs: ["rpc_today_overview", "rpc_today_handoffs"], my: ["rpc_my_today_state", "rpc_my_meal_plan"],
  meals: ["rpc_today_overview", "rpc_today_meal_plan"]
};
let session = null;
let page = "home";
let staffFilter = "all";
let epoch = 0;
let controller = null;
let polling = null;
let pollingGeneration = 0;
let busy = false;
let cache = {};
let sharedReads = {};
let dispatchFocus = null;
let updatedAt = {};
let pageError = {};
let actions;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function safe(value, fallback = "—") { return escapeHtml(value === null || value === undefined || value === "" ? fallback : value); }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function datetime(value, includeDate = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: includeDate ? "numeric" : undefined,
    day: includeDate ? "numeric" : undefined, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function refreshedAt(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit",
    minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}
function minuteText(value) { return value === null || value === undefined ? "计时待确认" : `${number(value)} 分钟`; }
function breakTiming(status, since, givenMinutes) {
  if (!["meal", "short_leave"].includes(status) || !since) return "";
  const minutes = givenMinutes === null || givenMinutes === undefined
    ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000)) : number(givenMinutes);
  if (status === "meal") return minutes > 45 ? `吃饭超时 ${minutes - 45} 分钟` : `已吃饭 ${minutes} 分钟 · 剩余 ${Math.max(0, 45 - minutes)} 分钟`;
  return minutes > 15 ? `短离已 ${minutes} 分钟 · 超过提醒 ${minutes - 15} 分钟` : `短离已 ${minutes} 分钟 · 15 分钟提醒`;
}
const assignment = assignmentLabel;
function returnAssignment(row) { return assignmentLabel(row, "return"); }
function statusTone(row) {
  if (row?.roster_status === "cancelled" || !row?.status || ["not_arrived", "off_duty"].includes(row.status)) return "gray";
  if (row.status === "meal") return "orange";
  if (row.status === "short_leave") return "orange";
  if (row.current_assignment_type === "in_transit") return "blue";
  return "green";
}
function isManager() { return managerRoles.has(session?.role); }
function rpcEndpoint(name) { return `${String(config.url || "").replace(/\/$/, "")}/rest/v1/rpc/${name}`; }
function isSessionError(error) {
  return error?.code === "28000" || /会话已失效|请重新验证身份|session.*expired/i.test(error?.message || "");
}
function readableError(error, context = "read") {
  if (error?.code === "42501") return "当前身份没有权限查看这项内容。";
  if (error?.code === "PGRST000" || /network|failed to fetch|连接|fetch/i.test(error?.message || "")) return "数据连接异常，请检查网络后重试。";
  if (/超时|AbortError/i.test(error?.message || "")) return "请求超时，请检查网络后重试。";
  if (context === "login") return "登录暂时失败，请检查网络或稍后重试。";
  if (context === "pin") return "PIN 修改暂时失败，请稍后重试。";
  return "现场数据暂时无法读取，请稍后刷新。";
}
async function rpc(name, body, signal, allowEmptyResponse = false) {
  const ownController = signal ? null : new AbortController();
  const timeout = setTimeout(() => (ownController || controller)?.abort(), 12000);
  try {
    const response = await fetch(rpcEndpoint(name), {
      method: "POST", headers: { apikey: config.publishableKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body), signal: signal || ownController.signal, cache: "no-store"
    });
    const raw = await response.text();
    let data = null;
    if (raw.trim()) {
      try { data = JSON.parse(raw); }
      catch {
        if (!response.ok) data = null;
        else if (allowEmptyResponse) data = raw;
        else throw new Error("服务器返回了无法读取的数据");
      }
    } else if (response.ok && !allowEmptyResponse) {
      throw new Error("服务器返回了无法读取的数据");
    }
    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `请求失败（${response.status}）`);
      error.code = data?.code;
      if (isSessionError(error)) showLogin("登录已过期，请重新验证。 ");
      throw error;
    }
    if (allowEmptyResponse && data && typeof data === "object" && !Array.isArray(data) && data.error) {
      const error = new Error(data.message || String(data.error));
      error.code = data.code;
      if (isSessionError(error)) showLogin("登录已过期，请重新验证。 ");
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("连接超时，请检查网络后重试");
    throw error;
  } finally { clearTimeout(timeout); }
}
const writeRpc = (name, body) => rpc(name, body, undefined, true);
function saveSession(value) {
  session = { session_token: value.session_token, staff_id: value.staff_id, name: value.name,
    role: value.role, expires_at: value.expires_at, must_change_pin: Boolean(value.must_change_pin) };
  sessionStorage.setItem(sessionKey, JSON.stringify(session));
}
function clearSession() {
  session = null;
  sessionStorage.removeItem(sessionKey);
  cache = {}; sharedReads = {}; updatedAt = {}; pageError = {};
  stopPolling();
}
function showView(name) {
  for (const [key, element] of Object.entries(views)) element.hidden = key !== name;
}
function showError(id, message) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.hidden = !message;
}
function showLogin(message = "") {
  actions?.dismiss();
  clearSession(); showView("login");
  document.getElementById("pin").value = "";
  showError("loginError", message);
}
function showDashboard() {
  if (session.must_change_pin) { showView("changePin"); return; }
  page = isManager() ? "home" : "my";
  showView("dashboard");
  document.getElementById("headerPerson").textContent = `${session.name} · ${roleNames[session.role] || "员工"}`;
  renderNav(); tickClock();
  startPolling();
  refresh(true);
}
function renderNav() {
  const tabs = isManager() ? [
    ["home", "⌂", "总览"], ["staff", "◉", "人员"], ["positions", "▦", "岗位"],
    ["handoffs", "⇄", "交接"], ["my", "●", "我的"]
  ] : [["my", "●", "我的"]];
  document.getElementById("bottomNav").innerHTML = tabs.map(([id, icon, name]) =>
    `<button type="button" class="nav-button ${page === id ? "active" : ""}" data-page="${id}" aria-current="${page === id ? "page" : "false"}"><span aria-hidden="true">${icon}</span><span>${name}</span></button>`).join("");
}
function tickClock() {
  tickMealClocks(content);
  if (views.dashboard.hidden) return;
  const now = new Date();
  document.getElementById("headerDate").textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "short"
  }).format(now);
  document.getElementById("clockNow").textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(now);
}
function startPolling() {
  stopPolling();
  const generation = ++pollingGeneration;
  polling = setTimeout(async function poll() {
    if (generation !== pollingGeneration) return;
    if (!document.hidden && !busy) await refresh(false);
    if (generation !== pollingGeneration) return;
    polling = setTimeout(poll, page === "meals" ? mealPollMs : livePollMs);
  }, page === "meals" ? mealPollMs : livePollMs);
}
function stopPolling() {
  pollingGeneration++;
  if (polling) clearTimeout(polling);
  polling = null;
  if (controller) controller.abort();
  controller = null;
  busy = false;
  epoch++;
}
function selectPage(next) {
  if (!pageCalls[next] || (!isManager() && next !== "my")) return;
  if (page === next) return;
  if (controller) controller.abort();
  epoch++;
  busy = false;
  page = next;
  renderNav(); render(); startPolling(); refresh(false, true);
  window.scrollTo(0, 0);
}
async function refresh(force, reuseRecent = false) {
  if (!session || views.dashboard.hidden || document.hidden) return false;
  if (busy && !force) return false;
  if (controller) controller.abort();
  controller = new AbortController();
  const myEpoch = ++epoch;
  const myPage = page;
  const signal = controller.signal;
  busy = true;
  if (!cache[myPage]) render();
  const calls = pageCalls[myPage];
  try {
    const values = await Promise.all(calls.map(async name => {
      if (reuseRecent && sharedReads[name] && Date.now() - sharedReads[name].at < livePollMs) return sharedReads[name].value;
      let value;
      try { value = await rpc(name, { p_session_token: session.session_token }, signal); }
      catch (error) {
        if (!['rpc_today_meal_plan','rpc_my_meal_plan'].includes(name) || isSessionError(error) || signal.aborted) throw error;
        // Plan read failure must not hide live safety gaps or actual handoffs.
        value = { load_error: true };
      }
      return value;
    }));
    if (myEpoch !== epoch || myPage !== page) return;
    const freshData = Object.fromEntries(calls.map((name, index) => [name, values[index]]));
    if (actions?.isAutoRefreshPaused?.(myPage) === true) {
      actions?.handleBackgroundRefresh?.(myPage, freshData);
      return !values.some(value => value?.load_error);
    }
    calls.forEach((name, index) => { sharedReads[name] = { value: values[index], at: Date.now() }; });
    cache[myPage] = freshData;
    updatedAt[myPage] = new Date().toISOString();
    pageError[myPage] = "";
    render();
    return !values.some(value => value?.load_error);
  } catch (error) {
    if (myEpoch !== epoch || myPage !== page) return;
    if (isSessionError(error)) { showLogin("登录已失效，请重新输入个人 PIN。"); return; }
    if (actions?.isAutoRefreshPaused?.(myPage) === true) {
      actions?.handleBackgroundRefresh?.(myPage, null, error);
      return false;
    }
    pageError[myPage] = readableError(error);
    render();
    return false;
  } finally {
    if (myEpoch === epoch) { busy = false; controller = null; }
  }
}
function title(name, description) {
  return `<div class="page-title"><div><h1>${name}</h1><p>${description}</p></div><button class="refresh-button" id="refreshButton" type="button">刷新</button></div>`;
}
function empty(heading, detail) { return `<div class="empty"><strong>${heading}</strong>${detail}</div>`; }
function section(name, body, note = "") {
  return `<section class="section"><div class="section-title"><h2>${name}</h2>${note ? `<small>${note}</small>` : ""}</div>${body}</section>`;
}
function metric(label, value, tone = "") { return `<div class="metric ${tone}"><span>${label}</span><strong>${safe(value)}</strong></div>`; }
function phaseText(overview) {
  const phase = overview?.phase || "not_prepared";
  return `${label(phaseNames, phase)}${overview?.operation_mode ? ` · ${label(modeNames, overview.operation_mode)}` : ""}`;
}
function safetyGaps(data) {
  return (data.rpc_today_alerts?.alerts || []).filter(item => item.kind === "safety_position_vacant")
    .sort((a,b) => number(b.vacant_minutes)-number(a.vacant_minutes));
}
function coverageCards(data, gapsOnly = false) {
  const rank = { below_minimum: 0, tight: 1, normal: 2 };
  const rows = [...(data.rpc_today_coverage || [])].sort((a,b) => (rank[a.business_level] ?? 3)-(rank[b.business_level] ?? 3));
  return rows.filter(item => !gapsOnly || ["below_minimum","tight"].includes(item.business_level)).map(item => {
    const low = item.business_level === "below_minimum", tight = item.business_level === "tight";
    const level = low ? "低于最低" : tight ? "人力偏紧" : item.business_level === "normal" ? "正常" : "未监控";
    return `<button type="button" class="card coverage-card ${low ? "alert-red" : tight ? "alert-orange" : ""} ${page === "dispatch" && dispatchFocus === item.scope_code ? "is-focused" : ""}" data-area-focus="${safe(item.scope_code)}"><div class="card-row"><h3>${safe(areaLabel(item.scope_code))}</h3><span class="pill ${low ? "red" : tight ? "orange" : "gray"}">${level}</span></div><p>当前 <strong>${number(item.current_count)}</strong> 人 / 最低 ${number(item.minimum_coverage)} 人</p><p>${low ? `缺 ${Math.max(0,number(item.minimum_coverage)-number(item.current_count))} 人 · ` : ""}目标 ${number(item.target_coverage)} 人${item.scope_type === "mobile_pool" && tight ? " · 机动力量不足" : ""}</p></button>`;
  }).join("");
}
function safetyGapCard(item) {
  return `<button type="button" class="card alert-red gap-card" data-position-focus="${safe(item.position_id)}"><div class="card-row"><h3>${safe(item.position_name || positionLabel(item.position_id))}</h3><span class="pill red">待补岗</span></div><p>空岗 ${safe(minuteText(item.vacant_minutes))} · ${safe(areaLabel(item.area_code))}</p></button>`;
}
function renderHome(data) {
  const overview = data.rpc_today_overview || {};
  const safety = safetyGaps(data);
  const handoffs = data.rpc_today_handoffs || [];
  const reminders = (data.rpc_today_alerts?.alerts || []).filter(item => ["meal_over_45","short_leave_over_15"].includes(item.kind));
  const safetyBody = safety.length ? `<div class="safety-summary"><strong>当前有 ${safety.length} 个安全关键岗无人值守</strong></div><div class="card-list">${safety.slice(0,3).map(safetyGapCard).join("")}</div>${safety.length>3 ? '<button class="action-button" data-all-safety>查看全部</button>' : ""}`
    : `<div class="quiet-line">${overview.phase === "monitoring" ? "安全关键岗暂无空岗" : overview.phase === "ended" ? "今日营业已结束，实时告警已停止" : "尚未开始营业，安全岗监控未启动"}</div>`;
  const metrics = `<div class="metric-grid field-metrics">${[metric("当前在岗",overview.on_duty_count),metric("吃饭",overview.meal_count),metric("短离",overview.short_leave_count),metric("前往中",overview.in_transit_count),metric("未到岗",overview.not_arrived_count)].join("")}</div><p class="muted roster-note">今日排班 ${number(overview.scheduled_count)} 人 · 已下班 ${number(overview.off_duty_count)} 人</p>`;
  const reminderBody = reminders.length ? section("离岗提醒", `<div class="card-list">${reminders.map(item => `<button class="card alert-orange" data-staff-focus="${safe(item.staff_id)}"><h3>${safe(item.staff_name)} · ${item.kind === "meal_over_45" ? "吃饭超时" : "短离提醒"}</h3><p>已离岗 ${safe(minuteText(item.duration_minutes))}</p></button>`).join("")}</div>`) : "";
  return title("今日现场", `${safe(overview.business_day,"今日")} 营业日 · ${phaseText(overview)}`) +
    section("安全关键岗状态", safetyBody) +
    `<div class="section-title"><h2>区域人力</h2><button class="action-button primary" data-open-dispatch>现场调度</button></div>` +
    `<section class="section"><div class="coverage-grid">${coverageCards(data) || '<div class="quiet-line">尚未选择模式</div>'}</div></section>` +
    section("现场人员", metrics) +
    section("正在交接", handoffs.length ? `<div class="card-list">${handoffs.slice(0,3).map(handoffCard).join("")}</div><button class="action-button" data-open-handoffs>查看交接待办（${handoffs.length}）</button>` : '<div class="quiet-line">当前无未完成交接</div>') + reminderBody + renderNextMeals(data) + '<div id="lifecycleSlot"></div>';
}
function renderDispatch(data) {
  const safety = safetyGaps(data);
  const candidates = dispatchCandidates(data.rpc_today_staff || [], data.rpc_today_positions || []);
  const coverage = coverageCards(data,true);
  return title("现场调度", "先补安全缺口，再安排区域人力") + '<button class="action-button" data-back-home>返回总览</button>' +
    (dispatchFocus ? `<div class="focus-note">正在处理：${safe(areaLabel(dispatchFocus))}</div>` : "") +
    section("当前缺口", `<div class="card-list">${safety.map(safetyGapCard).join("")}${coverage || ""}</div>${!safety.length && !coverage ? '<div class="quiet-line">当前无安全或区域人力缺口</div>' : ""}`) +
    section("可调人员", candidates.length ? `<div class="card-list">${candidates.map(row => {
      const position = (data.rpc_today_positions || []).find(item => item.position_id === row.current_position_id);
      const scope = row.current_assignment_type === "mobile_pool" ? "global" : row.current_area_code || position?.area_code;
      const rule = (data.rpc_today_coverage || []).find(item => item.scope_code === scope);
      const risk = rule && number(rule.current_count)-1 < number(rule.minimum_coverage);
      return `<article class="card" data-dispatch-staff="${safe(row.staff_id)}"><div class="card-row"><div><h3>${safe(row.name)} <small>${safe(row.staff_id)}</small></h3><p>${safe(assignment(row))}</p><p>${safe(areaLabel(scope))}${scope === "global" ? " · 机动人员" : ""}</p></div><span class="pill gray">可调配</span></div>${risk ? `<p class="source-risk">${safe(row.name)}当前在${safe(areaLabel(scope))}。调离后该区域将低于最低人数，请先安排其他人员补位。</p>` : ""}<div class="card-actions"><button class="action-button primary" data-dispatch-select="${safe(row.staff_id)}">选择目标</button></div></article>`;
    }).join("")}</div>` : '<div class="quiet-line">暂无可直接调动人员。正在吃饭、短离、途中、顶岗或交接中的人员不在此列。</div>');
}
function renderStaff(data) {
  const rows = Array.isArray(data.rpc_today_staff) ? data.rpc_today_staff : [];
  const filters = [["all", "全部"], ["on_duty", "在岗"], ["not_arrived", "未到岗"], ["meal", "吃饭"], ["short_leave", "短离"], ["in_transit", "前往中"], ["off_duty", "已下班"], ["cancelled", "已取消"]];
  const chosen = rows.filter(row => staffFilter === "all" || (staffFilter === "cancelled" ? row.roster_status === "cancelled" : staffFilter === "in_transit" ? row.status === "on_duty" && row.current_assignment_type === "in_transit" : row.status === staffFilter && row.roster_status !== "cancelled"));
  const chips = `<div class="filter-chips" role="group" aria-label="人员状态筛选">${filters.map(([id, label]) =>
    `<button type="button" class="filter-chip ${staffFilter === id ? "active" : ""}" data-filter="${id}" aria-pressed="${staffFilter === id}">${label}</button>`).join("")}</div>`;
  const cards = chosen.length ? `<div class="card-list">${chosen.map(row => {
    const where = row.status === "on_duty" ? assignment(row) : row.status === "meal" || row.status === "short_leave" ? `返岗：${returnAssignment(row)}` : "";
    const notes = [row.is_temporary_cover ? "正在顶岗" : null, row.has_pending_handoff ? "有交接待办" : null].filter(Boolean).join(" · ");
    return `<article class="card" data-staff-id="${safe(row.staff_id)}"><div class="card-row"><div><h3>${safe(row.name)} <small>${safe(row.staff_id)}</small></h3><p>${safe(row.department)} · ${safe(label(employmentNames,row.employment_type))} · ${safe(label(roleNames,row.role))}</p></div><span class="pill ${statusTone(row)}">${safe(statusLabel(row))}</span></div><div class="card-footer"><span>${safe(where || "暂无当前分配")}</span><span>${safe(notes || datetime(row.status_since))}</span></div>${row.is_temporary_cover && row.cover_for_staff_name ? `<p>替 ${safe(row.cover_for_staff_name)} 顶岗</p>` : ""}${breakTiming(row.status, row.status_since) ? `<p class="break-timing">${safe(breakTiming(row.status, row.status_since))}</p>` : ""}</article>`;
  }).join("")}</div>` : empty("没有符合条件的员工", "可切换筛选查看其他人员。");
  return title("今日人员", `今日排班记录 ${rows.length} 人，含已取消记录`) + chips + cards;
}
function positionCard(item) {
  const assigned = Boolean(item.current_staff_id);
  const red = Boolean(item.is_safety_red_gap);
  const handoff = Boolean(item.pending_handoff_id);
  const snapshot = item.snapshot_present !== false;
  const open = item.expected_open === true;
  const label = !snapshot ? "尚无今日快照" : red ? "安全缺岗" : handoff ? "交接中" : !open ? "今日未启用" : assigned ? "有人值守" : item.is_vacant ? "当前无人" : "待确认";
  const tone = red ? "red" : handoff ? "blue" : !snapshot || !open ? "gray" : assigned ? "green" : item.is_vacant ? "orange" : "gray";
  return `<article class="card position-card ${red ? "danger" : !open ? "off" : ""}" data-position-id="${safe(item.position_id)}"><div class="card-row"><h3>${safe(item.name)}</h3><span class="pill ${tone}">${label}</span></div><div class="person ${assigned ? "" : "muted"}">${safe(item.current_staff_name, assigned ? "—" : "当前无人")}</div><div class="meta">${item.is_mobile ? "机动资源位" : item.is_safety_critical ? "安全关键岗" : item.requires_qualification ? "需可安排关系" : "普通站位"}${red ? ` · 已空岗 ${safe(minuteText(item.vacant_minutes))}` : ""}</div>${handoff ? `<div class="handoff-step">交接阶段：${safe(handoffStage(item.pending_handoff_stage))}</div>` : ""}${item.exception_reason ? `<p>当日例外：${safe(item.exception_reason)}</p>` : ""}</article>`;
}
function mobileCard(item) {
  return `<article class="card position-card off"><div class="card-row"><h3>${safe(item.name)}</h3><span class="pill gray">机动资源位</span></div><div class="person muted">不单独计缺岗</div><div class="meta">机动人员按实际当前分配计入区域或全场机动池</div></article>`;
}
function renderPositions(data) {
  const rows = Array.isArray(data.rpc_today_positions) ? data.rpc_today_positions : [];
  const fixed = rows.filter(row => !row.is_mobile);
  const mobile = rows.filter(row => row.is_mobile);
  const order = ["entrance", "front_hall", "toddler_vr", "high_altitude", "high_expansion", "second_floor"];
  const groups = order.map(area => {
    const inArea = fixed.filter(row => row.area_code === area);
    return `<section class="area-group"><h2>${areaNames[area]} <small>${inArea.length} 岗</small></h2><div class="position-grid">${inArea.map(positionCard).join("")}</div></section>`;
  }).join("");
  return title("岗位状态", `固定站位 ${fixed.length} 个 · 机动资源位 ${mobile.length} 个`) +
    (rows.length ? groups + section("机动资源位", `<div class="position-grid">${mobile.map(mobileCard).join("")}</div>`) : empty("暂未取得岗位数据", "请刷新后重试。"));
}
function handoffCard(row) {
  const next = row.next_actor_type === "manager" ? "管理人员" : row.next_actor_staff_id === row.incoming_staff_id ? row.incoming_staff_name || "接岗员工" : row.outgoing_staff_name || "原岗员工";
  return `<article class="card" data-handoff-id="${safe(row.handoff_id)}"><div class="card-row"><div><h3>${safe(row.position_name)}</h3><p>${safe(row.outgoing_staff_name, "当前空岗")} → ${safe(row.incoming_staff_name)}</p></div><span class="pill blue">${safe(handoffStage(row))}</span></div><div class="handoff-flow">申请：${safe(label(actionNames,row.requested_action))} · 下一步：${safe(next)} ${safe(label(nextActionNames,row.next_action))}</div><div class="card-footer"><span>发起 ${safe(datetime(row.requested_at, true))} · 出发 ${safe(datetime(row.incoming_departed_at))} · 到位 ${safe(datetime(row.incoming_confirmed_at))}</span><span>${row.short_leave_override_approved ? "短离例外已批准" : row.can_current_actor_act_next ? "轮到我确认" : "等待对方操作"}</span></div></article>`;
}
function renderHandoffs(data) {
  const rows = Array.isArray(data.rpc_today_handoffs) ? data.rpc_today_handoffs : [];
  return title("交接待办", `当前 ${rows.length} 项 · 按现场阶段处理`) +
    (rows.length ? `<div class="card-list">${rows.map(handoffCard).join("")}</div>` : empty("暂无未完成交接", "发起交接后可在这里查看进度。"));
}
function renderMy(data) {
  const row = data.rpc_my_today_state || {};
  const tasks = [...(row.my_handoffs || [])].sort((a,b) => Number(b.can_i_act_next)-Number(a.can_i_act_next));
  const where = row.status === "on_duty" || row.current_assignment_type === "in_transit" ? assignment(row) : ["meal","short_leave"].includes(row.status) ? `返岗目标：${returnAssignment(row)}` : "暂无分配";
  const timing = breakTiming(row.status,row.status_since,row.status_duration_minutes);
  const hero = `<section class="my-hero"><h2>${safe(row.name || session.name)}</h2><p class="muted">${safe(row.staff_id || session.staff_id)}</p><div class="my-state">当前状态：${safe(statusLabel(row))}</div><div class="my-arrangement">当前安排：${safe(where)}</div>${timing ? `<div class="break-clock">${safe(timing)}</div>` : ""}<details class="my-schedule"><summary>查看今日排班</summary><p>${safe(datetime(row.scheduled_start_time,true))} – ${safe(datetime(row.scheduled_end_time,true))}</p></details></section>`;
  const body = tasks.length ? `<div class="card-list">${tasks.map(task => `<article class="card task-card ${task.can_i_act_next ? "task-active" : ""}" data-my-handoff-id="${safe(task.handoff_id)}"><div class="card-row"><h3>${task.can_i_act_next ? "我的交接任务" : "正在交接"}</h3><span class="pill blue">${task.can_i_act_next ? "请我处理" : "等待对方"}</span></div><div class="task-destination">${task.next_action === "finalize" ? "确认" : "前往"}${safe(task.position_name || positionLabel(task.position_id))}${task.next_action === "finalize" ? "交接完成" : "接岗"}</div><p>${safe(handoffStage(task))}${task.counterparty_name ? ` · ${safe(task.counterparty_name)}` : ""}</p></article>`).join("")}</div>` : '<div class="quiet-line">目前没有我的交接任务</div>';
  return title("我的", label(phaseNames,row.phase,"今日现场")) + hero + renderMyMeal(data) + section("我的任务",body);
}
function render() {
  if (views.dashboard.hidden) return;
  const data = cache[page];
  const latest = data?.rpc_today_overview || data?.rpc_my_today_state;
  if (latest) {
    phaseBadge.textContent = phaseText(latest);
    phaseBadge.className = `phase-badge ${latest.phase || ""}`;
  }
  const error = pageError[page];
  banner.hidden = !error;
  if (error) banner.textContent = `${cache[page] ? "连接中断，以下为上次成功读取的数据。" : "暂时无法读取现场数据。"} ${error} · ${updatedAt[page] ? `最后更新于 ${refreshedAt(updatedAt[page])}` : "请检查网络并重试"}`;
  if (!data) {
    content.innerHTML = title({ home: "今日现场", staff: "今日人员", positions: "岗位状态", handoffs: "交接待办", dispatch: "现场调度", meals: "今日轮餐", my: "我的" }[page], "只读现场数据") + empty(error ? "读取失败" : "正在读取现场数据", error || "请稍候…");
    if (page === "staff") actions?.decorate(page, {}, content);
    return;
  }
  content.innerHTML = ({ home: renderHome, staff: renderStaff, positions: renderPositions,
    handoffs: renderHandoffs, dispatch: renderDispatch, my: renderMy, meals: renderMealPage })[page](data) + `<p class="muted" style="font-size:11px;text-align:center;margin:10px 0 25px">最后更新 ${safe(refreshedAt(updatedAt[page]))} · 每 5 秒自动读取</p>`;
  actions?.decorate(page, { ...Object.fromEntries(Object.entries(sharedReads).map(([name,item]) => [name,item.value])), ...data }, content);
}

actions = createActions({
  rpc: (name, body) => rpc(name, body),
  writeRpc,
  getSession: () => session,
  getPage: () => page,
  navigatePage: selectPage,
  getSharedData: () => Object.fromEntries(Object.entries(sharedReads).map(([name,item]) => [name,item.value])),
  refreshAfterWrite: async () => {
    sharedReads = {};
    for (const name of Object.keys(cache)) if (name !== page) delete cache[name];
    if (!await refresh(true)) throw new Error("写入后的现场数据尚未读取成功");
  },
  saveSession,
  requireLogin: showLogin,
  areaNames,
  escapeHtml,
  datetime
});

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const identifier = document.getElementById("identifier").value.trim();
  const pin = document.getElementById("pin").value;
  if (!identifier || !pin) { showError("loginError", "请输入员工编号或姓名及个人 PIN。"); return; }
  const button = document.getElementById("loginSubmit");
  button.disabled = true; button.textContent = "正在验证…";
  showError("loginError", "");
  try {
    const result = await writeRpc("pin_login", { p_identifier: identifier, p_pin: pin });
    if (!result?.ok) { showError("loginError", /姓名重复/.test(result?.message || "") ? "姓名重复，请使用员工编号登录。" : businessError(result?.message || "PIN验证失败")); return; }
    saveSession(result);
    document.getElementById("pin").value = "";
    if (session.must_change_pin) showView("changePin"); else showDashboard();
  } catch (error) { showError("loginError", readableError(error, "login")); }
  finally { button.disabled = false; button.textContent = "登录今日现场"; }
});
document.getElementById("changePinForm").addEventListener("submit", async event => {
  event.preventDefault();
  const current = document.getElementById("currentPin").value;
  const fresh = document.getElementById("newPin").value;
  const again = document.getElementById("confirmPin").value;
  if (!/^\d{6,8}$/.test(fresh)) { showError("changePinError", "新 PIN 必须是 6–8 位数字。"); return; }
  if (fresh !== again) { showError("changePinError", "两次输入的新 PIN 不一致。"); return; }
  const button = document.getElementById("changePinSubmit");
  button.disabled = true; button.textContent = "正在保存…";
  showError("changePinError", "");
  try {
    const result = await writeRpc("pin_change", { p_session_token: session.session_token, p_current_pin: current, p_new_pin: fresh });
    if (result === null || result === "") { showLogin("PIN 修改已提交，但未返回新会话。请用新 PIN 重新登录。 "); return; }
    if (!result?.ok) { showError("changePinError", "PIN未修改成功，请核对原PIN；新PIN须为不同的6–8位数字。"); return; }
    saveSession({ ...session, ...result, must_change_pin: false });
    event.target.reset();
    showDashboard();
  } catch (error) {
    if (isSessionError(error)) showLogin("登录已失效，请重新验证。");
    else showError("changePinError", readableError(error, "pin"));
  } finally { button.disabled = false; button.textContent = "保存并进入"; }
});
document.getElementById("logoutButton").addEventListener("click", async () => {
  const token = session?.session_token;
  showLogin("已退出。");
  if (token) { try { await writeRpc("pin_logout", { p_session_token: token }); } catch { /* local token already removed */ } }
});
document.getElementById("bottomNav").addEventListener("click", event => {
  const button = event.target.closest("[data-page]");
  if (button) selectPage(button.dataset.page);
});
content.addEventListener("click", event => {
  if (event.target.closest("#refreshButton")) refresh(true);
  if (event.target.closest("[data-open-dispatch],[data-all-safety]")) { dispatchFocus = null; selectPage("dispatch"); }
  if (event.target.closest("[data-back-home]")) selectPage("home");
  if (event.target.closest("[data-open-handoffs]")) selectPage("handoffs");
  const area = event.target.closest("[data-area-focus]");
  if (area) { dispatchFocus = area.dataset.areaFocus; if (page === "dispatch") { render(); content.querySelector("[data-dispatch-staff]")?.scrollIntoView({block:"center"}); } else selectPage("dispatch"); }
  const position = event.target.closest("[data-position-focus]");
  if (position) actions.openPosition(position.dataset.positionFocus);
  const staff = event.target.closest("[data-staff-focus]");
  if (staff) actions.openStaff(staff.dataset.staffFocus);
  const dispatch = event.target.closest("[data-dispatch-select]");
  if (dispatch) actions.dispatchStaff(dispatch.dataset.dispatchSelect);
  const chip = event.target.closest("[data-filter]");
  if (chip) { staffFilter = chip.dataset.filter; render(); }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else if (session && !views.dashboard.hidden) { startPolling(); refresh(true); }
});
window.addEventListener("focus", () => { if (!document.hidden && session && !views.dashboard.hidden && !busy && Date.now()-new Date(updatedAt[page] || 0).getTime()>1000) refresh(true); });
window.addEventListener("online", () => { if (session && !views.dashboard.hidden) refresh(true); });
setInterval(tickClock, 1000);

async function bootstrap() {
  if (!config.url || !config.publishableKey) {
    const hint = document.getElementById("configHint");
    hint.textContent = "尚未配置 Supabase publishable key。请在本地 .env.local 填入项目密钥后刷新页面。";
    document.getElementById("loginSubmit").disabled = true;
    return;
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    if (!stored?.session_token) return;
    if (stored.expires_at && new Date(stored.expires_at).getTime() <= Date.now()) {
      showLogin("登录已过期，请重新输入个人 PIN。"); return;
    }
    session = stored;
    const identity = await rpc("pin_whoami", { p_session_token: session.session_token });
    if (!identity?.staff_id) throw new Error("身份校验失败");
    saveSession({ ...session, ...identity });
    if (session.must_change_pin) showView("changePin"); else showDashboard();
  } catch (error) { showLogin(isSessionError(error) ? "登录已失效，请重新输入个人 PIN。" : "暂时无法验证登录，请检查网络后重试。"); }
}
bootstrap();
