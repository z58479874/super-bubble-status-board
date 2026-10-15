import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { WorkflowMock } from './workflow-mock.mjs';
import { businessError, assignmentLabel, handoffStage, dispatchCandidates } from '../site/displayLabels.js';
import { chromium, launchOptions } from './browser.mjs';
const browser = await chromium.launch({headless:true,...launchOptions});
const base = process.env.SB_TEST_BASE || 'http://127.0.0.1:8770/';
const mock = new WorkflowMock();
const calls = [];
const errors = [];
let offline = false, expired = false, rejectTransfer = false;
let groups = 0;
const passed = text => { groups++; console.log(`通过：${text}`); };
const manager = (name, params={}) => mock.rpc(name,{p_session_token:'FT001-token',...params});
const range = {p_scheduled_start:new Date(Date.now()-3600000).toISOString(),p_scheduled_end:new Date(Date.now()+3600000*9).toISOString()};
manager('rpc_prepare_today'); manager('rpc_select_today_mode',{p_mode:'yellow'});
for (let i=5;i<=11;i++) mock.staff.push({id:`FT${String(i).padStart(3,'0')}`,name:`模拟人员${i}`,department:'现场运营部',role:'staff',employment_type:'full_time',active:true});
mock.staff.find(row=>row.id==='FT004').role='supervisor';
for (const row of mock.staff.filter(row=>row.active)) manager('rpc_save_today_roster',{p_staff_id:row.id,...range});
manager('rpc_initialize_today_not_arrived');
for (const [id,type,position,area] of [['FT001','mobile_pool'],['FT002','position','plum'],['FT003','area_standby',null,'second_floor'],['FT004','position','sale1'],['FT005','mobile_pool'],['FT006','mobile_pool'],['FT008','mobile_pool'],['FT009','mobile_pool'],['FT010','mobile_pool'],['FT011','area_standby',null,'high_altitude']])
  manager('rpc_confirm_today_arrival',{p_staff_id:id,p_assignment_type:type,p_position_id:position||null,p_area_code:area||null});
