import {
  CURRENT_POLICY,
  CURRENT_POLICY_VERSION,
  GRADES,
  evaluateReadings,
  judgeInspection,
  recomputeChain,
} from '@/domain/bearing-policy'
import type { BearingPolicy, BearingReadings, Grade } from '@/domain/bearing-policy'
import type {
  BearingInspection,
  BearingState,
  PolicyRevision,
  RejectedSubmission,
  RepairTodo,
} from '@/domain/bearing-types'
import { backfillLegacyRows } from '@/domain/legacy-bearings'
import {
  bearingStorageKey,
  loadBearingState,
  persistBearingState,
  registerBearingInitializer,
  reloadBearingState,
  resetBearingState,
} from './bearing-store'

/**
 * 导轴承业务服务：全站唯一的读写入口。
 *
 * 收拢结果（对应需求）：
 * - 上导温度、下导温度、油位高度、振动数值的判级只在 domain/bearing-policy.ts，
 *   页面展示、提交动作、导出另存都通过本服务拿结论，不再各写一遍；
 * - 判成“待检修”的轴承在 reconcileTodos 里落检修班组待办，另一个入口（/repair-todos）读同一状态；
 * - 确认检修后轴承状态与待办同步完成，汇总条与台账都从同一份状态选择；
 * - 同一轴承同一班次重复提交（含同一时刻并发）只保留第一笔，其余记退回；
 * - 界值调整发布新版本，按新版重算全部检测链，历史结论快照（等级+版本）不覆盖；
 * - 老台账迁移保留原编号与既有结论，按检测日期排序回填，缺下导温度按温差法补齐。
 */

export type ServiceResult<T = void> =
  | ({ ok: true; duplicate: false } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; duplicate: true; message: string }

function nowIso(): string {
  return new Date().toISOString()
}

/** 当前班次：同一班次内同轴承重复提交只算第一次。 */
export type ShiftContext = {
  shift: string
  operator: string
}

function sortChain(rows: BearingInspection[]): BearingInspection[] {
  return [...rows].sort((a, b) => {
    const byDate = a.inspectedAt.localeCompare(b.inspectedAt)
    return byDate !== 0 ? byDate : a.id - b.id
  })
}

function policyFromRevision(version: string, policies: PolicyRevision[]): BearingPolicy {
  const revision = policies.find((item) => item.version === version)
  if (!revision) {
    throw new Error(`界值版本 ${version} 不存在`)
  }
  return {
    version: revision.version,
    tempWarn: revision.tempWarn,
    tempTrip: revision.tempTrip,
    oilLow: revision.oilLow,
    oilHigh: revision.oilHigh,
    oilTripMargin: revision.oilTripMargin,
    vibrationWarn: revision.vibrationWarn,
    vibrationTrip: revision.vibrationTrip,
  }
}

/* ------------------------------------------------------------------ */
/* 老台账迁移                                                          */
/* ------------------------------------------------------------------ */

/**
 * 从老台账构造初始状态：
 * 1. 缺项按业务日期回填（见 legacy-bearings.ts 的温差法）；
 * 2. 既有结论原样保留，标注 legacy 版本；
 * 3. 按检测日期成链，用当前界值重算出 currentGrade（不重排、不改 id）；
 * 4. 待检修落待办，已无待检修条件的老待办由 reconcileTodos 自动核销。
 */
