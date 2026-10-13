// Browser contract tests only. Never included in the Pages build.
import { WorkflowMock } from './workflow-mock.mjs';
const fail = (message, code = '23514') => { throw Object.assign(new Error(message), { code }); };
export class StaffManagementMock extends WorkflowMock {
  constructor() {
    super();
    this.grants = new Map(this.staff.map(s => [s.id, this.positions.filter(p => p.requires_qualification).map(p => p.position_id)]));
    this.versions = new Map(); this.created = new Map(); this.noPin = new Set();
    this.nextFT = 11; this.nextPT = 4; this.rejected = null; this.revoked = new Set();
    this.staff.find(s => s.id === 'FT004').role = 'supervisor';
  }
  result(id) {
    const staff = this.member(id);
    return { staff: { ...staff, home_position_id: null, position_ids: this.grants.get(id) || [] },
      revision: String(this.versions.get(id) || 0).padStart(64, '0'),
      assignable_position_count: (this.grants.get(id) || []).length,
      needs_pin_initialization: this.noPin.has(id),
      department_options: [...new Set(this.staff.filter(s => s.active).map(s => s.department))] };
  }
  rpc(name, b = {}) {
    if (b.p_session_token && this.revoked.has(b.p_session_token)) fail('会话已失效，请重新验证身份', '28000');
    const custom = new Set(['rpc_staff_management_detail','rpc_staff_name_candidates','rpc_staff_assignable_positions',
      'rpc_staff_create','rpc_staff_update_profile','rpc_staff_update_positions','rpc_staff_deactivate','rpc_staff_reactivate']);
    if (!custom.has(name)) return super.rpc(name,b);
    const actor = this.actor(b.p_session_token); if (actor.role !== 'manager') fail('只有店长可管理员工','42501');
    if ('p_actor_staff_id' in b) throw Error('forged actor');
    if (this.rejected?.name === name) { const error = this.rejected; this.rejected = null; fail(error.message, error.code); }
    if (name === 'rpc_staff_management_detail') return this.result(b.p_staff_id);
    if (name === 'rpc_staff_name_candidates') return this.staff.filter(s => s.name.trim().toLowerCase() === b.p_name.trim().toLowerCase()).map(s => ({...s,last_roster_day:null,last_state:null}));
    if (name === 'rpc_staff_assignable_positions') return { ...this.result(b.p_staff_id), positions: this.positions.map(p => ({ ...p,id:p.position_id,active:p.active!==false,
      editable:p.active!==false && p.requires_qualification && !p.is_mobile,
      independently_assignable:p.requires_qualification ? (this.grants.get(b.p_staff_id)||[]).includes(p.position_id) : !p.is_mobile,
      display_hint:p.is_mobile?'机动资源，不作为可安排岗位授权':p.requires_qualification?'由店长确认可独立安排':'无需单独授权' })) };
    if (name === 'rpc_staff_create') {
      if (this.created.has(b.p_request_id)) return {...this.result(this.created.get(b.p_request_id)),already_created:true};
      if (['deputy','manager'].includes(b.p_role) && !b.p_confirm_high_privilege) fail('创建副店或店长前，必须再次确认高权限角色');
      if (this.staff.some(s=>s.name===b.p_name) && !b.p_confirm_distinct_person) fail('发现同名历史人员，请选择恢复原档案，或明确确认是不同的人');
      const full=b.p_employment_type==='full_time'; const id=(full?'FT':'PT')+String(full?++this.nextFT:++this.nextPT).padStart(3,'0');
      this.staff.push({id,name:b.p_name,department:b.p_department,role:b.p_role,employment_type:b.p_employment_type,active:true});
      this.grants.set(id,[]); this.noPin.add(id); this.created.set(b.p_request_id,id); return {...this.result(id),already_created:false};
    }
    const row=this.member(b.p_staff_id);
    if (b.p_expected_revision!==this.result(row.id).revision) fail('员工资料或可安排岗位已变化，请重新打开详情后再保存','40001');
    if (name==='rpc_staff_update_positions') {
      if (b.p_position_ids.some(id=>!this.positions.some(p=>p.position_id===id&&p.active!==false&&p.requires_qualification&&!p.is_mobile))) fail('只能保存当前已启用、需要门店确认可独立安排的非机动岗位','22023');
      const state=this.states.get(row.id);
      if(state?.current_position_id && !b.p_position_ids.includes(state.current_position_id)) fail('不能撤销仍在使用的岗位');
      this.grants.set(row.id,b.p_position_ids);
    } else if(name==='rpc_staff_deactivate') {
      if(!b.p_reason)fail('请填写原因','22023');
      if(row.role==='manager'&&!this.staff.some(s=>s.id!==row.id&&s.role==='manager'&&s.active))fail('当前系统只有这一名在职店长，请先将另一名员工设为店长后再办理');
      const state=this.states.get(row.id);
      if(['on_duty','meal','short_leave'].includes(state?.status)||state?.current_assignment_type&&state.current_assignment_type!=='none'||this.activeHandoff(row.id))fail('该员工今天仍有现场状态或顶岗关系，请先完成交接、返岗/离岗和下班，再办理离职');
      if(this.roster.get(row.id)?.roster_status==='scheduled'&&this.states.get(row.id)?.status!=='off_duty')fail('该员工今日仍有未完成的有效排班，请先取消今日排班；营业中不可强制取消');
      row.active=false;this.revoked.add(`${row.id}-token`);
    } else {
      if(name==='rpc_staff_reactivate') {row.active=true;this.noPin.add(row.id);}
      if(b.p_role!==row.role)this.revoked.add(`${row.id}-token`);
      Object.assign(row,{name:b.p_name||row.name,department:b.p_department,role:b.p_role,employment_type:b.p_employment_type});
    }
    this.versions.set(row.id,(this.versions.get(row.id)||0)+1); return this.result(row.id);
  }
}