manager('rpc_start_today_monitoring');
manager('rpc_live_start_break',{p_staff_id:'FT005',p_break:'meal'}); mock.state('FT005').status_since=new Date(Date.now()-12*60000).toISOString();
manager('rpc_live_start_break',{p_staff_id:'FT006',p_break:'short_leave'}); mock.state('FT006').status_since=new Date(Date.now()-16*60000).toISOString();
manager('rpc_live_end_shift',{p_staff_id:'FT008'});
manager('rpc_live_begin_transfer',{p_staff_id:'FT009',p_type:'area_standby',p_area:'high_altitude'});
mock.state('FT010').cover_for_staff_id='FT002';
manager('rpc_live_request_handoff',{p_flow:'gap',p_action:'fill',p_position:'climb',p_outgoing:null,p_incoming:'FT011'});
const contexts=[];
async function open(id) {
  const context=await browser.newContext({viewport:{width:390,height:844}}); contexts.push(context);
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/rest/v1/rpc/**', async route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    const params=route.request().postDataJSON(); calls.push({name,actor:params.p_session_token?.replace('-token','')});
    try {
      if (offline) return route.fulfill({status:503,json:{message:'network unavailable',code:'PGRST000'}});
      if (expired) return route.fulfill({status:401,json:{message:'会话已失效，请重新验证身份',code:'28000'}});
      if (rejectTransfer && name==='rpc_live_begin_transfer') return route.fulfill({status:400,json:{message:'区域 front_hall 将由 1 人降至 0 人，低于最低 2 人；先补足人员',code:'P0001'}});
      let result=mock.rpc(name,params);
      if(name==='rpc_today_alerts') result={...result,alerts:[...result.alerts,{kind:'meal_over_45',staff_id:'FT005',staff_name:'模拟人员5',duration_minutes:48}]};
      // Simulate void RPC bodies exactly like production's successful writes.
      if(name.startsWith('rpc_') && !['rpc_my_return_position','rpc_position_candidates'].includes(name) && !name.startsWith('rpc_today_') && !name.startsWith('rpc_my_') && result===null) return route.fulfill({status:200,body:''});
      await route.fulfill({status:200,json:result});
    } catch(e) { await route.fulfill({status:e.code==='42501'?403:400,json:{message:e.message,code:e.code||'P0001'}}); }
  });
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#identifier').fill(id); await page.locator('#pin').fill('123456'); // local mock only
  await page.locator('#loginSubmit').click(); await page.locator('#dashboardView').waitFor({state:'visible'});
  await page.locator('#content .section').first().waitFor();
  return page;
}
const dialog=page=>page.getByRole('dialog');
const close=async page=>{ if(await dialog(page).count()) await dialog(page).locator('.sheet-close').click(); };
const refresh=async page=>{ await page.locator('#refreshButton').click(); await page.waitForTimeout(180); };
const width=async page=>{ const size=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,panel:document.querySelector('.sheet-panel')?.getBoundingClientRect().width||0})); assert.ok(size.document<=size.width&&size.panel<=size.width,JSON.stringify(size)); };
const chinese=async page=>{ assert.doesNotMatch(await page.locator('body').innerText(),/front_hall|high_altitude|high_expansion|second_floor|mobile_pool|area_standby|in_transit|awaiting_incoming|awaiting_outgoing|short_leave|not_arrived|temporary_part_time|regular_part_time|on_duty|off_duty|end_cover/); };
try {
  assert.equal(businessError({message:'区域 front_hall 将由 1 人降至 0 人，低于最低 2 人；先补足人员'}),'前厅最低需要2人，当前只有1人。请先安排其他人员补位。');
  assert.match(businessError('返岗关系不符'),/顶岗关系已经发生变化/);
  assert.match(businessError('该岗位已有未完成交接'),/交接正在进行/);
  assert.match(businessError('安全关键岗必须先发起交接'),/双人交接/);
  assert.equal(businessError('unknown_sql_error'),'操作未完成，请刷新状态后重试。');
  assert.equal(assignmentLabel({current_assignment_type:'area_standby',current_area_code:'high_altitude'}),'高空普通区待命');
  assert.equal(handoffStage({stage:'awaiting_outgoing',flow:'gap'}),'已到位，等待管理人员确认补岗');
  passed('共用中文与错误翻译、未知值兜底');
  const page=await open('FT001');
  assert.match(await page.locator('#content .section').first().innerText(),/安全关键岗无人值守/);
  assert.equal(await page.locator('[data-position-focus]').count(),3);
  await page.getByText('查看全部',{exact:true}).waitFor();
  assert.match(await page.locator('[data-area-focus="high_altitude"]').innerText(),/最低 6 人/);
  await chinese(page); await width(page);
  await page.screenshot({path:'artifacts/014-home-390.png',fullPage:true});
  passed('首页安全优先、前三项与查看全部、区域最低人数、390px');
  await page.locator('[data-position-focus]').first().click(); await dialog(page).getByRole('button',{name:'发起安全补岗'}).waitFor(); await close(page);
  await page.locator('[data-area-focus="high_altitude"]').click();
  await page.getByText('正在处理：高空普通区',{exact:true}).waitFor();
  const ids=await page.locator('[data-dispatch-staff]').evaluateAll(nodes=>nodes.map(n=>n.dataset.dispatchStaff));
  assert.deepEqual(ids,['FT001','FT003','FT004']);
  const gaps=await page.locator('.gap-card,.coverage-card').evaluateAll(nodes=>nodes.map(n=>n.className));
  assert.ok(gaps[0].includes('alert-red')); assert.ok(gaps.at(-1).includes('alert-orange'));
  await chinese(page); await width(page);
  await page.screenshot({path:'artifacts/014-dispatch-390.png',fullPage:true});
  passed('告警定位、调度缺口排序、排除安全占岗/离岗/途中/交接/顶岗');
  await page.locator('[data-dispatch-select="FT001"]').click(); await dialog(page).locator('[name="assignmentType"]').waitFor();
  assert.equal(await dialog(page).locator('[name="position"] option:not([value=""])').count(),29);
  assert.equal(await dialog(page).locator('[name="position"] option[value="plum"]').count(),1);
  assert.equal(await dialog(page).locator('[name="position"] option[value="m1"]').count(),0);
  await dialog(page).locator('[name="assignmentType"]').selectOption('area_standby'); await dialog(page).locator('[name="area"]').selectOption('front_hall');
  await dialog(page).getByRole('button',{name:'开始前往',exact:true}).click(); await dialog(page).waitFor({state:'detached'});
  assert.equal(mock.state('FT001').current_assignment_type,'in_transit');
  await page.locator('[data-page="staff"]').click(); await page.locator('[data-staff-id="FT001"]').getByRole('button',{name:'操作',exact:true}).click();
  await dialog(page).getByRole('button',{name:'确认到位',exact:true}).click(); await dialog(page).waitFor({state:'detached'});
  assert.equal(mock.state('FT001').current_assignment_type,'area_standby'); assert.equal(mock.state('FT001').current_area_code,'front_hall');
  passed('普通调岗两阶段，29个固定岗位均显示且机动资源不伪装为岗位');
  await page.locator('[data-page="home"]').click(); await page.locator('[data-staff-focus="FT005"]').click();
  assert.match(await dialog(page).innerText(),/返岗/); await close(page);
  await page.locator('[data-page="staff"]').click(); await page.locator('[data-staff-id="FT002"]').getByRole('button',{name:'操作',exact:true}).click();
  await dialog(page).getByRole('button',{name:'下班 · 请先交接'}).click();
  assert.match(await dialog(page).innerText(),/当前值守安全关键岗，请先完成岗位交接/); await close(page);
  assert.ok(!calls.some(row=>row.name==='rpc_live_end_shift'));
  passed('离岗提醒定位员工，安全岗下班说明不调用下班RPC');
  await page.locator('[data-staff-id="FT004"]').getByRole('button',{name:'操作',exact:true}).click();
  await dialog(page).getByRole('button',{name:'调岗',exact:true}).click(); await dialog(page).locator('[name="assignmentType"]').waitFor();
  assert.match(await dialog(page).innerText(),/调离后该区域将低于最低人数/);
  await dialog(page).locator('[name="assignmentType"]').selectOption('mobile_pool'); rejectTransfer=true;
  await dialog(page).getByRole('button',{name:'开始前往',exact:true}).click();
  await dialog(page).getByText('前厅最低需要2人，当前只有1人。请先安排其他人员补位。',{exact:true}).waitFor();
  assert.equal(mock.state('FT004').current_position_id,'sale1');
  await dialog(page).locator('.debug-error summary').waitFor(); await chinese(page); rejectTransfer=false; await close(page);
  passed('来源最低覆盖提示、数据库拒绝后不改UI事实、管理端折叠原始错误');
  for (const tab of ['positions','handoffs','my','staff','home']) { await page.locator(`[data-page="${tab}"]`).click(); await page.waitForTimeout(100); await width(page); await chinese(page); }
  await page.reload({waitUntil:'networkidle'}); await page.getByText('现场调度',{exact:true}).waitFor();
  offline=true; await refresh(page); await page.locator('#connectionBanner').waitFor({state:'visible'}); assert.match(await page.locator('#connectionBanner').innerText(),/上次成功/); offline=false; await refresh(page);
  passed('各页中文与390px，刷新恢复，断网保留旧数据并提示');
  for (const [id,text] of [['FT002','当前安排：梅花桩'],['FT003','当前安排：二楼电玩待命'],['FT005','已吃饭 12 分钟 · 剩余 33 分钟'],['FT006','短离已 16 分钟'],['FT009','前往高空普通区']]) {
    const worker=await open(id); assert.equal(await worker.locator('.nav-button').count(),1);
    assert.match(await worker.locator('.my-hero').innerText(),new RegExp(text)); await width(worker); await chinese(worker);
    assert.equal(await worker.getByText('员工管理',{exact:true}).count(),0);
    const actorCalls=calls.filter(row=>row.actor===id); assert.ok(actorCalls.every(row=>['pin_whoami','rpc_my_today_state','rpc_my_meal_plan'].includes(row.name)));
  }
  passed('员工单页权限、固定岗/待命/机动/吃饭/短离/途中展示');
  manager('rpc_live_return_from_break',{p_staff_id:'FT005',p_type:null,p_position:null,p_area:null});
  const mobileWorker=await open('FT005'); assert.match(await mobileWorker.locator('.my-hero').innerText(),/当前安排：全场机动/); await width(mobileWorker);
  const supervisor=await open('FT004'); await supervisor.locator('[data-page="staff"]').click(); await supervisor.locator('[data-staff-id]').first().waitFor(); assert.equal(await supervisor.getByText('员工管理',{exact:true}).count(),0); await width(supervisor);
  mock.staff.find(row=>row.id==='FT004').role='deputy'; const deputy=await open('FT004'); await deputy.getByText('现场调度',{exact:true}).waitFor(); await deputy.locator('[data-page="staff"]').click(); await deputy.locator('[data-staff-id]').first().waitFor(); assert.equal(await deputy.getByText('员工管理',{exact:true}).count(),0);
  passed('主管/副店拥有现场管理入口，无店长专属员工管理入口');
  await page.locator('[data-page="home"]').click(); await refresh(page);
  const initial=calls.filter(row=>row.actor==='FT001').length;
  for (const tab of ['staff','positions','home']) { await page.locator(`[data-page="${tab}"]`).click(); await page.waitForTimeout(100); }
  assert.equal(calls.filter(row=>row.actor==='FT001').length,initial,'切页应复用5秒内读取数据');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const managerBefore=calls.filter(row=>row.actor==='FT001').length;
  await page.waitForTimeout(5400);
  assert.equal(calls.filter(row=>row.actor==='FT001').length,managerBefore,'后台停止轮询');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(200);
  assert.equal(calls.filter(row=>row.actor==='FT001').length,managerBefore+7,'返回前台只刷新一组读取');
  passed('切页复用缓存、后台暂停轮询、回前台立即刷新');
  expired=true; await refresh(page); await page.locator('#loginView').waitFor({state:'visible'}); assert.equal(await page.evaluate(()=>sessionStorage.getItem('super_bubble_012_session')),null); expired=false;
  passed('会话失效回登录，移除本地会话');
  assert.deepEqual(errors,[]);
  console.log(`014 UI：${groups} 组通过；全部RPC拦截到本地模拟器，未访问生产写接口。`);
} finally { for(const context of contexts) await context.close(); await browser.close(); }
