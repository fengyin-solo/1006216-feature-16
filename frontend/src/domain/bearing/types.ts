/** 导轴承领域类型：台账记录、判级、规则版本、待办、汇总都在这里收口。 */

/** 三档判级结论（另有“已检修”为检修闭环后的处理状态，不是判级结果）。 */
export type BearingGrade = '正常' | '温度偏高' | '待检修'

/** 轴承当前状态：三档结论 + 检修闭环 + 尚未检测。 */
export type BearingStatus = BearingGrade | '已检修' | '待检测'

export type SignalChannel = '上导温度' | '下导温度' | '油位高度' | '振动数值'

/** 进判级的四个监测值，同一环节一起处理；null 表示缺测，不参与判级。 */
export type BearingSignalInput = {
  upperTemp: number | null
  lowerTemp: number | null
  /** 下导温度是否由上导推算补齐（推算值照常判级但全程标注）。 */
  lowerTempImputed?: boolean
  oilLevel: number | null
  vibration: number | null
  /** 检测业务时间（yyyy-mm-dd）：按它选择当时生效的规则版本。 */
  inspectedAt: string
}

export type ChannelThreshold = {
  /** 达到此值（含）判“温度偏高”。 */
  warn: number
  /** 达到此值（含）升级“待检修”。 */
  alarm: number
  /** gte：越大越差；lte：越小越差（油位）。 */
  compare: 'gte' | 'lte'
  unit: string
  /** 旧版本未纳入的通道关掉，避免误参与判级。 */
  enabled?: boolean
}

export type ChannelVerdict = {
  channel: SignalChannel
  value: number | null
  missing: boolean
  imputed: boolean
  level: BearingGrade
}

export type Evaluation = {
  level: BearingGrade
  /** 触发升级的通道明细，供页面与导出展示同一份理由。 */
  reasons: string[]
  channels: Record<SignalChannel, ChannelVerdict>
}

export type BearingRuleVersion = {
  version: string
  effectiveFrom: string
  /** null 表示当前在用版本。 */
  effectiveTo: string | null
  note: string
  thresholds: Record<SignalChannel, ChannelThreshold>
}

/** 每次提交检测留下的历史结论：保留当时等级并注明规则版本。 */
export type BearingHistoryEntry = {
  inspectedAt: string
  shift: string
  operator: string
  level: BearingGrade
  ruleVersion: string
  reasons: string[]
  /** 该次下导温度是否为推算补齐。 */
  lowerTempImputed: boolean
  /** 后界值调整重算时，原结论不动，重算结果记到这里并注明版本。 */
  recomputed?: { level: BearingGrade; ruleVersion: string; at: string }
  /** 重复提交被退回时只留痕，不改变等级。 */
  rejectedAsDuplicate?: boolean
}

/** 导轴承台账记录。原 id 与轴承编号在迁移中保持不变。 */
export type BearingRecord = {
  id: number
  bearingNo: string
  unitNo: string
  signals: BearingSignalInput
  /** 当前生效状态（三档结论 / 已检修 / 待检测）。 */
  status: BearingStatus
  /** 最近一次判级使用的规则版本。 */
  ruleVersion: string
  /** 最近一次检测班次与检测人，用于同一班次重复提交判定。 */
  lastInspectedAt: string | null
  lastShift: string | null
  lastOperator: string | null
  history: BearingHistoryEntry[]
  /** 检修待办：判待检修自动建，确认检修自动清。 */
  repairTodo: {
    open: boolean
    openedAt: string | null
    closedAt: string | null
    ruleVersion: string | null
  }
  repaired: boolean
  /** 迁移/登记备注（如“下导温度按上导−5℃补齐”）。 */
  remarks: string[]
}

/** 检修班组待办清单条目：直接从台账投影，两处读数天然一致。 */
export type RepairTodoItem = {
  id: number
  bearingNo: string
  unitNo: string
  level: BearingGrade
  openedAt: string
  ruleVersion: string
  reasons: string[]
  lowerTempImputed: boolean
}

export type BearingSummary = {
  total: number
  normal: number
  elevated: number
  pendingRepair: number
  repaired: number
  /** 待检修台数，待办入口与本页面读同一份。 */
  repairTodoCount: number
  uninspected: number
}

export type BearingActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; duplicate?: boolean }
