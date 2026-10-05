<template>
  <section class="page" data-module="bearing">
    <header class="page-head">
      <div>
        <h2>导轴承管理</h2>
        <p class="page-desc">
          上导温度、下导温度、油位高度、振动数值在同一环节判级（当前界值版本
          <strong>{{ policy.version }}</strong
          >：温度 {{ policy.tempWarn }}/{{ policy.tempTrip }}℃，油位 {{ policy.oilLow }}~{{ policy.oilHigh }}mm，振动
          {{ policy.vibrationWarn }}/{{ policy.vibrationTrip }}mm），页面、动作、另存共用同一份实现。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起登记' : '提交检测' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出导轴承台账</button>
        <RouterLink class="btn" to="/repair-todos">检修班组待办（{{ summary.waitingRepair }}）</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">待处理检修待办：{{ openTodoCount }}（与检修班组入口同源）</span>
    </p>

    <form v-if="showForm" class="filter-bar bearing-form" @submit.prevent="submitForm">
      <label class="filter-item">
        <span>轴承编号</span>
        <input v-model="form.bearingCode" list="bearing-codes" placeholder="如 BEAR-0002" required />
      </label>
      <datalist id="bearing-codes">
        <option v-for="view in views" :key="view.code" :value="view.code">{{ view.unit }}</option>
      </datalist>
      <label class="filter-item">
        <span>所属机组</span>
        <input v-model="form.unit" placeholder="如 2号机组" required />
      </label>
      <label class="filter-item">
        <span>检测日期</span>
        <input v-model="form.inspectedAt" type="date" required />
      </label>
      <label class="filter-item">
        <span>班次</span>
        <select v-model="form.shift">
          <option>白班</option>
          <option>夜班</option>
        </select>
      </label>
      <label class="filter-item">
        <span>上导温度(℃)</span>
        <input v-model.number="form.upperTemp" type="number" step="0.1" />
      </label>
      <label class="filter-item">
        <span>下导温度(℃)</span>
        <input v-model.number="form.lowerTemp" type="number" step="0.1" />
      </label>
      <label class="filter-item">
        <span>油位高度(mm)</span>
        <input v-model.number="form.oilLevel" type="number" step="1" />
      </label>
      <label class="filter-item">
        <span>振动数值(mm)</span>
        <input v-model.number="form.vibration" type="number" step="0.01" />
      </label>
      <button class="btn primary" type="submit">提交检测</button>
      <span class="preview-box">
        <template v-if="hasReadingInput">
          试算结论：<strong :class="previewClass">{{ preview.grade }}</strong>
          <em v-if="preview.reasons.length">{{ preview.reasons.join('；') }}</em>
        </template>
        <em v-else>填入任一监测量后按统一界值试算（不写入）</em>
      </span>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>轴承编号</span>
        <input v-model="keyword" placeholder="按轴承编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="keyword = ''; reload()">重置条件</button>
    </form>

    <h3>轴承台账（每台一行，取最近一次检测按当前界值的结论）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>轴承编号</th>
          <th>所属机组</th>
          <th>检测日期</th>
          <th>上导温度</th>
          <th>下导温度</th>
          <th>油位高度</th>
          <th>振动数值</th>
          <th>当前状态</th>
          <th>历史结论（版本）</th>
          <th>判级依据</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in filteredViews" :key="view.code">
          <td>{{ view.code }}</td>
          <td>{{ view.unit }}</td>
          <td>{{ view.latest.inspectedAt }} {{ view.latest.shift }}</td>
          <td>
            {{ view.latest.readings.upperTemp ?? '—' }}
            <small v-if="view.latest.estimated.includes('上导温度')" class="estimated-tag">推算</small>
          </td>
          <td>
            {{ view.latest.readings.lowerTemp ?? '—' }}
            <small v-if="view.latest.estimated.includes('下导温度')" class="estimated-tag">推算</small>
          </td>
          <td>
            {{ view.latest.readings.oilLevel ?? '—' }}
            <small v-if="view.latest.estimated.includes('油位高度')" class="estimated-tag">推算</small>
          </td>
          <td>
            {{ view.latest.readings.vibration ?? '—' }}
            <small v-if="view.latest.estimated.includes('振动数值')" class="estimated-tag">推算</small>
          </td>
          <td :class="`grade-${view.status}`">{{ view.status }}</td>
          <td>
            {{ view.latest.grade }}
            <small class="version-tag">{{ view.latest.policyVersion }}</small>
            <small v-if="view.latest.grade !== view.status" class="recompute-tag">
              新版重算→{{ view.status }}
            </small>
          </td>
          <td class="reason-cell">
            {{ view.latest.currentReasons.join('；') || '各监测量均在界值以内' }}
            <small v-if="view.latest.backfillNote" class="backfill-note">{{ view.latest.backfillNote }}</small>
          </td>
          <td class="row-actions">
            <button
              v-if="view.status === '待检修'"
              class="link"
              type="button"
              @click="repair(view.code)"
            >
              确认检修
            </button>
            <span v-else-if="view.status === '已检修'" class="repaired-text">检修已确认</span>
            <span v-else class="muted-text">无需检修</span>
          </td>
        </tr>
        <tr v-if="!filteredViews.length">
          <td colspan="11" class="empty-state">暂无导轴承数据，可先提交检测</td>
        </tr>
      </tbody>
    </table>

    <h3>检测明细（历史结论保留当时等级与界值版本，不被新版重排）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>轴承编号</th>
          <th>所属机组</th>
          <th>检测日期</th>
          <th>班次</th>
          <th>上导</th>
          <th>下导</th>
          <th>油位</th>
          <th>振动</th>
          <th>历史结论@版本</th>
          <th>当前结论@{{ policy.version }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredInspections" :key="row.id">
          <td>#{{ row.id }}</td>
          <td>{{ row.bearingCode }}</td>
          <td>{{ row.unit }}</td>
          <td>{{ row.inspectedAt }}</td>
          <td>{{ row.shift }}</td>
          <td>{{ mark(row.readings.upperTemp, '上导温度', row) }}</td>
          <td>{{ mark(row.readings.lowerTemp, '下导温度', row) }}</td>
          <td>{{ mark(row.readings.oilLevel, '油位高度', row) }}</td>
          <td>{{ mark(row.readings.vibration, '振动数值', row) }}</td>
          <td>
            {{ row.grade }}<small class="version-tag">{{ row.policyVersion }}</small>
          </td>
          <td :class="`grade-${row.currentGrade}`">{{ row.currentGrade }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="rejected.length" class="rejected-box">
      <h3>重复/并发退回记录（同一轴承同一班次只按第一笔算）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>退回编号</th>
            <th>轴承编号</th>
            <th>检测日期/班次</th>
            <th>提交人</th>
            <th>提交取值（上导/下导/油位/振动）</th>
            <th>退回原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rejected" :key="item.id">
            <td>#{{ item.id }}</td>
            <td>{{ item.bearingCode }}</td>
            <td>{{ item.inspectedAt }} {{ item.shift }}</td>
            <td>{{ item.operator }}</td>
            <td>
              {{ item.readings.upperTemp ?? '—' }}/{{ item.readings.lowerTemp ?? '—' }}/{{
                item.readings.oilLevel ?? '—'
              }}/{{ item.readings.vibration ?? '—' }}
            </td>
            <td>{{ item.reason }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="policy-box">
      <h3>界值版本（调整后按新版重算已处理轴承，历史结论保留当时等级并注明版本）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>版本</th>
            <th>发布时间</th>
            <th>温度报警/检修(℃)</th>
            <th>油位区间(mm)</th>
            <th>振动警戒/检修(mm)</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in policies" :key="item.version" :class="{ activePolicy: item.version === policy.version }">
            <td>{{ item.version }}<small v-if="item.version === policy.version" class="recompute-tag">当前生效</small></td>
            <td>{{ item.publishedAt.slice(0, 10) }}</td>
            <td>{{ item.tempWarn }}/{{ item.tempTrip }}</td>
            <td>{{ item.oilLow }}~{{ item.oilHigh }}（越界{{ item.oilTripMargin }}mm检修）</td>
            <td>{{ item.vibrationWarn }}/{{ item.vibrationTrip }}</td>
            <td>{{ item.note }}</td>
          </tr>
        </tbody>
      </table>

      <form class="filter-bar" style="margin-top: 10px" @submit.prevent="publishRevision">
        <label class="filter-item">
          <span>温度报警/检修</span>
          <input v-model.number="draft.tempWarn" type="number" step="1" style="width: 64px" /> /
          <input v-model.number="draft.tempTrip" type="number" step="1" style="width: 64px" />
        </label>
        <label class="filter-item">
          <span>振动警戒/检修</span>
          <input v-model.number="draft.vibrationWarn" type="number" step="0.01" style="width: 64px" /> /
          <input v-model.number="draft.vibrationTrip" type="number" step="0.01" style="width: 64px" />
        </label>
        <label class="filter-item">
          <span>版本说明</span>
          <input v-model="draft.note" placeholder="本次界值调整依据" style="width: 260px" />
        </label>
        <button class="btn primary" type="submit">发布新版并重算</button>
      </form>
    </section>

    <footer class="page-foot">
      <span>共 {{ summary.total }} 台导轴承，待检修 {{ summary.waitingRepair }} 台（与检修待办入口条数一致）</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import {
  activePolicy,
  bearingSummary,
  confirmRepair,
  downloadBearingLedger,
  exportBearingLedger,
  listBearingViews,
  listInspections,
  listPolicies,
  listRepairTodos,
  listRejected,
  previewGrade,
  publishPolicyRevision,
  submitInspection,
} from '@/api/bearing-service'
import type { BearingView } from '@/api/bearing-service'
import type { BearingInspection } from '@/domain/bearing-types'
import type { IndicatorName } from '@/domain/bearing-policy'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const views = ref<BearingView[]>([])
const inspections = ref<BearingInspection[]>([])
const rejected = ref<ReturnType<typeof listRejected>>([])
const policies = ref<ReturnType<typeof listPolicies>>([])
const policy = ref(activePolicy())
const keyword = ref('')
const message = ref('')
const messageOk = ref(true)
const showForm = ref(false)

function today() {
  return new Date().toISOString().slice(0, 10)
}

const form = reactive({
  bearingCode: '',
  unit: '',
  inspectedAt: today(),
  shift: session.shiftLabel.includes('夜') ? '夜班' : '白班',
  upperTemp: '' as number | '',
  lowerTemp: '' as number | '',
  oilLevel: '' as number | '',
  vibration: '' as number | '',
})

const draft = reactive({
  tempWarn: 60,
  tempTrip: 65,
  vibrationWarn: 0.1,
  vibrationTrip: 0.15,
  note: '',
})

const summary = computed(() => bearingSummary())
const openTodoCount = computed(() => listRepairTodos('待处理').length)

const statCards = computed(() => [
  { label: '轴承总台数', value: summary.value.total },
  { label: '正常轴承', value: summary.value.normal },
  { label: '温度偏高轴承', value: summary.value.high },
  { label: '待检修轴承', value: summary.value.waitingRepair },
  { label: '已检修轴承', value: summary.value.repaired },
])

const statusSummary = computed(() =>
  (['正常', '温度偏高', '待检修', '已检修'] as const).map((status) => ({
    status,
    count: views.value.filter((view) => view.status === status).length,
  })),
)

const filteredViews = computed(() =>
  keyword.value.trim()
    ? views.value.filter((view) => view.code.includes(keyword.value.trim()))
    : views.value,
)
const filteredInspections = computed(() =>
  keyword.value.trim()
    ? inspections.value.filter((row) => row.bearingCode.includes(keyword.value.trim()))
    : inspections.value,
)

const readingsInput = computed(() => ({
  upperTemp: form.upperTemp === '' ? null : Number(form.upperTemp),
  lowerTemp: form.lowerTemp === '' ? null : Number(form.lowerTemp),
  oilLevel: form.oilLevel === '' ? null : Number(form.oilLevel),
  vibration: form.vibration === '' ? null : Number(form.vibration),
}))
const hasReadingInput = computed(() => Object.values(readingsInput.value).some((value) => value !== null))
const preview = computed(() => previewGrade(readingsInput.value, form.bearingCode.trim() || undefined))
const previewClass = computed(() => `grade-${preview.value.grade}`)

function mark(value: number | null, name: IndicatorName, row: BearingInspection): string {
  if (value === null) {
    return '—'
  }
  return row.estimated.includes(name) ? `${value}(推算)` : String(value)
}

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function submitForm() {
  const readings = {
    upperTemp: form.upperTemp === '' ? null : Number(form.upperTemp),
    lowerTemp: form.lowerTemp === '' ? null : Number(form.lowerTemp),
    oilLevel: form.oilLevel === '' ? null : Number(form.oilLevel),
    vibration: form.vibration === '' ? null : Number(form.vibration),
  }
  if (Object.values(readings).every((value) => value === null)) {
    notify('至少填写一个监测量（上导温度/下导温度/油位/振动），否则没有判级依据', false)
    return
  }
  const result = submitInspection({
    bearingCode: form.bearingCode,
    unit: form.unit || views.value.find((view) => view.code === form.bearingCode.trim())?.unit || '',
    inspectedAt: form.inspectedAt,
    shift: form.shift,
    operator: session.operator,
    readings,
  })
  if (!result.ok) {
    notify(result.message, false)
  } else {
    notify(`已受理记录#${result.data.id}，判级「${result.data.currentGrade}」${result.data.escalated ? '（连续偏高升级）' : ''}`)
  }
  reload()
}

function repair(code: string) {
  const result = confirmRepair(code, `${session.operator}在${session.shiftLabel}确认检修完成`)
  notify(result.ok ? `${code} 已确认检修，待检修台数已回落` : result.message, result.ok)
  reload()
}

function publishRevision() {
  const result = publishPolicyRevision({
    note: draft.note || `界值调整为温度${draft.tempWarn}/${draft.tempTrip}℃、振动${draft.vibrationWarn}/${draft.vibrationTrip}mm`,
    tempWarn: Number(draft.tempWarn),
    tempTrip: Number(draft.tempTrip),
    oilLow: policy.value.oilLow,
    oilHigh: policy.value.oilHigh,
    oilTripMargin: policy.value.oilTripMargin,
    vibrationWarn: Number(draft.vibrationWarn),
    vibrationTrip: Number(draft.vibrationTrip),
  })
  notify(
    result.ok
      ? `新版界值 ${result.data.version} 已生效，全部检测已按新版重算，历史结论保留原等级与版本`
      : result.message,
    result.ok,
  )
  reload()
}

function exportRows() {
  downloadBearingLedger()
  notify(`另存导出：${exportBearingLedger().filename}，结论与页面、动作同源`)
}

function reload() {
  views.value = listBearingViews().sort((a, b) => a.code.localeCompare(b.code))
  inspections.value = listInspections()
  rejected.value = listRejected()
  policies.value = listPolicies()
  policy.value = activePolicy()
  draft.tempWarn = policy.value.tempWarn
  draft.tempTrip = policy.value.tempTrip
  draft.vibrationWarn = policy.value.vibrationWarn
  draft.vibrationTrip = policy.value.vibrationTrip
}

// 切到不同生效版本时，调整表单跟随当前界值，避免误发“没动过”的新版。
watch(policy, (next) => {
  draft.tempWarn = next.tempWarn
  draft.tempTrip = next.tempTrip
  draft.vibrationWarn = next.vibrationWarn
  draft.vibrationTrip = next.vibrationTrip
})

onMounted(reload)
</script>

<style scoped>
.bearing-form { align-items: flex-end; }
.preview-box { font-size: 12px; color: var(--muted); display: flex; flex-direction: column; gap: 2px; }
.preview-box em { font-style: normal; color: #b45309; }
.estimated-tag,
.version-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 11px;
}
.recompute-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 11px;
}
.backfill-note { display: block; color: var(--muted); margin-top: 2px; }
.reason-cell { max-width: 260px; }
.grade-正常 { color: #15803d; }
.grade-温度偏高 { color: #b45309; }
.grade-待检修 { color: #b42318; font-weight: 600; }
.repaired-text,
.muted-text { color: var(--muted); font-size: 12px; }
h3 { font-size: 14px; margin: 18px 0 8px; }
.rejected-box h3,
.policy-box h3 { color: #334155; }
.activePolicy { background: #f8fafc; }
</style>
