import assert from 'node:assert/strict';
import { chromium, launchOptions } from './browser.mjs';
import { WorkflowMock } from './workflow-mock.mjs';

const browser = await chromium.launch({ headless: true, ...launchOptions });
const base = process.env.SB_TEST_BASE || 'http://127.0.0.1:8770/';
const mock = new WorkflowMock();
const calls = [];
const pageErrors = [];
const denied = new Set();
let groups = 0;
const pass = text => { groups++; console.log(`016 通过 ${groups}: ${text}`); };
const manager = (name, params = {}) => mock.rpc(name, { p_session_token: 'FT001-token', ...params });
const range = { p_scheduled_start: new Date(Date.now() - 3600_000).toISOString(), p_scheduled_end: new Date(Date.now() + 9 * 3600_000).toISOString() };

manager('rpc_prepare_today');
manager('rpc_select_today_mode', { p_mode: 'green' });
mock.staff.find(row => row.id === 'FT004').role = 'supervisor';
for (const row of mock.staff.filter(row => row.active)) manager('rpc_save_today_roster', { p_staff_id: row.id, ...range });
manager('rpc_initialize_today_not_arrived');
for (const [id, type, position, area] of [
  ['FT001', 'mobile_pool'], ['FT002', 'area_standby', null, 'front_hall'],
  ['FT003', 'position', 'plum'], ['FT004', 'area_standby', null, 'high_altitude']
]) manager('rpc_confirm_today_arrival', { p_staff_id: id, p_assignment_type: type, p_position_id: position, p_area_code: area });
mock.position('plum').expected_open = true;
mock.position('slide').expected_open = true;
manager('rpc_start_today_monitoring');

function resetManagerAssignment() {
  const state = mock.state('FT001');
  Object.assign(state, { status: 'on_duty', current_assignment_type: 'mobile_pool', current_position_id: null, current_area_code: null, target_position_id: null, target_area_code: null });
}
function callCount(name) { return calls.filter(row => row.name === name).length; }
const dialog = page => page.getByRole('dialog');

async function openPage(id = 'FT001') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const params = route.request().postDataJSON();
    calls.push({ name, params: structuredClone(params) });
    try {
      let result = mock.rpc(name, params);
      if (name === 'rpc_position_candidates' && denied.has(params.p_position_id)) {
        result = result.map(item => item.staff_id === 'FT001' ? { ...item, has_required_assignment_permission: false, eligible: false, ineligible_reason: '缺少可安排关系' } : item);
      }
      if (name.startsWith('rpc_') && result === null) return route.fulfill({ status: 200, body: '' });
      return route.fulfill({ status: 200, json: result });
    } catch (error) {
      return route.fulfill({ status: error.code === '42501' ? 403 : 400, json: { message: error.message, code: error.code || 'P0001' } });
    }
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#identifier').fill(id);
  await page.locator('#pin').fill('123456');
  await page.locator('#loginSubmit').click();
  await page.locator('#dashboardView').waitFor({ state: 'visible' });
  return { context, page };
}

async function refresh(page) {
  await page.locator('#refreshButton').click();
  await page.waitForTimeout(180);
}
async function openTransfer(page, staffId = 'FT001') {
  await page.locator('[data-page="staff"]').click();
  await page.locator(`[data-staff-id="${staffId}"]`).getByRole('button', { name: '操作', exact: true }).click();
  await dialog(page).getByRole('button', { name: '调岗', exact: true }).click();
  await dialog(page).locator('[name="assignmentType"]').selectOption('position');
}
async function choose(page, positionId) {
  await dialog(page).locator('[name="position"]').selectOption(positionId);
  await dialog(page).locator('[data-candidate-hint]').getByText(/可独立安排|没有此岗位/).waitFor();
}

