import assert from "node:assert/strict";
import { WorkflowMock } from "./workflow-mock.mjs";

const iso = (hour) => new Date(Date.now() + hour * 3600_000).toISOString();
const run = (mock, staffId, name, fields = {}) => mock.rpc(name, { p_session_token: `${staffId}-token`, ...fields });
const manager = (mock, name, fields) => run(mock, "FT001", name, fields);
const roster = (mock, id) => manager(mock, "rpc_save_today_roster", {
  p_staff_id: id, p_scheduled_start: iso(-1), p_scheduled_end: iso(9)
});
const arrive = (mock, id, type, position = null, area = null) => manager(mock, "rpc_confirm_today_arrival", {
  p_staff_id: id, p_assignment_type: type, p_position_id: position, p_area_code: area
});
const prepare = (mock, mode, people) => {
  manager(mock, "rpc_prepare_today");
  manager(mock, "rpc_select_today_mode", { p_mode: mode });
  people.forEach(id => roster(mock, id));
  assert.equal(manager(mock, "rpc_initialize_today_not_arrived"), people.length);
  assert.equal(manager(mock, "rpc_initialize_today_not_arrived"), 0, "重复初始化必须安全");
};
let checks = 0;
const check = (name, fn) => { fn(); checks++; process.stdout.write(`通过：${name}\n`); };

const day = new WorkflowMock();
check("准备营业日、选模式、排班、未到岗幂等", () => {
  prepare(day, "green", ["FT001", "FT002", "FT003"]);
  assert.equal(manager(day, "rpc_today_overview").phase, "not_started");
  assert.equal(manager(day, "rpc_today_staff").length, 3);
});
check("到岗必须有实际安排，开园后才有实时告警", () => {
  arrive(day, "FT001", "mobile_pool");
  arrive(day, "FT002", "position", "sale1");
  arrive(day, "FT003", "position", "sale2");
  assert.equal(manager(day, "rpc_today_alerts").alert_count, 0);
  manager(day, "rpc_start_today_monitoring");
  assert.equal(manager(day, "rpc_today_overview").phase, "monitoring");
  assert.throws(() => manager(day, "rpc_start_today_monitoring"));
});
check("普通调岗在途只计一次，安全岗目标被拒绝", () => {
  assert.throws(() => manager(day, "rpc_live_begin_transfer", { p_staff_id: "FT003", p_type: "position", p_position: "plum", p_area: null }), /安全关键岗/);
  manager(day, "rpc_live_begin_transfer", { p_staff_id: "FT003", p_type: "position", p_position: "sale3", p_area: null });
  assert.equal(day.state("FT003").current_assignment_type, "in_transit");
  assert.equal(day.state("FT003").current_position_id, null);
  assert.equal(day.state("FT003").target_position_id, "sale3");
  manager(day, "rpc_live_finish_transfer", { p_staff_id: "FT003" });
  assert.equal(day.state("FT003").current_position_id, "sale3");
});
check("吃饭和短离不计覆盖，返岗恢复本次位置", () => {
  manager(day, "rpc_live_start_break", { p_staff_id: "FT001", p_break: "meal", p_confirm_short_leave_shortfall: false, p_reason: null });
  assert.equal(day.state("FT001").current_assignment_type, "none");
  assert.equal(day.state("FT001").return_assignment_type, "mobile_pool");
  manager(day, "rpc_live_return_from_break", { p_staff_id: "FT001", p_type: null, p_position: null, p_area: null });
  assert.equal(day.state("FT001").current_assignment_type, "mobile_pool");
  manager(day, "rpc_live_start_break", { p_staff_id: "FT003", p_break: "short_leave", p_confirm_short_leave_shortfall: false, p_reason: null });
  assert.equal(day.state("FT003").return_position_id, "sale3");
  manager(day, "rpc_live_return_from_break", { p_staff_id: "FT003", p_type: null, p_position: null, p_area: null });
  assert.equal(day.state("FT003").current_position_id, "sale3");
});
check("正常下班与闭店，结束后现场写入拒绝", () => {
  for (const id of ["FT001", "FT002", "FT003"]) manager(day, "rpc_live_end_shift", { p_staff_id: id, p_confirm_shortfall: false });
  manager(day, "rpc_end_business_day");
  assert.equal(manager(day, "rpc_today_overview").phase, "ended");
  assert.equal(manager(day, "rpc_today_alerts").alert_count, 0);
  assert.throws(() => manager(day, "rpc_live_begin_transfer", { p_staff_id: "FT002", p_type: "mobile_pool" }), /不是营业监控阶段/);
});

