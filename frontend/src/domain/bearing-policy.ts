/**
 * 导轴承判级：全站唯一的一份实现。
 *
 * 以前上导/下导温度的界值散在页面、动作、另存（导出）三处，各写各的，
 * 上导按 65、下导按 60，两边升级界值差 5 度，同一台机组大负荷时会得到两种结论。
 * 现在上导温度、下导温度、油位高度、振动数值四个量都在本文件同一个环节判级，
 * 页面展示、动作提交、导出另存都只能调用这里的函数，不允许再各写一遍。
 *
 * 界值依据（写清来历，后续改界值只改这里并发新版本）：
 * - 温度：参考《水轮发电机组运行规程》通行做法，轴承瓦温报警取 60℃、事故（停机检修）
 *   取 65℃。上导、下导统一用同一套，消掉历史上“上导 65 / 下导 60”的 5 度差——
 *   高负荷时上导瓦温系统性高于下导，按旧写法同一台机会同时得到两种结论。
 * - 油位：油标正常区间取 200～400mm；偏离区间一档记“偏高/温度偏高”档，
 *   偏离超过区间宽度 10% 记“待检修”档（油位异常会直接恶化瓦温，不能只做提示）。
 * - 振动：参考 GB/T 11348.5（水力发电厂机组轴振动），轴相对振动 0.10mm 起警戒、
 *   0.15mm 起不允许长期运行，据此取 0.10 / 0.15 两档。
 * - 升级：任一量到“待检修”档直接待检修；没有硬超限时，同一轴承连续两次检测都在
 *   “温度偏高”档（任一量警戒即算），第二次自动升级为待检修，确认检修后计数清零。
 */

/** 三档结论。页面、动作、待办清单、导出都只认这三个名字，已检修是流程态不在此列。 */
export const GRADES = ['正常', '温度偏高', '待检修'] as const
export type Grade = (typeof GRADES)[number]

/** 单个监测量的分档：0 正常 / 1 警戒（温度偏高） / 2 达到检修条件。 */
export type IndicatorLevel = 0 | 1 | 2

export type BearingReadings = {
  /** 上导轴瓦温度，℃；缺项给 null，缺项不参与判级（早年台账可能没有该量）。 */
  upperTemp: number | null
  /** 下导轴瓦温度，℃。 */
  lowerTemp: number | null
  /** 油位高度，mm。 */
  oilLevel: number | null
  /** 主轴振动数值（轴相对振动峰峰值），mm。 */
  vibration: number | null
}

export type IndicatorName = '上导温度' | '下导温度' | '油位高度' | '振动数值'

/**
 * 一版界值。版本号一旦发布就不可原地改值：调整界值必须新发一版，
 * 已处理过的轴承按新版重算，历史结论保留当时等级并注明版本。
 */
export type BearingPolicy = {
  version: string
  /** 温度报警（温度偏高）阈值，℃；上导、下导共用。 */
  tempWarn: number
  /** 温度事故（待检修）阈值，℃；上导、下导共用。 */
  tempTrip: number
  /** 油位正常区间，mm。 */
  oilLow: number
  oilHigh: number
  /** 油位越过正常区间多少（mm）算待检修；区间内正常，越界一档警戒。 */
  oilTripMargin: number
  /** 振动警戒 / 待检修阈值，mm。 */
  vibrationWarn: number
  vibrationTrip: number
}

/** 当前生效的一版界值。 */
export const CURRENT_POLICY_VERSION = 'v1-2026'

export const CURRENT_POLICY: BearingPolicy = {
  version: CURRENT_POLICY_VERSION,
  tempWarn: 60,
  tempTrip: 65,
  oilLow: 200,
  oilHigh: 400,
  oilTripMargin: 20,
  vibrationWarn: 0.1,
  vibrationTrip: 0.15,
}

/**
 * 老台账使用的旧界值：只用于给历史结论标版本，绝不能用来判当前数据。
 * 这正是本次收拢要消掉的写法——上导 65、下导 60，升级界值差着 5 度。
 */
