import assert from 'node:assert/strict';
import {chromium,launchOptions} from './browser.mjs';
import {StaffManagementMock} from './staff-management-mock.mjs';
import {mealClock,renderForecast,renderMealPage,renderMyMeal,renderNextMeals} from '../site/meal-plans.js';
let passed=0;
const pass=s=>{passed++;console.log(`014.2 通过 ${passed}: ${s}`);};
const check=(s,f)=>{f();pass(s);};
const now=new Date().toISOString(), start=new Date(Date.now()+600000).toISOString(),end=new Date(Date.now()+3300000).toISOString();
const plan=(fields={})=>({staff_id:'FT002',staff_name:'测试员工A',planned_start_time:start,planned_end_time:end,planned_assignment_type:'position',planned_position_id:'plum',planned_position_name:'梅花桩',coverage_mode:'named_cover',cover_staff_id:'FT003',cover_staff_name:'测试员工B',status:'planned',revision:4,display_state:'upcoming',time_until_start_seconds:600,current_assignment_type:'position',current_position_id:'plum',current_position_name:'梅花桩',next_action:'ask_manager_start_meal',next_action_label:'请管理人员确认实际离岗并开始吃饭',active:true,roster_status:'scheduled',...fields});
const analysis=(fields={})=>({baseline_status:'baseline_not_ready',baseline_ready:false,forecast:[{scope_code:'high_altitude',start_at:start,end_at:end,current_count:0,projected_count:0,minimum_coverage:7,target_coverage:9,level:'baseline_not_ready'}],errors:[],blocking_errors:[],warnings:[],risks:[],requires_risk_confirmation:false,preview_revision:'test-preview-1',...fields});
const day=(fields={})=>({business_day:'2026-10-13',phase:'not_started',is_prepared:true,operation_mode:'yellow',plans:[plan()],analysis:analysis(),unplanned_staff:[],planned_count:1,unplanned_count:0,currently_meal_count:0,abnormal_plan_count:0,as_of:now,next_30_minutes:[plan()],...fields});
const my=p=>renderMyMeal({rpc_my_meal_plan:{plan:p,as_of:now,my_cover_tasks:[]}});
check('无计划是正常暂未安排',()=>assert.match(my(null),/暂未安排 · 请等待主管安排/));
check('指定接岗人展示姓名',()=>assert.match(my(plan()),/接岗：测试员工B/));
check('时间以北京时间显示，不随设备时区变化',()=>assert.match(my(plan({planned_start_time:'2026-10-13T04:15:00Z',planned_end_time:'2026-10-13T05:00:00Z'})),/12:15–13:00/));
check('区域内部轮岗中文',()=>assert.match(my(plan({coverage_mode:'area_rotation'})),/覆盖：区域内部轮岗/));
check('现场安排中文',()=>assert.match(my(plan({coverage_mode:'no_fixed_cover'})),/覆盖：现场安排/));
check('基线未就绪的零人数不渲染红色风险',()=>{const html=renderForecast(analysis());assert.match(html,/现场人数基线尚未形成/);assert.match(html,/待营业后复核/);assert.doesNotMatch(html,/pill red|class="meal-risk/);});
check('真实基线风险明确为计划预判',()=>{const html=renderForecast(analysis({baseline_status:'ready',forecast:[{scope_code:'high_altitude',level:'below_minimum',current_count:3,projected_count:2,minimum_coverage:7,target_coverage:9}]}));assert.match(html,/预计低于最低人数/);assert.match(html,/不是现场实时人数/);});
check('已取消计划进入折叠历史且保留原因',()=>{const html=renderMealPage({rpc_today_meal_plan:day({plans:[plan({status:'cancelled',display_state:'cancelled',cancel_reason:'现场调整',cancelled_at:now})]})});assert.ok(html.indexOf('已取消/历史')<html.indexOf('取消原因：现场调整'));});
check('计划岗位不等于实际岗位有提示',()=>assert.match(my(plan({planned_actual_mismatch:true})),/当前岗位与午餐计划不同/));
check('提前15分钟页面提醒',()=>assert.equal(mealClock(plan(),now,Date.parse(now)).state,'upcoming'));
check('已到饭点不推断迟到或已meal',()=>{const c=mealClock(plan({time_until_start_seconds:-1}),now,Date.parse(now));assert.equal(c.state,'due_unverified');assert.match(c.text,/按现场实际情况确认/);});
check('真实meal显示正在吃饭',()=>assert.equal(mealClock(plan({display_state:'currently_meal'}),now).text,'正在吃饭'));
check('营业结束不继续饭点计时',()=>assert.equal(mealClock(plan({display_state:'day_ended'}),now,Date.now()+86400000).text,'今日营业已结束'));
check('普通staff普通岗没有直接开始吃饭按钮',()=>assert.doesNotMatch(my(plan()),/data-meal-real-handoff|data-meal-real-staff/));
check('未来30分钟使用接口给出的列表',()=>assert.match(renderNextMeals({rpc_today_meal_plan:day()}),/测试员工A → 测试员工B接梅花桩/));
check('未来无安排明确空态',()=>assert.match(renderNextMeals({rpc_today_meal_plan:day({next_30_minutes:[]})}),/未来30分钟暂无轮餐安排/));
check('异常计划可定位到受影响员工',()=>assert.match(renderMealPage({rpc_today_meal_plan:day({abnormal_plan_count:1,plans:[plan({planned_actual_mismatch:true})]})}),/data-meal-locate="FT002"/));
check('completed=null不伪装完成数',()=>assert.doesNotMatch(renderMealPage({rpc_today_meal_plan:day({completed_plan_count:null,returned_today_evidence_count:4})}),/已完成计划|已完成.*4/));
check('计划接岗任务没有立即出发按钮',()=>{const html=renderMyMeal({rpc_my_meal_plan:{plan:null,my_cover_tasks:[{planned_start_time:start,planned_position_name:'梅花桩',meal_staff_name:'测试员工A'}]}});assert.match(html,/实际出发须等待正式交接申请/);assert.doesNotMatch(html,/<button/);});
check('按时间排序且非PC横向甘特图',()=>{const html=renderMealPage({rpc_today_meal_plan:day({plans:[plan({staff_name:'后',planned_start_time:end}),plan({staff_name:'前'})]})});assert.ok(html.indexOf('<h3>前')<html.indexOf('<h3>后'));assert.match(html,/meal-timeline/);});
check('已结束无计划编辑入口',()=>assert.doesNotMatch(renderMealPage({rpc_today_meal_plan:day({phase:'ended'})}),/data-meal-edit=/));
check('英文内部代码不作为业务文本',()=>{const html=my(plan({planned_assignment_type:'mobile_pool',coverage_mode:'no_fixed_cover'})).replace(/<[^>]*>/g,'');assert.doesNotMatch(html,/mobile_pool|no_fixed_cover|upcoming/);assert.match(html,/全场机动/);});

const mock=new StaffManagementMock(),calls=[],errors=[],contexts=[];
mock.staff.find(s=>s.id==='FT003').role='deputy';
const m=(n,b={})=>mock.rpc(n,{p_session_token:'FT001-token',...b});
m('rpc_prepare_today');m('rpc_select_today_mode',{p_mode:'yellow'});
for(const id of ['FT001','FT002','FT003','FT004'])m('rpc_save_today_roster',{p_staff_id:id,p_scheduled_start:new Date(Date.now()-3600000).toISOString(),p_scheduled_end:new Date(Date.now()+10*3600000).toISOString()});
m('rpc_initialize_today_not_arrived');
let data=day({unplanned_staff:[{staff_id:'FT001',name:'测试店长'}],unplanned_count:1}), preview=analysis(),reject=null,failRead=false,myPlan=plan();
const browser=await chromium.launch({headless:true,...launchOptions});
async function open(id='FT001'){
 const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);const p=await context.newPage();
 p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/rest/v1/rpc/**',async route=>{
  const name=route.request().url().split('/').pop(),b=route.request().postDataJSON();calls.push({name,b});
  try {
   let result;
   const custom=['rpc_today_meal_plan','rpc_my_meal_plan','rpc_meal_plan_preview','rpc_meal_plan_upsert','rpc_meal_plan_cancel'];
   if(custom.includes(name)){
    const actor=mock.actor(b.p_session_token);if(name!=='rpc_my_meal_plan')mock.requireManager(actor);
    if(failRead&&(name==='rpc_today_meal_plan'||name==='rpc_my_meal_plan'))throw Error('计划读取失败');
    if(name==='rpc_today_meal_plan')result={...data,as_of:new Date().toISOString()};
    if(name==='rpc_my_meal_plan')result={business_day:mock.day,phase:mock.phase,plan:myPlan,my_cover_tasks:[{planned_start_time:start,planned_position_name:'梅花桩',meal_staff_name:'测试员工A'}],as_of:new Date().toISOString()};
    if(name==='rpc_meal_plan_preview')result=preview;
    if(name==='rpc_meal_plan_upsert'||name==='rpc_meal_plan_cancel'){
     if(reject){const e=reject;reject=null;throw e;}
     const old=data.plans.find(p=>p.staff_id===b.p_staff_id);
     if(b.p_expected_revision!==(old?.revision??0))throw Object.assign(Error('轮餐计划已被其他管理人员调整，请刷新后重新确认'),{code:'40001'});
     if(name==='rpc_meal_plan_cancel'){old.status='cancelled';old.display_state='cancelled';old.cancel_reason=b.p_reason;old.cancelled_at=now;old.revision++;}
     else {assert.equal(b.p_preview_revision,preview.preview_revision);const row=plan({staff_id:b.p_staff_id,planned_start_time:b.p_planned_start_time,planned_assignment_type:b.p_planned_assignment_type,planned_position_id:b.p_planned_position_id,coverage_mode:b.p_coverage_mode,revision:(old?.revision??0)+1});data.plans=data.plans.filter(p=>p.staff_id!==b.p_staff_id).concat(row);}
     result=null;
    }
   }else result=mock.rpc(name,b);
   if(name==='rpc_position_candidates')result=result.map(s=>s.staff_id==='FT004'?{...s,has_required_assignment_permission:false}:s);
   await route.fulfill({status:200,json:result});
  }catch(e){await route.fulfill({status:e.code==='42501'?403:400,json:{code:e.code||'23514',message:e.message}});}
 });
 await p.goto(process.env.SB_TEST_BASE,{waitUntil:'networkidle'});
 await p.locator('#identifier').fill(id);await p.locator('#pin').fill('123456');await p.locator('#loginSubmit').click();await p.locator('#dashboardView').waitFor({state:'visible'});await p.locator('#content .section').first().waitFor();return p;
}
const dialog=p=>p.getByRole('dialog'), f=(p,n)=>dialog(p).locator(`[name=${n}]`);
const close=async p=>{if(await dialog(p).count())await dialog(p).locator('.sheet-close').click();};
const refresh=async p=>{await p.locator('#refreshButton').click();await p.waitForTimeout(160);};
const enter=async p=>{await p.locator('[data-page=staff]').click();await p.locator('[data-meal-entry]').click();await p.locator('.meal-timeline').waitFor();};
async function edit(p,id='FT002'){await close(p);await p.locator(`[data-meal-edit="${id}"]`).click();await f(p,'mealStart').waitFor();await f(p,'mealIncoming').waitFor({state:'attached'});await p.waitForTimeout(100);}
const previewClick=async p=>{await dialog(p).getByRole('button',{name:'预览安排',exact:true}).click();await dialog(p).locator('[data-meal-save]').waitFor();};
const width=async p=>assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&(!document.querySelector('.sheet-panel')||document.querySelector('.sheet-panel').scrollWidth<=innerWidth)));
try{
 const p=await open();
 for(const [id,role] of [['FT001','manager'],['FT003','deputy'],['FT004','supervisor']]){
  const page=id==='FT001'?p:await open(id);await page.locator('[data-page=staff]').click();await page.locator('[data-meal-entry]').waitFor();
  if(role!=='manager')assert.equal(await page.getByRole('button',{name:'员工管理',exact:true}).count(),0);
  pass(`${role}今日轮餐可见，员工管理权限保持`);
 }
 const staff=await open('FT002');await staff.getByRole('heading',{name:'今日午餐',exact:true}).waitFor();assert.equal(await staff.locator('[data-meal-entry]').count(),0);assert.equal(calls.filter(c=>c.b.p_session_token==='FT002-token'&&c.name==='rpc_today_meal_plan').length,0);pass('staff仅读取本人计划，管理入口不可见');
 assert.match(await staff.locator('#content').innerText(),/今日接岗任务|计划接岗任务/);pass('本人第一页包含午餐、计划接岗任务');
 await enter(p);await edit(p);assert.equal(await f(p,'mealCover').inputValue(),'named_cover');assert.equal(await f(p,'mealCover').isDisabled(),true);assert.ok(calls.some(c=>c.name==='rpc_position_candidates'&&c.b.p_position_id==='plum'));assert.equal(await f(p,'mealIncoming').locator('option[value=FT004]').count(),0);pass('安全岗锁定指定接岗人并排除没有可安排关系的候选');
 const initialWrites=calls.filter(c=>c.name==='rpc_meal_plan_upsert').length;assert.equal(await dialog(p).locator('[data-meal-save]').count(),0);pass('预览前没有保存按钮');
 await previewClick(p);assert.equal(await f(p,'mealRiskReason').count(),0);await width(p);await p.screenshot({path:'artifacts/0142-preview-390.png',fullPage:true});
 await dialog(p).locator('[data-meal-save]').click();await dialog(p).waitFor({state:'hidden'});
 const saved=calls.filter(c=>c.name==='rpc_meal_plan_upsert').at(-1);assert.equal(saved.b.p_expected_revision,4);assert.equal(saved.b.p_preview_revision,'test-preview-1');assert.equal(saved.b.p_confirm_risk,false);assert.equal(saved.b.p_planned_duration_minutes,45);assert.equal(calls.filter(c=>c.name==='rpc_meal_plan_upsert').length,initialWrites+1);pass('开园前无风险理由可保存，携带服务器revision和preview_revision');
 await edit(p);await previewClick(p);await f(p,'mealNote').fill('改了备注');assert.equal(await dialog(p).locator('[data-meal-save]').count(),0);pass('任何计划输入变化使预览失效');
 preview=analysis({blocking_errors:[{message:'接岗人时间冲突'}]});await previewClick(p);assert.equal(await dialog(p).locator('[data-meal-save]').isDisabled(),true);pass('阻断冲突禁止保存');
 preview=analysis({warnings:[{message:'拓展区域须人工复核'}]});await previewClick(p);assert.equal(await dialog(p).locator('[data-meal-save]').isDisabled(),false);assert.match(await dialog(p).innerText(),/现场暂停部分索道岗位/);pass('黄色提示可继续处理，拓展不自动暂停');
 mock.phase='monitoring';data.phase='monitoring';preview=analysis({baseline_status:'ready',requires_risk_confirmation:true,forecast:[{scope_code:'high_altitude',level:'below_minimum',current_count:3,projected_count:2,minimum_coverage:7,target_coverage:9}]});await previewClick(p);
 let n=calls.filter(c=>c.name==='rpc_meal_plan_upsert').length;await dialog(p).locator('[data-meal-save]').click();assert.equal(calls.filter(c=>c.name==='rpc_meal_plan_upsert').length,n);assert.equal(await f(p,'mealRiskConfirm').isChecked(),false);
 await f(p,'mealRiskReason').fill('管理人员已复核现场');await f(p,'mealRiskConfirm').check();await dialog(p).locator('[data-meal-save]').click();await dialog(p).waitFor({state:'hidden'});assert.equal(calls.filter(c=>c.name==='rpc_meal_plan_upsert').at(-1).b.p_confirm_risk,true);pass('monitoring风险必须明确勾选及填写原因');
 preview=analysis();await edit(p);await previewClick(p);reject=Object.assign(Error('轮餐计划已被其他管理人员调整，请刷新后重新确认'),{code:'40001'});n=calls.length;await dialog(p).locator('[data-meal-save]').click();await dialog(p).getByRole('button',{name:'刷新计划',exact:true}).waitFor();assert.match(await dialog(p).innerText(),/刚刚被其他管理人员修改/);assert.equal(calls.slice(n).filter(c=>c.name==='rpc_meal_plan_upsert').length,1);pass('旧revision冲突只提示刷新，不偷偷重试');
 await dialog(p).getByRole('button',{name:'刷新计划',exact:true}).click();await f(p,'mealStart').waitFor();await previewClick(p);reject=Object.assign(Error('人员、排班、岗位或计划预判已变化，请重新预览后确认'),{code:'40001'});await dialog(p).locator('[data-meal-save]').click();await dialog(p).getByRole('button',{name:'刷新计划',exact:true}).waitFor();assert.match(await dialog(p).innerText(),/现场情况已变化/);pass('过期preview_revision要求重新核对');
 await close(p);await p.locator('[data-meal-cancel="FT002"]').click();await f(p,'mealCancelReason').waitFor();n=calls.filter(c=>c.name==='rpc_meal_plan_cancel').length;await dialog(p).getByRole('button',{name:'确认取消',exact:true}).click();assert.equal(calls.filter(c=>c.name==='rpc_meal_plan_cancel').length,n);await f(p,'mealCancelReason').fill('调整轮餐');await dialog(p).getByRole('button',{name:'确认取消',exact:true}).click();await dialog(p).waitFor({state:'hidden'});assert.equal(await p.locator('.meal-timeline [data-plan-id]').count(),0);pass('取消需原因，保留到历史，不在有效时间轴');
 await p.getByText('已取消/历史（1）',{exact:true}).click();assert.match(await p.locator('#content').innerText(),/调整轮餐/);pass('历史展示取消时间、原因、原岗位');
 await p.screenshot({path:'artifacts/0142-plans-390.png',fullPage:true});await width(p);pass('390px时间轴、表单和历史无横向溢出');
 await p.reload({waitUntil:'networkidle'});await p.locator('#dashboardView').waitFor({state:'visible'});await p.getByRole('heading',{name:'接下来30分钟轮餐'}).waitFor();const home=await p.locator('#content').innerText();assert.ok(home.indexOf('安全关键岗状态')<home.indexOf('接下来30分钟轮餐'));assert.ok(home.indexOf('正在交接')<home.indexOf('接下来30分钟轮餐'));pass('子路径刷新不白屏，未来计划在真实告警与交接之后');
 failRead=true;await refresh(p);assert.match(await p.locator('#content').innerText(),/轮餐数据暂时无法读取/);assert.match(await p.locator('#content').innerText(),/安全关键岗状态/);failRead=false;pass('计划RPC失败不遮挡真实现场信息');
 mock.states.get('FT002').status='on_duty';mock.setAssignment('FT002','position','plum',null);myPlan=plan({next_action:'self_request_safety_meal_handoff',next_action_label:'发起午餐交接'});await refresh(staff);await staff.locator('[data-meal-real-handoff]').click();await dialog(staff).getByRole('heading',{name:'申请安全岗交接'}).waitFor();assert.equal(await f(staff,'handoffAction').inputValue(),'meal');pass('本人安全午餐复用现有安全交接弹层');
 await close(staff);myPlan=plan({next_action:'ask_manager_start_meal',next_action_label:'请管理人员确认实际离岗并开始吃饭'});await refresh(staff);assert.equal(await staff.locator('[data-meal-real-handoff],[data-meal-real-staff]').count(),0);pass('普通岗位staff不得直接开始meal');
 const before=calls.length;myPlan=plan({display_state:'due_unverified',time_until_start_seconds:-5});await refresh(staff);await staff.waitForTimeout(5200);assert.ok(calls.slice(before).filter(c=>c.name==='rpc_my_meal_plan').length>=2);assert.equal(calls.slice(before).filter(c=>/rpc_live_/.test(c.name)).length,0);pass('5秒轮询更新饭点，不触发真实meal/出发/暂停');
 data=day({phase:'monitoring',plans:[plan({revision:8,planned_start_time:'2026-10-13T03:30:00Z'})]});
 mock.phase='monitoring';
 preview=analysis({baseline_status:'ready',requires_risk_confirmation:true,preview_revision:'concurrent-preview',forecast:[{scope_code:'high_altitude',level:'below_minimum',current_count:7,projected_count:6,minimum_coverage:7,target_coverage:9}]});
 const phoneA=await open('FT001'),phoneB=await open('FT003');
 await enter(phoneA);await enter(phoneB);await edit(phoneA);await edit(phoneB);
 await f(phoneB,'mealStart').fill('2026-10-13T12:30');await f(phoneB,'mealNote').fill('手机B保留的备注');await previewClick(phoneB);await f(phoneB,'mealRiskReason').fill('手机B填写的人数风险原因');await f(phoneB,'mealRiskConfirm').check();
 await f(phoneA,'mealStart').fill('2026-10-13T12:00');await previewClick(phoneA);await f(phoneA,'mealRiskReason').fill('手机A已复核');await f(phoneA,'mealRiskConfirm').check();await dialog(phoneA).locator('[data-meal-save]').click();await dialog(phoneA).waitFor({state:'hidden'});
 await phoneB.bringToFront();
 await dialog(phoneB).locator('[data-meal-refresh-note]').waitFor({state:'visible',timeout:20000});
 const bReads=calls.filter(c=>c.name==='rpc_today_meal_plan'&&c.b.p_session_token==='FT003-token').length;
 await phoneB.waitForTimeout(5500);
 assert.equal(calls.filter(c=>c.name==='rpc_today_meal_plan'&&c.b.p_session_token==='FT003-token').length,bReads,'轮餐页连续读取间隔不应仍为5秒');
 assert.equal(await f(phoneB,'mealStart').inputValue(),'2026-10-13T12:30');assert.equal(await f(phoneB,'mealNote').inputValue(),'手机B保留的备注');assert.equal(await f(phoneB,'mealRiskReason').inputValue(),'手机B填写的人数风险原因');assert.equal(await f(phoneB,'mealRiskConfirm').isChecked(),true);assert.match(await dialog(phoneB).innerText(),/编辑中，自动刷新已暂停/);assert.match(await dialog(phoneB).innerText(),/现场或计划数据已有更新/);await width(phoneB);pass('轮餐页15秒轮询，编辑期间后台读取但不重绘或覆盖表单');
 const bWriteStart=calls.filter(c=>c.name==='rpc_meal_plan_upsert'&&c.b.p_session_token==='FT003-token').length;
 await dialog(phoneB).locator('[data-meal-save]').click();await dialog(phoneB).getByRole('button',{name:'刷新计划',exact:true}).waitFor();assert.equal(calls.filter(c=>c.name==='rpc_meal_plan_upsert'&&c.b.p_session_token==='FT003-token').length,bWriteStart+1);assert.match(await dialog(phoneB).innerText(),/刚刚被其他管理人员修改/);
 await dialog(phoneB).getByRole('button',{name:'刷新计划',exact:true}).click();await f(phoneB,'mealStart').waitFor();assert.equal(await f(phoneB,'mealStart').inputValue(),'2026-10-13T12:00');pass('双客户端旧revision被数据库拦截，刷新后读取另一手机的12:00');
 const resumed=calls.filter(c=>c.name==='rpc_today_meal_plan'&&c.b.p_session_token==='FT003-token').length;await close(phoneB);await phoneB.waitForTimeout(300);assert.ok(calls.filter(c=>c.name==='rpc_today_meal_plan'&&c.b.p_session_token==='FT003-token').length>resumed);pass('关闭编辑弹窗后立即恢复并主动刷新');
 assert.equal(calls.filter(c=>c.b.p_actor_staff_id).length,0);assert.deepEqual(errors,[]);pass('所有请求只传会话身份，无未捕获JS异常');
 console.log(`014.2 total ${passed} checks passed (mock only)`);
}finally{for(const c of contexts)await c.close();await browser.close();}
