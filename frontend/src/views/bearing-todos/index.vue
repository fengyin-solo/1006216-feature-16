<template>
  <section class="page" data-module="bearing-todos">
    <header class="page-head">
      <div>
        <h2>检修班组待办 · 导轴承</h2>
        <p class="page-desc">
          判为「待检修」的导轴承自动落到本清单；清单从导轴承台账实时投影，不另存一份，条数与导轴承页面的待检修台数始终一致。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/bearing">返回导轴承台账</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card danger">
        <span class="stat-label">待检修导轴承（台）</span>
        <strong class="stat-value">{{ todos.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">台账待检修台数（同源）</span>
        <strong class="stat-value">{{ summary.pendingRepair }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>轴承编号</th>
          <th>所属机组</th>
          <th>进入待办日期</th>
          <th>判级版本</th>
          <th>升级理由</th>
          <th>处理</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in todos" :key="item.id">
          <td>{{ item.bearingNo }}</td>
          <td>{{ item.unitNo }}</td>
          <td>{{ item.openedAt }}</td>
          <td>{{ item.ruleVersion }}</td>
          <td>
            {{ item.reasons.join('；') || '按统一界值判待检修' }}
            <em v-if="item.lowerTempImputed">（下导温度为上导−5℃推算值）</em>
          </td>
          <td class="row-actions">
            <button class="link danger" type="button" @click="finish(item.id)">确认检修</button>
          </td>
        </tr>
        <tr v-if="!todos.length">
          <td colspan="6" class="empty-state">当前没有待检修的导轴承，班组待办为空</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>确认检修后，待办条数与台账「待检修台数」「上导温度标记」同步回落，两处读数一致</span>
      <span v-if="message" :class="ok ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { bearingApi } from '@/api/local-service'
import type { BearingSummary, RepairTodoItem } from '@/domain/bearing/types'

const todos = ref<RepairTodoItem[]>([])
const summary = ref<BearingSummary>(bearingApi.bearingSummary())
const message = ref('')
const ok = ref(true)

function reload() {
  todos.value = bearingApi.listRepairTodos()
  summary.value = bearingApi.bearingSummary()
}

function finish(id: number) {
  const result = bearingApi.confirmRepair(id)
  message.value = result.message
  ok.value = result.ok
  reload()
}

onMounted(reload)
</script>

<style scoped>
.stat-card.danger strong { color: #b42318; }
.link.danger { color: #b42318; }
.ok-text { color: #067647; }
em { color: var(--muted); font-style: normal; font-size: 12px; }
</style>
