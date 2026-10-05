/**
 * 导轴承判级的唯一实现。
 *
 * 背景：上导/下导温度的判定原先散在页面、动作、另存（导出）三处，各写一遍，
 * 页面侧上导按 65℃、动作/另存侧按 60℃ 之外还把“升级界值”各抬了 5℃，
 * 大负荷时同一台机组会得出两种结论。本文件把以下事情收拢成一份：
 *
 *   1. 上导温度、下导温度、油位高度、振动数值在同一个环节（evaluateBearing）处理；
 *   2. 正常 / 温度偏高 / 待检修 三档界值与升级办法写成“规则版本”，全平台共用；
 *   3. 早年缺下导温度的补数办法（imputeLowerTemp）也只在这里定义一次。
 *
 * 任何页面、动作、导出、重算都必须调用本文件，不允许再抄一份阈值。
 */
import type {
  BearingGrade,
  BearingRecord,
  BearingRuleVersion,
  BearingSignalInput,
  ChannelThreshold,
  ChannelVerdict,
  Evaluation,
  SignalChannel,
} from './types'

/**
 * 早年只记了上导温度、没有下导温度时的补齐办法。
 *
 * 依据：本厂导轴承历史台账中，同一班次上下导轴瓦温度差稳定在 4～6℃，
 * 取下导承载更重、温漂更大的经验中值 5℃，按「下导 = 上导 − 5」推算。
 * 推算只用于让缺项记录能进入同一套判级，页面与导出都标注“推算（上导−5℃）”，
 * 不把它当实测值；拿不到上导温度则返回 null（缺测），绝不臆造。
 */
export const LOWER_TEMP_DELTA = 5

export function imputeLowerTemp(upperTemp: number | null): number | null {
  if (upperTemp === null || Number.isNaN(upperTemp)) {
    return null
  }
  return Math.round((upperTemp - LOWER_TEMP_DELTA) * 10) / 10
}

/**
 * 历史版本 v1 —— 迁移前页面侧实际使用的口径。
 * 当时只看温度，且升级界值比动作/另存侧高 5℃（上导升级 75、下导升级 70），
 * 大负荷时页侧还显示“偏高”、另存侧已判“待检修”，是两套结论的来源。
 * 保留 v1 仅用于回放迁移前的历史判定，不再用于新检测。
 */
export const RULE_V1: BearingRuleVersion = {
  version: 'v1',
  effectiveFrom: '2000-01-01',
  effectiveTo: '2026-10-04',
  note: '旧页端口径：仅按上导/下导温度判级，升级界值偏高 5℃，历史结论按此版本保留。',
  thresholds: {
    上导温度: { warn: 70, alarm: 75, compare: 'gte', unit: '℃' },
    下导温度: { warn: 65, alarm: 70, compare: 'gte', unit: '℃' },
    // v1 时代油位、振动没有纳入判级：enabled=false 的通道不触发任何等级。
    油位高度: { warn: 0, alarm: 0, compare: 'lte', unit: 'mm', enabled: false },
    振动数值: { warn: 0, alarm: 0, compare: 'gte', unit: 'mm', enabled: false },
  },
}

/**
 * 统一版本 v2 —— 收拢后的唯一在用口径。
 *
 * 界值依据（两边取值冲突时的取舍）：
 *  - 上导温度 65/70：取现场长期沿用的告警值 65℃，升级 70℃；
 *  - 下导温度 60/65：下导轴瓦更靠近转轮、承载与润滑条件都更恶劣，
 *    动作/另存侧的 60/65 比页侧的 65/70 更早暴露问题。
 *    两侧冲突时采用偏严的下导侧 60/65 —— 漏报轴瓦烧损的代价远大于一次提前检修，
 *    同时彻底消掉两边相差的 5℃；
 *  - 油位高度（油位计刻度 mm）：≤200 偏低（温度偏高档）、≤150 严重缺油（待检修档）；
 *  - 振动数值（导轴承处摆度 mm）：>0.10 偏高、>0.18 待检修，取机组振动防护常用档位。
 *
 * 升级办法：四个通道同口判定，取最差通道等级（任一通道到待检修即待检修），
 * 不再为温度单列一条升级路径。
 */
export const RULE_V2: BearingRuleVersion = {
  version: 'v2',
  effectiveFrom: '2026-10-05',
  effectiveTo: null,
  note: '统一版：上导65/70、下导60/65（取偏严口径，消除两侧5℃差），并入油位与振动，四通道取最差档。',
  thresholds: {
    上导温度: { warn: 65, alarm: 70, compare: 'gte', unit: '℃' },
    下导温度: { warn: 60, alarm: 65, compare: 'gte', unit: '℃' },
    油位高度: { warn: 200, alarm: 150, compare: 'lte', unit: 'mm' },
    振动数值: { warn: 0.1, alarm: 0.18, compare: 'gte', unit: 'mm' },
  },
}

