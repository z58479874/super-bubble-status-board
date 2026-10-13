import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { chromium, launchOptions } from './browser.mjs';
const base=process.env.SB_TEST_BASE;
await fetch(`${base}__scenario?mode=workflow`);
const browser = await chromium.launch({ headless: true, ...launchOptions });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const replaced = new Set();
let explicitErrorNext = false;
const variants = new Map([
  ['rpc_prepare_today', { status: 200, body: '' }],
  ['rpc_select_today_mode', { status: 204, body: '' }],
  ['rpc_save_today_roster', { status: 200, body: 'null' }],
  ['rpc_initialize_today_not_arrived', { status: 200, body: '""' }],
]);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/rest/v1/rpc/**', async route => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  if (explicitErrorNext && name === 'rpc_select_today_mode') {
    explicitErrorNext = false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: '测试拒绝', message: '测试拒绝切换模式' }) });
    return;
  }
  const variant = variants.get(name);
  if (!variant) { await route.continue(); return; }
  const original = await route.fetch(); // First apply the write to the isolated local mock.
  if (!original.ok()) { await route.fulfill({ response: original }); return; }
  replaced.add(name);
  await route.fulfill({ status: variant.status, contentType: 'application/json', body: variant.body });
});

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#identifier').fill('FT001');
  await page.locator('#pin').fill('123456'); // Local mock PIN only.
  await page.locator('#loginSubmit').click();
  await page.locator('#dashboardView').waitFor({ state: 'visible' });

  await page.getByRole('button', { name: '准备今天' }).click();
  await page.getByText('准备阶段', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: '选择模式' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '黄灯', exact: true }).click();
  await page.getByText('当前模式：黄灯').waitFor();
  assert.equal(await page.getByText('服务器返回了无法读取的数据').count(), 0);

  explicitErrorNext = true;
  await page.getByRole('button', { name: '选择模式' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '绿灯', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '改为绿灯' }).click();
  await page.getByText('操作未完成，请刷新状态后重试。', { exact: true }).waitFor();
  assert.equal(await page.getByText('当前模式：黄灯').count(), 1);
  await page.getByRole('dialog').getByRole('button', { name: '返回' }).click();

  await page.getByRole('button', { name: '今日人员' }).click();
  await page.getByRole('dialog').locator('[name="staffId"]').selectOption('FT001');
  await page.getByRole('dialog').getByRole('button', { name: '加入 / 更新排班' }).click();
  await page.getByRole('button', { name: '今日人员' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '生成未到岗名单' }).click();
  await page.locator('[data-page="staff"]').click();
  await page.locator('[data-staff-id="FT001"]').waitFor();
  assert.equal(await page.getByText('服务器返回了无法读取的数据').count(), 0);
  assert.deepEqual([...replaced].sort(), [...variants.keys()].sort());
  assert.deepEqual(errors, []);
  console.log('013.2: HTTP 200 empty, 204, JSON null, JSON empty string all accepted; writes persisted and read refresh restored UI.');
} finally { await browser.close(); }
