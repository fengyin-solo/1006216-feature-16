<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <h3 class="block-title">导轴承判级汇总（与导轴承台账、检修班组待办同源）</h3>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">轴承总台数</span>
        <strong class="stat-value">{{ bearing.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">正常</span>
        <strong class="stat-value grade-normal">{{ bearing.normal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">温度偏高</span>
        <strong class="stat-value grade-high">{{ bearing.high }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待检修</span>
        <strong class="stat-value grade-repair">{{ bearing.waitingRepair }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已检修</span>
        <strong class="stat-value">{{ bearing.repaired }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待处理检修待办</span>
        <strong class="stat-value grade-repair">{{ openTodos }}</strong>
      </article>
    </div>
    <p class="status-legend">
      <RouterLink class="btn" to="/bearing">导轴承台账</RouterLink>
      <RouterLink class="btn" to="/repair-todos">检修班组待办入口</RouterLink>
    </p>

    <h3 class="block-title">其它业务模块</h3>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到迁移后的初始数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { loadOverview } from '@/api/local-service'
import { bearingSummary, listRepairTodos } from '@/api/bearing-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const bearing = ref(bearingSummary())
const openTodos = ref(0)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  bearing.value = bearingSummary()
  openTodos.value = listRepairTodos('待处理').length
}

onMounted(refresh)
</script>

<style scoped>
.block-title { font-size: 14px; margin: 18px 0 8px; }
.grade-normal { color: #15803d; }
.grade-high { color: #b45309; }
.grade-repair { color: #b42318; }
</style>
