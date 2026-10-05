import { LEGACY_VERSION } from './bearing-policy'
import type { Grade, IndicatorName } from './bearing-policy'

/**
 * 老台账原始记录（迁移前的真实样貌）。
 * - id 沿用原导轴承页面里的 1/2/3 编号，迁移后不重排、不改既有结论；
 * - 早期记录只测了上导温度（下导温度、油位、振动缺项），按业务时间回填补齐；
 * - status 是当时老页面/动作写下的结论，迁移时作为历史结论保留并注明 legacy 版本。
 */

export type LegacyRawRow = {
  id: number
  bearingCode: string
  unit: string
  inspectedAt: string
  shift: string
  operator: string
  upperTemp: number | null
  lowerTemp: number | null
  oilLevel: number | null
  vibration: number | null
  status: Grade
}

export const LEGACY_RAW_ROWS: LegacyRawRow[] = [
  {
    id: 4,
    bearingCode: 'BEAR-0001',
    unit: '1号机组',
    inspectedAt: '2025-06-10',
    shift: '白班',
    operator: '李建国',
    upperTemp: 52,
    lowerTemp: null,
    oilLevel: null,
    vibration: null,
    status: '正常',
  },
  {
    id: 5,
    bearingCode: 'BEAR-0001',
    unit: '1号机组',
    inspectedAt: '2025-11-18',
    shift: '白班',
    operator: '李建国',
    upperTemp: 54,
    lowerTemp: 52,
    oilLevel: 320,
    vibration: 0.08,
    status: '正常',
  },
  {
    id: 1,
    bearingCode: 'BEAR-0001',
    unit: '1号机组',
    inspectedAt: '2026-09-01',
    shift: '白班',
    operator: '值班管理员',
    upperTemp: 55,
    lowerTemp: 53,
    oilLevel: 300,
    vibration: 0.09,
    status: '正常',
  },
  {
    id: 7,
    bearingCode: 'BEAR-0002',
    unit: '2号机组',
    inspectedAt: '2025-08-05',
    shift: '夜班',
    operator: '王海涛',
    upperTemp: 57,
    lowerTemp: null,
    oilLevel: null,
    vibration: null,
    status: '正常',
  },
  {
    id: 2,
    bearingCode: 'BEAR-0002',
    unit: '2号机组',
    inspectedAt: '2026-09-02',
    shift: '白班',
    operator: '值班管理员',
    upperTemp: 61,
    lowerTemp: 56,
    oilLevel: 305,
    vibration: 0.11,
    status: '温度偏高',
  },
  {
    // 大负荷工况：旧写法下导按 60 判“待检修”，统一界值（60 报警 / 65 检修）下只是“温度偏高”。
    // 历史结论保留旧判并注明版本，当前结论按新版重算——这就是“两种结论”冲突的现场。
    id: 8,
    bearingCode: 'BEAR-0002',
    unit: '2号机组',
    inspectedAt: '2026-09-20',
    shift: '夜班',
    operator: '王海涛',
    upperTemp: 62,
    lowerTemp: 60,
    oilLevel: 290,
    vibration: 0.12,
    status: '待检修',
  },
  {
    id: 3,
    bearingCode: 'BEAR-0003',
    unit: '3号机组',
    inspectedAt: '2026-09-03',
    shift: '白班',
    operator: '值班管理员',
    upperTemp: 66,
    lowerTemp: 61,
    oilLevel: 260,
    vibration: 0.13,
    status: '待检修',
  },
  {
    // 反向冲突：旧写法上导 65 才升级，64 只偏高；统一界值 65 检修、连续偏高也会升级。
    id: 9,
    bearingCode: 'BEAR-0003',
    unit: '3号机组',
    inspectedAt: '2026-08-19',
    shift: '白班',
    operator: '赵敏',
    upperTemp: 61,
    lowerTemp: 57,
    oilLevel: 280,
    vibration: 0.09,
    status: '温度偏高',
  },
  {
    id: 6,
    bearingCode: 'BEAR-0003',
    unit: '3号机组',
    inspectedAt: '2026-09-16',
    shift: '夜班',
    operator: '赵敏',
    upperTemp: 64,
    lowerTemp: 58,
    oilLevel: 176,
    vibration: 0.1,
    status: '温度偏高',
  },
  {
    id: 10,
    bearingCode: 'BEAR-0004',
    unit: '4号机组',
    inspectedAt: '2026-09-25',
    shift: '白班',
    operator: '陈立',
    upperTemp: 58,
    lowerTemp: 55,
    oilLevel: 350,
    vibration: 0.16,
    status: '待检修',
  },
]

