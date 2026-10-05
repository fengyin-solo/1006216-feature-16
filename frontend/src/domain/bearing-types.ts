import type { BearingReadings, Grade, IndicatorName } from './bearing-policy'

/**
 * 导轴承专属数据模型。老台账原本只有“当前状态”一个字符串，结论、版本、取值依据都丢了，
 * 这才让三处写法各自发挥。这里把“检测记录 / 轴承 / 检修待办 / 退回记录”拆开，
 * 页面、动作、检修班组入口、导出全部围绕同一份状态读。
 */

/** 一条导轴承检测记录（一次提交一笔，同一轴承同一班次只保留第一笔）。 */
export type BearingInspection = {
  /** 记录内部编号：迁移保留老台账原编号，新版界值重算不重排。 */
  id: number
  bearingCode: string
  unit: string
  /** 业务时间（检测日期），老台账按这个时间回填排序。 */
  inspectedAt: string
  /** 班次：同一轴承同一班次的重复提交按第一笔算。 */
  shift: string
  operator: string
  readings: BearingReadings
  /** 缺项补齐时，哪些量是推算出来的（页面标注“推算”，不当实测值用）。 */
  estimated: IndicatorName[]
  backfillNote: string | null

  /** 历史结论快照：grade + 当时界值版本，发布新版界值后也不覆盖。 */
  grade: Grade
  policyVersion: string
  /** 当时是否走了“连续两次偏高升级”。 */
  escalated: boolean
  reasons: string[]

  /** 按当前生效界值重算的结论；当前台账、汇总条、待办清单都以它为准。 */
  currentGrade: Grade
  currentReasons: string[]

  /** 写入时刻（用于并发裁决与审计）。 */
  createdAt: string
}

/** 一台导轴承：列表一行一台，状态取最近一次检测按当前界值的结论。 */
export type Bearing = {
  code: string
  unit: string
  latestId: number | null
  /** 确认检修时刻；晚于最近检测时整台显示“已检修”。 */
  repairedAt: string | null
  repairNote: string | null
}

/** 检修班组待办：判成待检修即落一条，检修班组在另一个入口看到。 */
export type RepairTodo = {
  id: number
  bearingCode: string
  unit: string
  sourceInspectionId: number
  openedAt: string
  reason: string
  /** 待处理 / 已完成（确认检修）/ 已核销（新版界值重算后回落）。 */
  status: '待处理' | '已完成' | '已核销'
  closedAt: string | null
  closeNote: string | null
  /** 开出这条待办时依据的界值版本。 */
  policyVersion: string
}

/** 被退回的提交（同班次重复 / 并发后到）：取值留痕，便于审计冲突。 */
export type RejectedSubmission = {
  id: number
  bearingCode: string
  unit: string
  inspectedAt: string
  shift: string
  operator: string
  readings: BearingReadings
  reason: string
  createdAt: string
}

/** 已发布的界值版本清单，调整界值即追加一版，不改旧版。 */
export type PolicyRevision = {
  version: string
  publishedAt: string
  note: string
  tempWarn: number
  tempTrip: number
  oilLow: number
  oilHigh: number
  oilTripMargin: number
  vibrationWarn: number
  vibrationTrip: number
}

export type BearingState = {
  inspections: BearingInspection[]
  bearings: Bearing[]
  todos: RepairTodo[]
  rejected: RejectedSubmission[]
  policies: PolicyRevision[]
  activeVersion: string
  /** 内部自增序列：新写入的记录/待办用，绝不复用老台账编号。 */
  seq: number
}
