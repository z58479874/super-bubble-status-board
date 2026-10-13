import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { chromium, launchOptions } from './browser.mjs';
const base=process.env.SB_TEST_BASE; // Local mock; no Supabase request is made.
const browser = await chromium.launch({ headless: true, ...launchOptions });
const errors = [];
const call = async (name, fields = {}, actor = 'FT001') => {
  const response = await fetch(new URL(`rest/v1/rpc/${name}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_session_token: `${actor}-token`, ...fields }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: ${result.message}`);
  return result;
};
const assertWidth = async (page, label) => {
  const width = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, panel: document.querySelector('.sheet-panel')?.getBoundingClientRect().width || 0 }));
  assert.ok(width.document <= width.viewport && width.panel <= width.viewport, `${label}: ${JSON.stringify(width)}`);
};
const card = (page, id) => page.locator(`[data-staff-id="${id}"]`);
const openActions = async (page, id) => { await card(page, id).getByRole('button', { name: '操作', exact: true }).click(); return page.getByRole('dialog'); };
const refresh = async page => { await page.locator('#refreshButton').click(); await page.waitForTimeout(250); };

try {
  await fetch(new URL('__scenario?mode=workflow', base));
  await call('rpc_prepare_today');
  await call('rpc_select_today_mode', { p_mode: 'yellow' });
  const start = new Date(Date.now() - 3600_000).toISOString();
  const end = new Date(Date.now() + 9 * 3600_000).toISOString();
  for (const id of ['FT001', 'FT004']) await call('rpc_save_today_roster', { p_staff_id: id, p_scheduled_start: start, p_scheduled_end: end });
  await call('rpc_initialize_today_not_arrived');

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#identifier').fill('FT001');
  await page.locator('#pin').fill('123456'); // Mock PIN only.
  await page.locator('#loginSubmit').click();
  await page.locator('#dashboardView').waitFor({ state: 'visible' });
  await page.locator('[data-page="staff"]').click();
  await card(page, 'FT001').getByRole('button', { name: '操作', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '操作', exact: true }).count(), 2);
  await assertWidth(page, 'two not-arrived cards');

  let dialog = await openActions(page, 'FT001');
  await dialog.getByRole('button', { name: '确认到岗', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('[name="assignmentType"]').waitFor();
  assert.equal(await dialog.locator('[name="assignmentType"]').inputValue(), '', 'assignment must be chosen explicitly');
  await dialog.getByRole('button', { name: '确认到岗', exact: true }).click();
  await dialog.getByText('请选择具体岗位、区域待命或全场机动。').waitFor();
  await dialog.locator('[name="assignmentType"]').selectOption('mobile_pool');
  await assertWidth(page, 'arrival sheet mobile');
  await dialog.getByRole('button', { name: '确认到岗', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  let overview = await call('rpc_today_overview');
  assert.equal(overview.on_duty_count, 1);
  assert.equal(overview.not_arrived_count, 1);
  assert.equal((await call('rpc_today_staff')).find(x => x.staff_id === 'FT001').current_assignment_type, 'mobile_pool');

  dialog = await openActions(page, 'FT004');
  await dialog.getByRole('button', { name: '确认到岗', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('[name="assignmentType"]').selectOption('area_standby');
  await dialog.locator('[name="area"]').selectOption('high_altitude');
  await assertWidth(page, 'arrival sheet area');
  await dialog.getByRole('button', { name: '确认到岗', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  overview = await call('rpc_today_overview');
  assert.equal(overview.on_duty_count, 2);
  assert.equal(overview.not_arrived_count, 0);
  assert.equal((await call('rpc_today_coverage')).find(x => x.scope_code === 'high_altitude').current_count, 1);

  await call('rpc_save_today_roster', { p_staff_id: 'FT002', p_scheduled_start: start, p_scheduled_end: end });
  await call('rpc_initialize_today_not_arrived');
  await call('rpc_confirm_today_arrival', { p_staff_id: 'FT002', p_assignment_type: 'position', p_position_id: 'plum', p_area_code: null });
  await call('rpc_start_today_monitoring');
  await refresh(page);
  dialog = await openActions(page, 'FT001');
  for (const label of ['调岗', '开始吃饭', '短时离岗', '正常下班', '异常真实离岗'])
    await dialog.getByRole('button', { name: label, exact: true }).waitFor();
  await dialog.locator('.sheet-close').click();
  dialog = await openActions(page, 'FT002');
  await dialog.getByRole('button', { name: '发起安全岗交接' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '调岗', exact: true }).count(), 0);
  await dialog.locator('.sheet-close').click();

  await call('rpc_live_add_reinforcement', { p_staff_id: 'FT003', p_start: start, p_end: end });
  await refresh(page);
  await page.route('**/rest/v1/rpc/rpc_position_candidates', async route => {
    const position = route.request().postDataJSON()?.p_position_id;
    const response = await route.fetch();
    const candidates = await response.json();
    if (position === 'gear1') {
      const person = candidates.find(item => item.staff_id === 'FT003');
      if (person) person.has_required_assignment_permission = false;
    }
    await route.fulfill({ response, json: candidates });
  });
  dialog = await openActions(page, 'FT003');
  await dialog.getByRole('button', { name: '确认到岗', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('[name="assignmentType"]').selectOption('position');
  assert.equal(await dialog.locator('[name="position"] option[value="gear1"]').count(), 0, 'unqualified position must not be offered');
  assert.equal(await dialog.locator('[name="position"] option[value="climb"]').count(), 1);
  await dialog.locator('[name="position"]').selectOption('climb');
  await dialog.getByRole('button', { name: '确认到岗', exact: true }).click();
  await dialog.getByRole('button', { name: '确认到岗并前往' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await call('rpc_today_staff')).find(x => x.staff_id === 'FT003').current_assignment_type, 'in_transit');
  assert.equal((await call('rpc_today_positions')).find(x => x.position_id === 'climb').current_staff_id, null);
  dialog = await openActions(page, 'FT003');
  await dialog.getByRole('button', { name: '发起安全补岗' }).waitFor();
  await dialog.locator('.sheet-close').click();

  await call('rpc_live_start_break', { p_staff_id: 'FT001', p_break: 'meal' });
  await refresh(page);
  dialog = await openActions(page, 'FT001');
  await dialog.getByRole('button', { name: '返岗', exact: true }).waitFor();
  await dialog.getByText(/已吃饭 \d+ 分钟/).waitFor();
  await dialog.locator('.sheet-close').click();
  await call('rpc_live_return_from_break', { p_staff_id: 'FT001', p_type: null, p_position: null, p_area: null });
  await call('rpc_live_start_break', { p_staff_id: 'FT001', p_break: 'short_leave' });
  await refresh(page);
  dialog = await openActions(page, 'FT001');
  await dialog.getByRole('button', { name: '返岗', exact: true }).waitFor();
  await dialog.getByText(/已短离 \d+ 分钟/).waitFor();
  await dialog.locator('.sheet-close').click();
  await call('rpc_live_return_from_break', { p_staff_id: 'FT001', p_type: null, p_position: null, p_area: null });
  await call('rpc_live_begin_transfer', { p_staff_id: 'FT004', p_type: 'area_standby', p_position: null, p_area: 'front_hall' });
  await refresh(page);
  dialog = await openActions(page, 'FT004');
  await dialog.getByRole('button', { name: '确认到位', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '调岗', exact: true }).count(), 0);
  await dialog.locator('.sheet-close').click();
  await call('rpc_live_end_shift', { p_staff_id: 'FT001', p_confirm_shortfall: false });
  await refresh(page);
  assert.equal(await card(page, 'FT001').getByRole('button', { name: '操作', exact: true }).count(), 0);
  await card(page, 'FT001').getByRole('button', { name: '查看资料' }).waitFor();
  await assertWidth(page, 'all staff states');
  assert.deepEqual(errors, []);
  console.log('013.3 local mock passed: FT001/FT004 arrival, all action states, safety handoff, 390px. No Supabase calls.');
} finally { await browser.close(); }

