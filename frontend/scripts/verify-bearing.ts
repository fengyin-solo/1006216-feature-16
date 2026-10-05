/**
 * 导轴承领域逻辑验证（不依赖浏览器，esbuild 打包后 node 直接跑）。
 * 覆盖：统一判级、缺项推算、迁移保序保结论、同班次查重、并发写入去重、
 * 待办与台账同步、确认检修回落、新版界值重算且历史留版本、导出与页面同源。
 */
import { strict as assert } from 'node:assert'

import { RULE_V1, RULE_V2, evaluateBearing, imputeLowerTemp, ruleForDate } from '../src/domain/bearing/rules'
import { shiftKey, shiftOf } from '../src/domain/bearing/shift'
import {
  bearingSummary,
  confirmRepair,
  listRecords,
  listRepairTodos,
  publishRule,
  registerBearing,
  submitInspection,
  toRowCells,
} from '../src/domain/bearing/service'
import { resetBearingState, runExclusive } from '../src/domain/bearing/store'
import type { BearingRuleVersion, BearingSignalInput } from '../src/domain/bearing/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function sig(partial: Partial<BearingSignalInput>): BearingSignalInput {
  return {
    upperTemp: null,
    lowerTemp: null,
    oilLevel: null,
    vibration: null,
    inspectedAt: '2026-10-05',
    ...partial,
  }
}

console.log('1) 唯一判级实现：四通道同口、三档、统一升级')
check('四值均正常时判正常', () => {
  assert.equal(evaluateBearing(sig({ upperTemp: 50, lowerTemp: 48, oilLevel: 250, vibration: 0.05 }), RULE_V2).level, '正常')
})
check('上导 65 判偏高、70 升级待检修', () => {
  assert.equal(evaluateBearing(sig({ upperTemp: 65 }), RULE_V2).level, '温度偏高')
  assert.equal(evaluateBearing(sig({ upperTemp: 70 }), RULE_V2).level, '待检修')
})
check('下导采用偏严口径 60/65（不再与上导侧差 5℃）', () => {
  assert.equal(evaluateBearing(sig({ lowerTemp: 60 }), RULE_V2).level, '温度偏高')
  assert.equal(evaluateBearing(sig({ lowerTemp: 65 }), RULE_V2).level, '待检修')
})
check('旧页侧 v1 的 60 下导不误报、而 v2 必报——两种结论的收敛点', () => {
  assert.equal(evaluateBearing(sig({ lowerTemp: 60, inspectedAt: '2026-09-01' }), RULE_V1).level, '正常')
  assert.equal(evaluateBearing(sig({ lowerTemp: 60 }), RULE_V2).level, '温度偏高')
})
check('油位越低越差：≤200 偏高、≤150 待检修', () => {
  assert.equal(evaluateBearing(sig({ oilLevel: 200 }), RULE_V2).level, '温度偏高')
  assert.equal(evaluateBearing(sig({ oilLevel: 150 }), RULE_V2).level, '待检修')
})
check('振动 >0.10 偏高、>0.18 待检修', () => {
  assert.equal(evaluateBearing(sig({ vibration: 0.11 }), RULE_V2).level, '温度偏高')
  assert.equal(evaluateBearing(sig({ vibration: 0.19 }), RULE_V2).level, '待检修')
})
check('多通道取最差档：温度偏高 + 振动待检修 => 待检修', () => {
  assert.equal(
    evaluateBearing(sig({ upperTemp: 66, lowerTemp: 55, oilLevel: 260, vibration: 0.19 }), RULE_V2).level,
    '待检修',
  )
})
check('缺测通道不参与判级', () => {
  assert.equal(evaluateBearing(sig({ upperTemp: 55 }), RULE_V2).level, '正常')
  assert.equal(evaluateBearing(sig({ oilLevel: 140 }), RULE_V2).level, '待检修')
})
check('升级理由明细同时产出（页面/导出共用）', () => {
  const result = evaluateBearing(sig({ lowerTemp: 65 }), RULE_V2)
  assert.ok(result.reasons.some((line) => line.includes('下导温度') && line.includes('判待检修')))
})

