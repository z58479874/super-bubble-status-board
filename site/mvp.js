
const config = window.__SB_CONFIG__ || {};
const sessionKey = "super_bubble_012_session";
const pollMs = 5000;
const managerRoles = new Set(["manager", "deputy", "supervisor"]);
const areaNames = {
  entrance: "一楼入口", front_hall: "前厅", toddler_vr: "淘气堡 / VR",
  high_altitude: "高空普通区", high_expansion: "高空拓展", second_floor: "二楼电玩",
  global: "全场机动池"
};
// 011 的本人读取接口未返回返岗岗位名称；这里只作中文展示兜底，业务判断仍由 RPC 完成。
const positionDisplayFallback = {
  gate: "闸机口外侧", shoes: "换鞋区", sale1: "销售1", sale2: "销售2", sale3: "销售3", dolls: "娃娃弹珠区", assist: "好评/协助岗",
  slide: "淘气堡飞跃滑梯上口", patrol: "淘气堡巡场", vr1: "VR-1", vr2: "VR-2",
  gear1: "装备1", gear2: "装备2", gear3: "装备3", gear4: "装备4", plum: "梅花桩", climb: "攀岩", leap: "勇士之跃", swing1: "高空秋千1", swing2: "高空秋千2",
  expand1: "沙池岗", expand2: "拓展入口·挂锁复检岗", expand3: "拓展入口·排队穿绳引导岗", expand4: "拓展一楼监护岗", expand5: "拓展二楼监护岗", expand6: "三楼索道上方操作岗", expand7: "三楼索道下方接应岗",
  arcade1: "二楼电玩1", arcade2: "二楼电玩2"
};
const roleNames = { manager: "店长", deputy: "副店长", supervisor: "主管", staff: "员工" };
const modeNames = { green: "绿灯", yellow: "黄灯", red: "红灯" };
const phaseNames = { not_prepared: "今日尚未准备", not_started: "尚未开始营业", monitoring: "营业监控中", ended: "今日已结束营业" };
const employmentNames = { full_time: "全职", regular_part_time: "固定兼职", temporary_part_time: "临时兼职" };
const stateNames = { on_duty: "在岗", meal: "吃饭", short_leave: "短时离岗", not_arrived: "未到岗", off_duty: "已下班" };
const views = {
  login: document.getElementById("loginView"),
  changePin: document.getElementById("changePinView"),
  dashboard: document.getElementById("dashboardView")
};
const content = document.getElementById("content");
const banner = document.getElementById("connectionBanner");
const phaseBadge = document.getElementById("phaseBadge");
const pageCalls = {
  home: ["rpc_today_overview", "rpc_today_alerts", "rpc_today_coverage", "rpc_today_handoffs"],
  staff: ["rpc_today_overview", "rpc_today_staff", "rpc_today_positions"],
  positions: ["rpc_today_overview", "rpc_today_positions"],
  handoffs: ["rpc_today_overview", "rpc_today_handoffs"], my: ["rpc_my_today_state"]
};
let session = null;
let page = "home";
let staffFilter = "all";
let epoch = 0;
let controller = null;
let polling = null;
let busy = false;
let cache = {};
let updatedAt = {};
let pageError = {};

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
function assignment(row, prefix = "current") {
  const type = row?.[`${prefix}_assignment_type`];
  if (type === "position") return row[`${prefix}_position_name`] || positionDisplayFallback[row[`${prefix}_position_id`]] || row[`${prefix}_position_id`] || "具体岗位";
  if (type === "area_standby") return `${areaNames[row[`${prefix}_area_code`]] || row[`${prefix}_area_code`] || "区域"}待命`;
  if (type === "mobile_pool") return "全场机动池";
  if (type === "in_transit") return `前往${row.target_position_name || areaNames[row.target_area_code] || row.target_position_id || row.target_area_code || "目标地点"}`;
  return "暂未分配";
}
function returnAssignment(row) {
  if (!row?.return_assignment_type || row.return_assignment_type === "none") return "无";
  return assignment(row, "return");
}
function statusLabel(row) {
  if (row?.roster_status === "cancelled") return "排班已取消";
  if (!row?.status) return "已排班，状态待初始化";
  if (row.status === "on_duty" && row.current_assignment_type === "in_transit") return "前往中";
  return row.status_display || stateNames[row.status] || row.status;
}
function statusTone(row) {
  if (row?.roster_status === "cancelled" || !row?.status || ["not_arrived", "off_duty"].includes(row.status)) return "gray";
  if (row.status === "meal") return "orange";
  if (row.status === "short_leave") return "purple";
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
async function rpc(name, body, signal) {
  const ownController = signal ? null : new AbortController();
  const timeout = setTimeout(() => (ownController || controller)?.abort(), 12000);
  try {
    const response = await fetch(rpcEndpoint(name), {
      method: "POST", headers: { apikey: config.publishableKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body), signal: signal || ownController.signal, cache: "no-store"
    });
    let data;
    try { data = await response.json(); } catch { throw new Error("服务器返回了无法读取的数据"); }
    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `请求失败（${response.status}）`);
      error.code = data?.code;
      if (isSessionError(error)) showLogin("登录已过期，请重新验证。 ");
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("连接超时，请检查网络后重试");
    throw error;
  } finally { clearTimeout(timeout); }
}
function saveSession(value) {
  session = { session_token: value.session_token, staff_id: value.staff_id, name: value.name,
    role: value.role, expires_at: value.expires_at, must_change_pin: Boolean(value.must_change_pin) };
  sessionStorage.setItem(sessionKey, JSON.stringify(session));
}
function clearSession() {
  session = null;
  sessionStorage.removeItem(sessionKey);
  cache = {}; updatedAt = {}; pageError = {};
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
  polling = setInterval(() => { if (!document.hidden && !busy) refresh(false); }, pollMs);
}
function stopPolling() {
  if (polling) clearInterval(polling);
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
  renderNav(); render(); refresh(true);
  window.scrollTo(0, 0);
}
async function refresh(force) {
  if (!session || views.dashboard.hidden || document.hidden) return;
  if (busy && !force) return;
  if (controller) controller.abort();
  controller = new AbortController();
  const myEpoch = ++epoch;
  const myPage = page;
  const signal = controller.signal;
  busy = true;
  if (!cache[myPage]) render();
  const calls = pageCalls[myPage];
  try {
    const values = await Promise.all(calls.map(name => rpc(name, { p_session_token: session.session_token }, signal)));
    if (myEpoch !== epoch || myPage !== page) return;
    cache[myPage] = Object.fromEntries(calls.map((name, index) => [name, values[index]]));
    updatedAt[myPage] = new Date().toISOString();
    pageError[myPage] = "";
    render();
  } catch (error) {
    if (myEpoch !== epoch || myPage !== page) return;
    if (isSessionError(error)) { showLogin("登录已失效，请重新输入个人 PIN。"); return; }
    pageError[myPage] = readableError(error);
    render();
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
  return `${phaseNames[phase] || phase}${overview?.operation_mode ? ` · ${modeNames[overview.operation_mode] || overview.operation_mode}` : ""}`;
}
function renderHome(data) {
  const overview = data.rpc_today_overview || {};
  const alerts = data.rpc_today_alerts?.alerts || [];
  const coverage = data.rpc_today_coverage || [];
  const handoffs = data.rpc_today_handoffs || [];
  const prepared = overview.prepared;
  const description = `${safe(overview.business_day, "今日")} 营业日 · ${phaseText(overview)}`;
  const metrics = `<div class="metric-grid">${[
    metric("今日排班", overview.scheduled_count), metric("未到岗", overview.not_arrived_count),
    metric("当前在岗", overview.on_duty_count), metric("吃饭", overview.meal_count, "warm"),
    metric("短时离岗", overview.short_leave_count, "warm"), metric("前往中", overview.in_transit_count),
    metric("已下班", overview.off_duty_count), metric("未完成交接", overview.pending_handoff_count)
  ].join("")}</div>`;
  const safety = alerts.filter(item => item.kind === "safety_position_vacant")
    .sort((a, b) => (b.vacant_minutes || 0) - (a.vacant_minutes || 0));
  const otherAlerts = alerts.filter(item => item.kind !== "safety_position_vacant");
  const safetyBody = safety.length ? `<div class="card-list">${safety.map(item =>
    `<article class="card alert-red"><div class="card-row"><div><h3>${safe(item.position_name)}</h3><p>${safe(areaNames[item.area_code] || item.area_code)} · 上一位：${safe(item.last_occupant_name)}</p></div><span class="pill red">待补岗</span></div><div class="card-footer"><span>空岗 ${safe(minuteText(item.vacant_minutes))}</span><span>${safe(datetime(item.vacant_since, true))} 起</span></div></article>`).join("")}</div>`
    : overview.phase === "ended" ? empty("今日营业已结束，不再产生实时安全岗告警", "当天岗位状态保留供查看。")
    : empty(prepared && overview.phase === "monitoring" ? "当前无异常" : "尚未开始岗位监控", "开始营业后，启用的安全关键岗缺口会在这里显示。");
  const alertBody = otherAlerts.length ? `<div class="card-list">${otherAlerts.map(item => {
    const area = item.kind === "area_below_minimum";
    const meal = item.kind === "meal_over_45";
    const label = area ? `${areaNames[item.area_code] || item.area_code}人数不足` : `${item.staff_name || "员工"}${meal ? "吃饭超时" : "短离提醒"}`;
    const detail = area ? `当前 ${number(item.current_count)} 人 / 最低 ${number(item.minimum_coverage)} 人，缺 ${number(item.deficit)} 人`
      : `已离岗 ${minuteText(item.duration_minutes)} · 超过提醒阈值 ${minuteText(item.overdue_minutes)}`;
    return `<article class="card ${item.kind === "short_leave_over_15" ? "alert-orange" : "alert-red"}"><div class="card-row"><div><h3>${safe(label)}</h3><p>${safe(detail)}</p></div><span class="pill ${item.kind === "short_leave_over_15" ? "orange" : "red"}">${area ? "区域缺口" : "超时"}</span></div></article>`;
  }).join("")}</div>` : empty("当前无其他异常", "区域最低人数和离岗提醒会在这里显示。");
  const coverageBody = coverage.length ? `<div class="coverage-grid">${coverage.map(item => {
    const name = item.scope_type === "mobile_pool" ? "全场机动池" : areaNames[item.scope_code] || item.scope_code;
    const tone = item.business_level === "below_minimum" ? "red" : item.business_level === "tight" ? "orange" : item.business_level === "normal" ? "green" : "gray";
    const label = item.business_level === "below_minimum" ? "低于最低" : item.business_level === "tight" ? "人力偏紧" : item.business_level === "normal" ? "正常" : overview.phase === "ended" ? "已结束" : "未监控";
    return `<article class="card compact"><div class="card-row"><h3>${safe(name)}</h3><span class="pill ${tone}">${label}</span></div><div class="coverage-number">${number(item.current_count)} / ${number(item.target_coverage)}</div><div class="coverage-target">最低 ${number(item.minimum_coverage)} 人 · 目标 ${number(item.target_coverage)} 人</div></article>`;
  }).join("")}</div>` : empty("暂无区域配置", "选择营业模式并开始营业后显示区域人数。");
  const handoffBody = handoffs.length ? `<div class="card-list">${handoffs.slice(0, 3).map(handoffCard).join("")}</div>` : empty("暂无待办交接", "新发起的交接会显示在这里。");
  return title("今日现场", description) + (prepared ? "" : `<div class="empty"><strong>今日尚未准备</strong>请由管理人员先准备营业日、今日名单和模式。</div>`) +
    section("现场人数", metrics) + section("待补岗安全岗", safetyBody, `${safety.length} 项`) +
    section("其他告警", alertBody, `${otherAlerts.length} 项`) + section("区域人数", coverageBody) +
    section("正在交接", handoffBody, `${handoffs.length} 项`);
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
    return `<article class="card" data-staff-id="${safe(row.staff_id)}"><div class="card-row"><div><h3>${safe(row.name)} <small>${safe(row.staff_id)}</small></h3><p>${safe(row.department)} · ${safe(employmentNames[row.employment_type] || row.employment_type)} · ${safe(roleNames[row.role] || row.role)}</p></div><span class="pill ${statusTone(row)}">${safe(statusLabel(row))}</span></div><div class="card-footer"><span>${safe(where || "暂无当前分配")}</span><span>${safe(notes || datetime(row.status_since))}</span></div>${row.is_temporary_cover && row.cover_for_staff_name ? `<p>替 ${safe(row.cover_for_staff_name)} 顶岗</p>` : ""}${breakTiming(row.status, row.status_since) ? `<p class="break-timing">${safe(breakTiming(row.status, row.status_since))}</p>` : ""}</article>`;
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
function handoffStage(stage) {
  return { awaiting_incoming: "等待接岗人出发", in_transit: "接岗人前往中", awaiting_outgoing: "已到位，等待确认" }[stage] || stage || "—";
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
  const next = row.next_actor_type === "manager" ? "管理人员" : row.next_actor_staff_id || "相关员工";
  return `<article class="card" data-handoff-id="${safe(row.handoff_id)}"><div class="card-row"><div><h3>${safe(row.position_name)}</h3><p>${safe(row.outgoing_staff_name, "当前空岗")} → ${safe(row.incoming_staff_name)}</p></div><span class="pill blue">${safe(row.stage_display || handoffStage(row.stage))}</span></div><div class="handoff-flow">申请：${safe({ meal: "吃饭", short_leave: "短时离岗", transfer: "调岗", fill: "补岗", end_cover: "结束顶岗" }[row.requested_action] || row.requested_action)} · 下一步：${safe(next)} ${safe({ begin_trip: "开始前往", confirm_arrival: "确认到位", finalize: "完成交接" }[row.next_action] || row.next_action)}</div><div class="card-footer"><span>发起 ${safe(datetime(row.requested_at, true))} · 出发 ${safe(datetime(row.incoming_departed_at))} · 到位 ${safe(datetime(row.incoming_confirmed_at))}</span><span>${row.short_leave_override_approved ? "短离例外已批准" : row.can_current_actor_act_next ? "轮到我确认" : "等待对方操作"}</span></div></article>`;
}
function renderHandoffs(data) {
  const rows = Array.isArray(data.rpc_today_handoffs) ? data.rpc_today_handoffs : [];
  return title("交接待办", `当前 ${rows.length} 项 · 按现场阶段处理`) +
    (rows.length ? `<div class="card-list">${rows.map(handoffCard).join("")}</div>` : empty("暂无未完成交接", "发起交接后可在这里查看进度。"));
}
function renderMy(data) {
  const row = data.rpc_my_today_state || {};
  const tasks = row.my_handoffs || [];
  const where = row.status === "on_duty" ? assignment(row) : row.status === "meal" || row.status === "short_leave" ? `返岗目标：${returnAssignment(row)}` : "当前无工作分配";
  const state = row.roster_status === "cancelled" ? "排班已取消" : row.status === "on_duty" && row.current_assignment_type === "in_transit" ? "前往中" : stateNames[row.status] || (row.roster_status === "scheduled" ? "已排班，待初始化" : "今日未排班");
  const hero = `<section class="my-hero"><h2>${safe(row.name || session.name)}</h2><p class="muted">${safe(row.staff_id || session.staff_id)} · ${safe(row.business_day)} 营业日</p><div class="my-state">${safe(state)}</div><div class="my-detail">排班：${safe(datetime(row.scheduled_start_time, true))} – ${safe(datetime(row.scheduled_end_time, true))}<br>${safe(where)}${row.status_since ? `<br>状态开始：${safe(datetime(row.status_since, true))} · 已持续 ${safe(minuteText(row.status_duration_minutes))}` : ""}${breakTiming(row.status, row.status_since, row.status_duration_minutes) ? `<br>${safe(breakTiming(row.status, row.status_since, row.status_duration_minutes))}` : ""}</div></section>`;
  const body = tasks.length ? `<div class="card-list">${tasks.map(row => `<article class="card" data-my-handoff-id="${safe(row.handoff_id)}"><div class="card-row"><h3>${safe(row.position_name)}</h3><span class="pill ${row.can_i_act_next ? "blue" : "gray"}">${row.can_i_act_next ? "轮到我" : "等待对方"}</span></div><p>${safe(row.stage_display)} · 交接对方：${safe(row.counterparty_name)}</p><div class="handoff-step">${safe({ begin_trip: "下一步：开始前往", confirm_arrival: "下一步：我已到位", finalize: "下一步：确认交接完成" }[row.next_action] || "查看现场进度")}</div></article>`).join("")}</div>` : empty("目前没有我的交接任务", "本页每 5 秒读取一次最新状态。");
  return title("我的今日状态", `${phaseNames[row.phase] || row.phase || "今日现场"} · 我的交接任务`) + hero + section("与我有关的交接", body, `${tasks.length} 项`);
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
    content.innerHTML = title({ home: "今日现场", staff: "今日人员", positions: "岗位状态", handoffs: "交接待办", my: "我的今日状态" }[page], "只读现场数据") + empty(error ? "读取失败" : "正在读取现场数据", error || "请稍候…");
    return;
  }
  content.innerHTML = ({ home: renderHome, staff: renderStaff, positions: renderPositions,
    handoffs: renderHandoffs, my: renderMy })[page](data) + `<p class="muted" style="font-size:11px;text-align:center;margin:10px 0 25px">最后更新 ${safe(refreshedAt(updatedAt[page]))} · 每 5 秒自动读取</p>`;
}

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const identifier = document.getElementById("identifier").value.trim();
  const pin = document.getElementById("pin").value;
  if (!identifier || !pin) { showError("loginError", "请输入员工编号或姓名及个人 PIN。"); return; }
  const button = document.getElementById("loginSubmit");
  button.disabled = true; button.textContent = "正在验证…";
  showError("loginError", "");
  try {
    const result = await rpc("pin_login", { p_identifier: identifier, p_pin: pin });
    if (!result?.ok) { showError("loginError", result?.message || "登录失败，请检查输入。"); return; }
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
    const result = await rpc("pin_change", { p_session_token: session.session_token, p_current_pin: current, p_new_pin: fresh });
    if (!result?.ok) { showError("changePinError", result?.message || "修改失败。"); return; }
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
  if (token) { try { await rpc("pin_logout", { p_session_token: token }); } catch { /* local token already removed */ } }
});
document.getElementById("bottomNav").addEventListener("click", event => {
  const button = event.target.closest("[data-page]");
  if (button) selectPage(button.dataset.page);
});
content.addEventListener("click", event => {
  if (event.target.closest("#refreshButton")) refresh(true);
  const chip = event.target.closest("[data-filter]");
  if (chip) { staffFilter = chip.dataset.filter; render(); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && session && !views.dashboard.hidden) refresh(true); });
window.addEventListener("focus", () => { if (!document.hidden && session && !views.dashboard.hidden) refresh(true); });
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
