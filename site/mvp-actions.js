// 013: 手机写操作仅使用既有 public RPC；规则和权限仍由数据库决定。
export function createActions(api) {
  const { rpc, writeRpc, getSession, getPage, refreshAfterWrite, saveSession, requireLogin, areaNames, escapeHtml, datetime } = api;
  const managerRoles = new Set(["manager", "deputy", "supervisor"]);
  const positionNames = new Map();
  let currentData = null;
  let sheet = null;
  let working = false;
  let tempDraft = null;
  let noticeTimer = null;
  let directoryRows = null;
  const roleNames = { manager: "店长", deputy: "副店长", supervisor: "主管", staff: "员工" };
  const employmentNames = { full_time: "全职", regular_part_time: "固定兼职", temporary_part_time: "临时兼职" };

  const e = escapeHtml;
  const $ = (selector, root = sheet) => root?.querySelector(selector);
  const isManager = () => managerRoles.has(getSession()?.role);
  const token = () => getSession()?.session_token;
  const overview = () => currentData?.rpc_today_overview || currentData?.rpc_my_today_state || {};
  const phase = () => overview().phase || "not_prepared";
  const staffRows = () => currentData?.rpc_today_staff || [];
  const positionRows = () => currentData?.rpc_today_positions || [];
  const handoffRows = () => currentData?.rpc_today_handoffs || [];
  const staffById = id => staffRows().find(row => row.staff_id === id);
  const positionById = id => positionRows().find(row => row.position_id === id);
  const handoffById = id => handoffRows().find(row => row.handoff_id === id);
  const nowBusinessDate = () => overview().business_day || new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const defaultStart = () => `${nowBusinessDate()}T09:00`;
  const defaultEnd = () => `${nowBusinessDate()}T21:00`;

  function explain(error) {
    const message = String(error?.message || "");
    if (/安全关键岗必须先发起交接|安全关键岗.*双确认|安全岗.*交接/.test(message)) return "安全关键岗必须走双确认交接。请先发起交接，再由接岗人本人点击开始前往。";
    if (/吃饭|meal/.test(message) && /低于最低|覆盖/.test(message)) return "当前离岗会使区域低于最低人数，请先安排替岗人员。";
    if (/仍在交接|顶安全岗|正式占据在用安全关键岗/.test(message)) return `当前不能直接操作：${message}`;
    if (/超时|网络|fetch|connection/i.test(message)) return "数据连接异常，请检查网络后重试。";
    if (/\p{Script=Han}/u.test(message)) return message;
    return "操作未完成。请刷新状态后重试；若持续失败，请联系店长核对现场数据。";
  }
  function notice(message, error = false) {
    let bar = document.getElementById("actionNotice");
    if (!bar) { bar = document.createElement("div"); bar.id = "actionNotice"; bar.setAttribute("role", "status"); document.body.append(bar); }
    bar.textContent = message;
    bar.className = `action-notice ${error ? "error" : ""}`;
    bar.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { bar.hidden = true; }, 8000);
  }
  function closeSheet() {
    if (working || !sheet) return;
    sheet.remove(); sheet = null;
    tempDraft = null;
    document.body.classList.remove("sheet-open");
  }
  function dismiss() {
    working = false;
    if (sheet) { sheet.remove(); sheet = null; }
    tempDraft = null;
    directoryRows = null;
    document.body.classList.remove("sheet-open");
  }
  function setSheetError(message) {
    const box = $(".sheet-error");
    if (box) { box.textContent = message; box.hidden = !message; }
    else notice(message, true);
  }
  function renderSheet({ title, description = "", body = "", buttons = [], onOpen, fullScreen = false }) {
    if (sheet) { sheet.remove(); sheet = null; }
    sheet = document.createElement("div");
    sheet.className = `sheet-backdrop${fullScreen ? " directory-view" : ""}`;
    sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${e(title)}"><div class="sheet-head"><div><h2>${e(title)}</h2>${description ? `<p>${e(description)}</p>` : ""}</div><button type="button" class="sheet-close" aria-label="关闭">×</button></div><div class="sheet-body">${body}</div><p class="sheet-error" role="alert" hidden></p><div class="sheet-buttons">${buttons.map((item, index) => `<button type="button" data-sheet-button="${index}" class="${item.primary ? "primary-button" : item.danger ? "sheet-danger" : "sheet-secondary"}">${e(item.label)}</button>`).join("")}</div></div>`;
    sheet.querySelector(".sheet-close").addEventListener("click", closeSheet);
    sheet.addEventListener("click", event => { if (event.target === sheet) closeSheet(); });
    buttons.forEach((item, index) => sheet.querySelector(`[data-sheet-button="${index}"]`).addEventListener("click", () => item.action?.()));
    document.body.append(sheet);
    document.body.classList.add("sheet-open");
    onOpen?.(sheet);
  }
  function field(label, name, type = "text", value = "", extra = "") {
    return `<label class="sheet-field">${e(label)}<input name="${e(name)}" type="${type}" value="${e(value)}" ${extra}></label>`;
  }
  function textarea(label, name, placeholder = "") {
    return `<label class="sheet-field">${e(label)}<textarea name="${e(name)}" placeholder="${e(placeholder)}" rows="3"></textarea></label>`;
  }
  function value(name) { return $(`[name="${name}"]`)?.value?.trim() || ""; }
  function checkReason(name = "reason") {
    const reason = value(name);
    if (!reason) { setSheetError("请填写原因，便于当天操作追溯。"); return null; }
    return reason;
  }
  function toIso(localValue) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localValue)) throw new Error("请选择完整的北京时间。 ");
    const date = new Date(`${localValue}:00+08:00`);
    if (Number.isNaN(date.getTime())) throw new Error("请选择有效的北京时间。 ");
    return date.toISOString();
  }
  function scheduleValues() {
    const start = toIso(value("start"));
    const end = toIso(value("end"));
    if (new Date(end) <= new Date(start)) throw new Error("预计下班时间必须晚于上班时间。 ");
    return { start, end };
  }
  function toLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    return parts.replace(" ", "T");
  }
  function busyButtons(disabled) {
    for (const button of document.querySelectorAll(".sheet-panel button,.action-button,.lifecycle-button")) button.disabled = disabled;
  }
  async function callWrite(name, params, success, options = {}) {
    if (working) return { ok: false, error: new Error("操作正在处理中") };
    working = true; busyButtons(true); setSheetError("");
    try {
      const result = await writeRpc(name, { p_session_token: token(), ...params });
      if (result && typeof result === "object" && result.ok === false) throw new Error(result.message || "操作未完成");
      let refreshOk = true;
      try { await refreshAfterWrite(); }
      catch { refreshOk = false; }
      working = false;
      if (!options.keepSheet) closeSheet();
      working = true;
      if (refreshOk && success) notice(success);
      if (!refreshOk) notice("操作已提交，但最新现场数据读取失败。请点击刷新核对，不要重复提交。", true);
      return { ok: true, result, refreshOk };
    } catch (error) {
      working = false;
      if (options.onError && options.onError(error)) return { ok: false, error };
      setSheetError(explain(error));
      return { ok: false, error };
    } finally { working = false; busyButtons(false); }
  }
  function confirm(title, description, label, action, danger = false) {
    renderSheet({ title, description, buttons: [
      { label: "返回", action: closeSheet },
      { label, primary: !danger, danger, action }
    ] });
  }
  function actionButton(label, action, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button ${primary ? "primary" : ""}`;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }
  function appendAction(card, label, callback, primary = false) {
    const bar = document.createElement("div"); bar.className = "card-actions";
    bar.append(actionButton(label, callback, primary)); card.append(bar);
  }

  function decorate(page, data, content) {
    currentData = data;
    if (data.rpc_today_positions) for (const item of data.rpc_today_positions) positionNames.set(item.position_id, item.name);
    if (isManager() && page === "home") decorateLifecycle(content);
    if (getSession()?.role === "manager" && page === "staff") decorateStaff(content);
    else if (isManager() && page === "staff" && ["not_started", "monitoring"].includes(phase())) decorateStaff(content);
    if (isManager() && page === "positions") decoratePositions(content);
    if (isManager() && page === "handoffs") decorateHandoffs(content);
    if (page === "my") decorateMy(content);
  }

  function decorateLifecycle(content) {
    const p = phase();
    const section = document.createElement("section");
    section.className = "section lifecycle-section";
    const mode = overview().operation_mode;
    section.innerHTML = `<div class="section-title"><h2>今日营业操作</h2></div><div class="lifecycle-card"><p>${e(p === "not_prepared" ? "先建立今天的营业日，再安排人员和选择模式。" : p === "not_started" ? `准备阶段 · 当前模式：${({ green: "绿灯", yellow: "黄灯", red: "红灯" })[mode] || "尚未选择"}` : p === "monitoring" ? "营业监控已启动，安全岗位与区域人数正在持续检查。" : "今日营业已结束，现场状态仅供查看。")}</p><div class="lifecycle-actions"></div></div>`;
    const row = section.querySelector(".lifecycle-actions");
    if (p === "not_prepared") row.append(actionButton("准备今天", () => callWrite("rpc_prepare_today", {}, "今天的营业日已准备。"), true));
    if (p === "not_started") {
      row.append(actionButton("今日人员", openRoster, false));
      row.append(actionButton("选择模式", openMode, false));
      row.append(actionButton("开始营业", openStartMonitoring, true));
    }
    if (p === "monitoring") row.append(actionButton("结束营业", openEndBusinessDay));
    content.querySelector(".page-title")?.after(section);
  }
  function openMode() {
    const current = overview().operation_mode;
    renderSheet({ title: "选择今日模式", description: "模式载入当天岗位与区域覆盖规则。", body: current ? `<p class="sheet-hint">当前已选：${e(({ green: "绿灯", yellow: "黄灯", red: "红灯" })[current] || current)}。切换模式需要明确确认。</p>` : "", buttons: [
      ...[["green", "绿灯"], ["yellow", "黄灯"], ["red", "红灯"]].map(([id, label]) => ({ label, action: () => {
        if (current === id) { notice(`今日已选择${label}。`); closeSheet(); return; }
        if (current) confirm("确认改选今日模式", `当前为${({ green: "绿灯", yellow: "黄灯", red: "红灯" })[current]}。确认改为${label}？当天岗位与覆盖快照可能变化。`, `改为${label}`, () => callWrite("rpc_select_today_mode", { p_mode: id }, `今日模式已改为${label}。`));
        else callWrite("rpc_select_today_mode", { p_mode: id }, `今日已选择${label}。`);
      } })),
      { label: "取消", action: closeSheet }
    ] });
  }
  function openStartMonitoring() {
    confirm("开始营业", "开始后系统将正式计算安全岗位和区域缺口，确认开始营业？", "确认开始营业", () => callWrite("rpc_start_today_monitoring", {}, "营业监控已启动。"));
  }
  function openEndBusinessDay() {
    confirm("结束今日营业", "请先核对所有人员已真实下班，交接已完成。", "继续核对", () => renderSheet({ title: "再次确认结束营业", description: "结束后今日现场操作将停止；正常下班后的无人岗位不计作经营缺岗。", body: `<label class="sheet-check"><input type="checkbox" name="closingCheck"> 我确认全部人员已真实下班、交接已完成</label>`, buttons: [
      { label: "返回", action: closeSheet },
      { label: "正式结束营业", danger: true, action: () => {
        if (!$('[name="closingCheck"]').checked) { setSheetError("请先勾选现场核对确认。"); return; }
        callWrite("rpc_end_business_day", {}, "今日营业已结束。实时告警停止。 ");
      } }
    ] }), true);
  }

  function decorateStaff(content) {
    const title = content.querySelector(".page-title");
    title?.classList.add("staff-page-title");
    if (getSession()?.role === "manager") title?.append(actionButton("员工管理", openDirectory, true));
    if (["not_started", "monitoring"].includes(phase())) title?.append(actionButton("今日排班", openRoster));
    for (const card of content.querySelectorAll("[data-staff-id]")) {
      const row = staffById(card.dataset.staffId);
      if (!row) continue;
      const bar = document.createElement("div"); bar.className = "card-actions";
      if (getSession()?.role === "manager") {
        card.setAttribute("role", "button");
        card.tabIndex = 0;
        card.setAttribute("aria-label", `查看 ${row.name} 的员工详情`);
        card.addEventListener("click", event => { if (!event.target.closest("button")) openStaffDetail(row.staff_id, "today", row); });
        card.addEventListener("keydown", event => {
          if (event.target !== card || !["Enter", " "].includes(event.key)) return;
          event.preventDefault(); openStaffDetail(row.staff_id, "today", row);
        });
        bar.append(actionButton("查看资料", () => openStaffDetail(row.staff_id, "today", row)));
      }
      if (["not_started", "monitoring"].includes(phase())) bar.append(actionButton("今日现场操作", () => openStaffActions(row)));
      if (bar.childElementCount) card.append(bar);
    }
  }
  async function loadDirectory() {
    if (directoryRows) return directoryRows;
    const rows = await rpc("rpc_staff_directory", { p_session_token: token() });
    if (!Array.isArray(rows)) throw new Error("员工名册返回格式不正确");
    directoryRows = rows;
    return rows;
  }
  async function openDirectory() {
    if (getSession()?.role !== "manager") return;
    renderSheet({ title: "员工管理", description: "正在读取长期员工名册…", fullScreen: true });
    const loadingSheet = sheet;
    try {
      const rows = await loadDirectory();
      if (sheet !== loadingSheet) return;
      renderSheet({ title: "员工管理", description: `全部员工 ${rows.length} 人 · 与今日排班和营业状态无关`, fullScreen: true,
        body: `<label class="sheet-field">搜索姓名或员工编号<input name="staffSearch" type="search" autocomplete="off" placeholder="输入姓名或员工编号"></label><div class="directory-list" data-directory-list></div>`,
        buttons: [{ label: "关闭员工管理", action: closeSheet }],
        onOpen: () => {
          const search = $("[name=staffSearch]");
          const list = $("[data-directory-list]");
          const update = () => {
            const query = search.value.trim().toLocaleLowerCase();
            const shown = rows.filter(row => `${row.name} ${row.id}`.toLocaleLowerCase().includes(query));
            list.innerHTML = shown.length ? shown.map(row => `<button type="button" class="directory-entry" data-directory-id="${e(row.id)}"><span><strong>${e(row.name)}</strong><small>${e(row.id)} · ${e(row.department)} · ${e(roleNames[row.role] || row.role)} · ${e(employmentNames[row.employment_type] || row.employment_type)}</small></span><span class="pill ${row.active ? "green" : "gray"}">${row.active ? "启用" : "停用"}</span></button>`).join("") : `<p class="sheet-hint">没有匹配的员工。</p>`;
          };
          search.addEventListener("input", update);
          list.addEventListener("click", event => {
            const button = event.target.closest("[data-directory-id]");
            if (button) openStaffDetail(button.dataset.directoryId, "directory");
          });
          update();
        } });
    } catch (error) {
      if (sheet !== loadingSheet) return;
      renderSheet({ title: "员工管理", description: "员工名册暂时无法读取。", fullScreen: true,
        body: `<p class="sheet-hint">${e(explain(error))}</p>`,
        buttons: [{ label: "重试", primary: true, action: () => { directoryRows = null; openDirectory(); } }, { label: "关闭", action: closeSheet }] });
    }
  }
  async function openStaffDetail(staffId, source = "today", fallback = null) {
    if (getSession()?.role !== "manager") return;
    renderSheet({ title: "员工详情", description: "正在核对长期员工档案…" });
    const loadingSheet = sheet;
    let row;
    try { row = (await loadDirectory()).find(item => item.id === staffId); }
    catch (error) { if (sheet === loadingSheet) setSheetError(explain(error)); return; }
    if (sheet !== loadingSheet) return;
    if (!row) row = fallback && { ...fallback, id: fallback.staff_id };
    if (!row) { setSheetError("员工档案未找到，请重新打开名册。 "); return; }
    const today = staffById(staffId);
    const detail = `<dl class="staff-detail-grid"><div><dt>姓名</dt><dd>${e(row.name)}</dd></div><div><dt>员工编号</dt><dd>${e(row.id)}</dd></div><div><dt>部门</dt><dd>${e(row.department)}</dd></div><div><dt>角色</dt><dd>${e(roleNames[row.role] || row.role)}</dd></div><div><dt>用工类型</dt><dd>${e(employmentNames[row.employment_type] || row.employment_type)}</dd></div><div><dt>是否启用</dt><dd>${row.active ? "启用" : "停用"}</dd></div></dl><div class="sheet-subsection"><strong>可安排岗位</strong><p>数量和明细：当前员工名册接口未提供，不能根据今日排班推算。</p></div>${today ? `<div class="sheet-subsection"><strong>今日现场（仅供查看）</strong><p>${e(today.status_display || today.status || "状态待初始化")} · ${e(today.roster_status === "cancelled" ? "排班已取消" : "今日已排班")}</p></div>` : ""}${!row.active ? `<p class="sheet-hint">该员工已停用，现有 PIN 接口会拒绝签发。</p>` : row.id === getSession()?.staff_id ? `<p class="sheet-hint">本人 PIN 请在“我的”页面修改；管理重置接口不允许重置自己的 PIN。</p>` : ""}`;
    renderSheet({ title: `${row.name} · 员工详情`, description: "人员资料操作与今日现场操作分开", body: detail,
      buttons: [
        { label: "初始化/重置PIN", primary: true, action: () => {
          if (!row.active) { setSheetError("该员工已停用，现有 PIN 接口不允许签发。 "); return; }
          if (row.id === getSession()?.staff_id) { setSheetError("请到“我的”页面修改自己的 PIN。 "); return; }
          openResetPin(row);
        } },
        { label: source === "directory" ? "返回员工名册" : "关闭详情", action: source === "directory" ? openDirectory : closeSheet }
      ] });
  }
  function openStaffActions(row) {
    const p = phase();
    const safety = row.current_position_id ? positionById(row.current_position_id)?.is_safety_critical : false;
    const actions = [];
    if (p === "not_started" && (!row.status || row.status === "not_arrived") && row.roster_status === "scheduled") {
      if (row.status === "not_arrived") actions.push({ label: "确认到岗", action: () => openAssignment("arrival", row, true) });
      else actions.push({ label: "先生成未到岗名单", action: openRoster });
      actions.push({ label: "修改排班时间", action: () => openRosterEdit(row) });
      actions.push({ label: "取消今日排班", action: () => openCancelRoster(row) });
    }
    if (p === "not_started" && row.status === "on_duty" && row.roster_status === "scheduled")
      actions.push({ label: "调整开园前安排", action: () => openAssignment("preassign", row, true) });
    if (p === "monitoring" && row.status === "not_arrived" && row.roster_status === "scheduled") actions.push({ label: "确认到岗", action: () => openAssignment("arrival", row, true) });
    if (p === "monitoring" && row.status === "on_duty" && row.current_assignment_type === "in_transit" && !row.has_pending_handoff) {
      const safetyTarget = row.target_position_id && positionById(row.target_position_id)?.is_safety_critical;
      if (safetyTarget) actions.push({ label: "发起安全补岗", action: () => openSafetyHandoff({ flow: "gap", action: "fill", position: positionById(row.target_position_id), outgoing: null }) });
      else actions.push({ label: "确认到位", action: () => callWrite("rpc_live_finish_transfer", { p_staff_id: row.staff_id }, `${row.name}已确认到位。`) });
    }
    if (p === "monitoring" && row.status === "on_duty" && row.current_assignment_type !== "in_transit") {
      if (safety) actions.push({ label: "安全岗交接", action: () => openSafetyManagement(row) });
      else if (!row.is_temporary_cover && !row.has_pending_handoff) {
        actions.push({ label: "调岗", action: () => openAssignment("transfer", row, false) });
        actions.push({ label: "开始吃饭", action: () => startBreak(row, "meal") });
        actions.push({ label: "短时离岗", action: () => startBreak(row, "short_leave") });
        actions.push({ label: "正常下班", action: () => endShift(row) });
      } else actions.push({ label: "先处理交接 / 顶岗", action: () => notice("员工仍有交接或顶岗关系，必须先完成对应安全交接。", true) });
    }
    if (p === "monitoring" && ["meal", "short_leave"].includes(row.status)) actions.push({ label: "返岗", action: () => returnFromBreak(row) });
    if (p === "monitoring" && row.status && row.status !== "not_arrived" && row.status !== "off_duty") actions.push({ label: "异常真实离岗", action: () => openEmergency(row), danger: true });
    renderSheet({ title: `${row.name} · 现场操作`, description: `${row.staff_id} · ${row.status_display || row.status || "已排班"}`, buttons: [...actions, { label: "关闭", action: closeSheet }] });
  }

  async function openRoster() {
    if (phase() === "ended") { notice("今日营业已结束，不能再修改今日排班。", true); return; }
    renderSheet({ title: "今日排班", description: "正在读取员工目录…" });
    let directory;
    try { directory = await rpc("rpc_staff_directory", { p_session_token: token() }); }
    catch (error) { setSheetError(explain(error)); return; }
    const existing = new Map(staffRows().map(row => [row.staff_id, row]));
    const selectable = (directory || []).filter(row => row.active && !existing.has(row.id));
    const canEdit = phase() === "not_started";
    const body = `<p class="sheet-hint">已排班 ${[...existing.values()].filter(row => row.roster_status === "scheduled").length} 人。${canEdit ? "开园前可加入、调整或取消。" : "营业中可临时加入已有员工增援。"}</p><label class="sheet-field">选择已有员工<select name="staffId"><option value="">请选择</option>${selectable.map(row => `<option value="${e(row.id)}">${e(row.name)} · ${e(row.id)} · ${e(row.employment_type)}</option>`).join("")}</select></label>${field("预计上班时间（北京时间）", "start", "datetime-local", defaultStart())}${field("预计下班时间（北京时间）", "end", "datetime-local", defaultEnd())}<div class="sheet-subsection"><strong>今日名单</strong>${[...existing.values()].map(row => `<p>${e(row.name)} · ${e(row.staff_id)} · ${row.roster_status === "cancelled" ? "已取消" : row.status_display || "已排班"}</p>`).join("") || "<p>暂无排班人员</p>"}</div>`;
    renderSheet({ title: "今日排班", description: canEdit ? "从已有员工中选择今天实际来的人。" : "营业中增援仅加入已有在职人员。", body, buttons: [
      { label: canEdit ? "加入 / 更新排班" : "加入增援", primary: true, action: () => {
        const id = value("staffId"); if (!id) { setSheetError("请选择一名员工。 "); return; }
        let time; try { time = scheduleValues(); } catch (error) { setSheetError(error.message); return; }
        const name = canEdit ? "rpc_save_today_roster" : "rpc_live_add_reinforcement";
        const params = canEdit ? { p_staff_id: id, p_scheduled_start: time.start, p_scheduled_end: time.end } : { p_staff_id: id, p_start: time.start, p_end: time.end };
        callWrite(name, params, "人员已加入今日名单。 ");
      } },
      ...(canEdit ? [{ label: "生成未到岗名单", action: async () => {
        const result = await callWrite("rpc_initialize_today_not_arrived", {}, "未到岗名单已更新。 ");
        if (result.ok && result.refreshOk && result.result !== null && result.result !== "") notice(`本次新增 ${Number(result.result) || 0} 名未到岗人员。`);
      } }] : []),
      { label: "新增临时兼职", action: openTempEntry },
      { label: "关闭", action: closeSheet }
    ] });
  }
  function openRosterEdit(row) {
    renderSheet({ title: `修改 ${row.name} 的排班`, description: "仅限开始营业前，且员工尚未实际到岗。", body: `${field("预计上班时间（北京时间）", "start", "datetime-local", toLocal(row.scheduled_start_time) || defaultStart())}${field("预计下班时间（北京时间）", "end", "datetime-local", toLocal(row.scheduled_end_time) || defaultEnd())}`, buttons: [
      { label: "取消", action: closeSheet },
      { label: "保存时间", primary: true, action: () => {
        let time; try { time = scheduleValues(); } catch (error) { setSheetError(error.message); return; }
        callWrite("rpc_save_today_roster", { p_staff_id: row.staff_id, p_scheduled_start: time.start, p_scheduled_end: time.end }, "排班时间已更新。 ");
      } }
    ] });
  }
  function openCancelRoster(row) {
    renderSheet({ title: `取消 ${row.name} 的今日排班`, description: "只能取消尚未实际到岗的人员，原排班历史保留。", body: textarea("取消原因", "reason", "例如：今天请假"), buttons: [
      { label: "返回", action: closeSheet },
      { label: "确认取消", danger: true, action: () => { const reason = checkReason(); if (reason) callWrite("rpc_cancel_today_roster", { p_staff_id: row.staff_id, p_reason: reason }, "今日排班已取消。 "); } }
    ] });
  }

  function openTempEntry() {
    tempDraft = null;
    renderSheet({ title: "新增临时兼职", description: "只填姓名和今日预计时间。系统会分配独立 TMP 编号，不自动设置 PIN。", body: `${field("真实姓名", "name", "text", "", 'maxlength="80" autocomplete="off"')}${field("预计上班时间（北京时间）", "start", "datetime-local", defaultStart())}${field("预计下班时间（北京时间）", "end", "datetime-local", defaultEnd())}`, buttons: [
      { label: "返回", action: openRoster },
      { label: "查询同名人员", primary: true, action: async () => {
        const name = value("name"); if (!name) { setSheetError("请输入临时兼职的真实姓名。 "); return; }
        let time; try { time = scheduleValues(); } catch (error) { setSheetError(error.message); return; }
        renderSheet({ title: "查询同名人员", description: "正在查询历史档案…" });
        try {
          const candidates = await rpc("rpc_temp_staff_candidates", { p_session_token: token(), p_name: name });
          tempDraft = { name, ...time, requestId: crypto.randomUUID() };
          openTempChoices(candidates || []);
        } catch (error) { setSheetError(explain(error)); }
      } }
    ] });
  }
  function openTempChoices(candidates) {
    const draft = tempDraft;
    const rows = candidates.map(item => `<div class="candidate-card"><strong>${e(item.staff_name)} · ${e(item.staff_id)}</strong><small>${e(item.employment_type)} · ${item.active ? "活跃" : "已停用"} · 最近排班 ${e(item.last_roster_day || "无")}</small></div>`).join("");
    const eligible = candidates.filter(item => item.employment_type === "temporary_part_time");
    renderSheet({ title: "确认是否复用历史人员", description: `${draft.name} · 请人工核对同名者；姓名不能作为唯一身份。`, body: rows || `<p class="sheet-hint">未查到完全同名档案。请确认是新人员后创建。</p>`, buttons: [
      ...eligible.map(item => ({ label: `复用 ${item.staff_id}${item.active ? "" : "（重新启用）"}`, action: () => {
        if (!item.active) confirm("重新启用历史人员", "此人员已停用，是否重新启用？原有可安排岗位关系会保留。", "确认重新启用并加入今日", () => reuseTemp(item, true));
        else confirm("复用历史人员", `请核对 ${item.staff_name}（${item.staff_id}）确为同一真人。`, "复用并加入今日", () => reuseTemp(item, false));
      } })),
      { label: "确认是新人，创建新编号", primary: true, action: () => confirm("确认创建新人员", `将为 ${draft.name} 创建独立 TMP 编号并加入今日名单。`, "确认创建", createTemp) },
      { label: "返回修改", action: openTempEntry }
    ] });
  }
  async function createTemp() {
    if (!tempDraft) { setSheetError("录入信息已失效，请重新查询同名人员。 "); return; }
    const draft = tempDraft;
    const outcome = await callWrite("rpc_temp_staff_create", {
      p_name: draft.name, p_scheduled_start: draft.start, p_scheduled_end: draft.end,
      p_confirm_new_person: true, p_request_id: draft.requestId
    }, null, { keepSheet: true });
    if (outcome.ok) showTempResult(outcome.result, draft);
  }
  async function reuseTemp(item, reactivate) {
    if (!tempDraft) { setSheetError("录入信息已失效，请重新查询同名人员。 "); return; }
    const draft = tempDraft;
    const outcome = await callWrite("rpc_temp_staff_reuse", {
      p_staff_id: item.staff_id, p_scheduled_start: draft.start, p_scheduled_end: draft.end,
      p_reactivate_inactive: reactivate
    }, null, { keepSheet: true });
    if (outcome.ok) showTempResult(outcome.result, draft);
  }
  function showTempResult(result, draft) {
    renderSheet({ title: "已加入今日人员名单", body: `<div class="result-card"><strong>${e(result?.staff_id || "请在今日人员核对新编号")}</strong><p>${e(result?.name || draft.name)}</p><p>今日排班：${e(datetime(draft.start, true))} – ${e(datetime(draft.end, true))}</p><p>现场状态：未到岗</p><p>未自动生成 PIN；如需本人参与安全交接，店长可单独初始化 PIN。</p></div>`, buttons: [{ label: "完成", primary: true, action: closeSheet }] });
  }

  function assignmentFields(positions, allowSafety, preset = {}) {
    const fixed = positions.filter(item => !item.is_mobile && item.snapshot_present !== false && item.expected_open === true && (allowSafety || !item.is_safety_critical));
    const options = fixed.map(item => `<option value="${e(item.position_id)}" data-safety="${Boolean(item.is_safety_critical)}" ${preset.position === item.position_id ? "selected" : ""}>${e(areaNames[item.area_code] || item.area_code)} · ${e(item.name)}${item.expected_open ? "" : "（今日未启用）"}</option>`).join("");
    const areaOptions = Object.entries(areaNames).filter(([id]) => id !== "global").map(([id, label]) => `<option value="${e(id)}" ${preset.area === id ? "selected" : ""}>${e(label)}</option>`).join("");
    return `<label class="sheet-field">当前实际安排<select name="assignmentType"><option value="position" ${preset.type === "position" ? "selected" : ""}>具体固定岗位</option><option value="area_standby" ${preset.type === "area_standby" ? "selected" : ""}>区域待命</option><option value="mobile_pool" ${preset.type === "mobile_pool" ? "selected" : ""}>全场机动池</option></select></label><label class="sheet-field" data-assignment-field="position">具体岗位<select name="position"><option value="">请选择</option>${options}</select></label><label class="sheet-field" data-assignment-field="area">所属区域<select name="area"><option value="">请选择</option>${areaOptions}</select></label><p class="sheet-hint" data-candidate-hint></p>`;
  }
  function wireAssignment(root, staffId) {
    const type = $('[name="assignmentType"]', root);
    const pos = $('[name="position"]', root);
    const posField = $('[data-assignment-field="position"]', root);
    const areaField = $('[data-assignment-field="area"]', root);
    const hint = $('[data-candidate-hint]', root);
    const update = async () => {
      posField.hidden = type.value !== "position";
      areaField.hidden = type.value !== "area_standby";
      if (type.value !== "position" || !pos.value || !staffId) { hint.textContent = ""; return; }
      hint.textContent = "正在核对可安排岗位…";
      try {
        const candidates = await rpc("rpc_position_candidates", { p_session_token: token(), p_position_id: pos.value });
        const candidate = (candidates || []).find(item => item.staff_id === staffId);
        hint.textContent = !candidate ? "今日人员名单中未找到此人，提交会被数据库拒绝。" : candidate.has_required_assignment_permission ? "该员工拥有此岗位的可安排关系；现场状态仍由数据库最终确认。" : "该员工缺少此岗位的可安排关系，不能提交。";
      } catch (error) { hint.textContent = explain(error); }
    };
    type.addEventListener("change", update); pos.addEventListener("change", update); update();
  }
  function selectedAssignment() {
    const type = value("assignmentType");
    const position = type === "position" ? value("position") : null;
    const area = type === "area_standby" ? value("area") : null;
    if (type === "position" && !position || type === "area_standby" && !area) throw new Error("请选择具体岗位或区域。 ");
    return { type, position, area };
  }
  async function loadPositions() {
    if (positionRows().length) return positionRows();
    return rpc("rpc_today_positions", { p_session_token: token() });
  }
  async function openAssignment(kind, row, allowSafety, extra = {}) {
    renderSheet({ title: "选择实际安排", description: "正在读取今日岗位…" });
    let positions;
    try { positions = await loadPositions(); } catch (error) { setSheetError(explain(error)); return; }
    const titles = { arrival: `确认 ${row.name} 到岗`, preassign: `调整 ${row.name} 的开园前安排`, transfer: `调动 ${row.name}`, return: `重新安排 ${row.name} 返岗`, cancel: "安排接岗人取消后的去向", outgoing: "交出安全岗后的去向" };
    const intro = kind === "arrival" || kind === "preassign" ? "到岗安排必须选实际岗位、区域待命或机动；开园前调整会记录操作流水。" : kind === "transfer" ? "普通调岗不得直接前往安全关键岗。" : kind === "return" ? "原返岗目标不能安全恢复，请另选合法安排。" : "只能选择非安全固定岗位、区域待命或机动池。";
    renderSheet({ title: titles[kind], description: intro, body: assignmentFields(positions, allowSafety), buttons: [
      { label: "返回", action: closeSheet },
      { label: kind === "arrival" ? "确认到岗" : kind === "preassign" ? "保存开园前安排" : kind === "transfer" ? "开始前往" : kind === "return" ? "确认返岗" : "确认安排", primary: true, action: async () => {
        let target; try { target = selectedAssignment(); } catch (error) { setSheetError(error.message); return; }
        const safety = target.type === "position" && positions.find(item => item.position_id === target.position)?.is_safety_critical;
        if (kind === "arrival" || kind === "preassign") {
          if (safety && phase() === "monitoring") {
            confirm("安全关键岗到岗提示", "这名员工到岗后会先记录为前往该安全岗，尚未正式占岗。仍须发起安全岗补位交接并完成双方确认。", "确认到岗并前往", () => submitArrival(row, target));
          } else submitArrival(row, target);
        } else if (kind === "transfer") {
          callWrite("rpc_live_begin_transfer", { p_staff_id: row.staff_id, p_type: target.type, p_position: target.position, p_area: target.area }, "调岗已发起；到达后请确认到位。 ");
        } else if (kind === "return") {
          callWrite("rpc_live_return_from_break", { p_staff_id: row.staff_id, p_type: target.type, p_position: target.position, p_area: target.area }, "返岗已记录。 ");
        } else if (kind === "cancel") {
          callWrite("rpc_live_cancel_handoff", { p_handoff_id: extra.handoffId, p_incoming_type: target.type, p_incoming_position: target.position, p_incoming_area: target.area, p_reason: extra.reason }, "交接已取消，并记录接岗人的新安排。 ");
        } else if (kind === "outgoing") extra.done?.(target);
      } }
    ], onOpen: root => wireAssignment(root, kind === "outgoing" ? null : row.staff_id) });
  }
  function submitArrival(row, target) {
    const pre = phase() === "not_started";
    const name = pre ? "rpc_confirm_today_arrival" : "rpc_live_late_arrival";
    const params = pre ? { p_staff_id: row.staff_id, p_assignment_type: target.type, p_position_id: target.position, p_area_code: target.area } : { p_staff_id: row.staff_id, p_type: target.type, p_position: target.position, p_area: target.area };
    callWrite(name, params, pre ? "已确认到岗并安排初始位置。 " : "已确认到岗；如前往安全岗，请继续完成独立交接。 ");
  }

  function startBreak(row, kind) {
    const label = kind === "meal" ? "开始吃饭" : "记录短时离岗";
    confirm(label, kind === "meal" ? "计划吃饭必须先满足区域最低人数；计时从数据库记录的状态开始时间计算。" : "短离按真实现场记录；如触及最低覆盖，须由管理人员明确确认原因。", label, async () => {
      const outcome = await callWrite("rpc_live_start_break", { p_staff_id: row.staff_id, p_break: kind, p_confirm_short_leave_shortfall: false, p_reason: null }, `${row.name}已${kind === "meal" ? "开始吃饭" : "进入短时离岗"}。`, {
        onError: error => {
          const message = String(error.message || "");
          if (kind === "short_leave" && /短时离岗将使区域低于最低人数/.test(message)) {
            renderSheet({ title: "确认真实短时离岗", description: "当前短离会使区域低于最低人数。若员工确实已需离开，填写原因后按真实人数记录，立即显示缺口。", body: textarea("确认原因", "reason", "例如：突发身体不适"), buttons: [
              { label: "返回", action: closeSheet },
              { label: "确认真实短离", danger: true, action: () => {
                const reason = checkReason(); if (reason) callWrite("rpc_live_start_break", { p_staff_id: row.staff_id, p_break: "short_leave", p_confirm_short_leave_shortfall: true, p_reason: reason }, `${row.name}短离已按真实状态记录。`);
              } }
            ] });
            return true;
          }
          if (kind === "meal" && /低于最低|覆盖/.test(message)) { setSheetError("当前离岗会使区域低于最低人数，请先安排替岗人员。 "); return true; }
          return false;
        }
      });
      return outcome;
    });
  }
  function returnFromBreak(row) {
    confirm("返岗", `优先恢复 ${row.name} 本次离岗前保存的实际安排；不会覆盖已有人值守的岗位。`, "尝试返岗", () => callWrite("rpc_live_return_from_break", { p_staff_id: row.staff_id, p_type: null, p_position: null, p_area: null }, "返岗已记录。", { onError: error => {
      if (/原岗位|返岗目标|不能自动覆盖|没有自动返岗目标|安全关键岗返岗/.test(String(error.message || ""))) {
        if (/安全关键岗|交接/.test(String(error.message || ""))) setSheetError("安全关键岗返岗必须由本人发起独立双确认交接。请到员工本人页处理，或选择其他非安全安排。 ");
        else openAssignment("return", row, false);
        return true;
      }
      return false;
    } }));
  }
  function endShift(row) {
    confirm("确认真实下班", "正常下班要求安全交接与顶岗关系已处理。若下班后区域不足，系统会再次要求确认。", "记录下班", () => callWrite("rpc_live_end_shift", { p_staff_id: row.staff_id, p_confirm_shortfall: false }, `${row.name}已下班。`, { onError: error => {
      if (/下班后区域将低于最低人数/.test(String(error.message || ""))) {
        confirm("确认区域缺口", "该员工已实际下班吗？确认后系统将按真实人数记录，并立即产生区域缺口告警。", "确认已实际下班", () => callWrite("rpc_live_end_shift", { p_staff_id: row.staff_id, p_confirm_shortfall: true }, `${row.name}已按真实下班记录。`, {}), true);
        return true;
      }
      return false;
    } }));
  }
  function openEmergency(row) {
    renderSheet({ title: `异常真实离岗 · ${row.name}`, description: "仅用于人员已经真实离岗、无法完成正常交接。安全岗位可能立即产生红色缺口。", body: `<label class="sheet-field">离岗后状态<select name="finalStatus"><option value="short_leave">短时离岗</option><option value="off_duty">今日不再返岗</option></select></label>${field("实际发生时间（北京时间）", "actualAt", "datetime-local", toLocal(new Date().toISOString()))}${textarea("异常原因", "reason", "请写真实原因及现场处理情况")}`, buttons: [
      { label: "返回", action: closeSheet },
      { label: "按真实离岗记录", danger: true, action: () => {
        const reason = checkReason(); if (!reason) return;
        let at; try { at = toIso(value("actualAt")); } catch (error) { setSheetError(error.message); return; }
        const finalStatus = value("finalStatus") || "short_leave";
        confirm("最后确认异常离岗", "此操作可能取消未完成交接并使安全关键岗立刻空岗。只能在人员确实已经离开时使用。", "确认记录真实现场", () => callWrite("rpc_emergency_real_departure", { p_staff_id: row.staff_id, p_final_status: finalStatus, p_reason: reason, p_actual_at: at }, "异常真实离岗已记录，已刷新现场缺口。"), true);
      } }
    ] });
  }
  function openResetPin(row) {
    const staffId = row.id || row.staff_id;
    confirm("初始化 / 重置 PIN", `将为 ${row.name}（${staffId}）签发一次性临时 PIN，旧 PIN 和旧会话立即失效。请当面告知员工。`, "签发临时 PIN", async () => {
      const outcome = await callWrite("pin_manager_issue_temp", { p_target_staff_id: staffId }, null, { keepSheet: true });
      if (!outcome.ok) return;
      const temporaryPin = outcome.result?.temporary_pin;
      if (!temporaryPin) {
        renderSheet({ title: "未返回临时 PIN", description: "签发请求已提交，但响应没有临时 PIN。无法当面告知员工；请重新签发一组。", buttons: [{ label: "关闭", primary: true, action: closeSheet }] });
        return;
      }
      renderSheet({ title: "临时 PIN · 仅显示一次", description: `请当面告知 ${row.name}，员工登录后需要修改。关闭后本页面不再保存或显示。`, body: `<div class="one-time-pin">${e(temporaryPin || "签发失败，请核对")}</div>`, buttons: [{ label: "我已当面告知，关闭", primary: true, action: closeSheet }] });
    });
  }
  function openMyPinChange() {
    renderSheet({ title: "修改我的 PIN", description: "新 PIN 为 6–8 位数字。修改成功后旧 PIN 和旧会话立即失效。", body: `${field("当前 PIN", "oldPin", "password", "", 'inputmode="numeric" autocomplete="current-password"')}${field("新 PIN", "newPin", "password", "", 'inputmode="numeric" autocomplete="new-password"')}${field("再次输入新 PIN", "confirmPin", "password", "", 'inputmode="numeric" autocomplete="new-password"')}`, buttons: [
      { label: "返回", action: closeSheet },
      { label: "保存新 PIN", primary: true, action: async () => {
        const oldPin = value("oldPin"), newPin = value("newPin"), confirmPin = value("confirmPin");
        if (!/^\d{6,8}$/.test(newPin) || newPin !== confirmPin) { setSheetError("新 PIN 须为相同的 6–8 位数字。 "); return; }
        if (working) return;
        working = true; busyButtons(true);
        try {
          const result = await writeRpc("pin_change", { p_session_token: token(), p_current_pin: oldPin, p_new_pin: newPin });
          if (result === null || result === "") { requireLogin("PIN 修改已提交，但未返回新会话。请用新 PIN 重新登录。 "); return; }
          if (!result?.ok) { setSheetError(result?.message || "修改失败，请核对当前 PIN。 "); return; }
          saveSession({ ...getSession(), ...result, must_change_pin: false });
          working = false; closeSheet(); notice("PIN 已修改，新的登录会话已启用。 ");
        } catch (error) { setSheetError(explain(error)); }
        finally { working = false; busyButtons(false); }
      } }
    ] });
  }

  function decoratePositions(content) {
    if (phase() !== "monitoring") return;
    for (const card of content.querySelectorAll("[data-position-id]")) {
      const row = positionById(card.dataset.positionId);
      if (row) appendAction(card, "操作", () => openPositionActions(row));
    }
  }
  function openPositionActions(row) {
    const actions = [];
    if (row.is_safety_critical && row.expected_open && !row.pending_handoff_id) {
      if (!row.current_staff_id) actions.push({ label: "发起安全补岗", primary: true, action: () => openSafetyHandoff({ flow: "gap", action: "fill", position: row, outgoing: null }) });
      else actions.push({ label: "安全岗交接", action: () => openSafetyManagement({ staff_id: row.current_staff_id, name: row.current_staff_name, current_position_id: row.position_id }) });
    }
    actions.push({ label: row.expected_open ? "暂停今日岗位" : "恢复今日岗位", action: () => openSetPosition(row) });
    actions.push({ label: "关闭", action: closeSheet });
    renderSheet({ title: row.name, description: row.is_safety_critical ? "安全关键岗按双确认交接；暂停/恢复必须填写原因。" : "岗位启闭只调整当天应开快照，不改长期模式模板。", buttons: actions });
  }
  function openSetPosition(row) {
    const opening = !row.expected_open;
    renderSheet({ title: `${opening ? "恢复" : "暂停"}今日岗位 · ${row.name}`, description: opening ? "恢复后若为安全关键岗且无人值守，将立即出现待补岗告警。" : "仅记录当天项目例外；不能借暂停掩盖真实离岗。", body: textarea("原因", "reason", opening ? "例如：设备维修完成" : "例如：拓展组轮餐，三楼索道临时暂停"), buttons: [
      { label: "返回", action: closeSheet },
      { label: opening ? "确认恢复" : "确认暂停", primary: opening, danger: !opening, action: () => {
        const reason = checkReason(); if (reason) callWrite("rpc_live_set_position_open", { p_position: row.position_id, p_open: opening, p_reason: reason }, `${row.name}已${opening ? "恢复" : "暂停"}。`);
      } }
    ] });
  }

  function openSafetyManagement(row) {
    const position = positionById(row.current_position_id) || { position_id: row.current_position_id, name: positionNames.get(row.current_position_id) || row.current_position_id };
    renderSheet({ title: `安全岗交接 · ${position.name}`, description: "饭休和短离须原占岗人本人发起；管理人员可办理调离、结束顶岗或空岗补位。", buttons: [
      { label: "交接后调离", action: () => openAssignment("outgoing", row, false, { done: target => openSafetyHandoff({ flow: "leave", action: "transfer", position, outgoing: row.staff_id, next: target }) }) },
      { label: "结束当前顶岗", action: () => openSafetyHandoff({ flow: "leave", action: "end_cover", position, outgoing: row.staff_id }) },
      { label: "饭休 / 短离由本人发起", action: () => { closeSheet(); notice("请原占岗员工用本人账号，在“我的”页面发起饭休或短离安全交接。 "); } },
      { label: "关闭", action: closeSheet }
    ] });
  }
  async function openSafetyHandoff({ flow, action, position, outgoing, next }) {
    renderSheet({ title: `选择 ${position.name} 接岗人`, description: "正在核对今日人员和可安排岗位…" });
    let candidates;
    try { candidates = await rpc("rpc_position_candidates", { p_session_token: token(), p_position_id: position.position_id }); }
    catch (error) { setSheetError(explain(error)); return; }
    const options = (candidates || []).filter(item => item.staff_id !== outgoing).map(item => `<option value="${e(item.staff_id)}" ${item.eligible ? "" : "disabled"}>${e(item.name)} · ${e(item.staff_id)}${item.eligible ? "" : `（${e(item.ineligible_reason || "暂不可选")}）`}</option>`).join("");
    renderSheet({ title: `发起 ${position.name} 交接`, description: flow === "gap" ? "空岗补位仍需接岗人出发、到位及管理人员最终确认。" : "发起后原占岗人仍在岗位；接岗人出发时才从来源区域扣除。", body: `<label class="sheet-field">接岗人<select name="incoming"><option value="">请选择合格接岗人</option>${options}</select></label>`, buttons: [
      { label: "返回", action: closeSheet },
      { label: "发起交接", primary: true, action: () => {
        const incoming = value("incoming"); if (!incoming) { setSheetError("请选择当前可接岗的员工。 "); return; }
        callWrite("rpc_live_request_handoff", { p_flow: flow, p_action: action, p_position: position.position_id, p_outgoing: outgoing, p_incoming: incoming, p_next_type: next?.type || null, p_next_position: next?.position || null, p_next_area: next?.area || null }, "安全岗交接已发起，请通知接岗人本人点击开始前往。 ");
      } }
    ] });
  }

  function decorateHandoffs(content) {
    if (phase() !== "monitoring") return;
    for (const card of content.querySelectorAll("[data-handoff-id]")) {
      const row = handoffById(card.dataset.handoffId);
      if (row) appendAction(card, "处理交接", () => openHandoffActions(row));
    }
  }
  function nextHandoff(row) {
    const names = { begin_trip: "开始前往", confirm_arrival: "我已到位", finalize: "确认交接完成" };
    const rpcNames = { begin_trip: "rpc_live_begin_handoff_trip", confirm_arrival: "rpc_live_confirm_handoff_arrival", finalize: "rpc_live_finalize_handoff" };
    const action = row.next_action || (row.stage === "awaiting_incoming" ? "begin_trip" : row.stage === "in_transit" ? "confirm_arrival" : "finalize");
    const rpcName = rpcNames[action];
    if (!rpcName) { notice("该交接的下一步状态暂不可识别，请刷新。", true); return; }
    confirm(names[action], `${row.position_name}：${row.stage_display || "请核对现场阶段"}。只允许真正负责此步的员工本人操作。`, names[action], () => callWrite(rpcName, { p_handoff_id: row.handoff_id }, `${row.position_name}交接进度已更新。`, { onError: error => {
      if (action === "begin_trip" && row.requested_action === "short_leave" && /来源区域低于最低人数/.test(String(error.message || ""))) {
        setSheetError("接岗人离开当前位置会造成新的区域最低人数缺口。请管理人员在交接页批准并填写原因，再由接岗人本人重新点击开始前往。 ");
        return true;
      }
      return false;
    } }));
  }
  function openHandoffActions(row) {
    const actions = [];
    if (row.can_current_actor_act_next) actions.push({ label: row.next_action === "begin_trip" ? "开始前往" : row.next_action === "confirm_arrival" ? "我已到位" : "确认交接完成", primary: true, action: () => nextHandoff(row) });
    if (row.flow === "leave" && row.requested_action === "short_leave" && !row.short_leave_override_approved) actions.push({ label: "批准短离覆盖例外", action: () => openShortLeaveApproval(row) });
    actions.push({ label: "取消未完成交接", danger: true, action: () => openCancelHandoff(row) });
    actions.push({ label: "关闭", action: closeSheet });
    renderSheet({ title: `${row.position_name} · 交接待办`, description: `${row.stage_display || "交接进行中"}。${row.can_current_actor_act_next ? "当前登录人可执行下一步。" : "下一步需要对应员工本人处理。"}`, buttons: actions });
  }
  function openShortLeaveApproval(row) {
    renderSheet({ title: "批准安全岗短离覆盖例外", description: "仅用于真实短离。吃饭不能使用此批准越过最低覆盖。批准后接岗人仍须本人点击开始前往。", body: textarea("批准原因", "reason", "例如：原岗员工突发身体不适"), buttons: [
      { label: "返回", action: closeSheet },
      { label: "确认批准", danger: true, action: () => {
        const reason = checkReason(); if (reason) callWrite("rpc_live_approve_short_leave_shortfall", { p_handoff_id: row.handoff_id, p_reason: reason }, "短离例外已批准，请通知接岗人重新点击开始前往。 ");
      } }
    ] });
  }
  function openCancelHandoff(row) {
    renderSheet({ title: `取消 ${row.position_name} 交接`, description: row.stage === "awaiting_incoming" ? "接岗人尚未出发，取消后其原安排不变。" : "接岗人已出发，先尝试恢复原实际安排；若不能恢复，再指定合法新安排。", body: textarea("取消原因", "reason", "请说明取消原因"), buttons: [
      { label: "返回", action: closeSheet },
      { label: "确认取消", danger: true, action: () => {
        const reason = checkReason(); if (!reason) return;
        callWrite("rpc_live_cancel_handoff", { p_handoff_id: row.handoff_id, p_incoming_type: null, p_incoming_position: null, p_incoming_area: null, p_reason: reason }, "交接已取消。", { onError: error => {
          if (row.stage !== "awaiting_incoming" && /不能自动|无法恢复|没有可恢复|已有正式值守者|原分配/.test(String(error.message || ""))) {
            openAssignment("cancel", { staff_id: row.incoming_staff_id, name: row.incoming_staff_name }, false, { handoffId: row.handoff_id, reason });
            return true;
          }
          return false;
        } });
      } }
    ] });
  }

  function decorateMy(content) {
    const row = currentData?.rpc_my_today_state;
    if (!row) return;
    const hero = content.querySelector(".my-hero");
    if (hero) {
      const buttons = document.createElement("div"); buttons.className = "card-actions";
      if (row.phase === "monitoring" && row.status === "on_duty" && row.current_assignment_type === "position" && row.current_position_id) buttons.append(actionButton("申请安全岗交接", () => openMySafetyLeave(row)));
      if (row.phase === "monitoring" && ["meal", "short_leave"].includes(row.status) && row.return_assignment_type === "position" && row.return_position_id) buttons.append(actionButton("申请安全返岗交接", () => openMySafetyReturn(row)));
      buttons.append(actionButton("修改我的 PIN", openMyPinChange));
      hero.append(buttons);
    }
    if (row.phase !== "monitoring") return;
    for (const card of content.querySelectorAll("[data-my-handoff-id]")) {
      const task = (row.my_handoffs || []).find(item => item.handoff_id === card.dataset.myHandoffId);
      if (task?.can_i_act_next) appendAction(card, task.next_action === "begin_trip" ? "开始前往" : task.next_action === "confirm_arrival" ? "我已到位" : "确认交接完成", () => nextHandoff(task), true);
    }
  }
  function openMySafetyLeave(row) {
    renderSheet({ title: "申请安全岗交接", description: "仅用于正在值守的安全关键岗。原占岗人发起后仍须留在岗位，直到接岗人到位且本人最终确认。请先和接岗人完成现场沟通。", body: `<label class="sheet-field">申请动作<select name="handoffAction"><option value="meal">吃饭</option><option value="short_leave">短时离岗</option></select></label>${field("接岗人员工编号", "incoming", "text", "", 'autocomplete="off" placeholder="例如 FT002"')}<p class="sheet-hint">本人页不开放全员候选列表；请填已沟通好的员工编号。数据库仍会核验该员工的可安排关系、今日状态与交接条件。</p>`, buttons: [
      { label: "返回", action: closeSheet },
      { label: "发起交接", primary: true, action: () => {
        const incoming = value("incoming").toUpperCase();
        if (!incoming) { setSheetError("请填写接岗人员工编号。 "); return; }
        callWrite("rpc_live_request_handoff", { p_flow: "leave", p_action: value("handoffAction"), p_position: row.current_position_id, p_outgoing: getSession().staff_id, p_incoming: incoming, p_next_type: null, p_next_position: null, p_next_area: null }, "交接已发起。请继续留在原岗，等待接岗人出发并确认到位。 ");
      } }
    ] });
  }
  function openMySafetyReturn(row) {
    renderSheet({ title: "申请安全岗返岗交接", description: "返岗人本人发起；由当前顶岗人交还岗位，双方完成确认后才恢复正式占岗。", body: field("当前顶岗人员工编号", "outgoing", "text", "", 'autocomplete="off" placeholder="例如 FT002"'), buttons: [
      { label: "返回", action: closeSheet },
      { label: "发起返岗交接", primary: true, action: () => {
        const outgoing = value("outgoing").toUpperCase();
        if (!outgoing) { setSheetError("请填写当前顶岗人员工编号。 "); return; }
        callWrite("rpc_live_request_handoff", { p_flow: "return", p_action: "return", p_position: row.return_position_id, p_outgoing: outgoing, p_incoming: getSession().staff_id, p_next_type: null, p_next_position: null, p_next_area: null }, "安全岗返岗交接已发起。 ");
      } }
    ] });
  }

  return { decorate, dismiss };
}
