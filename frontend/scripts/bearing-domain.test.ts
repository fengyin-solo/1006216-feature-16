/**
 * 导轴承收拢后的行为验证。用 vite 自带的 esbuild 打成一个 cjs 包再用 node 跑，
 * 不引入额外测试框架：每条用例失败即退出码非零。
 */
import assert from 'node:assert/strict'

import {
  bearingStorageKey,
  bearingSummary,
  confirmRepair,
  exportBearingLedger,
  getState,
  listBearingViews,
  listInspections,
  listRepairTodos,
  listRejected,
  migrateLegacyLedger,
  previewGrade,
  publishPolicyRevision,
  resetBearingState,
  submitInspection,
} from '../src/api/bearing-service'
import { CURRENT_POLICY, evaluateReadings, evaluateWithLegacyThresholds, judgeInspection } from '../src/domain/bearing-policy'
import { backfillLegacyRows } from '../src/domain/legacy-bearings'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('1) 判级唯一实现：上导/下导统一界值，四量同环节，三档与升级')
check('上导 60 报警、65 检修；下导同样 60/65（消掉旧版上导65/下导60的5度差）', () => {
  assert.equal(evaluateReadings({ upperTemp: 60, lowerTemp: 50, oilLevel: 300, vibration: 0.05 }).grade, '温度偏高')
  assert.equal(evaluateReadings({ upperTemp: 65, lowerTemp: 50, oilLevel: 300, vibration: 0.05 }).grade, '待检修')
  assert.equal(evaluateReadings({ upperTemp: 50, lowerTemp: 60, oilLevel: 300, vibration: 0.05 }).grade, '温度偏高')
  assert.equal(evaluateReadings({ upperTemp: 50, lowerTemp: 65, oilLevel: 300, vibration: 0.05 }).grade, '待检修')
})
check('油位越界一档偏高，越界超过20mm待检修；振动0.10/0.15两档', () => {
  assert.equal(evaluateReadings({ upperTemp: 50, lowerTemp: 50, oilLevel: 190, vibration: 0.05 }).grade, '温度偏高')
  assert.equal(evaluateReadings({ upperTemp: 50, lowerTemp: 50, oilLevel: 175, vibration: 0.05 }).grade, '待检修')
  assert.equal(evaluateReadings({ upperTemp: 50, lowerTemp: 50, oilLevel: 300, vibration: 0.12 }).grade, '温度偏高')
  assert.equal(evaluateReadings({ upperTemp: 50, lowerTemp: 50, oilLevel: 300, vibration: 0.15 }).grade, '待检修')
})
check('任一量达检修档即待检修；缺项不参与判级', () => {
  assert.equal(evaluateReadings({ upperTemp: null, lowerTemp: null, oilLevel: null, vibration: null }).grade, '正常')
  assert.equal(evaluateReadings({ upperTemp: 50, lowerTemp: 50, oilLevel: 300, vibration: 0.16 }).grade, '待检修')
})
check('同一轴承连续两次实测偏高，第二次自动升级为待检修', () => {
  const readings = { upperTemp: 61, lowerTemp: 55, oilLevel: 300, vibration: 0.05 }
  const first = judgeInspection(readings, [], CURRENT_POLICY)
  assert.equal(first.grade, '温度偏高')
  const second = judgeInspection(readings, [{ grade: '温度偏高' }], CURRENT_POLICY)
  assert.equal(second.grade, '待检修')
  assert.equal(second.escalated, true)
})
check('前次偏高来自推算回填时不升级', () => {
  const readings = { upperTemp: 61, lowerTemp: 55, oilLevel: 300, vibration: 0.05 }
  const result = judgeInspection(readings, [{ grade: '温度偏高', estimated: true }], CURRENT_POLICY)
  assert.equal(result.grade, '温度偏高')
})
check('旧版分歧写法留证：下导60旧界值即待检修，上导要65；统一界值两者同为60报警/65检修', () => {
  assert.equal(evaluateWithLegacyThresholds({ upperTemp: 62, lowerTemp: 60, oilLevel: 300, vibration: 0.05 }), '待检修')
  assert.equal(evaluateWithLegacyThresholds({ upperTemp: 62, lowerTemp: 58, oilLevel: 300, vibration: 0.05 }), '温度偏高')
  // 同一组取值在统一界值下不再因下导 60 直接升级
  assert.equal(evaluateReadings({ upperTemp: 62, lowerTemp: 60, oilLevel: 300, vibration: 0.05 }).grade, '温度偏高')
})

