import { getBearingState, persist, resetBearingState, runExclusive } from './store'
import {
  CURRENT_RULE_VERSION,
  RULE_VERSIONS,
  evaluateBearing,
  imputeLowerTemp,
  ruleByVersion,
} from './rules'
import { shiftOf } from './shift'
import type {
  BearingActionResult,
  BearingGrade,
  BearingRecord,
  BearingRuleVersion,
  BearingSignalInput,
  RepairTodoItem,
  BearingSummary,
} from './types'

/**
 * 导轴承领域服务：页面、检修待办入口、导出都只调这里，判级统一走 evaluateBearing。
 */

export function allRules(): BearingRuleVersion[] {
  const { publishedRules } = getBearingState()
  return [...RULE_VERSIONS, ...publishedRules].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

export function activeRule(): BearingRuleVersion {
  const { activeVersion } = getBearingState()
  return ruleByVersion(activeVersion, allRules())
}

export function listRecords(): BearingRecord[] {
  return getBearingState().records
}

export function getRecord(id: number): BearingRecord | undefined {
  return getBearingState().records.find((row) => row.id === id)
}

/** 检修班组待办清单：完全从台账投影，不另存一份，条数永远和台账一致。 */
export function listRepairTodos(): RepairTodoItem[] {
  return listRecords()
    .filter((row) => row.repairTodo.open)
    .map((row) => {
      const last = [...row.history].reverse().find((entry) => !entry.rejectedAsDuplicate)
      return {
        id: row.id,
        bearingNo: row.bearingNo,
        unitNo: row.unitNo,
        level: '待检修' as BearingGrade,
        openedAt: row.repairTodo.openedAt ?? row.lastInspectedAt ?? '',
        ruleVersion: row.repairTodo.ruleVersion ?? row.ruleVersion,
        reasons: last?.reasons ?? [],
        lowerTempImputed: Boolean(row.signals.lowerTempImputed),
      }
    })
}

export function bearingSummary(): BearingSummary {
  const records = listRecords()
  // 待检修台数以待办开关为唯一口径，保证与班组待办入口逐条对应、绝不分叉。
  const pendingRepair = records.filter((row) => row.repairTodo.open).length
  return {
    total: records.length,
    normal: records.filter((row) => row.status === '正常').length,
    elevated: records.filter((row) => row.status === '温度偏高').length,
    pendingRepair,
    repaired: records.filter((row) => row.status === '已检修').length,
    repairTodoCount: pendingRepair,
    uninspected: records.filter((row) => row.status === '待检测').length,
  }
}

export type InspectionInput = {
  id: number
  date: string
  time?: string
  operator: string
  upperTemp: number | null
  lowerTemp?: number | null
  oilLevel?: number | null
  vibration?: number | null
}

/**
 * 提交检测：
 *  - 同一轴承同一班次重复提交，只按第一次算，后到的按重复退回（留痕不改结论）；
 *  - 同一时刻并发写入（双击/竞态）只保留一笔，其余按重复处理；
 *  - 下导缺项按上导−5℃ 推算补齐并标注；四个通道进同一个 evaluateBearing；
 *  - 判成待检修自动进检修班组待办。
 */
export function submitInspection(input: InspectionInput): BearingActionResult {
  const locked = runExclusive(`submit:${input.id}:${input.date}:${input.time ?? ''}`, () => doSubmit(input))
  if ('duplicate' in locked) {
    return { ok: false, message: '同一时刻已有相同检测在提交，按重复处理，只保留第一笔', duplicate: true }
  }
  return locked
}

function doSubmit(input: InspectionInput): BearingActionResult {
  const state = getBearingState()
  const index = state.records.findIndex((row) => row.id === input.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.id} 的导轴承` }
  }
  const record = state.records[index]
  const shift = shiftOf(input.date, input.time ?? '12:00')

  // 同一轴承同一班次只认第一次。
  const dup = record.history.some(
    (entry) =>
      !entry.rejectedAsDuplicate &&
      entry.inspectedAt === input.date &&
      entry.shift === shift,
  )
  if (dup) {
    const rejected = {
      inspectedAt: input.date,
      shift,
      operator: input.operator,
      level: record.history.find((entry) => entry.inspectedAt === input.date && entry.shift === shift)?.level ??
        (record.status === '待检修' ? '待检修' : record.status === '温度偏高' ? '温度偏高' : '正常'),
      ruleVersion: state.activeVersion,
      reasons: [],
      lowerTempImputed: false,
      rejectedAsDuplicate: true,
    }
    record.history.push(rejected)
    persist()
    return {
      ok: false,
      message: `${record.bearingNo} 在 ${input.date} ${shift} 已提交过检测，同一班次重复提交按第一次结果计，本次退回`,
      duplicate: true,
    }
  }

  let lowerTemp = input.lowerTemp ?? null
  let imputed = false
  const remarks = [...record.remarks]
  if (lowerTemp === null && input.upperTemp !== null) {
    lowerTemp = imputeLowerTemp(input.upperTemp)
    imputed = true
    remarks.push(`${input.date} ${shift} 检测未测下导温度，按上导−5℃ 推算补齐（非实测）`)
  }

  const signals: BearingSignalInput = {
    upperTemp: input.upperTemp,
    lowerTemp,
    lowerTempImputed: imputed,
    oilLevel: input.oilLevel ?? null,
    vibration: input.vibration ?? null,
    inspectedAt: input.date,
  }
  const rule = activeRule()
  const verdict = evaluateBearing(signals, rule)

  record.signals = signals
  record.lastInspectedAt = input.date
  record.lastShift = shift
  record.lastOperator = input.operator
  record.ruleVersion = rule.version
  record.remarks = remarks
  record.history.push({
    inspectedAt: input.date,
    shift,
    operator: input.operator,
    level: verdict.level,
    ruleVersion: rule.version,
    reasons: verdict.reasons,
    lowerTempImputed: imputed,
  })

  if (record.repaired) {
    // 检修闭环后的新检测开启下一轮跟踪。
    record.repaired = false
  }
  record.status = verdict.level
  if (verdict.level === '待检修' && !record.repairTodo.open) {
    record.repairTodo = { open: true, openedAt: input.date, closedAt: null, ruleVersion: rule.version }
  }
  persist()
  const tail = verdict.level === '待检修' ? '，已进入检修班组待办清单' : ''
  return { ok: true, message: `${record.bearingNo} 检测完成，按规则 ${rule.version} 判为「${verdict.level}」${tail}` }
}

/**
 * 确认检修（检修班组在另一个入口，或本页面，共用这一个实现）：
 * 上导温度标记（轴承状态）与待检修台数同步回落，待办关闭。
 */
export function confirmRepair(id: number, operator = '检修班组'): BearingActionResult {
  const locked = runExclusive(`repair:${id}`, () => {
    const state = getBearingState()
    const index = state.records.findIndex((row) => row.id === id)
    if (index < 0) {
      return { ok: false as const, message: `没有找到编号为 ${id} 的导轴承` }
    }
    const record = state.records[index]
    if (!record.repairTodo.open && record.status !== '待检修') {
      return { ok: false as const, message: `${record.bearingNo} 没有待处理的检修项` }
    }
    record.status = '已检修'
    record.repaired = true
    record.repairTodo = { open: false, openedAt: record.repairTodo.openedAt, closedAt: new Date().toISOString().slice(0, 10), ruleVersion: record.repairTodo.ruleVersion }
    record.history.push({
      inspectedAt: record.repairTodo.closedAt ?? record.lastInspectedAt ?? '',
      shift: record.lastShift ?? '白班',
      operator,
      level: '正常',
      ruleVersion: record.ruleVersion,
      reasons: ['确认检修完成，待办关闭，状态回落为已检修'],
      lowerTempImputed: false,
    })
    persist()
    return { ok: true as const, message: `${record.bearingNo} 已确认检修，待办关闭，待检修台数回落` }
  })
  if ('duplicate' in locked) {
    return { ok: false, message: '同一时刻重复确认检修，按重复处理，只保留第一笔', duplicate: true }
  }
  return locked
}

/**
 * 发布新版界值并按新版重算已处理过的轴承：
 * 历史结论保留当时等级并注明版本（在原履历上挂 recomputed），
 * 当前状态取新版结果；已检修的记录状态不回退；待办按新版结果开关。
 */
export function publishRule(rule: BearingRuleVersion, operator = '值班管理员'): BearingActionResult {
  const locked = runExclusive(`publish-rule:${rule.version}`, () => {
    const state = getBearingState()
    if ([...RULE_VERSIONS, ...state.publishedRules].some((item) => item.version === rule.version)) {
      return { ok: false as const, message: `规则版本 ${rule.version} 已存在，界值只能发新版不能改旧版` }
    }
    state.publishedRules = [...state.publishedRules, rule]
    state.activeVersion = rule.version
    const at = new Date().toISOString().slice(0, 10)
    for (const record of state.records) {
      const verdict = evaluateBearing(record.signals, rule)
      // 给每条历史结论注明按新版重算的等级，原等级不动。
      record.history = record.history.map((entry) =>
        entry.rejectedAsDuplicate
          ? entry
          : { ...entry, recomputed: { level: verdict.level, ruleVersion: rule.version, at } },
      )
      if (!record.repaired) {
        record.status = verdict.level
        record.ruleVersion = rule.version
        if (verdict.level === '待检修' && !record.repairTodo.open) {
          record.repairTodo = { open: true, openedAt: at, closedAt: null, ruleVersion: rule.version }
        } else if (verdict.level !== '待检修') {
          // 重算后不再达待检修，且尚未开工的待办同步撤下（由界值版本驱动）。
          record.repairTodo = { ...record.repairTodo, open: false, closedAt: at }
        }
      }
      record.remarks.push(`${at} 界值发布 ${rule.version}：历史结论保留原等级，当前等级已按新版重算（操作人：${operator}）`)
    }
    persist()
    return { ok: true as const, message: `规则 ${rule.version} 已发布，已处理轴承按新版重算，历史结论保留当时等级并注明版本` }
  })
  if ('duplicate' in locked) {
    return { ok: false, message: '同一时刻重复发布规则，按重复处理，只保留第一笔', duplicate: true }
  }
  return locked
}

export type RegisterInput = {
  bearingNo: string
  unitNo: string
  operator: string
  date: string
  time?: string
  upperTemp: number | null
  lowerTemp?: number | null
  oilLevel?: number | null
  vibration?: number | null
}

/** 登记导轴承：轴承编号同号并发登记只保留一笔；无检测值时落「待检测」。 */
export function registerBearing(input: RegisterInput): BearingActionResult {
  const locked = runExclusive(`register:${input.bearingNo}`, () => {
    const state = getBearingState()
    if (state.records.some((row) => row.bearingNo === input.bearingNo)) {
      return { ok: false as const, message: `轴承编号 ${input.bearingNo} 已存在，按重复登记退回` }
    }
    const id = state.records.reduce((max, row) => Math.max(max, row.id), 0) + 1
    const inspectedAt = input.date
    const base: BearingRecord = {
      id,
      bearingNo: input.bearingNo,
      unitNo: input.unitNo,
      signals: { upperTemp: null, lowerTemp: null, lowerTempImputed: false, oilLevel: null, vibration: null, inspectedAt },
      status: '待检测',
      ruleVersion: state.activeVersion,
      lastInspectedAt: null,
      lastShift: null,
      lastOperator: null,
      history: [],
      repairTodo: { open: false, openedAt: null, closedAt: null, ruleVersion: null },
      repaired: false,
      remarks: [`${inspectedAt} 登记建档（操作人：${input.operator}）`],
    }
    state.records = [...state.records, base]
    persist()

    if (input.upperTemp !== null || input.lowerTemp !== null || input.oilLevel !== null || input.vibration !== null) {
      const result = submitInspection({
        id,
        date: input.date,
        time: input.time,
        operator: input.operator,
        upperTemp: input.upperTemp,
        lowerTemp: input.lowerTemp,
        oilLevel: input.oilLevel,
        vibration: input.vibration,
      })
      return result.ok
        ? { ok: true as const, message: `${input.bearingNo} 登记并完成首次检测：${result.message}` }
        : { ok: true as const, message: `${input.bearingNo} 已登记，首次检测提示：${result.message}` }
    }
    return { ok: true as const, message: `${input.bearingNo} 已登记，状态「待检测」` }
  })
  if ('duplicate' in locked) {
    return { ok: false, message: '同一时刻重复登记同一轴承，按重复处理，只保留第一笔', duplicate: true }
  }
  return locked
}

export function currentVersion(): string {
  return getBearingState().activeVersion || CURRENT_RULE_VERSION
}

export function resetDomain(): void {
  resetBearingState()
}

/** 给另存（导出）用的扁平结构：同样不在这里做任何判级，只投影统一实现的产物。 */
export function toRowCells(record: BearingRecord): Record<string, string> {
  const ch = evaluateBearing(record.signals, ruleByVersion(record.ruleVersion, allRules()))
  return {
    编号: String(record.id),
    轴承编号: record.bearingNo,
    所属机组: record.unitNo,
    上导温度: record.signals.upperTemp === null ? '缺测' : String(record.signals.upperTemp),
    下导温度:
      record.signals.lowerTemp === null
        ? '缺测'
        : `${record.signals.lowerTemp}${record.signals.lowerTempImputed ? '(推算)' : ''}`,
    油位高度: record.signals.oilLevel === null ? '缺测' : String(record.signals.oilLevel),
    振动数值: record.signals.vibration === null ? '缺测' : String(record.signals.vibration),
    检测日期: record.signals.inspectedAt,
    判定等级: ch.level,
    规则版本: record.ruleVersion,
    当前状态: record.status,
    升级理由: ch.reasons.join('；') || '各通道均在界值内',
    检修待办: record.repairTodo.open ? '待检修' : '—',
  }
}
