import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import {
  activeRule,
  allRules,
  bearingSummary,
  confirmRepair,
  listRecords,
  listRepairTodos,
  registerBearing,
  submitInspection,
  toRowCells,
} from '@/domain/bearing/service'
import type { BearingRecord } from '@/domain/bearing/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

/** 导轴承台账投影为通用 EntryRow：判级结果直接来自唯一实现，不再在页面另算。 */
function bearingToEntryRow(record: BearingRecord): EntryRow {
  return {
    id: record.id,
    status: record.status,
    pending: record.repairTodo.open,
    abnormal: record.status === '温度偏高' || record.status === '待检修',
    轴承编号: record.bearingNo,
    所属机组: record.unitNo,
    上导温度: record.signals.upperTemp === null ? '缺测' : record.signals.upperTemp,
    下导温度:
      record.signals.lowerTemp === null
        ? '缺测'
        : record.signals.lowerTemp + (record.signals.lowerTempImputed ? '（推算）' : ''),
    油位高度: record.signals.oilLevel === null ? '缺测' : record.signals.oilLevel,
    振动数值: record.signals.vibration === null ? '缺测' : record.signals.vibration,
    检测日期: record.signals.inspectedAt,
    轴承状态: `${record.status}（${record.ruleVersion}）`,
  }
}

function bearingEntries(): EntryRow[] {
  return listRecords().map(bearingToEntryRow)
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  if (key === 'bearing') {
    const matched = filterRows(bearingEntries(), filters)
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === 'bearing') {
    // 导轴承动作统一走领域服务：判级、去重、待办、版本都在同一份实现里。
    if (action === '提交检测') {
      const record = listRecords().find((row) => row.id === id)
      if (!record) {
        return { ok: false, message: `没有找到编号为 ${id} 的导轴承` }
      }
      return submitInspection({
        id,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 5),
        operator: '值班管理员',
        upperTemp: record.signals.upperTemp,
        lowerTemp: record.signals.lowerTemp,
        oilLevel: record.signals.oilLevel,
        vibration: record.signals.vibration,
      })
    }
    if (action === '确认检修') {
      return confirmRepair(id)
    }
    return { ok: false, message: `导轴承不提供「${action}」动作，判级由提交检测按统一界值自动完成` }
  }

  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  if (key === 'bearing') {
    // 另存（导出）与页面、动作共用同一实现：列与判定理由都来自领域，不再各写一份。
    const header = [
      '编号', '轴承编号', '所属机组', '上导温度', '下导温度', '油位高度',
      '振动数值', '检测日期', '判定等级', '规则版本', '当前状态', '升级理由', '检修待办',
    ]
    const lines = [header.join(',')]
    for (const record of listRecords()) {
      const cells = toRowCells(record)
      lines.push(header.map((column) => cells[column] ?? '').join(','))
    }
    return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
  }
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
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

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const bearing = bearingSummary()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    if (meta.key === 'bearing') {
      // 汇总条与台账记录同步：待处理=待检修待办数，异常量=偏高+待检修，与台账同源。
      return {
        name: meta.name,
        created: bearing.total,
        pending: bearing.repairTodoCount,
        abnormal: bearing.elevated + bearing.pendingRepair,
      }
    }
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 导轴承专用入口：页面、检修待办入口共用，避免业务判断散回组件 ——
export const bearingApi = {
  listEntries,
  registerBearing,
  submitInspection,
  confirmRepair,
  listRepairTodos,
  bearingSummary,
  allRules,
  activeRule,
}
