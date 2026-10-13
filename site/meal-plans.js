import { areaNames, areaLabel, positionLabel, assignmentLabel, statusLabel, phaseNames, modeNames, label, businessError } from './displayLabels.js';

const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const managers = new Set(['manager','deputy','supervisor']);
export const mealStates = { planned:'已安排', upcoming:'即将开始', due_unverified:'计划时间已到', currently_meal:'正在吃饭', cancelled:'已取消', day_ended:'今日营业已结束' };
export const coverNames = { named_cover:'指定接岗人', area_rotation:'区域内部轮岗', no_fixed_cover:'现场安排' };
const levels = {baseline_not_ready:'待营业后复核',below_minimum:'预计低于最低人数',tight:'预计人力偏紧',at_minimum:'预计达到最低人数',mobile_tight:'预计机动力量不足',normal:'预计正常'};
export const mealTime = v => v && Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)) : '—';
const localTime = v => v ? new Date(Date.parse(v)+8*3600000).toISOString().slice(0,16) : '';
const place = p => p.planned_assignment_type === 'position' ? p.planned_position_name || positionLabel(p.planned_position_id) : p.planned_assignment_type === 'area_standby' ? areaLabel(p.planned_area_code) : p.planned_assignment_type === 'mobile_pool' ? '全场机动' : '暂未确定';
const currentPlace = p => assignmentLabel(p);
export function mealClock(p, asOf, now=Date.now()) {
  if (['currently_meal','cancelled','day_ended'].includes(p.display_state)) return {state:p.display_state,text:mealStates[p.display_state]};
  const seconds = Number.isFinite(p.time_until_start_seconds) && asOf ? p.time_until_start_seconds-(now-Date.parse(asOf))/1000 : (Date.parse(p.planned_start_time)-now)/1000;
  if (!Number.isFinite(seconds)) return {state:p.display_state || 'planned',text:'时间待核对'};
  if (seconds<=0) return {state:'due_unverified',text:'计划午餐时间已到，请按现场实际情况确认。'};
  const mins=Math.ceil(seconds/60);
  return {state:seconds<=900?'upcoming':'planned',text:seconds<=900?'还有15分钟左右到计划午餐时间，请准备交接。':`距离午餐：${mins>=60?`${Math.floor(mins/60)}小时`:''}${mins%60}分钟`};
}
export function tickMealClocks(root=document) {
  for (const node of root.querySelectorAll('[data-meal-clock]')) {
    const clock=mealClock(JSON.parse(node.dataset.mealClock),node.dataset.mealAsOf);
    node.textContent=clock.text;
    const badge=node.closest('[data-meal-card]')?.querySelector('[data-meal-state]');
    if(badge) {badge.textContent=mealStates[clock.state] || '待核对';badge.className=`pill ${['upcoming','due_unverified'].includes(clock.state)?'orange':'gray'}`;}
  }
}
const empty = text => `<p class="quiet-line">${e(text)}</p>`;
const section = (name,body) => `<section class="section"><div class="section-title"><h2>${e(name)}</h2></div>${body}</section>`;
const loadError = () => '<p class="meal-hint" role="status">轮餐数据暂时无法读取，请点击页面刷新重试。现场状态仍以实际数据为准。</p>';
function baseline(a={}) { return a.baseline_status==='baseline_not_ready' ? '<div class="meal-hint baseline-not-ready"><strong>现场人数基线尚未形成</strong><p>当前可以提前安排轮餐。开始营业后，系统会按真实在岗人数重新核对。</p></div>' : ''; }
export function renderForecast(a={}) {
  return baseline(a)+`<p class="muted">按当前轮餐计划预计，不是现场实时人数</p><div class="meal-forecast">${(a.forecast||[]).map(f=>{
    const level=a.baseline_status==='baseline_not_ready'?'baseline_not_ready':f.level;
    return `<article class="meal-forecast-row ${level==='below_minimum'?'meal-risk':''}"><div><strong>${e(areaLabel(f.scope_code))}</strong><span class="pill ${level==='below_minimum'?'red':'gray'}">${e(levels[level]||'待复核')}</span></div><small>${e(mealTime(f.start_at))}–${e(mealTime(f.end_at))}</small><p>当前 ${e(f.current_count)} · 预计 ${e(f.projected_count)} · 最低 ${e(f.minimum_coverage)} · 目标 ${e(f.target_coverage)}</p></article>`;
  }).join('') || empty('暂无需要预判的计划时段')}</div>`;
}
function planCard(p,asOf,edit=false,issues=[]) {
  const clock=mealClock(p,asOf);
  const task=p.coverage_mode==='named_cover'?`接岗：${p.cover_staff_name||p.cover_staff_id||'待核对'}`:`覆盖：${coverNames[p.coverage_mode]||'待核对'}`;
  return `<article class="card meal-card" data-meal-card data-plan-id="${e(p.staff_id)}"><div class="card-row"><h3>${e(p.staff_name||p.staff_id)}</h3><span class="pill gray" data-meal-state>${e(mealStates[clock.state]||'待核对')}</span></div><p class="meal-range">${e(mealTime(p.planned_start_time))}–${e(mealTime(p.planned_end_time))}</p><p>计划岗位：${e(place(p))}</p><p>当前岗位：${e(currentPlace(p))}</p><p>${e(task)}</p>${p.planned_actual_mismatch?'<p class="meal-hint">当前岗位与午餐计划不同，请按当前现场岗位完成交接。</p>':''}<p data-meal-clock="${e(JSON.stringify({display_state:p.display_state,time_until_start_seconds:p.time_until_start_seconds,planned_start_time:p.planned_start_time}))}" data-meal-as-of="${e(asOf)}">${e(clock.text)}</p>${p.status==='cancelled'?`<p>取消原因：${e(p.cancel_reason)}</p><p>取消时间：${e(localTime(p.cancelled_at).replace('T',' '))}（北京时间）</p>`:''}${issues.length?`<div class="meal-hint">${issues.map(i=>`<p>${e(i.message)}</p>`).join('')}</div>`:''}${edit?`<div class="card-actions"><button class="action-button" data-meal-edit="${e(p.staff_id)}">${p.status==='cancelled'?'重新安排':'修改计划'}</button>${p.status!=='cancelled'?`<button class="action-button" data-meal-cancel="${e(p.staff_id)}">取消计划</button>`:''}</div>`:''}</article>`;
}
export function renderMealPage(data) {
  const d=data.rpc_today_meal_plan;
  if(!d || d.load_error) return section('今日轮餐',loadError());
  const editable=['not_started','monitoring'].includes(d.phase);
  const plans=[...(d.plans||[])].sort((a,b)=>Date.parse(a.planned_start_time)-Date.parse(b.planned_start_time));
  const active=plans.filter(p=>p.status!=='cancelled'),history=plans.filter(p=>p.status==='cancelled');
  const affected=active.filter(p=>p.active===false||p.roster_status==='cancelled'||p.planned_actual_mismatch||p.has_pending_handoff||['off_duty','short_leave'].includes(p.actual_status)||p.current_assignment_type==='in_transit'||(d.analysis?.errors||[]).some(i=>i.staff_ids?.includes(p.staff_id)));
  return `<div class="page-title"><div><h1>今日轮餐</h1><p>${e(d.business_day)} · ${e(label(phaseNames,d.phase))} · ${e(label(modeNames,d.operation_mode,'尚未选模式'))}</p></div><button class="refresh-button" id="refreshButton">刷新</button></div><button class="action-button" data-meal-back>返回今日人员</button><p class="meal-hint">轮餐计划只用于预排；真实吃饭、调岗和交接仍需按现场流程操作。</p>${!d.is_prepared?empty('今日尚未准备，请先在总览准备营业日'):''}<div class="metric-grid">${[['已安排',d.planned_count],['未安排',d.unplanned_count],['正在吃饭',d.currently_meal_count],['计划异常',d.abnormal_plan_count]].map(([t,n])=>`<div class="metric"><span>${t}</span><strong>${e(n??'—')}</strong></div>`).join('')}</div>${d.abnormal_plan_count>0?`<details class="meal-hint"><summary>有 ${e(d.abnormal_plan_count)} 项计划需要复核</summary>${affected.map(p=>`<button class="action-button" data-meal-locate="${e(p.staff_id)}">查看 ${e(p.staff_name)} 的计划</button>`).join('')}</details>`:''}${baseline(d.analysis)}${section('轮餐时间轴',`<div class="meal-timeline">${active.map(p=>planCard(p,d.as_of,editable,[...(d.analysis?.errors||[]),...(d.analysis?.warnings||[])].filter(i=>i.staff_ids?.includes(p.staff_id)))).join('')||empty('暂未安排轮餐')}</div>`)}${section('未安排午餐',(d.unplanned_staff||[]).length?`<details><summary>还有 ${e(d.unplanned_count)} 人未安排</summary><div class="meal-unplanned">${d.unplanned_staff.map(s=>`<button class="action-button" data-meal-edit="${e(s.staff_id)}" ${editable?'':'disabled'}>${e(s.name)} · 安排午餐</button>`).join('')}</div></details>`:empty(d.is_prepared?'今日排班人员已全部安排':'请先准备今日人员名单'))}<details class="section"><summary>查看计划人数预判</summary>${renderForecast(d.analysis)}</details><details class="section"><summary>已取消/历史（${history.length}）</summary>${history.map(p=>planCard(p,d.as_of,editable)).join('')||empty('暂无取消计划')}</details>`;
}
export function renderMyMeal(data) {
  const d=data.rpc_my_meal_plan;
  if(!d || d.load_error) return section('今日午餐',loadError());
  const p=d.plan;
  const button=p?.next_action==='self_request_safety_meal_handoff'?'<button class="action-button primary" data-meal-real-handoff>发起午餐交接</button>':p?.next_action==='existing_handoff'?'<button class="action-button" data-meal-real-tasks>查看正式交接待办</button>':p?.next_action==='manager_start_meal'?'<button class="action-button" data-meal-real-staff>查看实际现场操作</button>':'';
  return section('今日午餐',p?planCard(p,d.as_of,false,d.issues||[])+`<p class="meal-hint">${e(p.next_action_label||'请按现场实际情况处理')}</p>${button}`:empty('暂未安排 · 请等待主管安排'))+section('今日接岗任务',(d.my_cover_tasks||[]).map(t=>`<article class="card"><h3>${e(mealTime(t.planned_start_time))} · 接${e(t.planned_position_name||areaLabel(t.planned_area_code))}</h3><p>替：${e(t.meal_staff_name)}</p><p class="muted">计划接岗任务，实际出发须等待正式交接申请</p></article>`).join('')||empty('今日暂无计划接岗任务'));
}
export function renderNextMeals(data) {
  const d=data.rpc_today_meal_plan;
  return section('接下来30分钟轮餐',!d || d.load_error?loadError():(d.next_30_minutes||[]).map(p=>`<div class="quiet-line">${e(mealTime(p.planned_start_time))} ${e(p.staff_name)} → ${e(p.coverage_mode==='named_cover'?`${p.cover_staff_name||p.cover_staff_id}接${place(p)}`:`${place(p)} · ${coverNames[p.coverage_mode]||'待核对'}`)}</div>`).join('')||empty('未来30分钟暂无轮餐安排'));
}