export function migrateLegacyLedger(now: string = nowIso()): BearingState {
  const backfilled = backfillLegacyRows()

  const inspections: BearingInspection[] = backfilled.map((row) => ({
    id: row.id,
    bearingCode: row.bearingCode,
    unit: row.unit,
    inspectedAt: row.inspectedAt,
    shift: row.shift,
    operator: row.operator,
    readings: {
      upperTemp: row.upperTemp,
      lowerTemp: row.lowerTemp,
      oilLevel: row.oilLevel,
      vibration: row.vibration,
    },
    estimated: row.estimated,
    backfillNote: row.backfillNote,
    grade: row.status,
    policyVersion: row.policyVersion,
    escalated: false,
    reasons: [],
    currentGrade: row.status,
    currentReasons: [],
    createdAt: now,
  }))

  const policies: PolicyRevision[] = [
    {
      version: CURRENT_POLICY_VERSION,
      publishedAt: '2026-10-01T00:00:00.000Z',
      note: '统一界值首版：上导/下导统一 60 报警、65 检修；油位 200~400mm；振动 0.10/0.15mm',
      ...{
        tempWarn: CURRENT_POLICY.tempWarn,
        tempTrip: CURRENT_POLICY.tempTrip,
        oilLow: CURRENT_POLICY.oilLow,
        oilHigh: CURRENT_POLICY.oilHigh,
        oilTripMargin: CURRENT_POLICY.oilTripMargin,
        vibrationWarn: CURRENT_POLICY.vibrationWarn,
        vibrationTrip: CURRENT_POLICY.vibrationTrip,
      },
    },
  ]

  const maxLegacyId = inspections.reduce((max, row) => Math.max(max, row.id), 0)
  const state: BearingState = {
    inspections,
    bearings: [],
    todos: [],
    rejected: [],
    policies,
    activeVersion: CURRENT_POLICY_VERSION,
    seq: maxLegacyId + 1,
  }

  // 当前界值下整条链重算，currentGrade 写回每条记录；历史 grade/policyVersion 快照不动。
  recomputeStateChains(state, CURRENT_POLICY)
  rebuildBearings(state)
  reconcileTodos(state, CURRENT_POLICY, now)
  return state
}

/** 按轴承把检测记录成链回放，写回每条记录的 currentGrade / currentReasons。 */
function recomputeStateChains(state: BearingState, policy: BearingPolicy): void {
  const repairedAtByCode = new Map(state.bearings.map((item) => [item.code, item.repairedAt]))
  const byBearing = new Map<string, BearingInspection[]>()
  for (const row of state.inspections) {
    const list = byBearing.get(row.bearingCode) ?? []
    list.push(row)
    byBearing.set(row.bearingCode, list)
  }
  for (const list of byBearing.values()) {
    const chain = sortChain(list)
    const results = recomputeChain(
      chain.map((row) => ({
        readings: row.readings,
        inspectedAt: row.inspectedAt,
        // 温度连续偏高升级只认温度实测记录：上导或下导缺项推算的，不算实测前次。
        tempsMeasured: !row.estimated.includes('上导温度') && !row.estimated.includes('下导温度'),
      })),
      policy,
      repairedAtByCode.get(chain[0].bearingCode),
    )
    chain.forEach((row, index) => {
      row.currentGrade = results[index].grade
      row.currentReasons = results[index].reasons
    })
  }
}

function rebuildBearings(state: BearingState): void {
  const map = new Map<string, { unit: string; latest: BearingInspection | null }>()
  for (const row of sortChain(state.inspections)) {
    const entry = map.get(row.bearingCode) ?? { unit: row.unit, latest: null }
    entry.unit = row.unit
    entry.latest = row
    map.set(row.bearingCode, entry)
  }
  const existingByCode = new Map(state.bearings.map((item) => [item.code, item]))
  state.bearings = [...map.entries()].map(([code, entry]) => {
    const old = existingByCode.get(code)
    return {
      code,
      unit: entry.unit,
      latestId: entry.latest?.id ?? null,
      repairedAt: old?.repairedAt ?? null,
      repairNote: old?.repairNote ?? null,
    }
  })
}

/**
 * 待办对账（唯一的一份“升级写法”）：
 * 每个轴承当前结论为待检修且没确认过检修 -> 保证有一条待处理待办（沿用最早一条，不重复开）；
 * 当前结论回落，或已确认检修 -> 打开的待办关闭（已完成 / 已核销），数量随状态回落。
 */
