<template>
  <section class="page" data-module="bearing">
    <header class="page-head">
      <div>
        <h2>导轴承管理</h2>
        <p class="page-desc">
          上导温度、下导温度、油位高度、振动数值在同一环节判级；正常 / 温度偏高 / 待检修三档界值只有一份，页面、动作、另存共用。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记导轴承</button>
        <button class="btn" type="button" @click="openRules">界值版本</button>
        <button class="btn" type="button" @click="exportRows">导出导轴承清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card" :class="item.tone">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">
          {{ item.value }}
          <small v-if="item.link" class="stat-link" @click="goTodos">去看待办 →</small>
        </strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">当前规则：{{ currentRule.version }}（{{ currentRule.note }}）</span>
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openInspect(row)">提交检测</button>
            <button class="link" type="button" @click="openHistory(row)">履历</button>
            <button
              v-if="String(row.status) === '待检修'"
              class="link danger"
              type="button"
              @click="doRepair(row)"
            >
              确认检修
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无导轴承数据，可先登记导轴承</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条导轴承记录 · 待检修 {{ summary.repairTodoCount }} 台，与检修班组待办入口同源</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记 / 检测弹层 -->
    <div v-if="formOpen" class="modal-mask" @click.self="formOpen = false">
      <form class="modal" @submit.prevent="submitForm">
        <h3>{{ formMode === 'create' ? '登记导轴承' : `提交检测 · ${editing?.['轴承编号']}` }}</h3>
        <template v-if="formMode === 'create'">
          <label class="form-item"><span>轴承编号</span><input v-model="form.bearingNo" required placeholder="BEAR-0007" /></label>
          <label class="form-item"><span>所属机组</span><input v-model="form.unitNo" required placeholder="1号机组" /></label>
        </template>
        <label class="form-item"><span>检测日期</span><input v-model="form.date" type="date" required /></label>
        <label class="form-item"><span>检测时间</span><input v-model="form.time" type="time" required /></label>
        <div class="form-grid">
          <label class="form-item"><span>上导温度 ℃</span><input v-model="form.upperTemp" type="number" step="0.1" /></label>
          <label class="form-item"><span>下导温度 ℃（留空按上导−5℃推算）</span><input v-model="form.lowerTemp" type="number" step="0.1" /></label>
          <label class="form-item"><span>油位高度 mm</span><input v-model="form.oilLevel" type="number" step="1" /></label>
          <label class="form-item"><span>振动数值 mm</span><input v-model="form.vibration" type="number" step="0.01" /></label>
        </div>
        <p class="form-hint">四个监测值进入同一套判级；下导温度留空时按「上导−5℃」补齐并标注推算；同一班次重复提交将按第一次结果退回。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="formOpen = false">取消</button>
          <button class="btn primary" type="submit">{{ formMode === 'create' ? '登记并判级' : '提交判级' }}</button>
        </div>
      </form>
    </div>

    <!-- 履历弹层 -->
    <div v-if="historyOpen" class="modal-mask" @click.self="historyOpen = false">
      <div class="modal wide">
        <h3>{{ historyRecord?.bearingNo }} 检测履历</h3>
        <table class="data-table">
          <thead>
            <tr><th>检测日期</th><th>班次</th><th>检测人</th><th>当时结论</th><th>规则版本</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="(entry, idx) in historyRecord?.history ?? []" :key="idx" :class="{ duplicate: entry.rejectedAsDuplicate }">
              <td>{{ entry.inspectedAt }}</td>
              <td>{{ entry.shift }}</td>
              <td>{{ entry.operator }}</td>
              <td>{{ entry.rejectedAsDuplicate ? '重复退回' : entry.level }}</td>
              <td>{{ entry.ruleVersion }}</td>
              <td>
                {{ entry.reasons.join('；') }}
                <template v-if="entry.lowerTempImputed">（下导为推算值）</template>
                <template v-if="entry.recomputed">
                  <br /><em>后按 {{ entry.recomputed.ruleVersion }} 重算为「{{ entry.recomputed.level }}」（{{ entry.recomputed.at }}），原等级保留</em>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <ul class="remark-list">
          <li v-for="(note, idx) in historyRecord?.remarks ?? []" :key="idx">{{ note }}</li>
        </ul>
        <div class="modal-actions"><button class="btn primary" type="button" @click="historyOpen = false">关闭</button></div>
      </div>
    </div>

    <!-- 界值版本 -->
    <div v-if="rulesOpen" class="modal-mask" @click.self="rulesOpen = false">
      <div class="modal wide">
        <h3>判级界值版本</h3>
        <p class="form-hint">正常 / 温度偏高 / 待检修三档界值与升级办法的唯一来源。发布新版后已处理轴承按新版重算，历史结论保留当时等级并注明版本。</p>
        <table class="data-table">
          <thead>
            <tr><th>版本</th><th>生效起</th><th>状态</th><th>上导℃</th><th>下导℃</th><th>油位mm</th><th>振动mm</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.version" :class="{ active: rule.version === currentRule.version }">
              <td>{{ rule.version }}</td>
              <td>{{ rule.effectiveFrom }}</td>
              <td>{{ rule.version === currentRule.version ? '在用' : (rule.effectiveTo ? '已停用' : '备用') }}</td>
              <td>{{ formatBound(rule.thresholds['上导温度']) }}</td>
              <td>{{ formatBound(rule.thresholds['下导温度']) }}</td>
              <td>{{ formatBound(rule.thresholds['油位高度']) }}</td>
              <td>{{ formatBound(rule.thresholds['振动数值']) }}</td>
              <td>{{ rule.note }}</td>
            </tr>
          </tbody>
        </table>

        <h4>发布新版界值（仅追加，不改旧版）</h4>
        <div class="form-grid">
          <label class="form-item"><span>版本号</span><input v-model="newRule.version" placeholder="v3" /></label>
          <label class="form-item"><span>生效日期</span><input v-model="newRule.effectiveFrom" type="date" /></label>
          <template v-for="key in channelKeys" :key="key">
            <label class="form-item"><span>{{ key }} 偏高界值</span><input v-model="newRule.warn[key]" type="number" step="0.01" /></label>
            <label class="form-item"><span>{{ key }} 待检修界值</span><input v-model="newRule.alarm[key]" type="number" step="0.01" /></label>
          </template>
        </div>
        <label class="form-item"><span>版本说明</span><input v-model="newRule.note" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="rulesOpen = false">关闭</button>
          <button class="btn primary" type="button" @click="publishNewRule">发布并按新版重算</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { bearingApi, downloadEntries, listEntries } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { getRecord as listBearingRecord, publishRule as publishRuleApi } from '@/domain/bearing/service'
