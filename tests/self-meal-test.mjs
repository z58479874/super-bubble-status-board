// Local mocked RPC contract checks, never uses production identities or credentials.
import assert from 'node:assert/strict';
import {chromium,launchOptions} from './browser.mjs';
import {StaffManagementMock} from './staff-management-mock.mjs';
import {myMealAvailability,renderMyMeal,renderMealPage,mealClock} from '../site/meal-plans.js';
let count=0;
const pass=s=>{count++;console.log(`014.2.2 通过 ${count}: ${s}`);};
const check=(s,f)=>{f();pass(s);};
const now=new Date().toISOString();
const p0={staff_id:'FT002',status:'planned',revision:1,planned_start_time:now,planned_end_time:new Date(Date.now()+2700000).toISOString(),time_until_start_seconds:0,coverage_mode:'area_rotation',actual_safety_critical:false};
const s0={phase:'monitoring',status:'on_duty',current_assignment_type:'mobile_pool',my_handoffs:[]};
const data=(s={},p={})=>({rpc_my_today_state:{...s0,...s},rpc_my_meal_plan:{as_of:now,plan:p===null?null:{...p0,...p},my_cover_tasks:[]}});
check('饭点前30分钟禁用',()=>assert.equal(myMealAvailability(data({}, {time_until_start_seconds:1800})).ready,false));
check('饭点前5分钟允许本人开始',()=>assert.equal(myMealAvailability(data({}, {time_until_start_seconds:300})).ready,true));
for(const status of ['short_leave','off_duty','not_arrived','meal'])check(`${status}不显示本人开始`,()=>assert.equal(myMealAvailability(data({status})).ready,false));
check('在途不允许开始',()=>assert.equal(myMealAvailability(data({current_assignment_type:'in_transit'})).ready,false));
check('未完成交接不允许开始',()=>assert.equal(myMealAvailability(data({my_handoffs:[{}]})).ready,false));
check('结束营业不允许开始',()=>assert.equal(myMealAvailability(data({phase:'ended'})).ready,false));
check('取消计划不允许开始',()=>assert.equal(myMealAvailability(data({}, {status:'cancelled'})).ready,false));
check('安全岗位只显示发起交接',()=>{const h=renderMyMeal(data({}, {actual_safety_critical:true}));assert.match(h,/data-meal-real-handoff/);assert.doesNotMatch(h,/data-meal-start/);});
check('真实meal以状态起点计时，非计划起点',()=>assert.match(renderMyMeal(data({status:'meal',status_since:new Date(Date.now()-18*60000).toISOString()})),/已吃饭：1[78]分钟/));
check('超45分钟只提醒，没有自动返回',()=>assert.match(renderMyMeal(data({status:'meal',status_since:new Date(Date.now()-46*60000).toISOString()})),/午餐已超过45分钟/));
check('今日已返岗必须有真实证据',()=>{assert.notEqual(mealClock(p0,now).state,'returned_today');assert.equal(mealClock({...p0,meal_evidence:{meal_return_evidenced_at:now}},now).state,'returned_today');});
check('已有真实午餐启动证据时不再显示开始入口',()=>{const d=data({}, {meal_evidence:{latest_meal_started_at:now},revision:99});assert.equal(myMealAvailability(d).ready,false);assert.doesNotMatch(renderMyMeal(d),/data-meal-start|data-meal-real-handoff/);assert.match(renderMyMeal(d),/今日午餐已经开始过/);});
check('仅计划或未完成待办不伪造已启动证据',()=>assert.equal(myMealAvailability(data({}, {meal_evidence:{latest_meal_started_at:null}})).ready,true));
check('暂停安全岗复用读取分支显示普通开始',()=>{const d=data({}, {actual_safety_critical:true,next_action:'ask_manager_start_meal'});assert.equal(myMealAvailability(d).safety,false);assert.match(renderMyMeal(d),/data-meal-start/);assert.doesNotMatch(renderMyMeal(d),/data-meal-real-handoff/);});
check('安全岗恢复开放后仍显示交接入口',()=>assert.equal(myMealAvailability(data({}, {actual_safety_critical:true,next_action:'self_request_safety_meal_handoff'})).safety,true));
for(const role of ['manager','deputy','supervisor'])check(`${role}编辑权限`,()=>{
 const html=renderMealPage({rpc_today_meal_plan:{phase:'monitoring',plans:[],analysis:{},is_prepared:true}},role);
 assert.equal(html.includes('data-meal-add'),role!=='supervisor');assert.equal(html.includes('data-meal-advanced'),role==='manager');
});

