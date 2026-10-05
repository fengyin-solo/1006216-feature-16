import type { BearingRecord } from './types'

/**
 * 导轴承存量台账（迁移自旧通用台账）。
 * 迁移纪律：原编号、轴承编号、既有结论全部保留，不按新版界值重排；
 * 按检测日期（业务时间）回填，早年只记了上导温度的按下导=上导−5℃ 补齐并标注。
 * 下列结论均为迁移当时已经存在的等级，规则版本记 v1。
 */
export const BEARING_SEED_RECORDS: BearingRecord[] = [
  {
    id: 1,
    bearingNo: 'BEAR-0001',
    unitNo: '1号机组',
    signals: { upperTemp: 58.2, lowerTemp: 59.0, lowerTempImputed: false, oilLevel: 260, vibration: 0.07, inspectedAt: '2026-09-01' },
    status: '正常',
    ruleVersion: 'v1',
    lastInspectedAt: '2026-09-01',
    lastShift: '白班',
    lastOperator: '王建国',
    history: [
      { inspectedAt: '2026-09-01', shift: '白班', operator: '王建国', level: '正常', ruleVersion: 'v1', reasons: [], lowerTempImputed: false },
    ],
    repairTodo: { open: false, openedAt: null, closedAt: null, ruleVersion: null },
    repaired: false,
    remarks: ['迁移保留：既有结论「正常」，按检测日期 2026-09-01 回填'],
  },
  {
    id: 2,
    bearingNo: 'BEAR-0002',
    unitNo: '2号机组',
    signals: { upperTemp: 71.4, lowerTemp: 66.1, lowerTempImputed: false, oilLevel: 230, vibration: 0.09, inspectedAt: '2026-09-02' },
    status: '温度偏高',
    ruleVersion: 'v1',
    lastInspectedAt: '2026-09-02',
    lastShift: '白班',
    lastOperator: '李守义',
    history: [
      { inspectedAt: '2026-09-02', shift: '白班', operator: '李守义', level: '温度偏高', ruleVersion: 'v1', reasons: ['上导温度 71.4℃≥70℃ 判温度偏高（v1 页端口径）'], lowerTempImputed: false },
    ],
    repairTodo: { open: false, openedAt: null, closedAt: null, ruleVersion: null },
    repaired: false,
    remarks: ['迁移保留：既有结论「温度偏高」，不按新版重排'],
  },
  {
    id: 3,
    bearingNo: 'BEAR-0003',
    unitNo: '3号机组',
    signals: { upperTemp: 75.6, lowerTemp: 70.8, lowerTempImputed: false, oilLevel: 196, vibration: 0.16, inspectedAt: '2026-09-03' },
    status: '待检修',
    ruleVersion: 'v1',
    lastInspectedAt: '2026-09-03',
    lastShift: '夜班',
    lastOperator: '赵德海',
    history: [
      { inspectedAt: '2026-09-03', shift: '夜班', operator: '赵德海', level: '待检修', ruleVersion: 'v1', reasons: ['上导温度 75.6℃≥75℃ 判待检修（v1 动作/另存口径）'], lowerTempImputed: false },
    ],
    repairTodo: { open: true, openedAt: '2026-09-03', closedAt: null, ruleVersion: 'v1' },
    repaired: false,
    remarks: ['迁移保留：既有结论「待检修」，检修待办同步带入'],
  },
  {
    id: 4,
    bearingNo: 'BEAR-0004',
    unitNo: '1号机组',
    // 老台账样例：早年只记了上导温度，下导按上导−5℃ 推算补齐；油位、振动当时未记录，缺测不参与。
    signals: { upperTemp: 72.0, lowerTemp: 67.0, lowerTempImputed: true, oilLevel: null, vibration: null, inspectedAt: '2025-06-18' },
    status: '温度偏高',
    ruleVersion: 'v1',
    lastInspectedAt: '2025-06-18',
    lastShift: '白班',
    lastOperator: '王建国',
    history: [
      { inspectedAt: '2025-06-18', shift: '白班', operator: '王建国', level: '温度偏高', ruleVersion: 'v1', reasons: ['v1：上导 72℃≥70 判温度偏高（下导 67℃ 为推算值）'], lowerTempImputed: true },
    ],
    repairTodo: { open: false, openedAt: null, closedAt: null, ruleVersion: null },
    repaired: false,
    remarks: ['迁移补项：早期仅记录上导温度，下导温度按「上导−5℃」推算补齐（非实测）', '迁移补项：油位高度、振动数值缺测，不参与历史判级'],
  },
  {
    id: 5,
    bearingNo: 'BEAR-0005',
    unitNo: '4号机组',
    signals: { upperTemp: 61.5, lowerTemp: 58.5, lowerTempImputed: false, oilLevel: 245, vibration: 0.12, inspectedAt: '2026-09-20' },
    status: '已检修',
    ruleVersion: 'v1',
    lastInspectedAt: '2026-09-20',
    lastShift: '白班',
    lastOperator: '孙明远',
    history: [
      { inspectedAt: '2026-09-15', shift: '夜班', operator: '孙明远', level: '待检修', ruleVersion: 'v1', reasons: ['历史：振动 0.19mm>0.18（v2 通道，v1 未纳入，仅作留痕）'], lowerTempImputed: false },
      { inspectedAt: '2026-09-20', shift: '白班', operator: '孙明远', level: '温度偏高', ruleVersion: 'v1', reasons: ['复测温度偏高，检修闭环'], lowerTempImputed: false },
    ],
    repairTodo: { open: false, openedAt: '2026-09-15', closedAt: '2026-09-20', ruleVersion: 'v1' },
    repaired: true,
    remarks: ['迁移保留：已完成检修闭环，待办已清'],
  },
  {
    id: 6,
    bearingNo: 'BEAR-0006',
    unitNo: '2号机组',
    signals: { upperTemp: 72.0, lowerTemp: 67.2, lowerTempImputed: false, oilLevel: 180, vibration: 0.11, inspectedAt: '2026-09-28' },
    status: '温度偏高',
    ruleVersion: 'v1',
    lastInspectedAt: '2026-09-28',
    lastShift: '夜班',
    lastOperator: '李守义',
    history: [
      { inspectedAt: '2026-09-28', shift: '夜班', operator: '李守义', level: '温度偏高', ruleVersion: 'v1', reasons: ['v1：上导 72℃ 达 warn 未达 alarm=75，页侧判偏高；动作/另存侧升级界值低 5℃ 会判待检修——同一台机组两种结论的历史样例'], lowerTempImputed: false },
    ],
    repairTodo: { open: false, openedAt: null, closedAt: null, ruleVersion: null },
    repaired: false,
    remarks: ['迁移保留：按 v1 页侧既有结论「温度偏高」落账；发布 v2 后重算可验证升级为「待检修」'],
  },
]