export const LEGACY_POLICY: BearingPolicy = {
  version: 'legacy-pre2026',
  tempWarn: 60,
  tempTrip: 65,
  oilLow: 200,
  oilHigh: 400,
  oilTripMargin: 20,
  vibrationWarn: 0.1,
  vibrationTrip: 0.15,
}
export const LEGACY_VERSION = LEGACY_POLICY.version

/** 旧版上导 65 / 下导 60 的分歧写法，仅在迁移回填历史结论时使用。 */
export const LEGACY_UPPER_TRIP = 65
export const LEGACY_LOWER_TRIP = 60

export type IndicatorResult = {
  name: IndicatorName
  value: number | null
  level: IndicatorLevel
  /** 触发分档的人话说明，正常或缺项时为 null。页面和导出都直接展示它。 */
  reason: string | null
}

function classifyTemp(name: IndicatorName, value: number | null, policy: BearingPolicy): IndicatorResult {
  if (value === null) {
    return { name, value, level: 0, reason: null }
  }
  if (value >= policy.tempTrip) {
    return { name, value, level: 2, reason: `${name}${value}℃≥事故值${policy.tempTrip}℃` }
  }
  if (value >= policy.tempWarn) {
    return { name, value, level: 1, reason: `${name}${value}℃≥报警值${policy.tempWarn}℃` }
  }
  return { name, value, level: 0, reason: null }
}

function classifyOil(value: number | null, policy: BearingPolicy): IndicatorResult {
  if (value === null) {
    return { name: '油位高度', value, level: 0, reason: null }
  }
  if (value < policy.oilLow) {
    const level: IndicatorLevel = value < policy.oilLow - policy.oilTripMargin ? 2 : 1
    return {
      name: '油位高度',
      value,
      level,
      reason: level === 2
        ? `油位${value}mm低于下限${policy.oilLow}mm且超过${policy.oilTripMargin}mm`
        : `油位${value}mm低于正常下限${policy.oilLow}mm`,
    }
  }
  if (value > policy.oilHigh) {
    const level: IndicatorLevel = value > policy.oilHigh + policy.oilTripMargin ? 2 : 1
    return {
      name: '油位高度',
      value,
      level,
      reason: level === 2
        ? `油位${value}mm高于上限${policy.oilHigh}mm且超过${policy.oilTripMargin}mm`
        : `油位${value}mm高于正常上限${policy.oilHigh}mm`,
    }
  }
  return { name: '油位高度', value, level: 0, reason: null }
}

function classifyVibration(value: number | null, policy: BearingPolicy): IndicatorResult {
  if (value === null) {
    return { name: '振动数值', value, level: 0, reason: null }
  }
  if (value >= policy.vibrationTrip) {
    return { name: '振动数值', value, level: 2, reason: `振动${value}mm≥检修值${policy.vibrationTrip}mm` }
  }
  if (value >= policy.vibrationWarn) {
    return { name: '振动数值', value, level: 1, reason: `振动${value}mm≥警戒值${policy.vibrationWarn}mm` }
  }
  return { name: '振动数值', value, level: 0, reason: null }
}

export type Evaluation = {
  grade: Grade
  /** 四个量各自的分档与依据，页面提示、导出、重复冲突说明都取这里。 */
  indicators: IndicatorResult[]
  /** 导致最终结论的分档依据列表（正常时为空）。 */
  reasons: string[]
}

/**
 * 单次检测的原始分档（不含连续偏高升级）。
 * 这是“同一环节处理”的入口：上导、下导、油位、振动都在这里，一次出齐。
 */
export function evaluateReadings(readings: BearingReadings, policy: BearingPolicy = CURRENT_POLICY): Evaluation {
  const indicators = [
    classifyTemp('上导温度', readings.upperTemp, policy),
    classifyTemp('下导温度', readings.lowerTemp, policy),
    classifyOil(readings.oilLevel, policy),
    classifyVibration(readings.vibration, policy),
  ]
  const worst = indicators.reduce<IndicatorLevel>((max, item) => (item.level > max ? item.level : max), 0)
  const grade: Grade = worst === 2 ? '待检修' : worst === 1 ? '温度偏高' : '正常'
  return { grade, indicators, reasons: indicators.filter((item) => item.reason).map((item) => item.reason as string) }
}