console.log('2) 老台账迁移：编号/结论保留、业务日期回填、缺下导温度按温差法补')
const migrated = migrateLegacyLedger('2026-10-05T08:00:00.000Z')
check('原编号 1/2/3 保留且不重排（新记录从 seq 之后取号）', () => {
  const ids = migrated.inspections.map((row) => row.id).sort((a, b) => a - b)
  assert.deepEqual(ids.slice(0, 3), [1, 2, 3])
})
check('既有结论与 legacy 版本保留（历史快照）', () => {
  const byId = new Map(migrated.inspections.map((row) => [row.id, row]))
  assert.equal(byId.get(1)?.grade, '正常')
  assert.equal(byId.get(1)?.policyVersion, 'legacy-pre2026')
  assert.equal(byId.get(2)?.grade, '温度偏高')
  assert.equal(byId.get(3)?.grade, '待检修')
  assert.equal(byId.get(8)?.grade, '待检修') // 旧版下导60判待检修的冲突现场
})
check('缺下导温度按本轴承实测温差回填并标推算', () => {
  const backfilled = backfillLegacyRows()
  const r4 = backfilled.find((row) => row.id === 4)
  // BEAR-0001 成对记录温差 2℃（54-52、55-53），52-2=50
  assert.equal(r4?.lowerTemp, 50)
  assert.ok(r4?.estimated.includes('下导温度'))
  assert.ok((r4?.backfillNote ?? '').includes('本轴承实测平均温差'))
})
check('按检测日期排序回填：链按业务时间回放（#8 在 #2 之后）', () => {
  const chain = migrated.inspections.filter((row) => row.bearingCode === 'BEAR-0002')
  assert.deepEqual(chain.map((row) => row.id), [7, 2, 8])
})
check('旧版冲突记录的单值在统一界值下不再硬超限，但接在#2实测偏高之后按统一升级办法升待检修', () => {
  const row8 = migrated.inspections.find((row) => row.id === 8)
  assert.equal(row8?.grade, '待检修')
  // 单看 #8 的原始分档：下导 60 在统一界值下只到温度偏高
  const base = evaluateReadings(row8!.readings, CURRENT_POLICY)
  assert.equal(base.grade, '温度偏高')
  // 链路结论：前次 #2 实测温度偏高 → 升级
  assert.equal(row8?.currentGrade, '待检修')
  assert.ok(row8?.currentReasons.some((text) => text.includes('连续两次')))
})
check('#3 上导66 当前界值仍待检修；#6 上导64+油位176 连续偏高升级待检修', () => {
  const byId = new Map(migrated.inspections.map((row) => [row.id, row]))
  assert.equal(byId.get(3)?.currentGrade, '待检修')
  assert.equal(byId.get(6)?.currentGrade, '待检修')
})
check('迁移后待办对仍判待检修的轴承开出：BEAR-0002、BEAR-0003、BEAR-0004', () => {
  const open = migrated.todos.filter((todo) => todo.status === '待处理').map((todo) => todo.bearingCode).sort()
  assert.deepEqual(open, ['BEAR-0002', 'BEAR-0003', 'BEAR-0004'])
})