export function createMealActions(api) {
  const {rpc,getSession,getData,renderSheet,getSheet,closeSheet,callWrite,setSheetError,navigatePage,openMySafetyLeave,openStaff}=api;
  const token=()=>getSession()?.session_token;
  const canManage=()=>managers.has(getSession()?.role);
  let generation=0;
  let editing=null;
  const editingNotice='<p class="meal-edit-state">编辑中，自动刷新已暂停</p><p class="meal-background-update" data-meal-refresh-note hidden></p>';
  function mealSignature(d,id) {
    const plan=(d?.plans||[]).find(p=>p.staff_id===id);
    return JSON.stringify({revision:plan?.revision??0,status:plan?.status??null,
      phase:d?.phase??null,analysis:d?.analysis?.preview_revision??null});
  }
  function beginEditing(id,kind) { editing={staffId:id,kind,signature:null}; }
  function markEditingBaseline(d,id) { if(editing?.staffId===id) editing.signature=mealSignature(d,id); }
  function isEditing(page) { return page==='meals'&&editing!==null; }
  function onSheetClosed() { const wasEditing=editing!==null; if(wasEditing) generation++; editing=null; return wasEditing; }
  function handleBackgroundRefresh(page,data,error) {
    if(!isEditing(page)||error||!data?.rpc_today_meal_plan||editing.signature===null)return;
    if(mealSignature(data.rpc_today_meal_plan,editing.staffId)===editing.signature)return;
    const note=getSheet()?.querySelector('[data-meal-refresh-note]');
    if(note){note.hidden=false;note.textContent='现场或计划数据已有更新，保存前请重新预览。';}
  }
  function error(err) {setSheetError(/^[\s\S]*[\u4e00-\u9fff]/.test(err?.message||'') && !/SQLSTATE|public\.|app_private\.|\brpc_/.test(err.message)?err.message:businessError(err),getSession()?.role==='manager'?err:null);}
  async function fresh() {return rpc('rpc_today_meal_plan',{p_session_token:token()});}
  function conflict(err,id) {
    if(err.code!=='40001' && err.code!=='55P03') return false;
    const revision=/已被其他管理人员调整/.test(err.message||'');
    renderSheet({title:'请重新核对轮餐安排',description:revision?'该计划刚刚被其他管理人员修改，请重新查看最新安排。':'现场情况已变化，请重新核对轮餐安排。',buttons:[{label:'关闭',action:closeSheet},{label:'刷新计划',primary:true,action:()=>openEditor(id)}]});return true;
  }
  async function openEditor(id) {
    if(!canManage()) return;
    beginEditing(id,'edit');
    const gen=++generation;
    renderSheet({title:'安排午餐',description:'正在读取最新计划与今日人员…'});
    const loading=getSheet();
    let d,staff,positions;
    try {[d,staff,positions]=await Promise.all([fresh(),rpc('rpc_today_staff',{p_session_token:token()}),rpc('rpc_today_positions',{p_session_token:token()})]);}
    catch(err){if(getSheet()===loading)error(err);return;}
    if(gen!==generation||getSheet()!==loading) return;
    markEditingBaseline(d,id);
    if(!['not_started','monitoring'].includes(d.phase)) {setSheetError('请先准备营业日；结束营业后不能修改轮餐计划。');return;}
    const old=(d.plans||[]).find(p=>p.staff_id===id), person=staff.find(s=>s.staff_id===id);
    if(!person || person.roster_status!=='scheduled'||person.active===false) {setSheetError('该人员当前没有有效排班，不能安排轮餐。');return;}
    const revision=old?.revision??0;
    const defaultTime=`${d.business_day}T12:00`;
    const fixed=positions.filter(p=>!p.is_mobile&&p.active!==false);
    const opts=(arr,value)=>arr.map(([v,t])=>`<option value="${e(v)}" ${value===v?'selected':''}>${e(t)}</option>`).join('');
    renderSheet({title:old?.status==='planned'?'修改午餐计划':'安排午餐',description:`${person.name} · ${id}`,body:`${editingNotice}<p>今日排班：${e(mealTime(person.scheduled_start_time))}–${e(mealTime(person.scheduled_end_time))}（北京时间）</p><label class="sheet-field">计划午餐时间（北京时间）<input type="datetime-local" name="mealStart" value="${e(localTime(old?.planned_start_time)||defaultTime)}"></label><p>时长：45分钟</p><label class="sheet-field">计划位置<select name="mealAssignment">${opts([['unspecified','暂未确定'],['position','固定岗位'],['area_standby','区域'],['mobile_pool','机动']],old?.planned_assignment_type||'unspecified')}</select></label><label class="sheet-field" data-meal-position>固定岗位<select name="mealPosition"><option value="">请选择岗位</option>${opts(fixed.map(p=>[p.position_id,p.name]),old?.planned_position_id)}</select></label><label class="sheet-field" data-meal-area>区域<select name="mealArea"><option value="">请选择区域</option>${opts(Object.entries(areaNames).filter(([code])=>code!=='global'),old?.planned_area_code)}</select></label><label class="sheet-field">覆盖方式<select name="mealCover">${opts(Object.entries(coverNames),old?.coverage_mode||'no_fixed_cover')}</select></label><label class="sheet-field" data-meal-cover>接岗人<select name="mealIncoming"></select></label><p class="muted" data-meal-candidate-note></p><label class="sheet-field">备注<textarea name="mealNote" maxlength="500">${e(old?.note||'')}</textarea></label><p class="meal-hint">预览不会开始吃饭，也不会让接岗人出发。</p><div data-meal-preview></div>`,buttons:[{label:'预览安排',primary:true,action:()=>preview()}]});
    const sheet=getSheet(), $=s=>sheet.querySelector(s), val=n=>$(`[name=${n}]`).value;
    let candidateBusy=false, candidateError=false, requestId=0, previewBusy=false;
    const invalidate=()=>{$('[data-meal-preview]').innerHTML='';};
    async function choices() {
      const sequence=++requestId, type=val('mealAssignment'), pos=fixed.find(p=>p.position_id===val('mealPosition'));
      $('[data-meal-position]').hidden=type!=='position';$('[data-meal-area]').hidden=type!=='area_standby';
      const safety=type==='position'&&pos?.is_safety_critical;
      if(safety) $('[name=mealCover]').value='named_cover';
      $('[name=mealCover]').disabled=!!safety;
      $('[data-meal-cover]').hidden=val('mealCover')!=='named_cover';
      invalidate();candidateError=false;
      const selected=val('mealIncoming')||old?.cover_staff_id;
      let candidates=staff.filter(s=>s.staff_id!==id&&s.roster_status==='scheduled'&&s.active!==false);
      $('[name=mealIncoming]').disabled=true;
      if(type==='position'&&pos) {
        candidateBusy=true;$('[data-meal-candidate-note]').textContent='正在核对该岗位可安排关系…';
        try {
          const response=await rpc('rpc_position_candidates',{p_session_token:token(),p_position_id:pos.position_id});
          if(sequence!==requestId||getSheet()!==sheet)return;
          candidates=response.filter(s=>s.staff_id!==id&&s.has_required_assignment_permission===true);
        } catch(err){if(sequence===requestId&&getSheet()===sheet){candidateError=true;error(err);}return;}
        finally {if(sequence===requestId)candidateBusy=false;}
      } else candidateBusy=false;
      if(sequence!==requestId||getSheet()!==sheet)return;
      $('[name=mealIncoming]').innerHTML='<option value="">请选择接岗人</option>'+opts(candidates.map(s=>[s.staff_id,`${s.name} · ${statusLabel(s)}${s.ineligible_reason?` · ${s.ineligible_reason}`:''}`]),selected);
      $('[name=mealIncoming]').disabled=false;
      $('[data-meal-candidate-note]').textContent=safety?'安全关键岗必须指定接岗人。候选已核对可安排关系，计划可行性仍以预览为准。':'候选来自今日有效人员；当前状态仅作提示，最终以计划预览为准。';
    }
    for(const name of ['mealAssignment','mealPosition','mealArea','mealCover']) $(`[name=${name}]`).addEventListener('change',choices);
    for(const name of ['mealStart','mealIncoming','mealNote']) $(`[name=${name}]`).addEventListener('input',invalidate);
    await choices();
    function payload() {
      const start=val('mealStart');if(!start || !Number.isFinite(Date.parse(start+':00+08:00')))throw new Error('请选择完整的北京时间。');
      const type=val('mealAssignment'), cover=val('mealCover');
      if(type==='position'&&!val('mealPosition'))throw new Error('请选择固定岗位。');
      if(type==='area_standby'&&!val('mealArea'))throw new Error('请选择区域。');
      if(cover==='named_cover'&&!val('mealIncoming'))throw new Error('请选择接岗人。');
      return {p_staff_id:id,p_planned_start_time:new Date(start+':00+08:00').toISOString(),p_expected_revision:revision,p_planned_duration_minutes:45,p_planned_assignment_type:type,p_planned_position_id:type==='position'?val('mealPosition'):null,p_planned_area_code:type==='area_standby'?val('mealArea'):null,p_coverage_mode:cover,p_cover_staff_id:cover==='named_cover'?val('mealIncoming'):null,p_note:val('mealNote').trim()};
    }
    async function preview() {
      if(previewBusy||candidateBusy)return;
      if(candidateError){setSheetError('候选人核对失败，请重新选择岗位后再预览。');return;}
      let params;try{params=payload();}catch(err){error(err);return;}
      previewBusy=true;invalidate();setSheetError('');
      const btn=$('[data-sheet-button="0"]');btn.disabled=true;
      try {
        const p=await rpc('rpc_meal_plan_preview',{p_session_token:token(),...params});
        if(getSheet()!==sheet)return;
        if(JSON.stringify(payload())!==JSON.stringify(params)){setSheetError('填写内容已变化，请重新预览。');return;}
        const errors=p.blocking_errors??p.errors??[],warnings=p.warnings||[];
        const risky=p.baseline_status!=='baseline_not_ready'&&p.requires_risk_confirmation===true;
        const messages=(items,cls)=>items.length?`<div class="meal-hint ${cls}">${items.map(i=>`<p>${e(i.message||'请复核该计划')}</p>`).join('')}</div>`:'';
        $('[data-meal-preview]').innerHTML=messages(errors,'meal-block')+messages(warnings,'meal-warning')+messages((p.risks||[]).filter(r=>r.message),'meal-risk')+renderForecast(p)+(p.warnings?.some(w=>/拓展/.test(w.message))?'<p class="meal-hint">拓展轮餐可能需要现场暂停部分索道岗位，请由主管按实际情况处理。</p>':'')+(risky?'<div class="meal-risk"><strong>该轮餐安排预计会使部分区域低于最低人数。</strong><label class="sheet-field">风险确认原因<textarea name="mealRiskReason" maxlength="500"></textarea></label><label class="meal-check"><input type="checkbox" name="mealRiskConfirm">我已核对现场并确认本次计划风险</label></div>':'')+`<button class="primary-button" data-meal-save ${errors.length?'disabled':''}>确认保存计划</button>`;
        $('[data-meal-save]').addEventListener('click',async()=>{
          if(errors.length)return;
          let current;try{current=payload();}catch(err){invalidate();error(err);return;}
          if(JSON.stringify(current)!==JSON.stringify(params)){invalidate();setSheetError('填写内容已变化，请重新预览。');return;}
          const reason=$('[name=mealRiskReason]')?.value.trim()||null, confirmed=$('[name=mealRiskConfirm]')?.checked===true;
          if(risky&&(!confirmed||!reason)){setSheetError('请填写风险确认原因，并明确勾选确认。');return;}
          await callWrite('rpc_meal_plan_upsert',{...params,p_preview_revision:p.preview_revision,p_confirm_risk:risky&&confirmed,p_risk_reason:risky?reason:null},'轮餐计划已保存；现场状态没有改变。',{closeBeforeRefresh:true,onError:err=>{if(!conflict(err,id))error(err);return true;}});
        });
      } catch(err){if(getSheet()===sheet&&!conflict(err,id))error(err);}
      finally{previewBusy=false;btn.disabled=false;}
    }
  }
  async function cancel(id) {
    if(!canManage())return;
    beginEditing(id,'cancel');
    renderSheet({title:'取消轮餐计划',description:'正在核对当前版本…'});const loading=getSheet();
    let d;try{d=await fresh();}catch(err){if(getSheet()===loading)error(err);return;}
    if(getSheet()!==loading)return;
    markEditingBaseline(d,id);
    const p=(d.plans||[]).find(p=>p.staff_id===id);
    if(!p||p.status==='cancelled'||!['not_started','monitoring'].includes(d.phase)){setSheetError('计划状态已变化，请刷新计划。');return;}
    renderSheet({title:'确认取消轮餐计划',description:`${p.staff_name} · ${mealTime(p.planned_start_time)}。取消后仍保留历史记录。`,body:`${editingNotice}<label class="sheet-field">取消原因<textarea name="mealCancelReason" maxlength="500"></textarea></label>`,buttons:[{label:'保留计划',action:closeSheet},{label:'确认取消',danger:true,action:()=>{const reason=getSheet()?.querySelector('[name=mealCancelReason]')?.value.trim();if(!reason){setSheetError('请填写取消原因。');return;}callWrite('rpc_meal_plan_cancel',{p_staff_id:id,p_expected_revision:p.revision,p_reason:reason},'计划已取消，记录保留在历史中。',{closeBeforeRefresh:true,onError:err=>{if(!conflict(err,id))error(err);return true;}});}}]});
  }
  function decorate(page,data,content) {
    if(canManage()&&page==='staff') {
      const button=document.createElement('button');button.className='action-button primary';button.textContent='今日轮餐';button.dataset.mealEntry='';button.onclick=()=>navigatePage('meals');content.querySelector('.page-title')?.after(button);
    }
    content.querySelector('[data-meal-back]')?.addEventListener('click',()=>navigatePage('staff'));
    content.querySelectorAll('[data-meal-edit]').forEach(b=>b.addEventListener('click',()=>openEditor(b.dataset.mealEdit)));
    content.querySelectorAll('[data-meal-cancel]').forEach(b=>b.addEventListener('click',()=>cancel(b.dataset.mealCancel)));
    content.querySelectorAll('[data-meal-locate]').forEach(b=>b.addEventListener('click',()=>{const card=[...content.querySelectorAll('[data-plan-id]')].find(c=>c.dataset.planId===b.dataset.mealLocate);card?.scrollIntoView({block:'center'});card?.classList.add('meal-highlight');}));
    content.querySelector('[data-meal-real-handoff]')?.addEventListener('click',()=>{
      const now=getData().rpc_my_today_state,plan=getData().rpc_my_meal_plan?.plan;
      if(plan?.next_action==='self_request_safety_meal_handoff'&&now?.phase==='monitoring')openMySafetyLeave(now);
    });
    content.querySelector('[data-meal-real-tasks]')?.addEventListener('click',()=>content.querySelector('[data-my-handoff-id]')?.scrollIntoView({block:'center'}));
    content.querySelector('[data-meal-real-staff]')?.addEventListener('click',()=>{if(canManage()) {navigatePage('staff');}});
  }
  return {decorate,isEditing,handleBackgroundRefresh,onSheetClosed};
}