console.log('2) 早年缺下导温度的补齐办法（唯一一份）')
check('下导 = 上导 − 5，保留一位小数', () => {
  assert.equal(imputeLowerTemp(68), 63)
  assert.equal(imputeLowerTemp(68.4), 63.4)
})
check('无上导则不臆造，返回 null', () => {
  assert.equal(imputeLowerTemp(null), null)
})
check('提交检测时下导留空自动按上导−5 推算并标注', () => {
  resetBearingState()
  const result = submitInspection({
    id: 1,
    date: '2026-10-06',
    time: '10:00',
    operator: '测试员',
    upperTemp: 67,
    oilLevel: 250,
    vibration: 0.06,
  })
  assert.equal(result.ok, true)
  const record = listRecords().find((row) => row.id === 1)!
  assert.equal(record.signals.lowerTemp, 62)
  assert.equal(record.signals.lowerTempImputed, true)
})

console.log('3) 规则版本按业务时间选择')
check('2026-09 走 v1，2026-10-05 起走 v2', () => {
  assert.equal(ruleForDate('2026-09-30').version, 'v1')
  assert.equal(ruleForDate('2026-10-05').version, 'v2')
})
check('夜班跨零点归属开工日', () => {
  assert.equal(shiftOf('2026-10-05', '02:00'), '夜班')
  assert.equal(shiftKey('2026-10-05', '02:00'), shiftKey('2026-10-04', '23:00'))
  assert.notEqual(shiftKey('2026-10-05', '09:00'), shiftKey('2026-10-04', '23:00'))
})

console.log('4) 存量迁移：保编号、保结论、保顺序、按业务时间回填')
check('种子 6 条，编号 1..6 顺序不重排', () => {
  resetBearingState()
  const records = listRecords()
  assert.deepEqual(records.map((row) => row.id), [1, 2, 3, 4, 5, 6])
})
check('既有结论全部保留，历史版本记 v1', () => {
  const records = listRecords()
  assert.equal(records[0].status, '正常')
  assert.equal(records[1].status, '温度偏高')
  assert.equal(records[2].status, '待检修')
  assert.equal(records[4].status, '已检修')
  assert.ok(records.every((row) => row.ruleVersion === 'v1'))
})
check('早年缺下导（id=4，2025-06-18）按上导−5 补齐且标注', () => {
  const old = listRecords().find((row) => row.id === 4)!
  assert.equal(old.signals.upperTemp, 72)
  assert.equal(old.signals.lowerTemp, 67)
  assert.equal(old.signals.lowerTempImputed, true)
  assert.equal(old.signals.oilLevel, null)
  assert.equal(old.signals.vibration, null)
  assert.ok(old.remarks.some((note) => note.includes('上导−5℃')))
})
check('迁移把已存在的待检修（id=3）带入班组待办', () => {
  const todos = listRepairTodos()
  assert.ok(todos.some((item) => item.id === 3))
})
check('真实老台账迁移：保编号、按业务时间排序回填、缺项按条补齐、不被新版重排', () => {
  const { migrateLegacyRows } = require('../src/domain/bearing/store') as typeof import('../src/domain/bearing/store')
  const legacy = [
    { id: 9, status: '待检修', 轴承编号: 'BEAR-0009', 所属机组: '2号机组', 上导温度: '76.1', 下导温度: '71.0', 检测日期: '2026-09-09' },
    { id: 7, status: '正常', 轴承编号: 'BEAR-0007', 所属机组: '1号机组', 上导温度: '58', 检测日期: '2024-03-12' }, // 仅上导
    { id: 8, status: '温度偏高', 轴承编号: 'BEAR-0008', 所属机组: '1号机组', 上导温度: '71', 下导温度: '66', 油位高度: '205', 振动数值: '0.08', 检测日期: '2025-11-02' },
  ]
  const moved = migrateLegacyRows(legacy)
  assert.deepEqual(moved.map((row) => row.id), [7, 8, 9]) // 按编号输出，不重排
  // 内部按业务时间回填过：最早一条拿到下导推算
  const oldest = moved.find((row) => row.id === 7)!
  assert.equal(oldest.signals.lowerTemp, 53) // 58 − 5
  assert.equal(oldest.signals.lowerTempImputed, true)
  assert.equal(oldest.signals.oilLevel, null)
  assert.equal(oldest.status, '正常') // 既有结论保留
  const waiting = moved.find((row) => row.id === 9)!
  assert.equal(waiting.repairTodo.open, true)
  assert.ok(moved.every((row) => row.ruleVersion === 'v1'))
})

