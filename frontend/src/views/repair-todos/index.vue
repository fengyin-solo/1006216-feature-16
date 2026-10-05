<template>
  <section class="page" data-module="repair-todos">
    <header class="page-head">
      <div>
        <h2>检修班组待办</h2>
        <p class="page-desc">
          导轴承判成「待检修」即自动落到本清单（与导轴承页面同一份状态、同一套判级），
          班组在这里确认检修；确认后上导轴承的待检修标记与本清单条数同步回落。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/bearing">返回导轴承台账</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待处理</span>
        <strong class="stat-value">{{ counts.待处理 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已完成</span>
        <strong class="stat-value grade-正常">{{ counts.已完成 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">界值重算核销</span>
        <strong class="stat-value">{{ counts.已核销 }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label v-for="tab in tabs" :key="tab" class="filter-item">
        <button
          type="button"
          class="btn"
          :class="{ primary: tab === activeTab }"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>待办编号</th>
          <th>轴承编号</th>
          <th>所属机组</th>
          <th>来源检测</th>
          <th>入单时间</th>
          <th>判级依据 / 界值版本</th>
          <th>状态</th>
          <th>处理说明</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="todo in rows" :key="todo.id">
          <td>#{{ todo.id }}</td>
          <td>{{ todo.bearingCode }}</td>
          <td>{{ todo.unit }}</td>
          <td>检测记录#{{ todo.sourceInspectionId }}</td>
          <td>{{ todo.openedAt.slice(0, 16).replace('T', ' ') }}</td>
          <td>
            {{ todo.reason }}
            <small class="version-tag">{{ todo.policyVersion }}</small>
          </td>
          <td :class="statusClass(todo.status)">{{ todo.status }}</td>
          <td>{{ todo.closeNote ?? '—' }}</td>
          <td class="row-actions">
            <button v-if="todo.status === '待处理'" class="link" type="button" @click="finish(todo.bearingCode)">
              确认检修
            </button>
            <span v-else class="muted-text">已闭环</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty-state">当前没有{{ activeTab }}的检修待办</td>
        </tr>
      </tbody>
    </table>

    <p class="status-legend">
      <span class="legend-item">本入口待处理 {{ counts.待处理 }} 条</span>
      <span class="legend-item">导轴承页面待检修 {{ summary.waitingRepair }} 台（两边始终一致）</span>
    </p>

    <footer class="page-foot">
      <span>待办由判级结果自动开出/核销，不由班组手工增删，避免台账与待办不一致。</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { bearingSummary, confirmRepair, listRepairTodos } from '@/api/bearing-service'
import { useSessionStore } from '@/stores/session'

type Tab = '待处理' | '已完成' | '已核销' | '全部'
const tabs: Tab[] = ['待处理', '已完成', '已核销', '全部']
const activeTab = ref<Tab>('待处理')

const rows = ref<ReturnType<typeof listRepairTodos>>([])
const message = ref('')
const messageOk = ref(true)
const session = useSessionStore()

const summary = computed(() => bearingSummary())
const counts = computed(() => {
  const all = listRepairTodos('全部')
  return {
    待处理: all.filter((todo) => todo.status === '待处理').length,
    已完成: all.filter((todo) => todo.status === '已完成').length,
    已核销: all.filter((todo) => todo.status === '已核销').length,
  }
})

function statusClass(status: string) {
  if (status === '待处理') return 'grade-待检修'
  if (status === '已完成') return 'grade-正常'
  return ''
}

function finish(code: string) {
  const result = confirmRepair(code, `${session.operator}在${session.shiftLabel}现场确认导轴承检修完成`)
  message.value = result.ok ? `${code} 检修已确认，待办完成，导轴承待检修台数同步回落` : result.message
  messageOk.value = result.ok
  reload()
}

function reload() {
  rows.value = listRepairTodos(activeTab.value)
}

watch(activeTab, reload)
onMounted(reload)
</script>

<style scoped>
.version-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 11px;
}
.grade-待检修 { color: #b42318; font-weight: 600; }
.grade-正常 { color: #15803d; }
.muted-text { color: var(--muted); font-size: 12px; }
</style>
