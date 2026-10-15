// 013 的本机流程模拟器。仅供界面和调用顺序验收，不替代 PostgreSQL 业务约束。
const area = {
  gate: "entrance", shoes: "entrance", sale1: "front_hall", sale2: "front_hall", sale3: "front_hall", dolls: "front_hall", assist: "front_hall",
  slide: "toddler_vr", patrol: "toddler_vr", vr1: "toddler_vr", vr2: "toddler_vr",
  gear1: "high_altitude", gear2: "high_altitude", gear3: "high_altitude", gear4: "high_altitude", plum: "high_altitude", climb: "high_altitude", leap: "high_altitude", swing1: "high_altitude", swing2: "high_altitude",
  expand1: "high_expansion", expand2: "high_expansion", expand3: "high_expansion", expand4: "high_expansion", expand5: "high_expansion", expand6: "high_expansion", expand7: "high_expansion",
  arcade1: "second_floor", arcade2: "second_floor"
};
const names = {
  gate: "闸机口外侧", shoes: "换鞋区", sale1: "销售1", sale2: "销售2", sale3: "销售3", dolls: "娃娃弹珠区", assist: "好评/协助岗",
  slide: "淘气堡飞跃滑梯上口", patrol: "淘气堡巡场", vr1: "VR-1", vr2: "VR-2",
  gear1: "装备1", gear2: "装备2", gear3: "装备3", gear4: "装备4", plum: "梅花桩", climb: "攀岩", leap: "勇士之跃", swing1: "高空秋千1", swing2: "高空秋千2",
  expand1: "沙池岗", expand2: "拓展入口·挂锁复检岗", expand3: "拓展入口·排队穿绳引导岗", expand4: "拓展一楼监护岗", expand5: "拓展二楼监护岗", expand6: "三楼索道上方操作岗", expand7: "三楼索道下方接应岗",
  arcade1: "二楼电玩1", arcade2: "二楼电玩2", floor2mobile: "二楼机动", m1: "M1高空专业机动", m2: "M2综合服务机动"
};
const safety = new Set(["slide", "patrol", "vr1", "vr2", "plum", "climb", "leap", "swing1", "expand1", "expand2", "expand3", "expand4", "expand5", "expand6", "expand7"]);
const qualified = new Set(["slide", "patrol", "vr1", "vr2", "gear1", "gear2", "gear3", "gear4", "plum", "climb", "leap", "swing1", "swing2", "expand2", "expand3", "expand4", "expand5", "expand6", "expand7"]);
const mobile = new Set(["floor2mobile", "m1", "m2"]);
const yellowDefault = new Set(["sale1", "sale2", "slide", "patrol", "vr1", "gear1", "gear2", "gear3", "gear4", "plum", "climb", "leap", "swing1", "swing2", "expand1", "expand2", "expand3", "expand4", "expand5", "expand6", "expand7", "arcade1", "arcade2"]);
const greenDefault = new Set(["sale1", "sale2"]);
const baseCoverage = {
  green: [["entrance", 0, 0], ["front_hall", 1, 2], ["toddler_vr", 1, 1], ["high_altitude", 2, 3], ["high_expansion", 0, 0], ["second_floor", 0, 1], ["global", 0, 1]],
  yellow: [["entrance", 1, 1], ["front_hall", 2, 4], ["toddler_vr", 2, 4], ["high_altitude", 6, 9], ["high_expansion", 4, 7], ["second_floor", 1, 2], ["global", 0, 2]],
  red: [["entrance", 1, 2], ["front_hall", 2, 5], ["toddler_vr", 3, 4], ["high_altitude", 7, 10], ["high_expansion", 5, 8], ["second_floor", 2, 3], ["global", 0, 2]]
};
const iso = () => new Date().toISOString();
function fail(message, code = "P0001") { const error = new Error(message); error.code = code; throw error; }
function businessDay() {
  const date = new Date(Date.now() - 2 * 3600_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export class WorkflowMock {
  constructor() {
    this.day = businessDay(); this.phase = "not_prepared"; this.mode = null;
    this.staff = [
      { id: "FT001", name: "测试店长", department: "现场运营部", role: "manager", employment_type: "full_time", active: true },
      { id: "FT002", name: "测试员工A", department: "现场运营部", role: "staff", employment_type: "full_time", active: true },
      { id: "FT003", name: "测试员工B", department: "现场运营部", role: "staff", employment_type: "regular_part_time", active: true },
      { id: "FT004", name: "测试员工C", department: "现场运营部", role: "staff", employment_type: "full_time", active: true },
      { id: "TMP20261001-01", name: "历史兼职", department: "现场运营部", role: "staff", employment_type: "temporary_part_time", active: false }
    ];
    this.roster = new Map(); this.states = new Map(); this.handoffs = new Map();
    this.positions = Object.keys(names).map(id => ({ position_id: id, name: names[id], area_code: area[id] || null,
      is_mobile: mobile.has(id), is_safety_critical: safety.has(id), requires_qualification: qualified.has(id),
      expected_open: null, template_expected_open: null, snapshot_present: false, exception_reason: null, vacant_since: null }));
    this.handoffSequence = 0; this.tempSequence = 0; this.requests = new Map(); this.events = [];
  }
  actor(token) {
    const id = String(token || "").replace(/-token$/, "");
    const staff = this.staff.find(item => item.id === id && item.active && token === `${id}-token`);
    if (!staff) fail("会话已失效，请重新验证身份", "28000");
    return staff;
  }
  requireManager(actor) { if (!["manager", "deputy", "supervisor"].includes(actor.role)) fail("没有管理操作权限", "42501"); }
  requireMonitoring() { if (this.phase !== "monitoring") fail("当前不是营业监控阶段，不能继续现场操作"); }
  member(id) { const staff = this.staff.find(item => item.id === id); if (!staff) fail("员工不存在"); return staff; }
  state(id) { const state = this.states.get(id); if (!state) fail("今天没有该员工的现场状态"); return state; }
  position(id) { const position = this.positions.find(item => item.position_id === id); if (!position || position.is_mobile) fail("无效固定岗位"); return position; }
  dateTimes(body) {
    const start = body.p_scheduled_start || body.p_start;
    const end = body.p_scheduled_end || body.p_end;
    if (!start || !end || new Date(end) <= new Date(start)) fail("预计上下班时间无效");
    return { start, end };
  }
  putRoster(id, body) {
    const staff = this.member(id); if (!staff.active) fail("员工已停用");
    const { start, end } = this.dateTimes(body);
    this.roster.set(id, { staff_id: id, roster_status: "scheduled", scheduled_start_time: start, scheduled_end_time: end });
  }
  putNotArrived(id) {
    if (!this.states.has(id)) this.states.set(id, { staff_id: id, status: "not_arrived", status_since: iso(), current_assignment_type: "none", current_position_id: null, current_area_code: null, target_position_id: null, target_area_code: null, return_assignment_type: "none", return_position_id: null, return_area_code: null, cover_for_staff_id: null });
  }
  setAssignment(id, type, position, areaCode) {
    const state = this.state(id);
    if (!["position", "area_standby", "mobile_pool"].includes(type)) fail("请选择实际安排");
    if (type === "position") {
      const target = this.position(position);
      if (target.requires_qualification && !this.member(id).active) fail("缺少可安排关系");
      if (this.occupant(position, id)) fail("目标岗位已有正式值守者");
      state.current_position_id = position; state.current_area_code = null;
    } else if (type === "area_standby") {
      if (!Object.values(area).includes(areaCode)) fail("请选择有效区域");
      state.current_position_id = null; state.current_area_code = areaCode;
    } else { state.current_position_id = null; state.current_area_code = null; }
    state.current_assignment_type = type;
    state.target_position_id = null; state.target_area_code = null;
  }
  occupant(positionId, exceptId = null) {
    return [...this.states.values()].find(item => item.staff_id !== exceptId && item.status === "on_duty" && item.current_assignment_type === "position" && item.current_position_id === positionId);
  }
  activeHandoff(id) { return [...this.handoffs.values()].some(h => !["completed", "cancelled"].includes(h.stage) && [h.outgoing_staff_id, h.incoming_staff_id].includes(id)); }
  rpc(name, b = {}) {
    if (name === "pin_login") {
      const staff = this.staff.find(item => item.active && (item.id === String(b.p_identifier).toUpperCase() || item.name === b.p_identifier));
      if (!staff || b.p_pin !== "123456") return { ok: false, message: "编号或 PIN 不正确" };
      return { ok: true, staff_id: staff.id, name: staff.name, role: staff.role, must_change_pin: false, session_token: `${staff.id}-token`, expires_at: new Date(Date.now() + 12 * 3600_000).toISOString() };
    }
    if (name === "pin_whoami") { const a = this.actor(b.p_session_token); return { staff_id: a.id, name: a.name, role: a.role, must_change_pin: false, expires_at: new Date(Date.now() + 12 * 3600_000).toISOString() }; }
    if (name === "pin_logout") return true;
    const actor = this.actor(b.p_session_token);
    if (name === "pin_change") return b.p_current_pin === "123456" && /^\d{6,8}$/.test(b.p_new_pin) ? { ok: true, session_token: `${actor.id}-token`, expires_at: new Date(Date.now() + 12 * 3600_000).toISOString() } : { ok: false, message: "原 PIN 不正确或新 PIN 不符合要求" };
    if (name === "rpc_my_today_state") return this.myState(actor);
    if (name === "rpc_my_return_position") {
      const state = this.states.get(actor.id);
      if (!["meal", "short_leave"].includes(state?.status) || state.return_assignment_type !== "position") return null;
      const position = this.position(state.return_position_id);
      const occupant = this.occupant(position.position_id);
      return { position_id: position.position_id, position_name: position.name,
        is_safety_critical: position.is_safety_critical, expected_open: position.expected_open,
        current_staff_id: occupant?.staff_id || null,
        current_staff_name: this.staff.find(item => item.id === occupant?.staff_id)?.name || null,
        current_staff_covers_me: occupant?.cover_for_staff_id === actor.id,
        pending_handoff_id: [...this.handoffs.values()].find(item => item.position_id === position.position_id && !["completed", "cancelled"].includes(item.stage))?.handoff_id || null };
    }
    if(name==='rpc_my_meal_plan') return {business_day:this.day,phase:this.phase,plan:null,my_cover_tasks:[],as_of:iso()};
    if(name==='rpc_today_meal_plan') { this.requireManager(actor); return {business_day:this.day,phase:this.phase,is_prepared:this.phase!=='not_prepared',operation_mode:this.mode,plans:[],unplanned_staff:[],analysis:{baseline_status:'baseline_not_ready',forecast:[]},next_30_minutes:[],as_of:iso()}; }
    const staffHandoffCalls = new Set(["rpc_live_request_handoff", "rpc_live_begin_handoff_trip", "rpc_live_confirm_handoff_arrival", "rpc_live_finalize_handoff"]);
    if (!staffHandoffCalls.has(name)) this.requireManager(actor);
    if (name === "rpc_today_overview") return this.overview();
    if (name === "rpc_today_staff") return this.todayStaff();
    if (name === "rpc_today_positions") return this.todayPositions();
    if (name === "rpc_today_coverage") return this.coverage();
    if (name === "rpc_today_alerts") return this.alerts();
    if (name === "rpc_today_handoffs") return this.todayHandoffs(actor);
    if (name === "rpc_staff_directory") return this.staff.map(x => ({ ...x }));
    if (name === "rpc_position_candidates") return this.candidates(b.p_position_id);
    if (name === "rpc_temp_staff_candidates") return this.staff.filter(x => x.name.trim().toLowerCase() === String(b.p_name || "").trim().toLowerCase()).map(x => ({ staff_id: x.id, staff_name: x.name, employment_type: x.employment_type, active: x.active, last_roster_day: x.id.startsWith("TMP") ? "2026-10-01" : null }));
    if (name === "pin_manager_issue_temp") { if (actor.role !== "manager") fail("只有店长可以重置 PIN", "42501"); return { ok: true, staff_id: b.p_target_staff_id, temporary_pin: "654321", must_change_pin: true }; }
    if (name === "rpc_prepare_today") { if (this.phase !== "not_prepared") fail("今日已准备"); this.phase = "not_started"; return this.day; }
    if (name === "rpc_select_today_mode") { if (this.phase !== "not_started") fail("只允许开始营业前选择模式"); if (!baseCoverage[b.p_mode]) fail("无效模式"); this.mode = b.p_mode; for (const p of this.positions) { p.snapshot_present = true; p.expected_open = b.p_mode === "red" ? !p.is_mobile : b.p_mode === "green" ? greenDefault.has(p.position_id) : yellowDefault.has(p.position_id); p.template_expected_open = p.expected_open; } return null; }
    if (name === "rpc_save_today_roster") { if (this.phase !== "not_started") fail("只允许开始营业前编辑排班"); this.putRoster(b.p_staff_id, b); return null; }
    if (name === "rpc_cancel_today_roster") { if (this.phase !== "not_started") fail("只能开园前取消排班"); if (!b.p_reason) fail("取消原因必填"); const r = this.roster.get(b.p_staff_id); if (!r) fail("没有今日排班"); if (this.states.get(b.p_staff_id)?.status === "on_duty") fail("已到岗不能取消"); r.roster_status = "cancelled"; this.states.delete(b.p_staff_id); return null; }
    if (name === "rpc_initialize_today_not_arrived") { if (this.phase !== "not_started") fail("只允许准备阶段初始化"); let count = 0; for (const r of this.roster.values()) if (r.roster_status === "scheduled" && !this.states.has(r.staff_id)) { this.putNotArrived(r.staff_id); count++; } return count; }
    if (name === "rpc_confirm_today_arrival" || name === "rpc_live_late_arrival") {
      if (name === "rpc_confirm_today_arrival" && this.phase !== "not_started" || name === "rpc_live_late_arrival" && this.phase !== "monitoring") fail("到岗入口与营业阶段不匹配");
      if (!this.roster.has(b.p_staff_id) || this.roster.get(b.p_staff_id).roster_status !== "scheduled") fail("员工没有有效排班");
      this.putNotArrived(b.p_staff_id); const s = this.state(b.p_staff_id); if (s.status !== "not_arrived") fail("只有未到岗人员可确认");
      const type = b.p_assignment_type || b.p_type, position = b.p_position_id || b.p_position, areaCode = b.p_area_code || b.p_area;
      s.status = "on_duty"; s.status_since = iso();
      if (name === "rpc_live_late_arrival" && type === "position" && safety.has(position)) { s.current_assignment_type = "in_transit"; s.target_position_id = position; }
      else this.setAssignment(b.p_staff_id, type, position, areaCode);
      return null;
    }
    if (name === "rpc_start_today_monitoring") { if (this.phase !== "not_started" || !this.mode) fail("请先选择模式并准备人员"); this.phase = "monitoring"; this.startedAt = iso(); for (const p of this.positions) if (p.expected_open && !this.occupant(p.position_id)) p.vacant_since = this.startedAt; return null; }
    if (name === "rpc_live_add_reinforcement") { this.requireMonitoring(); this.putRoster(b.p_staff_id, b); this.putNotArrived(b.p_staff_id); return null; }
    if (name === "rpc_live_begin_transfer") { this.requireMonitoring(); const s = this.state(b.p_staff_id); if (s.status !== "on_duty") fail("只有在岗人员可调岗"); if (b.p_type === "position" && safety.has(b.p_position)) fail("安全关键岗必须先发起交接，再由接岗人本人点击开始前往"); if (s.current_position_id && safety.has(s.current_position_id) && this.position(s.current_position_id).expected_open) fail("在用安全岗不能普通调岗"); s.current_assignment_type = b.p_type === "mobile_pool" ? "mobile_pool" : "in_transit"; s.current_position_id = null; s.current_area_code = null; s.target_position_id = b.p_type === "position" ? b.p_position : null; s.target_area_code = b.p_type === "area_standby" ? b.p_area : null; return null; }
    if (name === "rpc_live_finish_transfer") { this.requireMonitoring(); const s = this.state(b.p_staff_id); if (s.current_assignment_type !== "in_transit" || this.activeHandoff(b.p_staff_id)) fail("员工当前不在普通调岗途中"); this.setAssignment(b.p_staff_id, s.target_position_id ? "position" : "area_standby", s.target_position_id, s.target_area_code); return null; }
    if (name === "rpc_live_start_break") { this.requireMonitoring(); const s = this.state(b.p_staff_id); if (s.status !== "on_duty" || s.current_assignment_type === "in_transit") fail("只有实际在岗可离岗"); if (s.current_position_id && safety.has(s.current_position_id) && this.position(s.current_position_id).expected_open) fail("在用安全关键岗必须先完成双确认交接"); if (!["meal", "short_leave"].includes(b.p_break)) fail("无效离岗状态"); s.return_assignment_type = s.current_assignment_type; s.return_position_id = s.current_position_id; s.return_area_code = s.current_area_code; s.status = b.p_break; s.status_since = iso(); s.current_assignment_type = "none"; s.current_position_id = null; s.current_area_code = null; return null; }
    if (name === "rpc_live_return_from_break") { this.requireMonitoring(); const s = this.state(b.p_staff_id); if (!["meal", "short_leave"].includes(s.status)) fail("只有吃饭或短离可返岗"); const type = b.p_type || s.return_assignment_type, position = b.p_position || s.return_position_id, areaCode = b.p_area || s.return_area_code; if (type === "position" && safety.has(position)) fail("安全关键岗返岗必须经过双确认"); s.status = "on_duty"; s.status_since = iso(); this.setAssignment(b.p_staff_id, type, position, areaCode); s.return_assignment_type = "none"; s.return_position_id = null; s.return_area_code = null; return null; }
    if (name === "rpc_live_end_shift") { this.requireMonitoring(); const s = this.state(b.p_staff_id); if (s.status === "not_arrived" || this.activeHandoff(b.p_staff_id)) fail("未到岗或交接中不能下班"); if (s.current_position_id && safety.has(s.current_position_id) && this.position(s.current_position_id).expected_open) fail("仍正式占据在用安全关键岗；先完成交接或受控暂停项目"); s.status = "off_duty"; s.status_since = iso(); s.current_assignment_type = "none"; s.current_position_id = null; s.current_area_code = null; return null; }
    if (name === "rpc_live_set_position_open") { this.requireMonitoring(); if (!b.p_reason) fail("必须填写原因"); const p = this.position(b.p_position); if ([...this.handoffs.values()].some(h => h.position_id === p.position_id && !["cancelled", "completed"].includes(h.stage))) fail("岗位有未完成交接"); p.expected_open = b.p_open; p.exception_reason = p.expected_open === p.template_expected_open ? null : b.p_reason; p.vacant_since = p.expected_open && !this.occupant(p.position_id) ? iso() : null; return null; }
    if (name === "rpc_live_request_handoff") { this.requireMonitoring(); if (b.p_flow === "leave" && ["meal", "short_leave"].includes(b.p_action) && actor.id !== b.p_outgoing) fail("饭休或短离交接须当前占岗人本人发起"); if (b.p_flow === "return" && actor.id !== b.p_incoming) fail("返岗交接须返岗人本人发起"); if (b.p_flow === "gap") { const incomingState = this.state(b.p_incoming); if (!(actor.id === b.p_incoming && incomingState.status === "short_leave" && incomingState.return_position_id === b.p_position)) this.requireManager(actor); if (this.occupant(b.p_position)) fail("该岗位已有正式占岗人，不能走空岗补位"); } if (b.p_action === "transfer" || b.p_action === "end_cover") this.requireManager(actor); if (!this.roster.has(b.p_incoming)) fail("接岗人没有今日排班"); const p = this.position(b.p_position); if (!p.is_safety_critical) fail("只允许安全关键岗双确认"); if (b.p_flow !== "gap" && this.occupant(b.p_position)?.staff_id !== b.p_outgoing) fail("原占岗人不符"); const id = `handoff-${++this.handoffSequence}`; this.handoffs.set(id, { handoff_id: id, position_id: b.p_position, flow: b.p_flow, requested_action: b.p_action, outgoing_staff_id: b.p_outgoing || null, incoming_staff_id: b.p_incoming, stage: "awaiting_incoming", requested_at: iso(), incoming_departed_at: null, incoming_confirmed_at: null, short_leave_override_approved: false, incoming_origin: structuredClone(this.states.get(b.p_incoming)) }); return id; }
    if (name === "rpc_live_begin_handoff_trip") { this.requireMonitoring(); const h = this.handoffs.get(b.p_handoff_id); if (!h || h.stage !== "awaiting_incoming" || h.incoming_staff_id !== actor.id) fail("只能由接岗人本人点击开始前往"); const s = this.state(actor.id); if (s.status === "on_duty") { s.current_assignment_type = "in_transit"; s.current_position_id = null; s.current_area_code = null; s.target_position_id = h.position_id; } h.stage = "in_transit"; h.incoming_departed_at = iso(); return null; }
    if (name === "rpc_live_confirm_handoff_arrival") { this.requireMonitoring(); const h = this.handoffs.get(b.p_handoff_id); if (!h || h.stage !== "in_transit" || h.incoming_staff_id !== actor.id) fail("只能由接岗人本人确认到位"); h.stage = "awaiting_outgoing"; h.incoming_confirmed_at = iso(); return null; }
    if (name === "rpc_live_approve_short_leave_shortfall") { this.requireMonitoring(); const h = this.handoffs.get(b.p_handoff_id); if (!h || h.requested_action !== "short_leave" || !b.p_reason) fail("无效短离批准"); h.short_leave_override_approved = true; h.short_leave_override_reason = b.p_reason; return null; }
    if (name === "rpc_live_finalize_handoff") { this.requireMonitoring(); const h = this.handoffs.get(b.p_handoff_id); if (!h || h.stage !== "awaiting_outgoing") fail("接岗人尚未确认到位"); if (h.flow === "gap") this.requireManager(actor); else if (h.outgoing_staff_id !== actor.id) fail("必须由原占岗人本人确认交接完成"); const incoming = this.state(h.incoming_staff_id); if (h.flow === "leave") { const outgoing = this.state(h.outgoing_staff_id); if (["meal", "short_leave"].includes(h.requested_action)) { outgoing.status = h.requested_action; outgoing.status_since = iso(); outgoing.return_assignment_type = "position"; outgoing.return_position_id = h.position_id; outgoing.current_assignment_type = "none"; outgoing.current_position_id = null; } else { outgoing.current_assignment_type = "mobile_pool"; outgoing.current_position_id = null; } } if (h.flow === "return") { const outgoing = this.state(h.outgoing_staff_id); outgoing.current_assignment_type = "mobile_pool"; outgoing.current_position_id = null; incoming.status = "on_duty"; incoming.return_assignment_type = "none"; incoming.return_position_id = null; } incoming.status = "on_duty"; if (h.flow === "leave" && ["meal", "short_leave"].includes(h.requested_action)) incoming.cover_for_staff_id = h.outgoing_staff_id; if (h.flow === "return") this.state(h.outgoing_staff_id).cover_for_staff_id = null; if (h.flow === "gap") { incoming.return_assignment_type = "none"; incoming.return_position_id = null; incoming.return_area_code = null; } incoming.current_assignment_type = "position"; incoming.current_position_id = h.position_id; incoming.target_position_id = null; h.stage = "completed"; this.position(h.position_id).vacant_since = null; return null; }
    if (name === "rpc_live_cancel_handoff") { this.requireMonitoring(); const h = this.handoffs.get(b.p_handoff_id); if (!h || !b.p_reason || h.stage === "completed") fail("已完成交接不能取消，或未填写原因"); if (h.stage !== "awaiting_incoming") { const origin = h.incoming_origin; const restoreType = b.p_incoming_type || origin?.current_assignment_type || "mobile_pool"; const restorePosition = b.p_incoming_position || origin?.current_position_id || null; const restoreArea = b.p_incoming_area || origin?.current_area_code || null; if (restoreType === "position" && safety.has(restorePosition)) fail("取消后不能直接转入另一个安全岗"); this.setAssignment(h.incoming_staff_id, restoreType, restorePosition, restoreArea); this.state(h.incoming_staff_id).target_position_id = null; } h.stage = "cancelled"; return null; }
    if (name === "rpc_temp_staff_create") { if (!["not_started", "monitoring"].includes(this.phase)) fail("今日营业已结束"); if (!b.p_request_id) fail("缺少请求编号"); if (this.requests.has(b.p_request_id)) return this.requests.get(b.p_request_id); this.tempSequence++; const id = `TMP${this.day.replaceAll("-", "")}-${String(this.tempSequence).padStart(2, "0")}`; this.staff.push({ id, name: b.p_name, department: "现场运营部", role: "staff", employment_type: "temporary_part_time", active: true }); this.putRoster(id, b); this.putNotArrived(id); const result = { staff_id: id, name: b.p_name, roster_status: "scheduled", state_status: "not_arrived", record_action: "new", qualification_count: 19 }; this.requests.set(b.p_request_id, result); return result; }
    if (name === "rpc_temp_staff_reuse") { if (!["not_started", "monitoring"].includes(this.phase)) fail("今日营业已结束"); const staff = this.member(b.p_staff_id); if (!staff.active && !b.p_reactivate_inactive) fail("历史临时兼职已停用，必须明确重新启用"); staff.active = true; this.putRoster(staff.id, b); this.putNotArrived(staff.id); return { staff_id: staff.id, name: staff.name, roster_status: "scheduled", state_status: "not_arrived", record_action: "reuse", reactivated: Boolean(b.p_reactivate_inactive) }; }
    if (name === "rpc_emergency_real_departure") { this.requireMonitoring(); if (!b.p_reason || !b.p_actual_at) fail("异常真实离岗必须填写原因与实际发生时间"); const s = this.state(b.p_staff_id); if (s.current_position_id) this.position(s.current_position_id).vacant_since = iso(); if (b.p_final_status === "short_leave") { s.return_assignment_type = s.current_assignment_type; s.return_position_id = s.current_position_id; s.return_area_code = s.current_area_code; } s.status = b.p_final_status; s.status_since = b.p_actual_at; s.current_assignment_type = "none"; s.current_position_id = null; s.current_area_code = null; for (const h of this.handoffs.values()) if ([h.incoming_staff_id, h.outgoing_staff_id].includes(s.staff_id) && !["completed", "cancelled"].includes(h.stage)) h.stage = "cancelled"; return null; }
    if (name === "rpc_end_business_day") { this.requireMonitoring(); if ([...this.handoffs.values()].some(h => !["completed", "cancelled"].includes(h.stage)) || [...this.states.values()].some(s => ["on_duty", "meal", "short_leave"].includes(s.status))) fail("仍有员工在岗、吃饭、短离或交接中，不能正常结束营业"); this.phase = "ended"; this.endedAt = iso(); return null; }
    fail(`模拟接口未实现：${name}`);
  }
  overview() {
    const scheduled = [...this.roster.values()].filter(r => r.roster_status === "scheduled");
    const states = scheduled.map(r => this.states.get(r.staff_id));
    return { business_day: this.day, prepared: this.phase !== "not_prepared", phase: this.phase, operation_mode: this.mode,
      monitoring_active: this.phase === "monitoring", monitoring_started_at: this.startedAt || null, monitoring_ended_at: this.endedAt || null,
      scheduled_count: scheduled.length, not_arrived_count: states.filter(s => !s || s.status === "not_arrived").length,
      on_duty_count: states.filter(s => s?.status === "on_duty" && ["position", "area_standby", "mobile_pool"].includes(s.current_assignment_type)).length,
      meal_count: states.filter(s => s?.status === "meal").length, short_leave_count: states.filter(s => s?.status === "short_leave").length,
      off_duty_count: states.filter(s => s?.status === "off_duty").length, in_transit_count: states.filter(s => s?.current_assignment_type === "in_transit").length,
      pending_handoff_count: [...this.handoffs.values()].filter(h => !["completed", "cancelled"].includes(h.stage)).length };
  }
  todayStaff() {
    return [...this.roster.values()].map(r => {
      const a = this.member(r.staff_id), s = this.states.get(r.staff_id);
      return { staff_id: a.id, name: a.name, department: a.department, role: a.role, employment_type: a.employment_type, active: a.active,
        ...r, status: s?.status || null, status_display: r.roster_status === "cancelled" ? "排班已取消" : s?.status === "not_arrived" ? "未到岗" : s?.status === "on_duty" ? s.current_assignment_type === "in_transit" ? "前往中" : "在岗" : s?.status === "meal" ? "吃饭" : s?.status === "short_leave" ? "短时离岗" : s?.status === "off_duty" ? "已下班" : "状态待初始化",
        status_since: s?.status_since || null, current_assignment_type: s?.current_assignment_type || null,
        current_position_id: s?.current_position_id || null, current_position_name: names[s?.current_position_id] || null,
        current_area_code: s?.current_area_code || null, target_position_id: s?.target_position_id || null, target_position_name: names[s?.target_position_id] || null, target_area_code: s?.target_area_code || null,
        return_assignment_type: s?.return_assignment_type || null, return_position_id: s?.return_position_id || null, return_position_name: names[s?.return_position_id] || null, return_area_code: s?.return_area_code || null,
        is_temporary_cover: Boolean(s?.cover_for_staff_id), cover_for_staff_id: s?.cover_for_staff_id || null, cover_for_staff_name: this.staff.find(x => x.id === s?.cover_for_staff_id)?.name || null,
        has_pending_handoff: this.activeHandoff(a.id) };
    });
  }
  todayPositions() {
    return this.positions.map(p => {
      const occupant = this.occupant(p.position_id), vacant = this.phase === "monitoring" && p.expected_open === true && !occupant;
      return { ...p, current_staff_id: occupant?.staff_id || null, current_staff_name: this.staff.find(x => x.id === occupant?.staff_id)?.name || null,
        vacant_since: p.vacant_since, vacant_minutes: p.vacant_since ? Math.max(0, Math.floor((Date.now() - new Date(p.vacant_since).getTime()) / 60000)) : null,
        is_vacant: vacant, is_safety_red_gap: vacant && p.is_safety_critical,
        pending_handoff_id: [...this.handoffs.values()].find(h => h.position_id === p.position_id && !["completed", "cancelled"].includes(h.stage))?.handoff_id || null };
    });
  }
  coverage() {
    if (!this.mode) return [];
    return baseCoverage[this.mode].map(([code, minimum, target]) => {
      const count = [...this.states.values()].filter(s => s.status === "on_duty" && (code === "global" ? s.current_assignment_type === "mobile_pool" : s.current_assignment_type === "area_standby" && s.current_area_code === code || s.current_assignment_type === "position" && area[s.current_position_id] === code)).length;
      return { scope_type: code === "global" ? "mobile_pool" : "area", scope_code: code, minimum_coverage: minimum, target_coverage: target, current_count: count, minimum_deficit: Math.max(0, minimum - count), target_deficit: Math.max(0, target - count), business_level: this.phase !== "monitoring" ? null : count < minimum ? "below_minimum" : count < target ? "tight" : "normal" };
    });
  }
  alerts() {
    if (this.phase !== "monitoring") return { business_day: this.day, phase: this.phase, alerts: [], alert_count: 0 };
    const vacancies = this.todayPositions().filter(p => p.is_safety_red_gap).map(p => ({ kind: "safety_position_vacant", position_id: p.position_id, position_name: p.name, area_code: p.area_code, vacant_since: p.vacant_since, vacant_minutes: p.vacant_minutes, last_occupant_name: null }));
    const deficits = this.coverage().filter(c => c.scope_type === "area" && c.business_level === "below_minimum").map(c => ({ kind: "area_below_minimum", area_code: c.scope_code, current_count: c.current_count, minimum_coverage: c.minimum_coverage, deficit: c.minimum_deficit }));
    const alerts = [...vacancies, ...deficits]; return { business_day: this.day, phase: this.phase, alerts, alert_count: alerts.length };
  }
  todayHandoffs(actor) {
    return [...this.handoffs.values()].filter(h => !["completed", "cancelled"].includes(h.stage)).map(h => ({ ...h, position_name: names[h.position_id], outgoing_staff_name: this.staff.find(x => x.id === h.outgoing_staff_id)?.name || null, incoming_staff_name: this.staff.find(x => x.id === h.incoming_staff_id)?.name || null,
      stage_display: h.stage === "awaiting_incoming" ? "等待接岗人出发" : h.stage === "in_transit" ? "接岗人前往中" : h.flow === "gap" ? "接岗人已到位，等待管理人员确认补岗" : "接岗人已到位，等待原岗确认",
      next_action: h.stage === "awaiting_incoming" ? "begin_trip" : h.stage === "in_transit" ? "confirm_arrival" : "finalize",
      next_actor_type: h.stage === "awaiting_outgoing" && h.flow === "gap" ? "manager" : "staff",
      next_actor_staff_id: h.stage === "awaiting_outgoing" ? h.outgoing_staff_id : h.incoming_staff_id,
      can_current_actor_act_next: h.stage === "awaiting_outgoing" ? h.flow === "gap" ? actor.role !== "staff" : h.outgoing_staff_id === actor.id : h.incoming_staff_id === actor.id }));
  }
  candidates(positionId) {
    const p = this.position(positionId);
    return [...this.roster.values()].filter(r => r.roster_status === "scheduled").map(r => {
      const staff = this.member(r.staff_id), state = this.states.get(staff.id);
      const reason = !staff.active ? "人员已停用" : !state || state.status === "not_arrived" ? "未到岗" : state.status !== "on_duty" ? "当前不可工作" : this.activeHandoff(staff.id) ? "正在安全交接" : state.current_position_id && safety.has(state.current_position_id) ? "仍占安全关键岗" : null;
      return { staff_id: staff.id, name: staff.name, status: state?.status || null, current_assignment_type: state?.current_assignment_type || null, current_position_id: state?.current_position_id || null, current_area_code: state?.current_area_code || null, has_required_assignment_permission: !p.requires_qualification || staff.active, has_pending_handoff: this.activeHandoff(staff.id), is_temporary_cover: Boolean(state?.cover_for_staff_id), eligible: !reason, ineligible_reason: reason };
    });
  }
  myState(actor) {
    const row = this.todayStaff().find(x => x.staff_id === actor.id);
    const tasks = this.todayHandoffs(actor).filter(h => [h.incoming_staff_id, h.outgoing_staff_id].includes(actor.id)).map(h => ({ ...h, counterparty_name: this.staff.find(x => x.id === (h.incoming_staff_id === actor.id ? h.outgoing_staff_id : h.incoming_staff_id))?.name || null, can_i_act_next: h.can_current_actor_act_next }));
    return { business_day: this.day, phase: this.phase, staff_id: actor.id, name: actor.name, roster_status: row?.roster_status || null,
      scheduled_start_time: row?.scheduled_start_time || null, scheduled_end_time: row?.scheduled_end_time || null,
      status: row?.status || null, status_since: row?.status_since || null, status_duration_minutes: row?.status_since ? Math.max(0, Math.floor((Date.now() - new Date(row.status_since).getTime()) / 60000)) : null,
      current_assignment_type: row?.current_assignment_type || null, current_position_id: row?.current_position_id || null, current_position_name: row?.current_position_name || null, current_area_code: row?.current_area_code || null,
      target_position_id: row?.target_position_id || null, target_position_name: row?.target_position_name || null, target_area_code: row?.target_area_code || null,
      return_assignment_type: row?.return_assignment_type || null, return_position_id: row?.return_position_id || null, return_area_code: row?.return_area_code || null,
      my_handoffs: tasks };
  }
}