console.log('5) 同一轴承同一班次重复提交只算第一次')
check('同班第二次提交被退回且结论不变，履历留重复痕', () => {
  resetBearingState()
  const first = submitInspection({ id: 2, date: '2026-10-06', time: '09:00', operator: '甲', upperTemp: 66, lowerTemp: 62, oilLevel: 250, vibration: 0.06 })
  assert.equal(first.ok, true)
  const before = listRecords().find((row) => row.id === 2)!.history.length
  const again = submitInspection({ id: 2, date: '2026-10-06', time: '11:30', operator: '乙', upperTemp: 90, lowerTemp: 88, oilLevel: 100, vibration: 0.5 })
  assert.equal(again.ok, false)
  assert.equal(again.duplicate, true)
  const record = listRecords().find((row) => row.id === 2)!
  assert.equal(record.history.length, before + 1)
  assert.equal(record.history.at(-1)!.rejectedAsDuplicate, true)
  // 后到的高数值没有覆盖第一次的判定
  assert.equal(record.signals.upperTemp, 66)
})
check('跨班次（白班 vs 夜班）允许再提交', () => {
  const night = submitInspection({ id: 2, date: '2026-10-06', time: '21:00', operator: '丙', upperTemp: 55, lowerTemp: 52, oilLevel: 260, vibration: 0.05 })
  assert.equal(night.ok, true)
})

console.log('6) 判待检修驱动班组待办；确认检修两处同步回落')
check('新判待检修自动进待办，两个入口条数一致', () => {
  resetBearingState()
  const result = submitInspection({ id: 1, date: '2026-10-06', time: '10:00', operator: '甲', upperTemp: 72, lowerTemp: 62, oilLevel: 260, vibration: 0.05 })
  assert.equal(result.ok, true)
  const summary = bearingSummary()
  assert.equal(summary.pendingRepair, listRepairTodos().length)
  assert.ok(listRepairTodos().some((item) => item.id === 1))
})
check('确认检修后状态、待检修台数、待办条数同步回落', () => {
  resetBearingState()
  submitInspection({ id: 1, date: '2026-10-06', time: '10:00', operator: '甲', upperTemp: 72, lowerTemp: 62, oilLevel: 260, vibration: 0.05 })
  const before = bearingSummary()
  assert.ok(before.pendingRepair >= 1)
  const done = confirmRepair(1)
  assert.equal(done.ok, true)
  const after = bearingSummary()
  assert.equal(after.pendingRepair, before.pendingRepair - 1)
  assert.equal(after.repairTodoCount, listRepairTodos().length)
  assert.equal(after.pendingRepair, listRepairTodos().length)
  const record = listRecords().find((row) => row.id === 1)!
  assert.equal(record.status, '已检修')
  assert.equal(record.repairTodo.open, false)
})