console.log('3) 服务层行为：汇总、去重、并发、确认检修回落、发版重算')
resetBearingState()
check('汇总条与台账同源：待检修台数 = 待处理待办条数', () => {
  const summary = bearingSummary()
  const open = listRepairTodos('待处理').length
  assert.equal(summary.waitingRepair, open)
  assert.equal(summary.waitingRepair, 3)
  const views = listBearingViews()
  assert.equal(views.filter((view) => view.status === '待检修').length, summary.waitingRepair)
})
check('同一轴承同一班次重复提交只保留第一笔，后到按重复退回', () => {
  const input = {
    bearingCode: 'BEAR-0001',
    unit: '1号机组',
    inspectedAt: '2026-10-05',
    shift: '白班',
    operator: '张三',
    readings: { upperTemp: 58, lowerTemp: 55, oilLevel: 300, vibration: 0.07 },
  }
  const first = submitInspection(input)
  assert.equal(first.ok, true)
  const second = submitInspection({ ...input, readings: { ...input.readings, upperTemp: 99 } })
  assert.equal(second.ok, false)
  if (second.ok === false) {
    assert.match(second.message, /重复提交已退回/)
  }
  // 冲突取值不生效：以第一笔为准
  const rows = listInspections({ bearingCode: 'BEAR-0001' }).filter((r) => r.inspectedAt === '2026-10-05')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].readings.upperTemp, 58)
  assert.equal(listRejected().length, 1)
})
check('同一时刻并发写入只留一笔：重置状态后两个不同班次键的裁决仍逐笔重读', () => {
  resetBearingState()
  const base = {
    bearingCode: 'BEAR-0004',
    unit: '4号机组',
    inspectedAt: '2026-10-05',
    operator: '李四',
    readings: { upperTemp: 55, lowerTemp: 53, oilLevel: 300, vibration: 0.08 },
  }
  const a = submitInspection({ ...base, shift: '夜班' })
  const b = submitInspection({ ...base, shift: '夜班', readings: { ...base.readings, lowerTemp: 99 } })
  assert.equal(a.ok, true)
  assert.equal(b.ok, false)
})
check('连续偏高升级自动落检修待办（提交即开单）', () => {
  resetBearingState()
  const readings = { upperTemp: 62, lowerTemp: 58, oilLevel: 300, vibration: 0.06 }
  const r1 = submitInspection({ bearingCode: 'BEAR-0009', unit: '9号机组', inspectedAt: '2026-10-04', shift: '白班', operator: '赵', readings })
  const r2 = submitInspection({ bearingCode: 'BEAR-0009', unit: '9号机组', inspectedAt: '2026-10-05', shift: '白班', operator: '赵', readings })
  assert.equal(r1.ok && r1.data.currentGrade, '温度偏高')
  assert.equal(r2.ok && r2.data.currentGrade, '待检修')
  const todo = listRepairTodos('待处理').find((t) => t.bearingCode === 'BEAR-0009')
  assert.ok(todo)
})
check('确认检修后轴承标记与待检修台数同步回落，另一入口读到的条数一致', () => {
  const before = bearingSummary().waitingRepair
  const openBefore = listRepairTodos('待处理').length
  assert.equal(before, openBefore)
  const done = confirmRepair('BEAR-0009', '现场更换瓦后复测正常')
  assert.equal(done.ok, true)
  const after = bearingSummary()
  assert.equal(after.waitingRepair, before - 1)
  assert.equal(after.repaired, 1)
  const openAfter = listRepairTodos('待处理').length
  assert.equal(openAfter, openBefore - 1)
  const view = listBearingViews().find((v) => v.code === 'BEAR-0009')
  assert.equal(view?.status, '已检修')
})
check('确认检修后连高计数清零，再测偏高不拿检修前记录升级', () => {
  const again = submitInspection({
    bearingCode: 'BEAR-0009', unit: '9号机组', inspectedAt: '2026-10-06', shift: '白班', operator: '赵',
    readings: { upperTemp: 61, lowerTemp: 55, oilLevel: 300, vibration: 0.06 },
  })
  assert.equal(again.ok, true)
  if (again.ok) assert.equal(again.data.currentGrade, '温度偏高')
})
check('界值调整发布新版：已处理轴承按新版重算，历史结论保留等级与版本，待办自动核销', () => {
  resetBearingState()
  // 当前 BEAR-0003 待检修（上导66）。把检修界值放宽（温度70、油位下限150、振动0.2）：
  // 重算后回落，待办核销；历史快照 grade 仍是待检修@legacy。
  const result = publishPolicyRevision({
    version: 'v2-test-loose',
    note: '验证用：检修温度上调到70，油位下限下调到150，振动检修上调到0.2',
    tempWarn: 60, tempTrip: 70,
    oilLow: 150, oilHigh: 400, oilTripMargin: 20,
    vibrationWarn: 0.1, vibrationTrip: 0.2,
  }, '2026-10-05T12:00:00.000Z')
  assert.equal(result.ok, true)
  const state = getState()
  assert.equal(state.activeVersion, 'v2-test-loose')
  const row3 = state.inspections.find((row) => row.id === 3)
  assert.equal(row3?.grade, '待检修')
  assert.equal(row3?.policyVersion, 'legacy-pre2026')
  // 上导66 < 70、振动0.13 < 0.2、油位260 正常；连续两次偏高（#9、#6 实测）仍升级为待检修
  assert.equal(row3?.currentGrade, '待检修')
  // 再发一版：温度报警提到 67、振动警戒提到 0.14，#9/#3/#6 的温度与振动全部回到正常，
  // 连续偏高链不成立，整条链回落，待办核销（#6 油位176 在 v2 已把下限放宽到150）。
  const v3 = publishPolicyRevision({
    version: 'v3-test-normal', note: '验证用：温度报警67、振动警戒0.14',
    tempWarn: 67, tempTrip: 70,
    oilLow: 150, oilHigh: 400, oilTripMargin: 20,
    vibrationWarn: 0.14, vibrationTrip: 0.2,
  }, '2026-10-05T13:00:00.000Z')
  assert.equal(v3.ok, true)
  const row3v3 = getState().inspections.find((row) => row.id === 3)
  assert.equal(row3v3?.currentGrade, '正常')
  const row6v3 = getState().inspections.find((row) => row.id === 6)
  assert.equal(row6v3?.currentGrade, '正常')
  assert.equal(listRepairTodos('待处理').filter((t) => t.bearingCode === 'BEAR-0003').length, 0)
  const closed = listRepairTodos('已核销').some((t) => t.bearingCode === 'BEAR-0003')
  assert.ok(closed)
  // 历史快照两次重算都没被动过
  assert.equal(row3v3?.grade, '待检修')
  assert.equal(row3v3?.policyVersion, 'legacy-pre2026')
})
check('旧版本不可覆盖，重复版本号被拒', () => {
  const dup = publishPolicyRevision({
    version: 'v3-test-normal', note: 'x', tempWarn: 1, tempTrip: 2,
    oilLow: 1, oilHigh: 2, oilTripMargin: 1, vibrationWarn: 1, vibrationTrip: 2,
  })
  assert.equal(dup.ok, false)
})
check('导出另存与页面/动作同源：含历史结论、版本、当前结论与回填标注', () => {
  resetBearingState()
  const { filename, content } = exportBearingLedger()
  assert.match(filename, new RegExp(CURRENT_POLICY.version))
  assert.match(content, /历史结论,结论界值版本,当前结论,当前界值版本/)
  assert.match(content, /legacy-pre2026/)
  assert.match(content, /推算/)
})
check('存储键独立，不与通用 entries 混写', () => {
  assert.equal(bearingStorageKey(), 'hydropower-plant-om:bearings:v1')
})
check('试算不写入，结论仍走统一判级', () => {
  const before = listInspections().length
  const p = previewGrade({ upperTemp: 70, lowerTemp: 60, oilLevel: 300, vibration: 0.05 })
  assert.equal(p.grade, '待检修')
  assert.equal(listInspections().length, before)
})

console.log(`\n全部通过：${passed} 条用例`)
