import { roleNames, employmentNames, stateNames, label, areaLabel, businessError } from './displayLabels.js';

// 014.1: only the deployed, manager-only RPCs may read/write personnel records.
export function createStaffManagement(ui) {
  const { rpc, getSession, renderSheet, getSheet, closeSheet, callWrite, setSheetError,
    openResetPin, invalidateDirectory, requireLogin, escapeHtml: e } = ui;
  let pendingCreate = null;
  const allowed = () => getSession()?.role === 'manager';
  const el = selector => getSheet()?.querySelector(selector);
  const val = name => el(`[name="${name}"]`)?.value?.trim() || '';
  const read = (name, args = {}) => rpc(name, { p_session_token: getSession()?.session_token, ...args });
  const input = (title, name, value = '', extra = '') => `<label class="sheet-field">${e(title)}<input name="${name}" value="${e(value)}" maxlength="80" ${extra}></label>`;
  const select = (title, name, choices, selected) => `<label class="sheet-field">${e(title)}<select name="${name}">${Object.entries(choices).map(([id, text]) => `<option value="${e(id)}" ${id === selected ? 'selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
  const checkbox = (name, title) => `<label class="hr-check"><input type="checkbox" name="${name}"><span>${e(title)}</span></label>`;
  const selected = name => !!el(`[name="${name}"]`)?.checked;
  function errorMessage(error) {
    if (error?.code === '40001') return '资料或可安排岗位已被另一台设备修改。请重新打开详情核对后保存。';
    if (error?.code === '55P03') return '员工正在进行现场操作，请稍后重新打开详情。';
    const message = String(error?.message || '');
    if (/当前系统只有这一名在职店长|该员工今天仍有现场状态|该员工今日仍有未完成的有效排班|此次管理角色变更|发现同名历史人员|只能保存当前已启用|岗位基线已变化|三位员工编号已用尽|该员工已经在职|停用人员请通过恢复/.test(message)) return message;
    if (/不能.*(删除|移除|撤销)|仍.*(岗位|交接|返岗|前往)/.test(message)) return '该可安排岗位仍被现场值守、前往、返岗或交接引用。请先完成对应现场流程，再重新打开详情修改。';
    return businessError(error);
  }
  function showError(error) {
    if (error?.code === '28000' || /会话已失效/.test(error?.message || '')) {
      requireLogin('身份已失效，请重新登录。'); return;
    }
    setSheetError(errorMessage(error));
  }
  async function load(title, loader, display, retry) {
    if (!allowed()) return;
    renderSheet({ title, description: '正在读取最新员工资料…' });
    const root = getSheet();
    try {
      const data = await loader();
      if (getSheet() === root && allowed()) display(data);
    } catch (error) {
      if (getSheet() !== root) return;
      renderSheet({ title, description: '暂时无法读取，未提交任何修改。', buttons: [
        { label: '重新读取', primary: true, action: retry }, { label: '返回员工名册', action: openDirectory }
      ] });
      showError(error);
    }
  }
  async function save(name, args, message, after) {
    if (!allowed()) return;
    const result = await callWrite(name, args, message, { keepSheet: true, onError: error => { showError(error); return true; } });
    if (result.ok) {
      invalidateDirectory();
      if (allowed() && getSheet()) await after(result.result);
    }
    return result;
  }
  function summary(row) {
    return `<dl class="staff-detail-grid">${[
      ['姓名', row.name], ['员工编号', row.id], ['部门', row.department],
      ['角色', label(roleNames, row.role)], ['用工类型', label(employmentNames, row.employment_type)],
      ['是否启用', row.active ? '在职 / 启用' : '已离职 / 停用']
    ].map(([key, value]) => `<div><dt>${e(key)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
  }
  function openDirectory() {
    return load('员工管理', () => read('rpc_staff_directory'), rows => {
      if (!Array.isArray(rows)) throw new Error('员工名册返回格式不正确');
      renderSheet({ title: '员工管理', fullScreen: true,
        description: `共 ${rows.length} 人 · 在职 ${rows.filter(r => r.active).length} 人 · 不受营业阶段限制`,
        body: `<button type="button" class="primary-button hr-create" data-hr-create>${pendingCreate ? '核对未确认的新增结果' : '新增员工'}</button>` + input('搜索姓名或员工编号', 'hrSearch', '', 'type="search" autocomplete="off"') +
          select('人员状态', 'hrActive', { all: '全部人员', active: '在职人员', inactive: '已离职 / 停用' }, 'all') +
          select('用工类型筛选', 'hrType', { all: '全部类型', ...employmentNames }, 'all') + '<div class="directory-list" data-hr-list></div>',
        buttons: [{ label: '关闭员工管理', action: closeSheet }],
        onOpen: () => {
          el('[data-hr-create]').addEventListener('click', openCreate);
          const update = () => {
            const query = val('hrSearch').toLocaleLowerCase();
            const shown = rows.filter(r => `${r.id} ${r.name}`.toLocaleLowerCase().includes(query) &&
              (val('hrActive') === 'all' || r.active === (val('hrActive') === 'active')) &&
              (val('hrType') === 'all' || r.employment_type === val('hrType')));
            el('[data-hr-list]').innerHTML = shown.map(row => `<button type="button" class="directory-entry" data-hr-id="${e(row.id)}"><span><strong>${e(row.name)}</strong><small>${e(row.id)} · ${e(row.department)} · ${e(label(roleNames, row.role))} · ${e(label(employmentNames, row.employment_type))}</small></span><span class="pill ${row.active ? 'green' : 'gray'}">${row.active ? '在职' : '停用'}</span></button>`).join('') || '<p class="sheet-hint">没有匹配的员工。</p>';
          };
          for (const name of ['hrSearch', 'hrActive', 'hrType']) el(`[name=${name}]`).addEventListener(name === 'hrSearch' ? 'input' : 'change', update);
          el('[data-hr-list]').addEventListener('click', event => { const button = event.target.closest('[data-hr-id]'); if (button) openDetail(button.dataset.hrId); });
          update();
        }
      });
    }, openDirectory);
  }
  function openDetail(id) {
    return load('员工详情', () => read('rpc_staff_management_detail', { p_staff_id: id }), data => {
      const row = data.staff;
      renderSheet({ title: `${row.name} · 员工详情`, description: '长期档案；新增、恢复均不会自动加入今日排班。',
        body: summary(row) + `<div class="sheet-subsection"><strong>可安排岗位：${e(data.assignable_position_count)} 个</strong><p>表示门店确认可独立安排；普通岗位无需单独授权。点击下方查看与调整。</p></div>` +
          (row.active && data.needs_pin_initialization ? '<p class="sheet-hint">尚未初始化 PIN。需要本人登录或参与交接时，请初始化。</p>' : '') +
          (!row.active ? '<p class="sheet-hint">历史编号、岗位关系与操作记录保留。恢复后旧 PIN 不会重新生效，需要重新初始化。</p>' : ''),
        buttons: [
          { label: row.active ? '编辑资料' : '恢复员工', primary: true, action: () => editProfile(data, !row.active) },
          { label: '可安排岗位', action: () => openPositions(id) },
          ...(row.active && row.id !== getSession()?.staff_id ? [{ label: '初始化/重置PIN', action: () => openResetPin(row) }] : []),
          ...(row.active && row.id === getSession()?.staff_id ? [{ label: '本人PIN请到“我的”修改', action: () => setSheetError('管理接口不允许重置自己的 PIN，请关闭详情并进入“我的”。') }] : []),
          ...(row.active ? [{ label: '办理离职', danger: true, action: () => deactivate(data) }] : []),
          { label: '返回员工名册', action: openDirectory }
        ] });
    }, () => openDetail(id));
  }
  function profileFields(row, departments, create = false, restore = false) {
    const types = create ? { full_time: '全职', regular_part_time: '固定兼职' } : employmentNames;
    return (restore ? `<p class="sheet-hint">恢复原员工：${e(row.name)} · ${e(row.id)}</p>` : input('姓名', 'hrName', row.name)) +
      input('部门（可选择或填写）', 'hrDepartment', row.department, 'list="hrDepartments" autocomplete="off"') +
      `<datalist id="hrDepartments">${departments.map(d => `<option value="${e(d)}"></option>`).join('')}</datalist>` +
      select('用工类型', 'hrEmployment', types, row.employment_type || 'full_time') + select('系统角色', 'hrRole', roleNames, row.role || 'staff');
  }
  function profileValues(name) {
    const result = { p_name: name || val('hrName'), p_department: val('hrDepartment'), p_employment_type: val('hrEmployment'), p_role: val('hrRole') };
    if (!result.p_name || !result.p_department || result.p_name.length > 80 || result.p_department.length > 80) { setSheetError('请填写姓名和部门，均不能超过80字。'); return null; }
    return result;
  }
  function editProfile(data, restore = false) {
    const row = data.staff;
    renderSheet({ title: restore ? '恢复员工' : '编辑资料',
      description: restore ? '请核对部门、用工类型与角色。原编号和历史可安排岗位保留；恢复后须重新初始化 PIN。' : `员工编号 ${row.id} 永久保留，调整用工类型也不更换编号。角色变化会使旧登录会话失效。`,
      body: profileFields(row, data.department_options || [], false, restore), buttons: [
        { label: '返回详情', action: () => openDetail(row.id) },
        { label: '核对并继续', primary: true, action: () => {
          const params = profileValues(restore ? row.name : null); if (!params) return;
          const confirmRole = restore ? params.p_role !== 'staff' || row.role === 'manager' : params.p_role !== row.role && (params.p_role !== 'staff' || row.role === 'manager');
          if (restore) delete params.p_name;
          const newRow = { ...row, name: params.p_name || row.name, department: params.p_department, role: params.p_role, employment_type: params.p_employment_type, active: true };
          renderSheet({ title: restore ? '确认恢复员工' : '确认保存资料', body: summary(newRow) +
            (confirmRole ? checkbox('hrRoleConfirmed', '我已核对管理权限变更，并确认该人员应拥有上述角色') : '') +
            (row.id === getSession()?.staff_id && row.role !== params.p_role ? '<p class="sheet-hint">修改本人角色后需重新登录；请确保另一名店长已能正常登录。</p>' : ''), buttons: [
              { label: '返回修改', action: () => editProfile({ ...data, staff: { ...row, name: newRow.name, department: newRow.department, employment_type: newRow.employment_type } }, restore) },
              { label: restore ? '确认恢复' : '确认保存', primary: true, action: async () => {
                if (confirmRole && !selected('hrRoleConfirmed')) { setSheetError('请先勾选确认管理角色。'); return; }
                await save(restore ? 'rpc_staff_reactivate' : 'rpc_staff_update_profile', { ...params, p_staff_id: row.id, p_expected_revision: data.revision, p_confirm_role_change: confirmRole }, restore ? '已恢复原档案，请核对可安排岗位并初始化 PIN。' : '员工资料已保存。', () => openDetail(row.id));
              } }
            ] });
        } }
      ] });
  }
  function openCreate() {
    if (pendingCreate) { confirmCreate(pendingCreate); return; }
    return load('新增员工', () => read('rpc_staff_management_detail', { p_staff_id: getSession().staff_id }), data => {
      renderSheet({ title: '新增员工', description: '新增全职或固定兼职；临时兼职继续从今日排班快捷加入。编号由数据库生成，不创建排班、PIN或可安排岗位。',
        body: profileFields({ name: '', department: '', role: 'staff', employment_type: 'full_time' }, data.department_options || [], true),
        buttons: [{ label: '返回员工名册', action: openDirectory }, { label: '检查同名人员', primary: true, action: async () => {
          const params = profileValues(); if (!params) return;
          const root = getSheet();
          const button = el('[data-sheet-button="1"]'); button.disabled = true;
          try {
            const candidates = await read('rpc_staff_name_candidates', { p_name: params.p_name });
            if (getSheet() !== root || !allowed()) return;
            const draft = { params, candidates, requestId: crypto.randomUUID(), attempted: false };
            confirmCreate(draft);
          } catch (error) { if (getSheet() === root) showError(error); }
          finally { button.disabled = false; }
        } }] });
    }, openCreate);
  }
  function confirmCreate(draft) {
    if (!allowed()) return;
    const high = ['deputy', 'manager'].includes(draft.params.p_role);
    renderSheet({ title: '核对新员工', description: draft.attempted ? '上次提交结果待核对。重试使用同一创建凭据，不会重复分配编号。请勿刷新页面或另行重复建档。' : '姓名不是唯一身份。请核对历史档案，再确认是否为不同的人。',
      body: summary({ id: '保存后自动生成', name: draft.params.p_name, department: draft.params.p_department, role: draft.params.p_role, employment_type: draft.params.p_employment_type, active: true }) +
        draft.candidates.map(r => `<button type="button" class="directory-entry" data-existing-id="${e(r.id)}"><span><strong>${e(r.name)} · ${e(r.id)}</strong><small>${e(r.department)} · ${e(label(employmentNames, r.employment_type))} · ${r.active ? '在职，查看原档案' : '已停用，查看并恢复原档案'}<br>最近排班：${e(r.last_roster_day || '无')} · 最近状态：${e(r.last_state ? label(stateNames, r.last_state.status) : '无')}</small></span></button>`).join('') +
        (!draft.attempted ? checkbox('hrDistinct', draft.candidates.length ? '已核对同名档案，确认这是不同的人，需要新建独立编号' : '确认是新员工，创建独立编号') + (high ? checkbox('hrHigh', '再次确认：此员工需要副店长或店长管理权限') : '') : ''),
      buttons: [{ label: '返回员工名册', action: openDirectory }, { label: draft.attempted ? '使用原请求核对 / 重试' : '确认新增', primary: true, action: async () => {
        if (!draft.attempted && (!selected('hrDistinct') || (high && !selected('hrHigh')))) { setSheetError('请先完成新人员与管理权限确认。'); return; }
        draft.attempted = true; pendingCreate = draft;
        const result = await save('rpc_staff_create', { ...draft.params, p_confirm_distinct_person: true, p_request_id: draft.requestId, p_confirm_high_privilege: high }, '员工档案已建立，请设置可安排岗位；需要登录时再初始化 PIN。', response => {
          if (!response?.staff?.id) { confirmCreate(draft); setSheetError('提交已成功，但未返回编号。请使用原请求核对结果，不要重新建档。'); return; }
          pendingCreate = null; return openDetail(response.staff.id);
        });
        if (result && !result.ok && getSheet() && allowed()) {
          // Keep the exact request for network errors. A retry returns the same database-created ID.
          if (/^22|^23|^P0001$/.test(result.error?.code || '')) { pendingCreate = null; draft.attempted = false; }
          confirmCreate(draft); showError(result.error);
        }
      } }], onOpen: () => {
        for (const button of getSheet().querySelectorAll('[data-existing-id]')) {
          button.disabled = draft.attempted;
          button.addEventListener('click', () => openDetail(button.dataset.existingId));
        }
      } });
  }
  function openPositions(id) {
    return load('可安排岗位', () => read('rpc_staff_assignable_positions', { p_staff_id: id }), data => {
      const positions = data.positions;
      const editable = p => p.editable && p.active && p.requires_qualification && !p.is_mobile;
      const groups = [...new Set(positions.map(p => p.area_code))];
      renderSheet({ title: `${data.staff.name} · 可安排岗位`, fullScreen: true,
        description: '勾选表示门店已确认该员工可以独立上岗。普通岗位无需单独授权，机动资源不作为岗位授权。',
        body: groups.map(area => `<section class="hr-position-group"><h3>${e(area ? areaLabel(area) : '机动资源')}</h3>${positions.filter(p => p.area_code === area).map(p => editable(p) ?
          `<label class="hr-check"><input type="checkbox" name="hrPosition" value="${e(p.id)}" ${p.independently_assignable ? 'checked' : ''}><span>${e(p.name)}</span></label>` :
          `<p class="hr-readonly">${e(p.name)} · ${!p.active ? '岗位已停用，不可勾选' : e(p.display_hint)}${p.requires_qualification && p.independently_assignable ? '（现有关系将在保存时移除）' : ''}</p>`).join('')}</section>`).join(''),
        buttons: [{ label: '返回详情', action: () => openDetail(id) }, { label: '核对岗位变更', primary: true, action: () => {
          const ids = [...getSheet().querySelectorAll('[name=hrPosition]:checked')].map(box => box.value);
          const previous = data.staff.position_ids || [];
          const added = ids.filter(value => !previous.includes(value));
          const removed = previous.filter(value => !ids.includes(value));
          const names = list => list.map(value => positions.find(p => p.id === value)?.name || value).map(e).join('、') || '无';
          renderSheet({ title: '确认可安排岗位', description: `${data.staff.name}：保存后 ${ids.length} 个需确认岗位。`,
            body: `<p class="sheet-hint">新增：${names(added)}<br>移除：${names(removed)}<br>正在值守、前往、返岗或交接使用的岗位关系，数据库会阻止移除，整次保存不会部分生效。</p>`, buttons: [
              { label: '返回重新选择', action: () => openPositions(id) },
              { label: '确认保存岗位', primary: true, action: () => save('rpc_staff_update_positions', { p_staff_id: id, p_position_ids: ids, p_expected_revision: data.revision }, '可安排岗位已保存。', () => openDetail(id)) }
            ] });
        } }] });
    }, () => openPositions(id));
  }
  function deactivate(data) {
    const row = data.staff;
    renderSheet({ title: `办理离职 · ${row.name}`, description: '停用后旧会话失效。人员编号、历史操作和可安排岗位保留；今天没排班不需要办理离职。',
      body: `<p class="sheet-hint">有未处理排班、现场状态或交接时，数据库会拒绝。不能借离职入口跳过现场流程。</p><label class="sheet-field">离职 / 停用原因<textarea name="hrReason" maxlength="500" rows="3"></textarea></label>` + checkbox('hrDeactivate', `确认将 ${row.name}（${row.id}）设为停用`),
      buttons: [{ label: '返回详情', action: () => openDetail(row.id) }, { label: '确认办理离职', danger: true, action: () => {
        const reason = val('hrReason');
        if (!reason || !selected('hrDeactivate')) { setSheetError('请填写原因并勾选确认停用。'); return; }
        return save('rpc_staff_deactivate', { p_staff_id: row.id, p_reason: reason, p_expected_revision: data.revision }, '已办理离职，历史档案保留。', () => openDetail(row.id));
      } }] });
  }
  return { openDirectory, openDetail, reset: () => { pendingCreate = null; } };
}