/**
 * 判定一条检测记录时调用的统一入口：原始分档 + 连续偏高升级。
 * 页面判显、提交检测动作、界值调整后的重算，全部走这里。
 *
 * @param reading 本次检测四个量
 * @param history 同一轴承在本次之前、按检测日期排好序的检测结论序列
 *                （只看“上一版以后”的记录；legacy 结论不参与连高计数）
 * @returns 最终结论与升级说明
 */
export type HistoryEntry = { grade: Grade; estimated?: boolean }

export function judgeInspection(
  reading: BearingReadings,
  history: HistoryEntry[] = [],
  policy: BearingPolicy = CURRENT_POLICY,
): Evaluation & { escalated: boolean } {
  const base = evaluateReadings(reading, policy)
  if (base.grade === '温度偏高') {
    // 紧邻的上一次“温度为实测”的结论必须也是温度偏高才升级：
    // 中间隔了一次正常（实测）即打断连续性；早年温度缺项推算的记录整体跳过不打断。
    let index = history.length - 1
    while (index >= 0 && history[index].estimated) {
      index -= 1
    }
    const prevMeasured = index >= 0 ? history[index] : undefined
    if (prevMeasured && prevMeasured.grade === '温度偏高') {
      return {
        ...base,
        grade: '待检修',
        escalated: true,
        reasons: [...base.reasons, '同一轴承连续两次检测温度偏高，按升级办法升为待检修'],
      }
    }
  }
  return { ...base, escalated: false }
}

export type ChainReading = {
  readings: BearingReadings
  inspectedAt: string
  /**
   * 该记录能否作为“连续温度偏高升级”的前次依据。
   * 只有温度本身是实测才算：早年缺项回填里油位/振动可能是借用值，
   * 但只要上导/下导温度是实测，温度结论就有效，不能整条记录被剔出升级链。
   */
  tempsMeasured?: boolean
}

/**
 * 界值调整后按新版重算一整条检测链。
 * 逐条回放（连续偏高升级依赖前一次结论），返回每次记录在新版下的结论。
 * 注意：调用方只把它写进“当前重算结论”，历史快照（grade + policyVersion）永不覆盖。
 *
 * @param repairedAt 确认检修时刻：检修后的检测重新起算连高计数，检修前的偏高不再带过来。
 */
export function recomputeChain(
  readings: ChainReading[],
  policy: BearingPolicy,
  repairedAt?: string | null,
): (Evaluation & { escalated: boolean })[] {
  let history: HistoryEntry[] = []
  return readings.map((item) => {
    // 跨过确认检修时刻，连高链断开。
    if (repairedAt && item.inspectedAt >= repairedAt) {
      history = []
      repairedAt = null
    }
    const result = judgeInspection(item.readings, history, policy)
    // 升级结论来自“连续两次实测温度偏高”，视为实测温度结论；
    // 否则按温度是否实测决定该结论能否做后一条记录的升级依据。
    const tempsMeasured = result.escalated || item.tempsMeasured !== false
    history.push({ grade: result.grade, estimated: !tempsMeasured })
    return result
  })
}

/**
 * 按旧版“上导 65 / 下导 60”的分歧升级界值复算老结论，仅迁移对照与测试用。
 * 这就是本次收拢消掉的两套界值：下导 60 即升级，上导要到 65。
 * （旧版没有留下统一的报警档规则，这里只复算升级档，警戒档以统一界值兜底。）
 */
export function evaluateWithLegacyThresholds(readings: BearingReadings): Grade {
  const upper = readings.upperTemp
  const lower = readings.lowerTemp
  const tempTripped =
    (upper !== null && upper >= LEGACY_UPPER_TRIP) || (lower !== null && lower >= LEGACY_LOWER_TRIP)
  const other = evaluateReadings(readings, LEGACY_POLICY).indicators.filter(
    (item) => item.name === '油位高度' || item.name === '振动数值',
  )
  if (tempTripped || other.some((item) => item.level === 2)) {
    return '待检修'
  }
  const base = evaluateReadings(readings, LEGACY_POLICY)
  return base.grade === '正常' ? '正常' : '温度偏高'
}