export type LegacyBackfilledRow = LegacyRawRow & {
  estimated: IndicatorName[]
  backfillNote: string | null
  policyVersion: typeof LEGACY_VERSION
}

/**
 * 早年缺项按条补齐。下导温度缺失的补法（决定如下，依据写在注释里）：
 * 1) 优先用“同一轴承自己”后续有实测的记录，取上导−下导的平均温差，
 *    按 下导 = 上导 − 自身温差 回填——同机台冷热端温差稳定，比全廠平均可靠；
 * 2) 同一轴承没有任何成对实测时，用全厂成对记录的平均温差；
 * 3) 都没有时，按导轴承通行温差 3℃ 兜底（下导瓦温通常低于上导 2～4℃）。
 * 油位、振动早年未测：不凭空编工况值，按“同轴承距离该业务时间最近的一条实测值”就近借用，
 * 借不到就补正常中值（油位 300mm、振动 0.08mm）。所有补齐量一律标 estimated，台账注明“推算”。
 */
export function backfillLegacyRows(rows: LegacyRawRow[] = LEGACY_RAW_ROWS): LegacyBackfilledRow[] {
  const sorted = [...rows].sort((a, b) => a.inspectedAt.localeCompare(b.inspectedAt))

  // 各轴承自身的（上导−下导）实测温差
  const ownDeltas = new Map<string, number[]>()
  for (const row of rows) {
    if (row.upperTemp !== null && row.lowerTemp !== null) {
      const list = ownDeltas.get(row.bearingCode) ?? []
      list.push(row.upperTemp - row.lowerTemp)
      ownDeltas.set(row.bearingCode, list)
    }
  }
  const allDeltas = rows
    .filter((row) => row.upperTemp !== null && row.lowerTemp !== null)
    .map((row) => (row.upperTemp as number) - (row.lowerTemp as number))
  const globalDelta = allDeltas.length ? allDeltas.reduce((s, v) => s + v, 0) / allDeltas.length : 3

  function nearestMeasured(code: string, date: string, field: 'oilLevel' | 'vibration'): number | null {
    const candidates = rows
      .filter((r) => r.bearingCode === code && r[field] !== null)
      .map((r) => ({ value: r[field] as number, distance: Math.abs(r.inspectedAt.localeCompare(date)) }))
    if (!candidates.length) {
      return null
    }
    candidates.sort((a, b) => a.distance - b.distance)
    return candidates[0].value
  }

  return sorted.map((row) => {
    const estimated: IndicatorName[] = []
    const notes: string[] = []

    let lower = row.lowerTemp
    if (lower === null && row.upperTemp !== null) {
      const deltas = ownDeltas.get(row.bearingCode)
      const delta = deltas && deltas.length
        ? deltas.reduce((s, v) => s + v, 0) / deltas.length
        : Number.isFinite(globalDelta)
          ? globalDelta
          : 3
      lower = Number((row.upperTemp - delta).toFixed(1))
      estimated.push('下导温度')
      notes.push(
        deltas && deltas.length
          ? `下导温度缺项，按本轴承实测平均温差${delta.toFixed(1)}℃推算回填`
          : `下导温度缺项，按全厂平均温差${delta.toFixed(1)}℃推算回填`,
      )
    }

    let oil = row.oilLevel
    if (oil === null) {
      oil = nearestMeasured(row.bearingCode, row.inspectedAt, 'oilLevel') ?? 300
      estimated.push('油位高度')
      notes.push('油位高度缺项，按同轴承最近实测值借用回填（无实测时取正常中值300mm）')
    }

    let vibration = row.vibration
    if (vibration === null) {
      vibration = nearestMeasured(row.bearingCode, row.inspectedAt, 'vibration') ?? 0.08
      estimated.push('振动数值')
      notes.push('振动数值缺项，按同轴承最近实测值借用回填（无实测时取正常中值0.08mm）')
    }

    return {
      ...row,
      lowerTemp: lower,
      oilLevel: oil,
      vibration,
      estimated,
      backfillNote: notes.length ? notes.join('；') : null,
      policyVersion: LEGACY_VERSION,
    }
  })
}
