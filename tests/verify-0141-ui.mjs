import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { StaffManagementMock } from './staff-management-mock.mjs';
import { chromium, launchOptions } from './browser.mjs';
const browser=await chromium.launch({headless:true,...launchOptions});
const base=process.env.SB_TEST_BASE||'http://127.0.0.1:8772/';
const mock=new StaffManagementMock(), calls=[], errors=[], consoles=[]; let loseCreateResponse=false;
let groups=0; const passed=message=>{groups++;console.log('通过：'+message);};
const contexts=[];
async function open(id='FT001') {
 const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>consoles.push(e.text()));
 await page.route('**/rest/v1/rpc/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop(), params=route.request().postDataJSON();
  // Never print params: even local test PIN/session are not needed in test logs.
  calls.push({name,params});
  try {
   const result=mock.rpc(name,params);
   if(name==='rpc_staff_create'&&loseCreateResponse){loseCreateResponse=false;return route.abort('connectionreset');}
   await route.fulfill({status:200,json:result});
  } catch(e){await route.fulfill({status:e.code==='42501'?403:e.code==='28000'?401:400,json:{message:e.message,code:e.code||'P0001'}});}
 });
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('#identifier').fill(id);await page.locator('#pin').fill('123456');
 await page.locator('#loginSubmit').click();await page.locator('#dashboardView').waitFor({state:'visible'});
 await page.locator('#content .section').first().waitFor();return page;
}
const dialog=p=>p.getByRole('dialog');
const click=(p,name)=>dialog(p).getByRole('button',{name,exact:true}).click();
const field=(p,name)=>dialog(p).locator(`[name=${name}]`);
async function width(p){assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && (!document.querySelector('.sheet-panel') || document.querySelector('.sheet-panel').scrollWidth<=document.querySelector('.sheet-panel').clientWidth+1)));}
async function directory(p){if(await dialog(p).count())await dialog(p).locator('.sheet-close').click();await p.locator('[data-page=staff]').click();await p.getByRole('button',{name:'员工管理',exact:true}).click();await dialog(p).locator('[data-hr-list]').waitFor();}
async function detail(p,id){await directory(p);await dialog(p).locator(`[data-hr-id="${id}"]`).click();await dialog(p).getByRole('button',{name:'可安排岗位',exact:true}).waitFor();}
async function create(p,name,type='full_time',role='staff') {
 await directory(p);await click(p,'新增员工');await field(p,'hrName').fill(name);await field(p,'hrDepartment').fill('现场运营部');
 await field(p,'hrEmployment').selectOption(type);await field(p,'hrRole').selectOption(role);await click(p,'检查同名人员');await field(p,'hrDistinct').waitFor();
}
try {
 const p=await open();
 for(const phase of ['not_prepared','not_started','monitoring','ended']){
  if(await dialog(p).count())await dialog(p).locator('.sheet-close').click();
  mock.phase=phase;await p.locator('#refreshButton').click();await directory(p);await width(p);
  assert.equal(await dialog(p).locator('[data-hr-id]').count(),5);
 }
 passed('四种营业阶段均可进入员工管理，未排班员工也显示');
 await field(p,'hrType').selectOption('temporary_part_time');assert.equal(await dialog(p).locator('[data-hr-id]').count(),1);
 await field(p,'hrActive').selectOption('active');assert.equal(await dialog(p).locator('[data-hr-id]').count(),0);
 await field(p,'hrType').selectOption('all');await field(p,'hrActive').selectOption('all');await field(p,'hrSearch').fill('FT002');assert.equal(await dialog(p).locator('[data-hr-id]').count(),1);
 passed('姓名/编号搜索、在职和用工类型筛选');
 await detail(p,'FT002');await width(p);await p.screenshot({path:'artifacts/0141-detail-390.png'});
 await click(p,'编辑资料');await width(p);await field(p,'hrName').fill('测试新姓名');await field(p,'hrRole').selectOption('supervisor');await click(p,'核对并继续');
 let before=calls.filter(c=>c.name==='rpc_staff_update_profile').length;await click(p,'确认保存');assert.equal(calls.filter(c=>c.name==='rpc_staff_update_profile').length,before);
 await field(p,'hrRoleConfirmed').check();await click(p,'确认保存');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();assert.equal(mock.member('FT002').role,'supervisor');
 passed('编辑资料使用revision，管理角色二次确认后保存并重新读取');
 await click(p,'编辑资料');await field(p,'hrDepartment').fill('前厅');await click(p,'核对并继续');mock.versions.set('FT002',99);await click(p,'确认保存');
 await dialog(p).locator('.sheet-error').filter({hasText:'另一台设备'}).waitFor();assert.equal(mock.member('FT002').department,'现场运营部');passed('跨设备版本冲突不覆盖资料，提示重新打开');
 await detail(p,'FT003');await click(p,'可安排岗位');await field(p,'hrPosition').first().waitFor();assert.equal(await field(p,'hrPosition').count(),19);await width(p);await p.screenshot({path:'artifacts/0141-positions-390.png'});
 assert.equal(await dialog(p).locator('[name=hrPosition][value=expand1]').count(),0);assert.equal(await dialog(p).locator('[name=hrPosition][value=m1]').count(),0);
 await dialog(p).locator('[value=plum]').uncheck();await click(p,'核对岗位变更');assert.match(await dialog(p).innerText(),/移除：梅花桩/);await click(p,'确认保存岗位');await dialog(p).getByRole('button',{name:'可安排岗位',exact:true}).waitFor();assert.equal(mock.grants.get('FT003').length,18);
 passed('19个可编辑岗位、普通/机动只读；保存差异与读回数量正确');
 mock.states.set('FT003',{staff_id:'FT003',status:'on_duty',current_assignment_type:'position',current_position_id:'climb'});
 await click(p,'可安排岗位');await dialog(p).locator('[value=climb]').uncheck();await click(p,'核对岗位变更');await click(p,'确认保存岗位');await dialog(p).locator('.sheet-error').filter({hasText:'仍被现场'}).waitFor();assert.ok(mock.grants.get('FT003').includes('climb'));
 passed('使用中的岗位关系撤销被拒绝，保留原集合');
 mock.positions.find(row=>row.position_id==='gear4').active=false;
 await detail(p,'FT003');await click(p,'可安排岗位');await field(p,'hrPosition').first().waitFor();assert.equal(await field(p,'hrPosition').count(),18);assert.match(await dialog(p).innerText(),/岗位已停用/);mock.positions.find(row=>row.position_id==='gear4').active=true;
 passed('停用岗位不可编辑，不能作为可保存目标');
 await detail(p,'FT003');await click(p,'办理离职');await field(p,'hrReason').fill('合同结束');await field(p,'hrDeactivate').check();await click(p,'确认办理离职');await dialog(p).locator('.sheet-error').filter({hasText:'仍有现场状态'}).waitFor();assert.ok(mock.member('FT003').active);
 mock.states.delete('FT003');mock.roster.set('FT003',{roster_status:'scheduled'});await click(p,'确认办理离职');await dialog(p).locator('.sheet-error').filter({hasText:'有效排班'}).waitFor();mock.roster.delete('FT003');
 await click(p,'确认办理离职');await dialog(p).getByRole('button',{name:'恢复员工',exact:true}).waitFor();assert.equal(mock.member('FT003').active,false);assert.equal(mock.grants.get('FT003').length,18);assert.equal(await dialog(p).getByRole('button',{name:'初始化/重置PIN',exact:true}).count(),0);
 passed('离职必须填写原因，现场/未完成排班阻止；离职保留编号和岗位关系');
 await click(p,'恢复员工');await width(p);await field(p,'hrDepartment').fill('前厅');await click(p,'核对并继续');await click(p,'确认恢复');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();assert.ok(mock.member('FT003').active);assert.equal(mock.grants.get('FT003').length,18);assert.match(await dialog(p).innerText(),/尚未初始化 PIN/);
 passed('恢复原编号、保留原关系、不自动排班、提示重新初始化PIN');
 await click(p,'初始化/重置PIN');await click(p,'签发临时 PIN');await dialog(p).locator('.one-time-pin').waitFor();const oneTime=await dialog(p).locator('.one-time-pin').innerText();await width(p);
 await click(p,'我已当面告知，关闭');assert.equal(await p.locator('.one-time-pin').count(),0);
 assert.equal(await p.evaluate(pin=>JSON.stringify(localStorage).includes(pin)||JSON.stringify(sessionStorage).includes(pin),oneTime),false);
 assert.equal(consoles.some(line=>line.includes(oneTime)),false);assert.ok(!p.url().includes(oneTime));
 passed('ended仍可签发PIN，仅显示一次，关闭后无PIN持久化或日志');
 await create(p,'测试店长','regular_part_time','deputy');assert.equal(await dialog(p).locator('[data-existing-id=FT001]').count(),1);
 await width(p);await p.screenshot({path:'artifacts/0141-create-390.png'});
 before=calls.filter(c=>c.name==='rpc_staff_create').length;await click(p,'确认新增');assert.equal(calls.filter(c=>c.name==='rpc_staff_create').length,before);
 await field(p,'hrDistinct').check();await click(p,'确认新增');assert.equal(calls.filter(c=>c.name==='rpc_staff_create').length,before);
 await field(p,'hrHigh').check();loseCreateResponse=true;await click(p,'确认新增');await dialog(p).getByRole('button',{name:'使用原请求核对 / 重试',exact:true}).waitFor();assert.equal(mock.staff.filter(s=>s.name==='测试店长').length,2);
 await click(p,'使用原请求核对 / 重试');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();const creates=calls.filter(c=>c.name==='rpc_staff_create');assert.equal(creates.at(-1).params.p_request_id,creates.at(-2).params.p_request_id);assert.equal(mock.staff.filter(s=>s.name==='测试店长').length,2);assert.equal(mock.grants.get('PT005').length,0);assert.ok(!mock.roster.has('PT005')&&!mock.states.has('PT005'));
 passed('同名不同人和高权限明确确认；响应丢失用相同UUID重试、不重复建档、不自动授权/排班');
 await create(p,'历史兼职');await dialog(p).locator('[data-existing-id="TMP20261001-01"]').click();await click(p,'恢复员工');await click(p,'核对并继续');await click(p,'确认恢复');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();assert.ok(mock.member('TMP20261001-01').active);assert.equal(mock.grants.get('TMP20261001-01').length,19);
 passed('同名历史档案可选择恢复，保持TMP编号和人工岗位关系');
 await create(p,'新增全职');await field(p,'hrDistinct').check();await click(p,'确认新增');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();assert.equal(mock.member('FT012').employment_type,'full_time');
 passed('新增全职自动取得FT编号，默认普通员工且未初始化PIN');
 await detail(p,'PT005');await click(p,'编辑资料');await field(p,'hrEmployment').selectOption('full_time');await field(p,'hrDepartment').fill('管理层');await click(p,'核对并继续');await click(p,'确认保存');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();
 assert.equal(mock.member('PT005').employment_type,'full_time');assert.equal(mock.member('PT005').department,'管理层');
 passed('固定兼职转全职与修改部门不改变原PT编号');
 await detail(p,'FT012');await click(p,'可安排岗位');await dialog(p).locator('[value=plum]').check();await click(p,'核对岗位变更');await click(p,'确认保存岗位');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();assert.deepEqual(mock.grants.get('FT012'),['plum']);
 passed('新员工可单独增加岗位，不默认授予其余18岗');
 await click(p,'办理离职');await field(p,'hrReason').fill('模拟状态保护');await field(p,'hrDeactivate').check();
 for(const [status,assignment] of [['meal','none'],['short_leave','none'],['on_duty','in_transit']]){
  mock.states.set('FT012',{staff_id:'FT012',status,current_assignment_type:assignment});await click(p,'确认办理离职');await dialog(p).locator('.sheet-error').filter({hasText:'仍有现场状态'}).waitFor();assert.ok(mock.member('FT012').active);
 }
 mock.states.delete('FT012');mock.handoffs.set('test-protect',{incoming_staff_id:'FT012',outgoing_staff_id:'FT002',stage:'awaiting_incoming'});
 await click(p,'确认办理离职');await dialog(p).locator('.sheet-error').filter({hasText:'仍有现场状态'}).waitFor();mock.handoffs.delete('test-protect');
 mock.states.set('FT012',{staff_id:'FT012',status:'off_duty',current_assignment_type:'none'});mock.roster.set('FT012',{staff_id:'FT012',roster_status:'scheduled'});
 await click(p,'确认办理离职');await dialog(p).getByRole('button',{name:'恢复员工',exact:true}).waitFor();assert.equal(mock.states.get('FT012').status,'off_duty');assert.ok(mock.roster.has('FT012'));
 await click(p,'恢复员工');await click(p,'核对并继续');await click(p,'确认恢复');await dialog(p).getByRole('button',{name:'编辑资料',exact:true}).waitFor();mock.roster.delete('FT012');mock.states.delete('FT012');
 passed('吃饭/短离/在途/未完交接拒绝离职的界面反馈；已下班允许且保留历史');
 await detail(p,'FT001');await click(p,'办理离职');await field(p,'hrReason').fill('测试末位店长保护');await field(p,'hrDeactivate').check();await click(p,'确认办理离职');await dialog(p).locator('.sheet-error').filter({hasText:'只有这一名在职店长'}).waitFor();assert.ok(mock.member('FT001').active);
 passed('最后一名店长保护的数据库提示可见');
 await directory(p);await p.setViewportSize({width:1280,height:900});await width(p);await p.screenshot({path:'artifacts/0141-directory-desktop.png'});await p.setViewportSize({width:390,height:844});await width(p);await p.screenshot({path:'artifacts/0141-directory-390.png'});
 const deputy=await open('PT005');await deputy.locator('[data-page=staff]').click();assert.equal(await deputy.getByRole('button',{name:'员工管理',exact:true}).count(),0);
 const supervisor=await open('FT004');await supervisor.locator('[data-page=staff]').click();assert.equal(await supervisor.getByRole('button',{name:'员工管理',exact:true}).count(),0);
 const ordinary=await open('TMP20261001-01');assert.equal(await ordinary.getByRole('button',{name:'员工管理',exact:true}).count(),0);
 passed('副店/主管/普通员工无人员管理入口，390px与桌面无横向溢出');
 mock.staff.push({id:'FT013',name:'另一店长',role:'manager',department:'现场运营部',employment_type:'full_time',active:true});
 await detail(p,'FT001');await click(p,'编辑资料');await field(p,'hrRole').selectOption('staff');await click(p,'核对并继续');await field(p,'hrRoleConfirmed').check();await click(p,'确认保存');await p.locator('#loginView').waitFor({state:'visible'});assert.equal(await dialog(p).count(),0);
 passed('本人角色改变导致会话撤销后退出员工管理，要求重新登录');
 assert.deepEqual(errors,[]);
 const newCalls=calls.filter(c=>/^rpc_staff_(management_detail|name_candidates|assignable_positions|create|update_profile|update_positions|deactivate|reactivate)$/.test(c.name));
 assert.equal(new Set(newCalls.map(c=>c.name)).size,8);assert.ok(newCalls.every(c=>!('p_actor_staff_id' in c.params)&&c.params.p_session_token));
 passed('8个014.1 RPC均覆盖，全部仅传session身份，无浏览器运行错误');
 const signatures=JSON.parse(readFileSync(new URL('./0141-contract.json',import.meta.url),'utf8'));
 for(const call of newCalls){
  const keys=signatures[call.name];
  assert.ok(keys,call.name);
  assert.deepEqual(Object.keys(call.params).sort(),keys,`${call.name} SQL signature mismatch`);
 }
 passed('全部实际请求参数逐项对照014.1已部署SQL签名，无猜测字段');
 console.log(`014.1：${groups}组界面/契约回归通过（全部模拟接口，未操作生产库）`);
} finally {for(const c of contexts)await c.close();await browser.close();}