import type { BearingRecord, BearingRuleVersion, ChannelThreshold, SignalChannel } from '@/domain/bearing/types'

const router = useRouter()
const columns = ['轴承编号', '所属机组', '上导温度', '下导温度', '油位高度', '振动数值', '检测日期']
const filterFields = columns.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const summary = ref(bearingApi.bearingSummary())
const rules = ref<BearingRuleVersion[]>(bearingApi.allRules())

const currentRule = computed(() => bearingApi.activeRule())

const statCards = computed(() => [
  { label: '正常轴承', value: summary.value.normal, tone: '' },
  { label: '温度偏高轴承', value: summary.value.elevated, tone: 'warn' },
  { label: '待检修轴承', value: summary.value.pendingRepair, tone: 'danger', link: true },
  { label: '待检修待办（班组入口）', value: summary.value.repairTodoCount, tone: 'danger', link: true },
  { label: '已检修', value: summary.value.repaired, tone: '' },
])

const statusSummary = computed(() => {
  const all = listEntries('bearing').items
  return ['正常', '温度偏高', '待检修', '已检修', '待检测'].map((status) => ({
    status,
    count: all.filter((row) => String(row.status).startsWith(status)).length,
  }))
})

// 登记 / 检测弹层
const formOpen = ref(false)
const formMode = ref<'create' | 'inspect'>('create')
const editing = ref<EntryRow | null>(null)
const emptyForm = () => ({
  bearingNo: '',
  unitNo: '',
  date: new Date().toISOString().slice(0, 10),
  time: new Date().toTimeString().slice(0, 5),
  upperTemp: '' as string | number,
  lowerTemp: '' as string | number,
  oilLevel: '' as string | number,
  vibration: '' as string | number,
})
const form = reactive(emptyForm())

function openCreate() {
  formMode.value = 'create'
  editing.value = null
  Object.assign(form, emptyForm())
  formOpen.value = true
}

function openInspect(row: EntryRow) {
  formMode.value = 'inspect'
  editing.value = row
  Object.assign(form, {
    ...emptyForm(),
    upperTemp: row['上导温度'] === '缺测' ? '' : Number(String(row['上导温度']).replace('（推算）', '')),
    lowerTemp: '',
    oilLevel: row['油位高度'] === '缺测' ? '' : Number(row['油位高度']),
    vibration: row['振动数值'] === '缺测' ? '' : Number(row['振动数值']),
  })
  formOpen.value = true
}