export function reconcileTodos(state: BearingState, policy: BearingPolicy, at: string = nowIso()): void {
  const chainByCode = new Map<string, BearingInspection[]>()
  for (const row of state.inspections) {
    const list = chainByCode.get(row.bearingCode) ?? []
    list.push(row)
    chainByCode.set(row.bearingCode, list)
  }

  for (const bearing of state.bearings) {
    const chain = sortChain(chainByCode.get(bearing.code) ?? [])
    const latest = chain[chain.length - 1]
    const open = state.todos
          .filter((todo) => todo.bearingCode === bearing.code && todo.status === '待处理')
          .sort((a, b) => a.id - b.id)

    if (!latest) {
      continue
    }
    const repaired = bearing.repairedAt !== null && bearing.repairedAt > latest.inspectedAt
    if (latest.currentGrade === '待检修' && !repaired) {
      if (!open.length) {
        state.todos.push({
          id: state.seq++,
          bearingCode: bearing.code,
          unit: bearing.unit,
          sourceInspectionId: latest.id,
          openedAt: at,
          reason: latest.currentReasons.join('；') || `按界值版本${policy.version}判为待检修`,
          status: '待处理',
          closedAt: null,
          closeNote: null,
          policyVersion: policy.version,
        })
      } else {
        open[0].sourceInspectionId = latest.id
        open[0].reason = latest.currentReasons.join('；') || open[0].reason
        open[0].policyVersion = policy.version
      }
    } else if (open.length) {
      const note = repaired
        ? `已于${bearing.repairedAt}确认检修，待办完成`
        : `界值版本${policy.version}重算后当前结论为「${latest.currentGrade}」，自动核销`
      for (const todo of open) {
        todo.status = repaired ? '已完成' : '已核销'
        todo.closedAt = at
        todo.closeNote = note
      }
    }
  }
}

registerBearingInitializer(() => migrateLegacyLedger())

/* ------------------------------------------------------------------ */
/* 读取与汇总：页面、待办入口、看板、导出都从这里取，结论只有一份        */
/* ------------------------------------------------------------------ */

export function getState(): BearingState {
  return loadBearingState()
}

export type BearingView = {
  code: string
  unit: string
  latest: BearingInspection
  /** 页面状态：当前判级，或已检修（确认检修晚于最近检测）。 */
  status: Grade | '已检修'
  grade: Grade | null
  openTodo: RepairTodo | null
}

/**
 * 一台轴承当前该显示什么。台账表、汇总条、待办清单条数全部基于这个视图，
 * 保证“确认检修后上导温度标记与待检修台数两处读到的一致”。
 */
export function listBearingViews(): BearingView[] {
  const state = loadBearingState()
  return state.bearings.map((bearing) => {
    const chain = sortChain(state.inspections.filter((row) => row.bearingCode === bearing.code))
    const latest = chain[chain.length - 1]
    const openTodo = state.todos.find(
      (todo) => todo.bearingCode === bearing.code && todo.status === '待处理',
    ) ?? null
    const repaired = bearing.repairedAt !== null && bearing.repairedAt > latest.inspectedAt
    return {
      code: bearing.code,
      unit: bearing.unit,
      latest,
      status: repaired ? '已检修' : latest.currentGrade,
      grade: repaired ? null : latest.currentGrade,
      openTodo,
    }
  })
}

export function listInspections(filters: { bearingCode?: string } = {}): BearingInspection[] {
  const state = loadBearingState()
  const keyword = filters.bearingCode?.trim()
  const rows = keyword
    ? state.inspections.filter((row) => row.bearingCode.includes(keyword as string))
    : state.inspections
  return sortChain(rows)
}

export function listRepairTodos(status: '待处理' | '已完成' | '已核销' | '全部' = '待处理'): RepairTodo[] {
  const state = loadBearingState()
  const rows = status === '全部' ? state.todos : state.todos.filter((todo) => todo.status === status)
  return [...rows].sort((a, b) => {
    const byStatus = Number(a.status !== '待处理') - Number(b.status !== '待处理')
    return byStatus !== 0 ? byStatus : a.id - b.id
  })
}

export function listRejected(): RejectedSubmission[] {
  return [...loadBearingState().rejected].sort((a, b) => b.id - a.id)
}

export function listPolicies(): PolicyRevision[] {
  return loadBearingState().policies
}

export function activePolicy(): BearingPolicy {
  const state = loadBearingState()
  return policyFromRevision(state.activeVersion, state.policies)
}

export type BearingSummary = {
  total: number
  normal: number
  high: number
  waitingRepair: number
  repaired: number
}