console.log('7) 界值调整：按新版重算，历史结论保留等级并注明版本')
check('发布 v3（放宽下导到 62/67）后，v2 下判待检修的记录重算回落', () => {
  resetBearingState()
  // 下导 65 在 v2 是待检修
  const make = submitInspection({ id: 1, date: '2026-10-06', time: '09:00', operator: '甲', upperTemp: 50, lowerTemp: 65, oilLevel: 260, vibration: 0.05 })
  assert.equal(make.ok, true)
  assert.equal(listRecords().find((row) => row.id === 1)!.status, '待检修')
  const v3: BearingRuleVersion = {
    version: 'v3',
    effectiveFrom: '2026-10-07',
    effectiveTo: null,
    note: '试验放宽',
    thresholds: {
      上导温度: { warn: 70, alarm: 75, compare: 'gte', unit: '℃' },
      下导温度: { warn: 62, alarm: 67, compare: 'gte', unit: '℃' },
      油位高度: { warn: 180, alarm: 130, compare: 'lte', unit: 'mm' },
      振动数值: { warn: 0.15, alarm: 0.25, compare: 'gte', unit: 'mm' },
    },
  }
  const published = publishRule(v3)
  assert.equal(published.ok, true)
  const record = listRecords().find((row) => row.id === 1)!
  assert.equal(record.status, '温度偏高') // 65 落在 62~67 之间
  // 待办因重算不再达待检修而撤下
  assert.equal(listRepairTodos().some((item) => item.id === 1), false)
  // 历史结论保留当时等级，挂重算注明
  const original = record.history.find((entry) => entry.ruleVersion === 'v2' && !entry.rejectedAsDuplicate)!
  assert.equal(original.level, '待检修')
  assert.equal(original.recomputed?.ruleVersion, 'v3')
  assert.equal(original.recomputed?.level, '温度偏高')
})
check('已检修记录不因重算回退状态', () => {
  resetBearingState()
  // id=5 是已检修
  const v3: BearingRuleVersion = {
    version: 'v3x',
    effectiveFrom: '2026-10-07',
    effectiveTo: null,
    note: '试验收紧',
    thresholds: {
      上导温度: { warn: 50, alarm: 55, compare: 'gte', unit: '℃' },
      下导温度: { warn: 45, alarm: 50, compare: 'gte', unit: '℃' },
      油位高度: { warn: 300, alarm: 280, compare: 'lte', unit: 'mm' },
      振动数值: { warn: 0.01, alarm: 0.02, compare: 'gte', unit: 'mm' },
    },
  }
  publishRule(v3)
  assert.equal(listRecords().find((row) => row.id === 5)!.status, '已检修')
})
check('规则版本号不可重复发布', () => {
  resetBearingState()
  const dup = publishRule({ ...RULE_V2, effectiveFrom: '2026-10-08', note: 'x' })
  assert.equal(dup.ok, false)
})

console.log('8) 并发写入：同一时刻只保留一笔')
check('同键同步重入直接判重（双击/竞态）', () => {
  resetBearingState()
  let nested: unknown
  const a = runExclusive('k', () => {
    nested = runExclusive('k', () => 'second') // 同一时刻重入（双击/竞态的等价形态）
    return 'first'
  })
  assert.equal(a, 'first')
  assert.deepEqual(nested, { duplicate: true })
})
check('业务幂等：同一轴承同一时刻的两次提交只有第一笔落账', () => {
  resetBearingState()
  const first = submitInspection({ id: 1, date: '2026-10-06', time: '10:00', operator: '甲', upperTemp: 72, lowerTemp: 62, oilLevel: 260, vibration: 0.05 })
  const second = submitInspection({ id: 1, date: '2026-10-06', time: '10:00', operator: '乙', upperTemp: 40, lowerTemp: 38, oilLevel: 260, vibration: 0.05 })
  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  assert.equal(second.duplicate, true)
  // 后到的低值没有冲掉第一笔的待检修结论
  assert.equal(listRecords().find((row) => row.id === 1)!.status, '待检修')
})

console.log('9) 登记新轴承与同号并发去重')
check('登记后可检测；重复编号退回', () => {
  resetBearingState()
  const created = registerBearing({ bearingNo: 'BEAR-0007', unitNo: '9号机组', operator: '甲', date: '2026-10-06', time: '09:00', upperTemp: 71, lowerTemp: 66, oilLevel: 200, vibration: 0.05 })
  assert.equal(created.ok, true)
  assert.ok(listRecords().some((row) => row.bearingNo === 'BEAR-0007' && row.status === '待检修'))
  const dup = registerBearing({ bearingNo: 'BEAR-0007', unitNo: '9号机组', operator: '乙', date: '2026-10-06', upperTemp: 40 })
  assert.equal(dup.ok, false)
})

console.log('10) 另存（导出）与页面/动作同源')
check('导出单元格的等级与 evaluateBearing 当前实现一致', () => {
  resetBearingState()
  submitInspection({ id: 1, date: '2026-10-06', time: '09:00', operator: '甲', upperTemp: 50, lowerTemp: 61, oilLevel: 260, vibration: 0.05 })
  const record = listRecords().find((row) => row.id === 1)!
  const cells = toRowCells(record)
  assert.equal(cells['判定等级'], '温度偏高')
  assert.equal(cells['规则版本'], 'v2')
  assert.ok(cells['下导温度'].startsWith('61'))
})

console.log(`\n全部通过：${passed} 项检查`)
