import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { chromium, launchOptions } from './browser.mjs';
const base = process.env.SB_TEST_BASE || 'http://127.0.0.1:8769/'; // Local workflow mock only.
const browser = await chromium.launch({ headless: true, ...launchOptions });
const errors = [];
const contexts = [];
const call = async (actor, name, data = {}) => {
  const response = await fetch(new URL(`rest/v1/rpc/${name}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_session_token: `${actor}-token`, ...data }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${name}: ${body.message}`);
  return body;
};
const start = new Date(Date.now() - 3600_000).toISOString();
const end = new Date(Date.now() + 9 * 3600_000).toISOString();
const reset = async staff => {
  await fetch(new URL('__scenario?mode=workflow', base));
  await call('FT001', 'rpc_prepare_today');
  await call('FT001', 'rpc_select_today_mode', { p_mode: 'yellow' });
  for (const id of staff) await call('FT001', 'rpc_save_today_roster', { p_staff_id: id, p_scheduled_start: start, p_scheduled_end: end });
  await call('FT001', 'rpc_initialize_today_not_arrived');
  for (const [id, position] of staff.map(id => [id, id === 'FT002' ? 'plum' : null]))
    await call('FT001', 'rpc_confirm_today_arrival', { p_staff_id: id, p_assignment_type: position ? 'position' : 'mobile_pool', p_position_id: position, p_area_code: null });
  await call('FT001', 'rpc_start_today_monitoring');
};
const open = async id => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#identifier').fill(id);
  await page.locator('#pin').fill('123456'); // Mock PIN, never production.
  await page.locator('#loginSubmit').click();
  await page.locator('#dashboardView').waitFor({ state: 'visible' });
  await page.locator('[data-page="my"]').click();
  return page;
};
const width = async (page, label) => {
  const data = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, sheet: document.querySelector('.sheet-panel')?.getBoundingClientRect().width || 0 }));
  assert.ok(data.document <= data.viewport && data.sheet <= data.viewport, `${label}: ${JSON.stringify(data)}`);
};
const clickTask = async (page, label) => {
  await page.locator('[data-my-handoff-id]').getByRole('button', { name: label, exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
};

try {
  // Occupied return: saved cover relationship is required; no outgoing ID entry.
  await reset(['FT001', 'FT002']);
  const leave = await call('FT002', 'rpc_live_request_handoff', { p_flow: 'leave', p_action: 'short_leave', p_position: 'plum', p_outgoing: 'FT002', p_incoming: 'FT001', p_next_type: null, p_next_position: null, p_next_area: null });
  await call('FT001', 'rpc_live_begin_handoff_trip', { p_handoff_id: leave });
  await call('FT001', 'rpc_live_confirm_handoff_arrival', { p_handoff_id: leave });
  await call('FT002', 'rpc_live_finalize_handoff', { p_handoff_id: leave });
  const cover = await call('FT002', 'rpc_my_return_position');
  assert.equal(cover.current_staff_id, 'FT001');
  assert.equal(cover.current_staff_covers_me, true);
  const returning = await open('FT002');
  await returning.getByRole('button', { name: '申请安全返岗交接' }).click();
  await returning.getByRole('dialog').getByText(/当前由.*顶岗/).waitFor();
  assert.equal(await returning.getByRole('dialog').locator('[name="outgoing"]').count(), 0);
  await width(returning, 'occupied return sheet');
  await returning.getByRole('dialog').getByRole('button', { name: '发起返岗交接' }).click();
  await returning.getByRole('dialog').waitFor({ state: 'detached' });
  let handoffs = await call('FT001', 'rpc_today_handoffs');
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].flow, 'return');
  assert.equal(handoffs[0].outgoing_staff_id, 'FT001');
  await clickTask(returning, '开始前往');
  await clickTask(returning, '我已到位');
  await call('FT001', 'rpc_live_finalize_handoff', { p_handoff_id: handoffs[0].handoff_id });
  assert.equal((await call('FT001', 'rpc_today_positions')).find(x => x.position_id === 'plum').current_staff_id, 'FT002');

  // Vacant return: ordinary employee starts gap/fill, management finalizes.
  await reset(['FT001', 'FT002']);
  await call('FT001', 'rpc_emergency_real_departure', { p_staff_id: 'FT002', p_final_status: 'short_leave', p_reason: '模拟突发短离', p_actual_at: new Date().toISOString() });
  assert.equal((await call('FT001', 'rpc_today_alerts')).alerts.some(x => x.kind === 'safety_position_vacant' && x.position_id === 'plum'), true);
  const manager = await open('FT001');
  await manager.locator('[data-page="staff"]').click();
  await manager.locator('[data-staff-id="FT002"]').getByRole('button', { name: '操作', exact: true }).click();
  await manager.getByRole('dialog').getByRole('button', { name: '通知员工本人发起安全返岗' }).waitFor();
  assert.equal(await manager.getByRole('dialog').getByRole('button', { name: '尝试返岗' }).count(), 0);
  await manager.getByRole('dialog').locator('.sheet-close').click();
  const employee = await open('FT002');
  await employee.getByRole('button', { name: '申请安全返岗交接' }).click();
  await employee.getByRole('dialog').getByText('梅花桩当前为空岗，将按安全空岗返岗流程处理。', { exact: false }).waitFor();
  assert.equal(await employee.getByRole('dialog').locator('[name="outgoing"]').count(), 0);
  await width(employee, 'vacant return sheet');
  await employee.getByRole('dialog').getByRole('button', { name: '发起空岗返岗' }).click();
  await employee.getByRole('dialog').waitFor({ state: 'detached' });
  handoffs = await call('FT001', 'rpc_today_handoffs');
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].flow, 'gap');
  assert.equal(handoffs[0].outgoing_staff_id, null);
  const wrong = await fetch(new URL('rest/v1/rpc/rpc_live_request_handoff', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_session_token: 'FT002-token', p_flow: 'return', p_action: 'return', p_position: 'plum', p_outgoing: 'FT001', p_incoming: 'FT002' }) });
  assert.equal(wrong.ok, false, 'wrong outgoing must be rejected');
  await clickTask(employee, '开始前往');
  await clickTask(employee, '我已到位');
  assert.equal((await call('FT001', 'rpc_today_positions')).find(x => x.position_id === 'plum').current_staff_id, null);
  await call('FT001', 'rpc_live_finalize_handoff', { p_handoff_id: handoffs[0].handoff_id });
  const finalStaff = (await call('FT001', 'rpc_today_staff')).find(x => x.staff_id === 'FT002');
  assert.equal(finalStaff.status, 'on_duty');
  assert.equal(finalStaff.current_position_id, 'plum');
  assert.equal((await call('FT001', 'rpc_today_alerts')).alerts.some(x => x.kind === 'safety_position_vacant' && x.position_id === 'plum'), false);
  assert.equal((await call('FT001', 'rpc_today_handoffs')).length, 0);
  await width(manager, 'manager phone');
  assert.deepEqual(errors, []);
  console.log('013.4 localhost mock passed: occupied return, vacant self-start gap, trip, arrival, manager finalize, alert cleared, wrong outgoing rejected, 390px. SQL remains unexecuted.');
} finally { await Promise.all(contexts.map(x => x.close())); await browser.close(); }