/** 汇总条唯一来源：和台账行、待办条数同源，不可能对不上。 */
export function bearingSummary(): BearingSummary {
  const views = listBearingViews()
  return {
    total: views.length,
    normal: views.filter((view) => view.status === '正常').length,
    high: views.filter((view) => view.status === '温度偏高').length,
    waitingRepair: views.filter((view) => view.status === '待检修').length,
    repaired: views.filter((view) => view.status === '已检修').length,
  }
}

/* ------------------------------------------------------------------ */
/* 写入动作：提交检测 / 确认检修 / 发版重算                            */
/* ------------------------------------------------------------------ */

export type SubmitInput = {
  bearingCode: string
  unit: string
  inspectedAt: string
  readings: BearingReadings
  shift: string
  operator: string
}

/**
 * 提交检测。同一轴承同一班次只保留第一笔：
 * - 页面重复点、同一时刻并发后到的，都先重读磁盘再裁决，后到者按重复退回；
 * - 退回记录保留取值，冲突时以“先落到服务层的一笔”为准——
 *   依据：判级只承认持久化后的第一笔，页面不缓存自己的结论，从根上消掉两种结论。
 */
export function submitInspection(input: SubmitInput, at: string = nowIso()): ServiceResult<BearingInspection> {
  const state = reloadBearingState()
  const code = input.bearingCode.trim()
  if (!code) {
    return { ok: false, duplicate: true, message: '轴承编号不能为空' }
  }
  const dup = state.inspections.find(
    (row) => row.bearingCode === code && row.inspectedAt === input.inspectedAt && row.shift === input.shift,
  )
  if (dup) {
    state.rejected.push({
      id: state.seq++,
      bearingCode: code,
      unit: input.unit,
      inspectedAt: input.inspectedAt,
      shift: input.shift,
      operator: input.operator,
      readings: input.readings,
      reason: `同一轴承同一班次（${input.inspectedAt} ${input.shift}）已由记录#${dup.id}受理，重复提交按第一笔算，本次退回`,
      createdAt: at,
    })
    persistBearingState(state)
    return {
      ok: false,
      duplicate: true,
      message: `重复提交已退回：该轴承本班次检测已受理（记录#${dup.id}，结论「${dup.currentGrade}」），只按第一次算`,
    }
  }

  const policy = policyFromRevision(state.activeVersion, state.policies)
  const id = state.seq++
  // 先占位再按“当前界值下整链回放”定论，保证连续偏高升级与已有记录一致。
  const row: BearingInspection = {
    id,
    bearingCode: code,
    unit: input.unit,
    inspectedAt: input.inspectedAt,
    shift: input.shift,
    operator: input.operator,
    readings: input.readings,
    estimated: [],
    backfillNote: null,
    grade: '正常',
    policyVersion: policy.version,
    escalated: false,
    reasons: [],
    currentGrade: '正常',
    currentReasons: [],
    createdAt: at,
  }
  state.inspections.push(row)
  recomputeStateChains(state, policy)
  const saved = state.inspections.find((item) => item.id === id)
  if (!saved) {
    throw new Error('检测记录写入失败')
  }
  // 历史快照与当时结论：新发的检测，写入时两版结论一致。
  saved.grade = saved.currentGrade
  saved.escalated = saved.currentReasons.some((text) => text.includes('连续两次'))
  saved.reasons = [...saved.currentReasons]
  rebuildBearings(state)
  reconcileTodos(state, policy, at)
  persistBearingState(state)
  return { ok: true, duplicate: false, data: saved }
}

/**
 * 确认检修：检修班组在待办入口或导轴承页面执行同一份实现。
 * 轴承转“已检修”、待办完成、待检修台数回落，连续偏高计数以新检测重新起算。
 */
export function confirmRepair(bearingCode: string, note: string, at: string = nowIso()): ServiceResult {
  const state = reloadBearingState()
  const bearing = state.bearings.find((item) => item.code === bearingCode)
  if (!bearing) {
    return { ok: false, duplicate: true, message: `没有找到轴承 ${bearingCode}` }
  }
  const open = state.todos.filter((todo) => todo.bearingCode === bearingCode && todo.status === '待处理')
  if (!open.length) {
    const already = bearing.repairedAt
      ? '该轴承已确认检修'
      : '该轴承当前没有待处理的检修待办，无需确认检修'
    return { ok: false, duplicate: true, message: already }
  }
  bearing.repairedAt = at
  bearing.repairNote = note || '检修班组确认处理完成'
  const policy = policyFromRevision(state.activeVersion, state.policies)
  reconcileTodos(state, policy, at)
  persistBearingState(state)
  return { ok: true, duplicate: false }
}