const contexts = [];
try {
  const first = await openPage(); contexts.push(first.context); const page = first.page;
  await openTransfer(page);
  const selector = dialog(page).locator('[name="position"]');
  assert.equal(await selector.locator('option:not([value=""])').count(), 29); pass('显示全部29个固定岗位');
  assert.equal(await selector.locator('optgroup').count(), 6); pass('固定岗位按六个区域分组');
  assert.match(await selector.locator('option[value="gate"]').textContent(), /今日未启用/); pass('未启用普通岗位仍显示');
  assert.match(await selector.locator('option[value="climb"]').textContent(), /安全岗.*今日未启用/); pass('未启用安全岗位仍显示');
  assert.equal(await selector.locator('option[value="plum"]').count(), 1); pass('已启用安全岗位不再隐藏');
  assert.equal(await selector.locator('option[value="m1"],option[value="m2"],option[value="floor2mobile"]').count(), 0); pass('三个机动资源位不伪装为固定岗位');
  await dialog(page).locator('[name="assignmentType"]').selectOption('mobile_pool');
  assert.match(await dialog(page).locator('.mobile-pool-note').innerText(), /全场机动.*统一记录/); pass('机动池说明真实反映当前模型');

  await dialog(page).locator('[name="assignmentType"]').selectOption('position');
  denied.add('gear1'); await choose(page, 'gear1');
  assert.match(await dialog(page).locator('[data-candidate-hint]').innerText(), /没有此岗位的可安排关系/);
  assert.equal(await dialog(page).locator('.primary-button').isDisabled(), true); pass('无可安排关系明确显示且禁止提交');
  denied.delete('gear1'); await choose(page, 'sale1');
  assert.match(await dialog(page).locator('[data-candidate-hint]').innerText(), /可独立安排/); pass('有可安排关系显示可提交状态');

  const ordinaryBefore = callCount('rpc_live_begin_transfer');
  await dialog(page).getByRole('button', { name: '开始前往', exact: true }).click();
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal(callCount('rpc_live_begin_transfer'), ordinaryBefore + 1);
  assert.equal(mock.state('FT001').target_position_id, 'sale1'); pass('已启用普通岗位调用普通调岗RPC');
  resetManagerAssignment(); await refresh(page);

  await openTransfer(page); await choose(page, 'gate');
  assert.equal(await dialog(page).getByRole('button', { name: '先恢复今日岗位', exact: true }).count(), 1); pass('未启用普通岗位先进入恢复步骤');
  const restoreTransferBefore = callCount('rpc_live_begin_transfer');
  await dialog(page).getByRole('button', { name: '先恢复今日岗位', exact: true }).click();
  await dialog(page).getByRole('button', { name: '确认恢复今日岗位', exact: true }).click();
  assert.match(await dialog(page).locator('.sheet-error').innerText(), /请填写原因/); pass('恢复岗位必须填写原因');
  await dialog(page).locator('[name="reason"]').fill('现场恢复入口服务');
  await dialog(page).getByRole('button', { name: '确认恢复今日岗位', exact: true }).click();
  await dialog(page).getByRole('button', { name: '开始调岗', exact: true }).waitFor();
  assert.equal(mock.position('gate').expected_open, true);
  assert.ok(calls.filter(row => row.name === 'rpc_today_positions').length >= 2); pass('恢复后重新读取最新岗位状态');
  assert.equal(callCount('rpc_live_begin_transfer'), restoreTransferBefore); pass('恢复成功不会静默自动调岗');
  await dialog(page).getByRole('button', { name: '开始调岗', exact: true }).click();
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal(callCount('rpc_live_begin_transfer'), restoreTransferBefore + 1); pass('恢复后由第二次明确操作开始调岗');
  resetManagerAssignment(); await refresh(page);

  const transferBeforeGap = callCount('rpc_live_begin_transfer');
  await openTransfer(page); await choose(page, 'slide');
  await dialog(page).getByRole('button', { name: '发起安全补岗', exact: true }).click();
  await dialog(page).getByRole('heading', { name: '淘气堡飞跃滑梯上口 · 安全补岗', exact: true }).waitFor();
  assert.match(await dialog(page).innerText(), /不能普通调岗/); pass('安全空岗进入补岗引导而非死路错误');
  await dialog(page).getByRole('button', { name: '发起安全补岗', exact: true }).click();
  await dialog(page).waitFor({ state: 'detached' });
  const gap = [...mock.handoffs.values()].find(item => item.position_id === 'slide' && item.stage === 'awaiting_incoming');
  assert.ok(gap && gap.flow === 'gap' && gap.requested_action === 'fill');
  assert.equal(callCount('rpc_live_begin_transfer'), transferBeforeGap); pass('安全空岗使用gap/fill且不调用普通调岗');
  assert.equal(mock.state('FT001').current_assignment_type, 'mobile_pool'); pass('交接发起后接岗人尚未出发，来源分配仍保留');
  assert.throws(() => mock.rpc('rpc_live_begin_handoff_trip', { p_session_token: 'FT004-token', p_handoff_id: gap.handoff_id }), /接岗人本人/); pass('非接岗人不能代替点击开始前往');
  mock.rpc('rpc_live_begin_handoff_trip', { p_session_token: 'FT001-token', p_handoff_id: gap.handoff_id });
  assert.equal(mock.state('FT001').current_assignment_type, 'in_transit'); pass('接岗人本人开始前往后才离开来源分配');
  assert.throws(() => mock.rpc('rpc_live_confirm_handoff_arrival', { p_session_token: 'FT004-token', p_handoff_id: gap.handoff_id }), /接岗人本人/);
  mock.rpc('rpc_live_confirm_handoff_arrival', { p_session_token: 'FT001-token', p_handoff_id: gap.handoff_id }); pass('只有接岗人本人可以确认到位');
  assert.equal(mock.occupant('slide'), undefined);
  mock.rpc('rpc_live_finalize_handoff', { p_session_token: 'FT004-token', p_handoff_id: gap.handoff_id });
  assert.equal(mock.occupant('slide').staff_id, 'FT001'); pass('空岗补位仅在管理人员最终确认后正式占岗');
  mock.setAssignment('FT001', 'mobile_pool', null, null); await refresh(page);

  const transferBeforeLeave = callCount('rpc_live_begin_transfer');
  await openTransfer(page); await choose(page, 'plum');
  await dialog(page).getByRole('button', { name: '进入安全岗交接', exact: true }).click();
  await dialog(page).getByRole('heading', { name: '梅花桩 · 安全岗换人', exact: true }).waitFor();
  assert.match(await dialog(page).innerText(), /当前由测试员工B值守/); pass('安全有人值守时识别真实outgoing');
  await dialog(page).getByRole('button', { name: '选择原占岗人交接后的去向', exact: true }).click();
  await dialog(page).locator('[name="assignmentType"]').selectOption('mobile_pool');
  await dialog(page).getByRole('button', { name: '确认安排', exact: true }).click();
  assert.match(await dialog(page).innerText(), /原占岗人交接后去向.*全场机动/s); pass('安全换人要求明确原占岗人下一去向');
  await dialog(page).getByRole('button', { name: '确认发起安全交接', exact: true }).click();
  await dialog(page).waitFor({ state: 'detached' });
  const leave = [...mock.handoffs.values()].find(item => item.position_id === 'plum' && item.stage === 'awaiting_incoming');
  const request = calls.filter(row => row.name === 'rpc_live_request_handoff').at(-1).params;
  assert.deepEqual([request.p_flow, request.p_action, request.p_outgoing, request.p_incoming, request.p_next_type], ['leave', 'transfer', 'FT003', 'FT001', 'mobile_pool']);
  assert.equal(callCount('rpc_live_begin_transfer'), transferBeforeLeave); pass('安全有人使用leave/transfer且不调用普通调岗');
  assert.equal(mock.occupant('plum').staff_id, 'FT003'); pass('交接完成前原占岗人继续正式值守');
  mock.rpc('rpc_live_begin_handoff_trip', { p_session_token: 'FT001-token', p_handoff_id: leave.handoff_id });
  mock.rpc('rpc_live_confirm_handoff_arrival', { p_session_token: 'FT001-token', p_handoff_id: leave.handoff_id });
  assert.throws(() => mock.rpc('rpc_live_finalize_handoff', { p_session_token: 'FT004-token', p_handoff_id: leave.handoff_id }), /原占岗人本人/);
  mock.rpc('rpc_live_finalize_handoff', { p_session_token: 'FT003-token', p_handoff_id: leave.handoff_id });
  assert.equal(mock.occupant('plum').staff_id, 'FT001'); pass('安全换岗最终确认仍由原占岗人本人完成');
  mock.setAssignment('FT001', 'mobile_pool', null, null); await refresh(page);

  const handoffBeforeRestore = callCount('rpc_live_request_handoff');
  await openTransfer(page); await choose(page, 'climb');
  await dialog(page).getByRole('button', { name: '先恢复安全岗', exact: true }).click();
  await dialog(page).locator('[name="reason"]').fill('现场恢复攀岩服务');
  await dialog(page).getByRole('button', { name: '确认恢复安全岗', exact: true }).click();
  await dialog(page).getByRole('button', { name: '发起安全补岗', exact: true }).waitFor();
  assert.equal(callCount('rpc_live_request_handoff'), handoffBeforeRestore); pass('未启用安全岗恢复后仍停在独立补岗确认');

  const beforeRefreshChoice = await dialog(page).innerText();
  await page.waitForTimeout(5200);
  assert.equal(await dialog(page).isVisible(), true);
  assert.equal(await dialog(page).innerText(), beforeRefreshChoice); pass('自动刷新不关闭或重建正在进行的引导');
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, panel: document.querySelector('.sheet-panel')?.getBoundingClientRect().width || 0 }));
  assert.ok(size.document <= size.viewport && size.panel <= size.viewport, JSON.stringify(size)); pass('390px岗位选择与引导无横向溢出');

  const yellow = new WorkflowMock(); yellow.rpc('rpc_prepare_today', { p_session_token: 'FT001-token' }); yellow.rpc('rpc_select_today_mode', { p_session_token: 'FT001-token', p_mode: 'yellow' });
  const yellowCoverage = yellow.coverage();
  assert.deepEqual([yellowCoverage.find(x => x.scope_code === 'high_altitude').minimum_coverage, yellowCoverage.find(x => x.scope_code === 'high_altitude').target_coverage], [6, 9]);
  assert.deepEqual([yellowCoverage.find(x => x.scope_code === 'high_expansion').minimum_coverage, yellowCoverage.find(x => x.scope_code === 'high_expansion').target_coverage], [4, 7]); pass('015黄灯覆盖基线保持6/9与4/7');
  const greenCoverage = mock.coverage();
  assert.deepEqual([greenCoverage.find(x => x.scope_code === 'front_hall').minimum_coverage, greenCoverage.find(x => x.scope_code === 'front_hall').target_coverage], [1, 2]); pass('015绿灯前厅覆盖基线保持1/2');
  assert.deepEqual(pageErrors, []); pass('专项流程无页面脚本异常');
  assert.ok(groups >= 24, `expected at least 24 groups, got ${groups}`);
  console.log(`016 人员调岗岗位选择：${groups}组检查通过（全部模拟接口，未访问生产库）。`);
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
