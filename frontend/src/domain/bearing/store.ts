import { BEARING_SEED_RECORDS } from './seed'
import { imputeLowerTemp } from './rules'
import type { BearingRecord, BearingRuleVersion, BearingStatus } from './types'

/**
 * 导轴承独立存储。
 * - 与通用台账分开存，自带结构版本，后续界值版本演进不影响其它模块；
 * - 首次初始化时做一次性迁移：从旧通用台账 `hydropower-plant-om:entries`
 *   按检测日期（业务时间）把导轴承记录搬过来，保留原编号与既有结论，不重排；
 * - 所有写操作走 runExclusive：同一时刻同一业务键的并发写入只放第一笔，其余按重复退回。
 */

const GENERIC_STORAGE_KEY = 'hydropower-plant-om:entries'
export const BEARING_STORAGE_KEY = 'hydropower-plant-om:bearing:v2'
const BEARING_SCHEMA = 2

export type BearingState = {
  schema: number
  /** 界值调整后追加的规则版本；与内置 RULE_VERSIONS 合并使用，只追加不改写。 */
  publishedRules: BearingRuleVersion[]
  activeVersion: string
  records: BearingRecord[]
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
    return Number(value.trim())
  }
  return null
}

export type LegacyRow = {
  id: number
  status: string
  轴承编号?: string
  所属机组?: string
  上导温度?: unknown
  下导温度?: unknown
  油位高度?: unknown
  振动数值?: unknown
  检测日期?: string
}

/** 判断旧通用台账里的导轴承数据是脚手架占位样例还是真实老台账。 */
function isScaffoldSample(rows: LegacyRow[]): boolean {
  // 脚手架样例的特征：编号为 BEAR-0001.. 且温度等字段是“导轴承样例N”这类占位串；
  // 真实老台账即使缺测，编号/机组成列正常，不会整片都是占位串。
  const placeholderLike = rows.filter(
    (row) => /导轴承样例/.test(String(row.所属机组 ?? '')) && parseNumber(row.上导温度) === null,
  )
  return placeholderLike.length === rows.length
}

/**
 * 老台账迁移：逐条按业务时间回填。
 * 早年缺下导温度的按「下导 = 上导 − 5℃」补齐并标注；
 * 油位、振动缺测记 null（不参与判级）；既有结论原样保留，版本记 v1。
 */
export function migrateLegacyRows(rows: LegacyRow[]): BearingRecord[] {
  const ordered = [...rows].sort((a, b) => String(a.检测日期 ?? '').localeCompare(String(b.检测日期 ?? '')))
  const migrated = ordered.map((row): BearingRecord => {
    const inspectedAt = String(row.检测日期 ?? '').slice(0, 10) || '2000-01-01'
    const upperTemp = parseNumber(row.上导温度)
    let lowerTemp = parseNumber(row.下导温度)
    let imputed = false
    const remarks: string[] = []
    if (lowerTemp === null && upperTemp !== null) {
      lowerTemp = imputeLowerTemp(upperTemp)
      imputed = true
      remarks.push('迁移补项：早期仅记录上导温度，下导温度按「上导−5℃」推算补齐（非实测）')
    }
    const oilLevel = parseNumber(row.油位高度)
    const vibration = parseNumber(row.振动数值)
    if (oilLevel === null) {
      remarks.push('迁移补项：油位高度缺测，不参与判级')
    }
    if (vibration === null) {
      remarks.push('迁移补项：振动数值缺测，不参与判级')
    }
    const rawStatus = String(row.status)
    const status: BearingStatus =
      rawStatus === '温度偏高' || rawStatus === '待检修' || rawStatus === '已检修' || rawStatus === '正常'
        ? rawStatus
        : '待检测'
    const level = status === '已检修' || status === '待检测' ? '正常' : status
    const repaired = status === '已检修'
    remarks.push(`迁移保留：既有结论「${status}」按 v1 留档，不按新版界值重排`)

    return {
      id: row.id,
      bearingNo: String(row.轴承编号 ?? `BEAR-${String(row.id).padStart(4, '0')}`),
      unitNo: String(row.所属机组 ?? ''),
      signals: { upperTemp, lowerTemp, lowerTempImputed: imputed, oilLevel, vibration, inspectedAt },
      status,
      ruleVersion: 'v1',
      lastInspectedAt: inspectedAt,
      lastShift: '白班',
      lastOperator: '历史台账',
      history: [
        { inspectedAt, shift: '白班', operator: '历史台账', level, ruleVersion: 'v1', reasons: [], lowerTempImputed: imputed },
      ],
      repairTodo: {
        open: status === '待检修',
        openedAt: status === '待检修' ? inspectedAt : null,
        closedAt: status === '已检修' ? inspectedAt : null,
        ruleVersion: status === '待检修' ? 'v1' : null,
      },
      repaired,
      remarks,
    }
  })
  // 展示顺序仍按原编号，不被业务时间排序或新版本重排。
  return migrated.sort((a, b) => a.id - b.id)
}

function readLegacyBearingRows(): LegacyRow[] | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(GENERIC_STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, LegacyRow[]>
    const rows = parsed.bearing
    return Array.isArray(rows) ? rows : null
  } catch {
    return null
  }
}

function seedState(): BearingState {
  const legacy = readLegacyBearingRows()
  if (legacy && legacy.length > 0 && !isScaffoldSample(legacy)) {
    // 真实老台账：按业务时间迁移，保留编号与结论；统一口径 v2 即刻在用。
    return { schema: BEARING_SCHEMA, publishedRules: [], activeVersion: 'v2', records: migrateLegacyRows(legacy) }
  }
  // 脚手架占位数据不构成历史台账，用正式存量样例播种（编号仍从 1 开始、连续不重排）。
  return {
    schema: BEARING_SCHEMA,
    publishedRules: [],
    activeVersion: 'v2',
    records: JSON.parse(JSON.stringify(BEARING_SEED_RECORDS)) as BearingRecord[],
  }
}

let state: BearingState | null = null

export function getBearingState(): BearingState {
  if (state !== null) {
    return state
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(BEARING_STORAGE_KEY)
    if (raw) {
      try {
        state = JSON.parse(raw) as BearingState
        return state
      } catch {
        // 落盘损坏时回到播种，不影响页面可用。
      }
    }
  }
  state = seedState()
  persist()
  return state
}

export function persist(next?: BearingState): void {
  if (next) {
    state = next
  }
  if (typeof window !== 'undefined' && window.localStorage && state) {
    window.localStorage.setItem(BEARING_STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetBearingState(): BearingState {
  state = seedState()
  persist()
  return state
}

/**
 * 同一时刻并发写入只保留一笔：同业务键重入直接判重，第一笔执行完同步放行。
 * 业务键本身已编码同一轴承/同一班次，双击、Promise 重入与竞态都在此被挡。
 */
const inflight = new Set<string>()

export function runExclusive<T>(key: string, fn: () => T): T | { duplicate: true } {
  if (inflight.has(key)) {
    return { duplicate: true }
  }
  inflight.add(key)
  try {
    return fn()
  } finally {
    inflight.delete(key)
  }
}
