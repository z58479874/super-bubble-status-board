import { areaNames, areaLabel, positionLabel, assignmentLabel, statusLabel, phaseNames, modeNames, label, businessError } from './displayLabels.js';

const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const editors = new Set(['manager','deputy']);
const managers = new Set(['manager','deputy','supervisor']);
export const mealStates = { planned:'已安排', upcoming:'已安排', due_unverified:'到饭点', currently_meal:'吃饭中', returned_today:'今日已返岗', cancelled:'已取消', day_ended:'今日营业已结束' };
export const coverNames = { named_cover:'指定人员顶岗', area_rotation:'该岗位无需固定顶岗', no_fixed_cover:'到时现场安排' };
const levels = {baseline_not_ready:'待营业后复核',below_minimum:'预计低于最低人数',tight:'预计人力偏紧',at_minimum:'预计达到最低人数',mobile_tight:'预计机动力量不足',normal:'预计正常'};
export const mealTime = v => v && Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)) : '—';
const localTime = v => v ? new Date(Date.parse(v)+8*3600000).toISOString().slice(0,16) : '';
const place = p => p.planned_assignment_type === 'position' ? p.planned_position_name || positionLabel(p.planned_position_id) : p.planned_assignment_type === 'area_standby' ? areaLabel(p.planned_area_code) : p.planned_assignment_type === 'mobile_pool' ? '全场机动' : '暂未确定';
const currentPlace = p => assignmentLabel(p);
export function mealClock(p, asOf, now=Date.now()) {
  if(p.actual_status!=='meal'&&p.meal_evidence?.meal_return_evidenced_at&&p.status!=='cancelled') return {state:'returned_today',text:'今日已返岗'};
  if (['currently_meal','cancelled','day_ended'].includes(p.display_state)) return {state:p.display_state,text:mealStates[p.display_state]};
  const seconds = Number.isFinite(p.time_until_start_seconds) && asOf ? p.time_until_start_seconds-(now-Date.parse(asOf))/1000 : (Date.parse(p.planned_start_time)-now)/1000;
  if (!Number.isFinite(seconds)) return {state:p.display_state || 'planned',text:'时间待核对'};
  if (seconds<=0) return {state:'due_unverified',text:'已到计划午餐时间，请根据现场情况开始吃饭。'};
  const mins=Math.ceil(seconds/60);
  return {state:seconds<=900?'upcoming':'planned',text:seconds<=900?'距离午餐：15分钟以内':`距离午餐：${mins>=60?`${Math.floor(mins/60)}小时`:''}${mins%60}分钟`};
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
export function planCard(p,asOf,edit=false,issues=[]) {
  const clock=mealClock(p,asOf);
  const task=p.coverage_mode==='named_cover'?(p.cover_staff_name||'待核对'):p.coverage_mode==='area_rotation'?'无需固定顶岗':'到时现场安排';
  return `<article class="card meal-card" data-meal-card data-plan-id="${e(p.staff_id)}"><div class="card-row"><h3>${e(p.staff_name||p.staff_id)}</h3><span class="pill gray" data-meal-state>${e(mealStates[clock.state]||'已安排')}</span></div><p class="meal-range">${e(mealTime(p.planned_start_time))}–${e(mealTime(p.planned_end_time))}</p><p>当前岗位：${e(currentPlace(p))}</p><p>顶岗安排：${e(task)}</p>${p.planned_actual_mismatch?'<p class="meal-hint">当前岗位与午餐计划不同，请按当前现场岗位完成交接。</p>':''}<p data-meal-clock="${e(JSON.stringify(p))}" data-meal-as-of="${e(asOf)}">${e(clock.text)}</p>${clock.state==='due_unverified'&&p.actual_status==='on_duty'?`<p class="meal-warning">计划${e(mealTime(p.planned_start_time))}午餐，目前仍在岗</p>`:''}${p.status==='cancelled'?`<p>取消原因：${e(p.cancel_reason)}</p><p>取消时间：${e(localTime(p.cancelled_at).replace('T',' '))}（北京时间）</p>`:''}${edit?`<div class="card-actions"><button class="action-button" data-meal-edit="${e(p.staff_id)}">${p.status==='cancelled'?'重新安排':'修改饭点'}</button>${p.status!=='cancelled'?`<button class="action-button" data-meal-cancel="${e(p.staff_id)}">取消安排</button>`:''}</div>`:''}</article>`;
}
export function renderMealPage(data, role='staff') {
  const d=data.rpc_today_meal_plan;
  if(!d || d.load_error) return section('今日轮餐',loadError());
  const editable=editors.has(role)&&['not_started','monitoring'].includes(d.phase);
  const plans=[...(d.plans||[])].sort((a,b)=>Date.parse(a.planned_start_time)-Date.parse(b.planned_start_time));
  const active=plans.filter(p=>p.status!=='cancelled'),history=plans.filter(p=>p.status==='cancelled');
  return `<div class="page-title"><div><h1>今日轮餐</h1><p>${e(d.business_day)} · ${e(label(phaseNames,d.phase))}</p></div><button class="refresh-button" id="refreshButton">刷新</button></div><button class="action-button" data-meal-back>返回今日人员</button>${editable?'<button class="action-button primary" data-meal-add>＋ 安排午餐</button>':''}<p class="meal-hint">饭点是安排，员工确认后才开始实际吃饭。</p>${!d.is_prepared?empty('今日尚未准备，请先在总览准备营业日'):''}${section('今日安排',`<div class="meal-timeline">${active.map(p=>planCard(p,d.as_of,editable)).join('')||empty('暂未安排轮餐')}</div>`)}${editable?section('未安排午餐',`<details><summary>还有 ${e(d.unplanned_count||0)} 人未安排</summary>${(d.unplanned_staff||[]).map(s=>`<button class="action-button" data-meal-edit="${e(s.staff_id)}">${e(s.name)} · 安排午餐</button>`).join('')}</details>`):''}${role==='manager'?`<details class="section" data-meal-advanced><summary>高级信息</summary>${renderForecast(d.analysis)}</details>`:''}<details class="section"><summary>已取消/历史（${history.length}）</summary>${history.map(p=>planCard(p,d.as_of,editable)).join('')||empty('暂无取消计划')}</details>`;
}
export function myMealAvailability(data, now=Date.now()) {
  const d=data.rpc_my_meal_plan||{}, s=data.rpc_my_today_state||{}, p=d.plan;
  const elapsed=d.as_of?(now-Date.parse(d.as_of))/1000:0;
  const seconds=Number.isFinite(p?.time_until_start_seconds)?p.time_until_start_seconds-elapsed:(Date.parse(p?.planned_start_time)-now)/1000;
  const alreadyStarted=!!p?.meal_evidence?.latest_meal_started_at;
  // 既有read model的next_action已经按is_safety_critical AND expected_open分流。
  // 分类字段本身不表示当天启用；未知分支保守保留交接提示，写入仍由数据库最终核对。
  const safety=p?.actual_safety_critical===true&&!['manager_start_meal','ask_manager_start_meal'].includes(p?.next_action);
  return {s,p,d,alreadyStarted,ready:!!(!alreadyStarted&&p?.status==='planned'&&s.phase==='monitoring'&&s.status==='on_duty'&&['position','area_standby','mobile_pool'].includes(s.current_assignment_type)&&!s.my_handoffs?.length&&!p.has_pending_handoff&&seconds<=300),
    safety,seconds};
}
export function renderMyMeal(data) {
  const {s,p,d,ready,safety,seconds,alreadyStarted}=myMealAvailability(data);
  if(d.load_error)return section('今日午餐',loadError());
  let body=p?planCard(p,d.as_of):empty('暂未安排 · 请等待店长或副店安排。');
  if(s.status==='meal') {
    const elapsed=Math.max(0,(Date.parse(d.as_of||new Date().toISOString())-Date.parse(s.status_since))/60000);
    const minutes=Math.floor(elapsed);
    body=`<article class="card meal-card"><h3>吃饭中</h3><p>开始时间：${e(mealTime(s.status_since))}</p><p>已吃饭：${e(minutes)}分钟 · 剩余：${Math.max(0,45-minutes)}分钟</p>${elapsed>45?'<p class="meal-warning">午餐已超过45分钟，请尽快结束吃饭并返回岗位。</p>':''}${s.phase==='monitoring'?'<button class="action-button primary" data-meal-end>结束吃饭 / 返回岗位</button>':''}</article>`;
  } else if(alreadyStarted&&s.status==='on_duty') {
    body+='<p class="meal-hint">今日午餐已经开始过，如需再次离岗请联系管理人员。</p>';
  } else if(p?.status==='planned'&&s.status==='on_duty'&&s.phase==='monitoring') {
    body+=safety?'<p class="meal-hint">该岗位需要完成接岗后才能开始吃饭。</p>':'';
    body+=`<button class="action-button primary" data-meal-${safety?'real-handoff':'start'} ${ready?'':'disabled'}>${safety?'发起午餐交接':'开始吃饭'}</button>${seconds>300?'<p class="muted">尚未到计划午餐时间</p>':ready?'<p class="meal-hint">现在是你的计划午餐时间</p>':'<p class="muted">请先完成当前现场任务</p>'}`;
  }
  return section('今日午餐',body)+section('今日接岗任务',(d.my_cover_tasks||[]).map(t=>`<article class="card"><h3>${e(mealTime(t.planned_start_time))} · 接${e(t.planned_position_name||areaLabel(t.planned_area_code))}</h3><p>替：${e(t.meal_staff_name)}</p><p class="muted">计划接岗任务，实际出发须等待正式交接申请</p></article>`).join('')||empty('今日暂无计划接岗任务'));
}

export function renderNextMeals(data) {
  const d=data.rpc_today_meal_plan;
  return section('接下来30分钟轮餐',!d || d.load_error?loadError():(d.next_30_minutes||[]).map(p=>`<div class="quiet-line">${e(mealTime(p.planned_start_time))} ${e(p.staff_name)} → ${e(p.coverage_mode==='named_cover'?`${p.cover_staff_name||p.cover_staff_id}接${place(p)}`:`${place(p)} · ${coverNames[p.coverage_mode]||'待核对'}`)}</div>`).join('')||empty('未来30分钟暂无轮餐安排'));
}

export function createMealActions(api) {
  const {rpc,getSession,getData,renderSheet,getSheet,closeSheet,callWrite,setSheetError,navigatePage,openMySafetyLeave,openMySafetyReturn,openStaff}=api;
  const token=()=>getSession()?.session_token;
  const canManage=()=>managers.has(getSession()?.role);
  const canEdit=()=>editors.has(getSession()?.role);
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
    renderSheet({title:'请重新核对轮餐安排',description:revision?'该轮餐计划刚刚被其他管理人员调整，请刷新后重新确认。':'现场情况已变化，请重新核对轮餐安排。',buttons:[{label:'关闭',action:closeSheet},{label:'刷新计划',primary:true,action:()=>openEditor(id)}]});return true;
  }
  async function openEditor(id) {
    if(!canEdit()) return;
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
    const actual=['position','area_standby','mobile_pool'].includes(person.current_assignment_type)?person.current_assignment_type:'unspecified';
    const assignment=old?.planned_assignment_type||actual;
    const position=old?.planned_position_id||(assignment==='position'?person.current_position_id:null);
    const area=old?.planned_area_code||(assignment==='area_standby'?person.current_area_code:null);
    renderSheet({title:old?.status==='planned'?'修改饭点':'安排午餐',description:'按北京时间安排；实际吃饭由员工本人确认。',body:`${editingNotice}<label class="sheet-field">员工<select name="mealStaff">${opts(staff.filter(s=>s.active!==false&&s.roster_status==='scheduled').map(s=>[s.staff_id,s.name+' · '+s.staff_id]),id)}</select></label><label class="sheet-field">午餐开始时间<input type="datetime-local" name="mealStart" value="${e(localTime(old?.planned_start_time)||defaultTime)}"></label><p>午餐时长：45分钟</p><p>当前岗位：${e(assignmentLabel(person))}</p><input type="hidden" name="mealAssignment" value="${e(assignment)}"><input type="hidden" name="mealPosition" value="${e(position||'')}"><input type="hidden" name="mealArea" value="${e(area||'')}"><label class="sheet-field">顶岗方式<select name="mealCover">${opts(Object.entries(coverNames),old?.coverage_mode||'no_fixed_cover')}</select></label><label class="sheet-field" data-meal-cover>顶岗人<select name="mealIncoming"></select></label><p class="muted" data-meal-candidate-note></p><label class="sheet-field">备注（非必填）<textarea name="mealNote" maxlength="500">${e(old?.note||'')}</textarea></label><div data-meal-preview></div>`,buttons:[{label:'保存安排',primary:true,action:()=>preview()}]});
    const sheet=getSheet(), $=s=>sheet.querySelector(s), val=n=>$(`[name=${n}]`).value;
    let candidateBusy=false, candidateError=false, requestId=0, previewBusy=false;
    const invalidate=()=>{$('[data-meal-preview]').innerHTML='';};
    async function choices() {
      const sequence=++requestId, type=val('mealAssignment'), pos=fixed.find(p=>p.position_id===val('mealPosition'));

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
      $('[data-meal-candidate-note]').textContent=safety?'该岗位需要指定可接岗人员。':'请先与顶岗人员沟通。';
    }
    for(const name of ['mealCover']) $(`[name=${name}]`).addEventListener('change',choices);
    for(const name of ['mealStart','mealIncoming','mealNote']) $(`[name=${name}]`).addEventListener('input',invalidate);
    $('[name=mealStaff]').addEventListener('change',()=>openEditor(val('mealStaff')));
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
        const save=async()=>{
          let current;try{current=payload();}catch(err){invalidate();error(err);return;}
          if(JSON.stringify(current)!==JSON.stringify(params)){invalidate();setSheetError('填写内容已变化，请重新保存。');return;}
          const reason=$('[name=mealRiskReason]')?.value.trim()||null, confirmed=$('[name=mealRiskConfirm]')?.checked===true;
          if(risky&&(!confirmed||!reason)){setSheetError('请填写原因，并明确勾选确认。');return;}
          await callWrite('rpc_meal_plan_upsert',{...params,p_preview_revision:p.preview_revision,p_confirm_risk:risky&&confirmed,p_risk_reason:risky?reason:null},'午餐安排已保存。',{closeBeforeRefresh:true,onError:err=>{if(!conflict(err,id))error(err);return true;}});
        };
        if(!errors.length&&!warnings.length&&!risky){await save();return;}
        $('[data-meal-preview]').innerHTML=messages(errors,'meal-block')+messages(warnings,'meal-warning')+(risky?'<div class="meal-risk"><strong>当前安排可能造成人员不足，请先核对补位安排。</strong><label class="sheet-field">确认原因<textarea name="mealRiskReason" maxlength="500"></textarea></label><label class="meal-check"><input type="checkbox" name="mealRiskConfirm">我已核对现场并确认</label></div>':'')+`<button class="primary-button" data-meal-save ${errors.length?'disabled':''}>确认保存安排</button>`;
        $('[data-meal-save]').addEventListener('click',()=>{if(!errors.length)save();});
      } catch(err){if(getSheet()===sheet&&!conflict(err,id))error(err);}
      finally{previewBusy=false;btn.disabled=false;}
    }
  }
  async function cancel(id) {
    if(!canEdit())return;
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
    content.querySelector('[data-meal-add]')?.addEventListener('click',async()=>{
      if(!canEdit())return;
      beginEditing(null,'select');
      renderSheet({title:'安排午餐',body:editingNotice,description:'正在读取今日人员…'});
      const loading=getSheet();
      try {const rows=await rpc('rpc_today_staff',{p_session_token:token()});if(getSheet()!==loading)return;
        renderSheet({title:'选择员工',body:editingNotice,buttons:rows.filter(s=>s.roster_status==='scheduled'&&s.active!==false).map(s=>({label:s.name+' · '+s.staff_id,action:()=>openEditor(s.staff_id)}))});
      }catch(err){if(getSheet()===loading)error(err);}
    });
    content.querySelectorAll('[data-meal-edit]').forEach(b=>b.addEventListener('click',()=>openEditor(b.dataset.mealEdit)));
    content.querySelectorAll('[data-meal-cancel]').forEach(b=>b.addEventListener('click',()=>cancel(b.dataset.mealCancel)));
    content.querySelectorAll('[data-meal-locate]').forEach(b=>b.addEventListener('click',()=>{const card=[...content.querySelectorAll('[data-plan-id]')].find(c=>c.dataset.planId===b.dataset.mealLocate);card?.scrollIntoView({block:'center'});card?.classList.add('meal-highlight');}));
    const start=()=>{
      const {s,p,ready,safety}=myMealAvailability(getData());if(!ready)return;
      renderSheet({title:safety?'发起午餐交接':'确认开始吃饭？',body:`<p>当前岗位：${e(assignmentLabel(s))}</p><p>计划饭点：${e(mealTime(p.planned_start_time))}</p><p>顶岗安排：${e(p.coverage_mode==='named_cover'?p.cover_staff_name||'待核对':coverNames[p.coverage_mode])}</p>${safety?'<p>请留在原岗，接岗人出发、到位并完成交接后才开始计时。</p>':'<label class="meal-check"><input type="checkbox" name="mealReady">现场已安排，可以开始吃饭</label>'}`,buttons:[{label:'返回',action:closeSheet},{label:safety?'发起午餐交接':'确认开始吃饭',primary:true,action:()=>{
        const ready=safety||getSheet()?.querySelector('[name=mealReady]')?.checked;
        if(!ready){setSheetError('请确认现场已安排，可以开始吃饭');return;}
        callWrite('rpc_my_start_meal',{p_expected_revision:p.revision,p_confirm_ready:!safety},safety?'交接已发起，请继续值守至交接完成。':'已开始吃饭。',{onError:err=>{if(/今日午餐已经开始过/.test(err.message)){setSheetError('今日午餐已经开始过，如需再次离岗请联系管理人员。');return true;}if(/最低|先补足/.test(err.message)){setSheetError('当前人员不足，请先由管理人员安排补位。');return true;}if(err.code==='40001'){setSheetError('该轮餐计划刚刚被其他管理人员调整，请关闭并刷新后重新确认。');return true;}return false;}});
      }}]});
    };
    content.querySelector('[data-meal-start]')?.addEventListener('click',start);
    content.querySelector('[data-meal-real-handoff]')?.addEventListener('click',start);
    content.querySelector('[data-meal-end]')?.addEventListener('click',async()=>{
      const s=getData().rpc_my_today_state;if(s?.status!=='meal')return;
      renderSheet({title:'结束吃饭 / 返回岗位',description:'正在核对本人返岗安排…'});const loading=getSheet();
      try {const target=await rpc('rpc_my_return_position',{p_session_token:token()});if(getSheet()!==loading)return;
        if(target?.is_safety_critical){if(target.current_staff_id&&target.current_staff_covers_me){openMySafetyReturn(s);return;}
          setSheetError('原安全岗位暂不能直接返回，请联系管理人员安排安全补岗交接。');return;}
        renderSheet({title:'结束吃饭 / 返回岗位',description:'请确认你已返回原安排位置。',buttons:[{label:'返回',action:closeSheet},{label:'确认已返岗',primary:true,action:()=>callWrite('rpc_my_end_meal',{},'已结束吃饭并恢复原安排。')}]});
      }catch(err){if(getSheet()===loading)error(err);}
    });
    content.querySelector('[data-meal-real-tasks]')?.addEventListener('click',()=>content.querySelector('[data-my-handoff-id]')?.scrollIntoView({block:'center'}));
    content.querySelector('[data-meal-real-staff]')?.addEventListener('click',()=>{if(canManage()) {navigatePage('staff');}});
  }
  return {decorate,isEditing,handleBackgroundRefresh,onSheetClosed};
}
