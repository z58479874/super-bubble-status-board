// 014 共用显示层。只转换展示，不承担数据库权限或覆盖判断。
export const areaNames = { entrance: '一楼入口', front_hall: '前厅', toddler_vr: '淘气堡 / VR', high_altitude: '高空普通区', high_expansion: '高空拓展', second_floor: '二楼电玩', global: '全场机动池' };
export const roleNames = { manager: '店长', deputy: '副店长', supervisor: '主管', staff: '员工' };
export const employmentNames = { full_time: '全职', regular_part_time: '固定兼职', temporary_part_time: '临时兼职' };
export const modeNames = { green: '绿灯', yellow: '黄灯', red: '红灯' };
export const phaseNames = { not_prepared: '今日尚未准备', not_started: '尚未开始营业', monitoring: '营业监控中', ended: '今日已结束营业' };
export const stateNames = { on_duty: '在岗', meal: '吃饭', short_leave: '短时离岗', not_arrived: '未到岗', off_duty: '已下班' };
export const assignmentNames = { position: '固定岗位', area_standby: '区域待命', mobile_pool: '全场机动', in_transit: '前往中', none: '暂无分配' };
export const stageNames = { awaiting_incoming: '等待接岗人出发', in_transit: '接岗人前往中', awaiting_outgoing: '已到位，等待确认', completed: '已完成', cancelled: '已取消' };
export const actionNames = { meal: '吃饭', short_leave: '短时离岗', transfer: '调岗', fill: '空岗补位', return: '返岗', end_cover: '结束顶岗' };
export const nextActionNames = { begin_trip: '开始前往', confirm_arrival: '我已到位', finalize: '确认交接完成' };
// 来自已确认002基线：本人读取不包含岗位分类，以下只用于按钮说明，RPC仍作最终校验。
export const safetyPositionIds = new Set(['slide','patrol','vr1','vr2','plum','climb','leap','swing1','expand1','expand2','expand3','expand4','expand5','expand6','expand7']);
export const positionNames = { gate:'闸机口外侧', shoes:'换鞋区', sale1:'销售1', sale2:'销售2', sale3:'销售3', dolls:'娃娃弹珠区', assist:'好评/协助岗', slide:'淘气堡飞跃滑梯上口', patrol:'淘气堡巡场', vr1:'VR-1', vr2:'VR-2', gear1:'装备1', gear2:'装备2', gear3:'装备3', gear4:'装备4', plum:'梅花桩', climb:'攀岩', leap:'勇士之跃', swing1:'高空秋千1', swing2:'高空秋千2', expand1:'沙池岗', expand2:'拓展入口·挂锁复检岗', expand3:'拓展入口·排队穿绳引导岗', expand4:'拓展一楼监护岗', expand5:'拓展二楼监护岗', expand6:'三楼索道上方操作岗', expand7:'三楼索道下方接应岗', arcade1:'二楼电玩1', arcade2:'二楼电玩2', floor2mobile:'二楼机动', m1:'M1高空专业机动', m2:'M2综合服务机动' };
export const label = (map, value, fallback = '待确认') => map[value] || fallback;
export const areaLabel = code => label(areaNames, code, '区域待确认');
export const positionLabel = id => label(positionNames, id, '岗位待确认');
export function assignmentLabel(row, prefix = 'current') {
  const type = row?.[`${prefix}_assignment_type`];
  if (type === 'position') return row[`${prefix}_position_name`] || positionLabel(row[`${prefix}_position_id`]);
  if (type === 'area_standby') return `${areaLabel(row[`${prefix}_area_code`])}待命`;
  if (type === 'mobile_pool') return '全场机动';
  if (type === 'in_transit') return `前往${row.target_position_name || (row.target_position_id ? positionLabel(row.target_position_id) : row.target_area_code ? areaLabel(row.target_area_code) : '目标地点')}`;
  return '暂无分配';
}
export function handoffStage(row) {
  if (!row) return '交接状态待确认';
  if (typeof row === 'string') return label(stageNames, row, '交接状态待确认');
  if (row.stage === 'awaiting_outgoing' && row.flow === 'gap') return '已到位，等待管理人员确认补岗';
  return label(stageNames, row.stage, '交接状态待确认');
}
export function statusLabel(row) {
  if (row?.roster_status === 'cancelled') return '排班已取消';
  if (!row?.status) return row?.roster_status === 'scheduled' ? '已排班，状态待初始化' : '今日未排班';
  if (row.current_assignment_type === 'in_transit') return row.status === 'on_duty' ? '前往中' : `${label(stateNames,row.status)} · 前往中`;
  return label(stateNames, row.status, '状态待确认');
}
export function businessError(error) {
  const message = String(error?.message || error || '');
  if (error?.code === '28000' || /会话.*失效|登录.*过期|session.*expired/i.test(message)) return '登录已过期，请重新验证身份。';
  if (error?.code === '42501') return '当前身份没有权限执行这项操作。';
  if (/锁定|尝试过多/.test(message)) return 'PIN尝试次数过多，请稍后再试，或联系店长重置。';
  if (/PIN|编号或姓名|身份验证失败|原.*口令/.test(message)) return '员工编号或PIN不正确，请核对后重试。';
  if (/网络|连接|超时|fetch|network|connection|AbortError/i.test(message)) return '数据连接异常，请检查网络后重试。';
  if (/写入后|最新现场数据.*读取/.test(message)) return '操作已提交，最新状态尚未读取成功。请刷新核对，不要重复提交。';
  const coverage = message.match(/(?:区域\s*)?(\w+)\s*将由\s*(\d+)\s*人降至\s*(\d+)\s*人[，,]\s*低于最低\s*(\d+)\s*人/);
  if (coverage) return `${areaLabel(coverage[1])}最低需要${coverage[4]}人，当前只有${coverage[2]}人。请先安排其他人员补位。`;
  if (/低于最低|覆盖不足|最低覆盖缺口/.test(message)) return '这次操作会让区域低于最低人数，请先安排其他人员补位。真实短离或下班请由管理人员确认现场情况。';
  if (/返岗关系|顶岗关系.*变化|交还.*关系/.test(message)) return '当前岗位的顶岗关系已经发生变化，请刷新后重新确认现场人员。';
  if (/已有.*(?:未完成|进行中).*交接|已有安全交接/.test(message)) return '这个岗位已经有一条交接正在进行，请先完成或取消现有交接。';
  if (/安全关键岗.*交接|安全岗.*交接|安全关键岗.*普通调岗/.test(message)) return '这是安全关键岗位，需要先完成双人交接，不能直接调岗、吃饭、短离或下班。';
  if (/正式值守者|由他人值守|不能自动覆盖|已由.*接岗/.test(message)) return '该岗位已有人正式值守，请刷新后重新确认现场人员。';
  if (/可安排关系|可独立安排|资格/.test(message)) return '该员工尚未被门店确认可独立安排到这个岗位，请更换人员或联系店长。';
  if (/未启用|没有启用覆盖/.test(message)) return '目标岗位或区域今天未启用，请管理人员先核对当天配置。';
  if (/已结束|尚未开始|不是营业监控/.test(message)) return '当前营业阶段不允许这个现场操作，请刷新确认营业状态。';
  if (/仍在交接|正在顶岗|顶安全岗/.test(message)) return '员工仍在交接或临时顶岗，请先完成或取消相关交接。';
  if (/没有今日有效排班|已停用|员工不存在/.test(message)) return '该员工没有今日有效排班或已停用，请先核对今日人员名单。';
  return '操作未完成，请刷新状态后重试。';
}
// 仅供管理端手动展开；不输出请求参数，也不将凭证写入日志。
export function debugError(error) {
  return String(error?.message || '').replace(/(?:sb_[a-z]+_|eyJ)[\w.\-]+|[A-Za-z0-9_\-]{32,}/g, '[已隐藏凭证]').replace(/\b\d{6,8}\b/g, '[已隐藏数字凭证]').slice(0, 1200);
}
export function dispatchCandidates(staff, positions) {
  const byId = new Map(positions.map(row => [row.position_id,row]));
  const rank = { mobile_pool:0, area_standby:1, position:2 };
  return staff.filter(row => row.active !== false && row.roster_status === 'scheduled' && row.status === 'on_duty' && !row.has_pending_handoff && !row.is_temporary_cover && !row.cover_for_staff_id && (row.current_assignment_type === 'mobile_pool' || row.current_assignment_type === 'area_standby' || row.current_assignment_type === 'position' && byId.get(row.current_position_id)?.is_safety_critical === false))
    .sort((a,b) => rank[a.current_assignment_type]-rank[b.current_assignment_type] || a.staff_id.localeCompare(b.staff_id));
}