/** 规则版本清单：按生效时间排序。新增版本只能往后追加，历史版本不可改。 */
export const RULE_VERSIONS: BearingRuleVersion[] = [RULE_V1, RULE_V2]

export const CURRENT_RULE_VERSION = RULE_V2.version

/** 按业务时间挑当时生效的规则版本；早于任何版本时用最早一版。 */
export function ruleForDate(date: string, versions: BearingRuleVersion[] = RULE_VERSIONS): BearingRuleVersion {
  const ordered = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  let picked = ordered[0]
  for (const rule of ordered) {
    if (date >= rule.effectiveFrom) {
      picked = rule
    }
  }
  return picked
}

export function ruleByVersion(version: string, versions: BearingRuleVersion[] = RULE_VERSIONS): BearingRuleVersion {
  const found = versions.find((item) => item.version === version)
  if (!found) {
    throw new Error(`没有找到规则版本 ${version}`)
  }
  return found
}

/** 单通道判级：缺测或旧版本未纳入的通道不参与；达到 alarm 待检修，达到 warn 偏高，否则正常。 */
function judgeChannel(
  channel: SignalChannel,
  value: number | null,
  imputed: boolean,
  threshold: ChannelThreshold,
): ChannelVerdict {
  if (threshold.enabled === false) {
    return { channel, value: value ?? null, missing: value === null, imputed: false, level: '正常' }
  }
  if (value === null || Number.isNaN(value)) {
    return { channel, value: null, missing: true, imputed: false, level: '正常' }
  }
  const hit = (bound: number) => (threshold.compare === 'gte' ? value >= bound : value <= bound)
  let level: BearingGrade = '正常'
  if (hit(threshold.alarm)) {
    level = '待检修'
  } else if (hit(threshold.warn)) {
    level = '温度偏高'
  }
  return { channel, value, missing: false, imputed, level }
}

const ORDER: SignalChannel[] = ['上导温度', '下导温度', '油位高度', '振动数值']

/**
 * 唯一判级入口：页面、动作、另存（导出）、重算全部调用这里。
 * 四个监测值同口进参，一次输出三档结论与每个通道的明细。
 */
export function evaluateBearing(signals: BearingSignalInput, rule: BearingRuleVersion = RULE_V2): Evaluation {
  const channels = {
    上导温度: judgeChannel('上导温度', signals.upperTemp, false, rule.thresholds.上导温度),
    下导温度: judgeChannel('下导温度', signals.lowerTemp, Boolean(signals.lowerTempImputed), rule.thresholds.下导温度),
    油位高度: judgeChannel('油位高度', signals.oilLevel, false, rule.thresholds.油位高度),
    振动数值: judgeChannel('振动数值', signals.vibration, false, rule.thresholds.振动数值),
  } as Record<SignalChannel, ChannelVerdict>

  let level: BearingGrade = '正常'
  for (const channel of ORDER) {
    const verdict = channels[channel]
    if (verdict.level === '待检修') {
      level = '待检修'
      break
    }
    if (verdict.level === '温度偏高') {
      level = '温度偏高'
    }
  }

  const reasons = ORDER.flatMap((channel) => {
    const verdict = channels[channel]
    if (verdict.missing || verdict.level === '正常' || verdict.value === null) {
      return []
    }
    const bound = verdict.level === '待检修'
      ? rule.thresholds[channel].alarm
      : rule.thresholds[channel].warn
    const relation = rule.thresholds[channel].compare === 'gte' ? '≥' : '≤'
    const tag = verdict.imputed ? '（推算：上导−5℃）' : ''
    return [`${channel} ${verdict.value}${rule.thresholds[channel].unit}${tag}，${relation}${bound}${rule.thresholds[channel].unit} 判${verdict.level}`]
  })

  return { level, reasons, channels }
}

/** 按一条记录的检测业务时间回放当时规则下的结论（历史等级用，不改数据）。 */
export function evaluateAtBusinessTime(
  signals: BearingSignalInput,
  versions: BearingRuleVersion[] = RULE_VERSIONS,
): Evaluation {
  return evaluateBearing(signals, ruleForDate(signals.inspectedAt, versions))
}

/** 用指定（最新）版本重算一条既有记录的当前等级；历史履历不在此处改写。 */
export function recomputeWith(
  record: BearingRecord,
  rule: BearingRuleVersion,
): Evaluation {
  return evaluateBearing(record.signals, rule)
}