const mock=new StaffManagementMock(), calls=[],errors=[];
const admin=(n,b={})=>mock.rpc(n,{p_session_token:'FT001-token',...b});
admin('rpc_prepare_today');admin('rpc_select_today_mode',{p_mode:'yellow'});
for(const id of ['FT001','FT002','FT003'])admin('rpc_save_today_roster',{p_staff_id:id,p_scheduled_start:new Date(Date.now()-3600000).toISOString(),p_scheduled_end:new Date(Date.now()+3600000).toISOString()});
admin('rpc_initialize_today_not_arrived');
for(const id of ['FT001','FT002','FT003'])admin('rpc_confirm_today_arrival',{p_staff_id:id,p_assignment_type:'mobile_pool',p_position_id:null,p_area_code:null});
admin('rpc_start_today_monitoring');
let plan={...p0,staff_name:'测试员工A'}, reject=null,startedAt=null;
const browser=await chromium.launch({headless:true,...launchOptions});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.on('pageerror',err=>errors.push(err.message));
await page.route('**/rest/v1/rpc/**',async route=>{
 const name=route.request().url().split('/').pop(),b=route.request().postDataJSON();calls.push({name,b});
 try{
  let result;
  const actor=b.p_session_token?mock.actor(b.p_session_token):null;
  if(name==='rpc_my_meal_plan'){
   const state=mock.state(actor.id);
   result={phase:mock.phase,as_of:new Date().toISOString(),plan:plan?{...plan,...state,status:plan.status,actual_status:state.status,display_state:state.status==='meal'?'currently_meal':'planned',actual_safety_critical:state.current_position_id==='plum',next_action:state.current_position_id==='plum'&&mock.position('plum').expected_open?'self_request_safety_meal_handoff':'ask_manager_start_meal',meal_evidence:{latest_meal_started_at:startedAt}}:null,my_cover_tasks:[]};
  }else if(name==='rpc_my_start_meal'){
   assert.deepEqual(Object.keys(b).sort(),['p_confirm_ready','p_expected_revision','p_session_token']);
   if(reject){const err=reject;reject=null;throw err;}
   mock.requireMonitoring();const state=mock.state(actor.id);
   if(!plan||plan.status!=='planned'||state.status!=='on_duty')throw Error('当前不能开始吃饭');
   if(b.p_expected_revision!==plan.revision)throw Object.assign(Error('该轮餐计划刚刚被其他管理人员调整，请刷新后重新确认。'),{code:'40001'});
   if(startedAt)throw Error('今日午餐已经开始过，如需再次离岗请联系管理人员。');
   if(state.current_position_id==='plum'&&mock.position('plum').expected_open)result=mock.rpc('rpc_live_request_handoff',{p_session_token:b.p_session_token,p_flow:'leave',p_action:'meal',p_position:'plum',p_outgoing:actor.id,p_incoming:plan.cover_staff_id});
   else {assert.equal(b.p_confirm_ready,true);result=admin('rpc_live_start_break',{p_staff_id:actor.id,p_break:'meal'});startedAt=new Date().toISOString();}
  }else if(name==='rpc_my_end_meal'){
   assert.deepEqual(Object.keys(b),['p_session_token']);
   if(reject){const err=reject;reject=null;throw err;}
   if(mock.state(actor.id).status!=='meal')throw Error('只有本人正在吃饭时可以结束吃饭');
   result=admin('rpc_live_return_from_break',{p_staff_id:actor.id});
  }else result=mock.rpc(name,b);
  await route.fulfill({status:200,json:result});
 }catch(err){await route.fulfill({status:400,json:{code:err.code||'P0001',message:err.message}});}
});
const dialog=()=>page.getByRole('dialog');
const refresh=async()=>{await page.locator('#refreshButton').click();await page.waitForTimeout(220);};
const close=async()=>{if(await dialog().count())await dialog().locator('.sheet-close').click();};
const start=async()=>{await page.locator('[data-meal-start]').click();await dialog().locator('[name=mealReady]').check();await dialog().getByRole('button',{name:'确认开始吃饭',exact:true}).click();};
try{
 await page.goto(process.env.SB_TEST_BASE,{waitUntil:'networkidle'});await page.locator('#identifier').fill('FT002');await page.locator('#pin').fill('123456');await page.locator('#loginSubmit').click();await page.locator('[data-meal-start]').waitFor();
 assert.equal(await page.locator('[data-meal-add],[data-meal-entry]').count(),0);pass('普通员工只有本人午餐操作');
 plan=null;await refresh();assert.match(await page.locator('#content').innerText(),/暂未安排.*店长或副店/);pass('无计划等待店长或副店');
 plan={...p0,time_until_start_seconds:1800};await refresh();assert.equal(await page.locator('[data-meal-start]').isDisabled(),true);pass('提前30分钟实际按钮禁用');
 plan.time_until_start_seconds=240;await refresh();assert.equal(await page.locator('[data-meal-start]').isEnabled(),true);pass('提前4分钟实际按钮可用');
 await page.locator('[data-meal-start]').click();assert.equal(await dialog().locator('select,input[type=text]').count(),0);assert.match(await dialog().innerText(),/无需固定顶岗/);await close();pass('员工无需选择新接岗人');
 reject=Error('将低于最低人数');await start();await dialog().getByText('当前人员不足，请先由管理人员安排补位。',{exact:true}).waitFor();assert.match(await dialog().innerText(),/当前人员不足，请先由管理人员安排补位/);assert.equal(mock.state('FT002').status,'on_duty');await close();pass('最低人数拒绝显示补位提示');
 await start();await dialog().waitFor({state:'hidden'});assert.equal(mock.state('FT002').status,'meal');assert.equal(mock.state('FT001').status,'on_duty');await page.locator('[data-meal-end]').waitFor();pass('本人开始只发送本人凭证，读取真实meal');
 mock.state('FT002').status_since=new Date(Date.now()-46*60000).toISOString();await refresh();assert.match(await page.locator('#content').innerText(),/午餐已超过45分钟/);assert.equal(mock.state('FT002').status,'meal');pass('超时后仍meal，不自动返回');
 await page.locator('[data-meal-end]').click();await dialog().getByRole('button',{name:'确认已返岗'}).waitFor();reject=Error('原岗位已有正式值守者');await dialog().getByRole('button',{name:'确认已返岗'}).click();await dialog().getByText(/该岗位已有人正式值守/).waitFor();assert.match(await dialog().innerText(),/岗位已有人正式值守/);await close();pass('返岗冲突给中文提示且不覆盖别人');
 await page.locator('[data-meal-end]').click();await dialog().getByRole('button',{name:'确认已返岗'}).click();await dialog().waitFor({state:'hidden'});assert.equal(mock.state('FT002').status,'on_duty');assert.equal(mock.state('FT002').current_assignment_type,'mobile_pool');assert.equal(mock.state('FT002').return_assignment_type,'none');pass('结束饭休恢复真实返岗安排');
 assert.equal(await page.locator('[data-meal-start]').count(),0);assert.match(await page.locator('#content').innerText(),/今日午餐已经开始过/);pass('本人普通meal返岗后不能再次点击开始');
 const realBefore=JSON.stringify([...mock.states]);const denied=await page.evaluate(async url=>{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_session_token:'FT002-token',p_expected_revision:1,p_confirm_ready:true})});return {ok:r.ok,body:await r.json()};},new URL('rest/v1/rpc/rpc_my_start_meal',process.env.SB_TEST_BASE).href);assert.equal(denied.ok,false);assert.match(denied.body.message,/今日午餐已经开始过/);assert.equal(JSON.stringify([...mock.states]),realBefore);pass('绕过按钮直接重复请求也拒绝且不改现场');
 // 以下继续原有独立revision/安全交接场景，重置的只有本地模拟夹具。
 startedAt=null;
 plan={...p0,revision:2};await refresh();plan.revision=3;await start();await dialog().getByText(/该轮餐计划刚刚被其他管理人员调整/).waitFor();assert.match(await dialog().innerText(),/刚刚被其他管理人员调整/);await close();pass('本人开始也受计划版本冲突保护');
 mock.setAssignment('FT002','position','plum',null);plan={...p0,revision:4,coverage_mode:'named_cover',cover_staff_id:'FT003',cover_staff_name:'测试员工B'};await refresh();assert.equal(await page.locator('[data-meal-start]').count(),0);await page.locator('[data-meal-real-handoff]').click();assert.match(await dialog().innerText(),/测试员工B/);assert.equal(await dialog().locator('input').count(),0);await dialog().getByRole('button',{name:'发起午餐交接',exact:true}).click();await dialog().waitFor({state:'hidden'});assert.equal(mock.state('FT002').status,'on_duty');assert.equal(mock.state('FT002').current_position_id,'plum');assert.equal(mock.handoffs.size,1);pass('安全岗发起既有交接，未完成前仍在原岗');
 const h=[...mock.handoffs.values()][0];for(const name of ['rpc_live_begin_handoff_trip','rpc_live_confirm_handoff_arrival'])mock.rpc(name,{p_session_token:'FT003-token',p_handoff_id:h.handoff_id});mock.rpc('rpc_live_finalize_handoff',{p_session_token:'FT002-token',p_handoff_id:h.handoff_id});await refresh();assert.equal(mock.state('FT002').status,'meal');pass('正式双确认后才进入meal');
 await page.locator('[data-meal-end]').click();await dialog().getByRole('heading',{name:'梅花桩 · 安全返岗'}).waitFor();assert.equal(await dialog().locator('[name=outgoing]').count(),0);assert.match(await dialog().innerText(),/测试员工B/);await close();pass('安全返岗复用实际顶岗人交还，不新增普通返岗旁路');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/01422-my-meal-390.png',fullPage:true});pass('390px本人页面无横向溢出');
 await page.reload({waitUntil:'networkidle'});await page.locator('#dashboardView').waitFor({state:'visible'});await page.locator('[data-meal-end]').waitFor();pass('子路径刷新恢复会话和真实meal');
 // 独立暂停安全岗夹具：不复用上一个测试中仍然存在的顶岗链。
 startedAt=null;mock.handoffs.clear();mock.setAssignment('FT003','mobile_pool',null,null);mock.state('FT003').cover_for_staff_id=null;Object.assign(mock.state('FT002'),{status:'on_duty',return_assignment_type:'none',return_position_id:null,return_area_code:null});mock.setAssignment('FT002','position','plum',null);mock.position('plum').expected_open=false;plan={...p0};await refresh();assert.equal(await page.locator('[data-meal-real-handoff]').count(),0);await start();await dialog().waitFor({state:'hidden'});assert.equal(mock.state('FT002').status,'meal');assert.equal(mock.state('FT002').return_position_id,'plum');assert.equal(mock.handoffs.size,0);pass('暂停安全岗普通确认开始，不创建handoff且保留返岗目标');
 await page.locator('[data-meal-end]').click();await dialog().getByText(/请联系管理人员安排安全补岗交接/).waitFor();assert.equal(await dialog().getByRole('button',{name:'确认已返岗'}).count(),0);assert.equal(mock.state('FT002').status,'meal');await close();pass('暂停安全岗未恢复时提示管理处理，不提供直接返岗');
 mock.position('plum').expected_open=true;await page.locator('[data-meal-end]').click();await dialog().getByText(/请联系管理人员安排安全补岗交接/).waitFor();assert.equal(mock.state('FT002').status,'meal');await close();pass('恢复但无顶岗人的安全岗仍不能直接抢回');
 assert.equal(calls.filter(c=>/rpc_my_(start|end)_meal/.test(c.name)&&('p_staff_id' in c.b||'p_actor_staff_id' in c.b)).length,0);assert.deepEqual(errors,[]);pass('本人RPC无可伪造工号，无页面异常');
 console.log(`014.2.2 self meal total ${count} checks passed (mock only)`);
}finally{await browser.close();}