/**
 * 发布新一版界值：只许追加、不许改旧版。
 * 已处理过的轴承按新版整链重算（currentGrade），历史结论 grade/policyVersion 原样保留；
 * 待办按新结论自动开出/核销；汇总条随之变化，全部同源。
 */
export function publishPolicyRevision(
  input: Omit<PolicyRevision, 'version' | 'publishedAt'> & { version?: string },
  at: string = nowIso(),
): ServiceResult<PolicyRevision> {
  const state = reloadBearingState()
  const version = input.version?.trim() || `v${state.policies.length + 1}-${at.slice(0, 10)}`
  if (state.policies.some((item) => item.version === version)) {
    return { ok: false, duplicate: true, message: `界值版本 ${version} 已存在，不能覆盖旧版` }
  }
  const revision: PolicyRevision = { ...input, version, publishedAt: at }
  state.policies.push(revision)
  state.activeVersion = version
  const policy = policyFromRevision(version, state.policies)
  recomputeStateChains(state, policy)
  reconcileTodos(state, policy, at)
  persistBearingState(state)
  return { ok: true, duplicate: false, data: revision }
}

/* ------------------------------------------------------------------ */
/* 导出另存：与页面、动作共用判级，导出的也是同一份结论                 */
/* ------------------------------------------------------------------ */

export function exportBearingLedger(): { filename: string; content: string } {
  const state = loadBearingState()
  const policy = policyFromRevision(state.activeVersion, state.policies)
  const header = [
    '记录编号', '轴承编号', '所属机组', '检测日期', '班次', '检测人',
    '上导温度(℃)', '下导温度(℃)', '油位高度(mm)', '振动数值(mm)', '缺项补齐',
    '历史结论', '结论界值版本', '当前结论', '当前界值版本', '升级说明',
  ]
  const lines = [header.join(',')]
  for (const row of sortChain(state.inspections)) {
    const estimatedText = row.estimated.length ? `推算:${row.estimated.join('/')}` : ''
    const values = [
      row.id,
      row.bearingCode,
      row.unit,
      row.inspectedAt,
      row.shift,
      row.operator,
      row.readings.upperTemp ?? '',
      row.readings.lowerTemp ?? '',
      row.readings.oilLevel ?? '',
      row.readings.vibration ?? '',
      estimatedText,
      row.grade,
      row.policyVersion,
      row.currentGrade,
      policy.version,
      row.currentReasons.join('；'),
    ].map((value) => String(value).replace(/,/g, '，'))
    lines.push(values.join(','))
  }
  return { filename: `导轴承检测台账-${policy.version}.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadBearingLedger(): void {
  const { filename, content } = exportBearingLedger()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 试算：不写入，给页面上“按当前输入会判成什么”的即时提示，结论仍来自同一份判级。 */
export function previewGrade(readings: BearingReadings, bearingCode?: string) {
  const state = loadBearingState()
  const policy = policyFromRevision(state.activeVersion, state.policies)
  const bearing = bearingCode ? state.bearings.find((item) => item.code === bearingCode) : undefined
  const chain = bearingCode
    ? sortChain(state.inspections.filter((row) => row.bearingCode === bearingCode))
    : []
  const latestDate = chain[chain.length - 1]?.inspectedAt
  // 确认检修之后连高计数清零：检修后重新起算，不拿检修前的偏高做升级依据。
  const chainAfterRepair = bearing?.repairedAt && latestDate && bearing.repairedAt > latestDate ? [] : chain
  const history = chainAfterRepair
    .filter((row) => row.policyVersion !== 'legacy-pre2026')
    .map((row) => ({
      grade: row.grade,
      estimated: row.estimated.includes('上导温度') || row.estimated.includes('下导温度'),
    }))
  return judgeInspection(readings, history, policy)
}

export { GRADES, bearingStorageKey, evaluateReadings, resetBearingState }