const safety = new WorkflowMock();
check("安全岗四阶段：未正式交接前保留原占岗", () => {
  prepare(safety, "yellow", ["FT001", "FT002", "FT003"]);
  arrive(safety, "FT001", "mobile_pool");
  arrive(safety, "FT002", "position", "plum");
  arrive(safety, "FT003", "mobile_pool");
  manager(safety, "rpc_start_today_monitoring");
  const handoffId = run(safety, "FT002", "rpc_live_request_handoff", {
    p_flow: "leave", p_action: "meal", p_position: "plum", p_outgoing: "FT002", p_incoming: "FT003",
    p_next_type: null, p_next_position: null, p_next_area: null
  });
  assert.equal(safety.handoffs.get(handoffId).stage, "awaiting_incoming");
  assert.equal(safety.occupant("plum").staff_id, "FT002");
  run(safety, "FT003", "rpc_live_begin_handoff_trip", { p_handoff_id: handoffId });
  assert.equal(safety.state("FT003").current_assignment_type, "in_transit");
  assert.equal(safety.occupant("plum").staff_id, "FT002");
  run(safety, "FT003", "rpc_live_confirm_handoff_arrival", { p_handoff_id: handoffId });
  assert.equal(safety.occupant("plum").staff_id, "FT002");
  assert.throws(() => manager(safety, "rpc_live_finalize_handoff", { p_handoff_id: handoffId }), /原占岗人本人/);
  run(safety, "FT002", "rpc_live_finalize_handoff", { p_handoff_id: handoffId });
  assert.equal(safety.state("FT002").status, "meal");
  assert.equal(safety.occupant("plum").staff_id, "FT003");
});
check("安全岗返岗必须重新交接，临时接岗人恢复机动", () => {
  const id = run(safety, "FT002", "rpc_live_request_handoff", {
    p_flow: "return", p_action: "return", p_position: "plum", p_outgoing: "FT003", p_incoming: "FT002",
    p_next_type: null, p_next_position: null, p_next_area: null
  });
  run(safety, "FT002", "rpc_live_begin_handoff_trip", { p_handoff_id: id });
  run(safety, "FT002", "rpc_live_confirm_handoff_arrival", { p_handoff_id: id });
  run(safety, "FT003", "rpc_live_finalize_handoff", { p_handoff_id: id });
  assert.equal(safety.occupant("plum").staff_id, "FT002");
  assert.equal(safety.state("FT003").current_assignment_type, "mobile_pool");
});
check("交接取消保留阶段，已出发者恢复原实际分配", () => {
  const id = manager(safety, "rpc_live_request_handoff", {
    p_flow: "leave", p_action: "transfer", p_position: "plum", p_outgoing: "FT002", p_incoming: "FT003",
    p_next_type: "area_standby", p_next_position: null, p_next_area: "high_altitude"
  });
  manager(safety, "rpc_live_cancel_handoff", { p_handoff_id: id, p_incoming_type: null, p_incoming_position: null, p_incoming_area: null, p_reason: "现场改派" });
  assert.equal(safety.state("FT003").current_assignment_type, "mobile_pool");
  const id2 = manager(safety, "rpc_live_request_handoff", {
    p_flow: "leave", p_action: "transfer", p_position: "plum", p_outgoing: "FT002", p_incoming: "FT003",
    p_next_type: "area_standby", p_next_position: null, p_next_area: "high_altitude"
  });
  run(safety, "FT003", "rpc_live_begin_handoff_trip", { p_handoff_id: id2 });
  manager(safety, "rpc_live_cancel_handoff", { p_handoff_id: id2, p_incoming_type: null, p_incoming_position: null, p_incoming_area: null, p_reason: "现场改派" });
  assert.equal(safety.state("FT003").current_assignment_type, "mobile_pool");
});
check("岗位暂停/恢复和店长单次临时 PIN", () => {
  manager(safety, "rpc_live_set_position_open", { p_position: "expand6", p_open: false, p_reason: "拓展组轮餐，三楼索道临时暂停" });
  assert.equal(safety.position("expand6").expected_open, false);
  manager(safety, "rpc_live_set_position_open", { p_position: "expand6", p_open: true, p_reason: "轮餐结束" });
  assert.equal(safety.position("expand6").expected_open, true);
  assert.equal(manager(safety, "pin_manager_issue_temp", { p_target_staff_id: "FT003" }).temporary_pin, "654321");
  assert.throws(() => run(safety, "FT003", "pin_manager_issue_temp", { p_target_staff_id: "FT002" }), /权限/);
});
check("异常真实离岗清理真实占岗和交接", () => {
  const id = manager(safety, "rpc_live_request_handoff", {
    p_flow: "leave", p_action: "transfer", p_position: "plum", p_outgoing: "FT002", p_incoming: "FT003",
    p_next_type: "area_standby", p_next_position: null, p_next_area: "high_altitude"
  });
  manager(safety, "rpc_emergency_real_departure", { p_staff_id: "FT002", p_final_status: "off_duty", p_reason: "突发身体不适", p_actual_at: iso(0) });
  assert.equal(safety.occupant("plum"), undefined);
  assert.equal(safety.handoffs.get(id).stage, "cancelled");
  assert.equal(safety.todayPositions().find(p => p.position_id === "plum").is_safety_red_gap, true);
});

const temporary = new WorkflowMock();
check("临时兼职新建同一请求幂等、复用历史 inactive 须确认", () => {
  manager(temporary, "rpc_prepare_today");
  const request = { p_name: "今日临时员工", p_scheduled_start: iso(-1), p_scheduled_end: iso(9), p_confirm_new_person: true, p_request_id: crypto.randomUUID() };
  const created = manager(temporary, "rpc_temp_staff_create", request);
  assert.match(created.staff_id, /^TMP\d{8}-\d{2}$/);
  assert.equal(manager(temporary, "rpc_temp_staff_create", request).staff_id, created.staff_id);
  assert.equal(temporary.state(created.staff_id).status, "not_arrived");
  assert.throws(() => manager(temporary, "rpc_temp_staff_reuse", { p_staff_id: "TMP20261001-01", p_scheduled_start: iso(-1), p_scheduled_end: iso(9), p_reactivate_inactive: false }), /重新启用/);
  manager(temporary, "rpc_temp_staff_reuse", { p_staff_id: "TMP20261001-01", p_scheduled_start: iso(-1), p_scheduled_end: iso(9), p_reactivate_inactive: true });
  assert.equal(temporary.state("TMP20261001-01").status, "not_arrived");
});

process.stdout.write(`\n模拟流程验收：${checks} 组通过。未访问 Supabase。\n`);