function numOrNull(value: string | number): number | null {
  if (value === '' || value === null || value === undefined) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function submitForm() {
  const payload = {
    date: form.date,
    time: form.time,
    operator: '值班管理员',
    upperTemp: numOrNull(form.upperTemp),
    lowerTemp: numOrNull(form.lowerTemp),
    oilLevel: numOrNull(form.oilLevel),
    vibration: numOrNull(form.vibration),
  }
  const result =
    formMode.value === 'create'
      ? bearingApi.registerBearing({ bearingNo: form.bearingNo, unitNo: form.unitNo, ...payload })
      : bearingApi.submitInspection({ id: Number(editing.value?.id), ...payload })
  finishAction(result)
}

// 履历
const historyOpen = ref(false)
const historyRecord = ref<BearingRecord | null>(null)

function openHistory(row: EntryRow) {
  historyRecord.value = listBearingRecord(Number(row.id)) ?? null
  historyOpen.value = true
}

// 界值版本
const rulesOpen = ref(false)
const channelKeys: SignalChannel[] = ['上导温度', '下导温度', '油位高度', '振动数值']
const newRule = reactive({
  version: 'v3',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  note: '',
  warn: { 上导温度: 65, 下导温度: 60, 油位高度: 200, 振动数值: 0.1 } as Record<SignalChannel, number>,
  alarm: { 上导温度: 70, 下导温度: 65, 油位高度: 150, 振动数值: 0.18 } as Record<SignalChannel, number>,
})

function openRules() {
  rules.value = bearingApi.allRules()
  rulesOpen.value = true
}

function formatBound(threshold: ChannelThreshold): string {
  const rel = threshold.compare === 'gte' ? '≥' : '≤'
  return `${rel}${threshold.warn} / ${rel}${threshold.alarm}`
}

function publishNewRule() {
  const rule: BearingRuleVersion = {
    version: newRule.version.trim(),
    effectiveFrom: newRule.effectiveFrom,
    effectiveTo: null,
    note: newRule.note || `自发布界值 ${newRule.version}`,
    thresholds: {
      上导温度: { warn: Number(newRule.warn.上导温度), alarm: Number(newRule.alarm.上导温度), compare: 'gte', unit: '℃' },
      下导温度: { warn: Number(newRule.warn.下导温度), alarm: Number(newRule.alarm.下导温度), compare: 'gte', unit: '℃' },
      油位高度: { warn: Number(newRule.warn.油位高度), alarm: Number(newRule.alarm.油位高度), compare: 'lte', unit: 'mm' },
      振动数值: { warn: Number(newRule.warn.振动数值), alarm: Number(newRule.alarm.振动数值), compare: 'gte', unit: 'mm' },
    },
  }
  finishAction(publishRuleApi(rule))
}

function doRepair(row: EntryRow) {
  finishAction(bearingApi.confirmRepair(Number(row.id)))
}

function finishAction(result: { ok: boolean; message: string }, closeModal = true) {
  if (result.ok && closeModal) {
    formOpen.value = false
    rulesOpen.value = false
  }
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function exportRows() {
  downloadEntries('bearing')
}

function goTodos() {
  router.push('/bearing-todos')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries('bearing', filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = bearingApi.bearingSummary()
    rules.value = bearingApi.allRules()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导轴承列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.stat-card.warn strong { color: #b54708; }
.stat-card.danger strong { color: #b42318; }
.stat-link { font-size: 12px; color: var(--brand); cursor: pointer; margin-left: 6px; }
.link.danger { color: #b42318; }
.modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 20;
}
.modal {
  background: #fff; border-radius: 10px; padding: 18px 20px; width: 560px; max-height: 86vh; overflow: auto;
}
.modal.wide { width: 860px; }
.modal h3 { margin: 0 0 12px; }
.modal h4 { margin: 16px 0 8px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.form-item { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.form-item input { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; color: #1f2937; }
.form-hint { font-size: 12px; color: var(--muted); margin: 6px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.remark-list { font-size: 12px; color: var(--muted); margin: 10px 0 0; padding-left: 18px; }
.duplicate td { color: var(--muted); background: #f8fafc; }
tr.active { background: #eef6ff; }
</style>
