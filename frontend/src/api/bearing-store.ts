import type { BearingState } from '@/domain/bearing-types'

/**
 * 导轴承专属持久化，与通用模块的 hydropower-plant-om:entries 分开存。
 * 迁移完成后老台账不再经过通用 local-store，避免两边各写一份、读数冲突。
 */
export const BEARING_STORAGE_KEY = 'hydropower-plant-om:bearings:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: BearingState | null = null
let initializer: (() => BearingState) | null = null

/** 由 service 层注入“全新初始化（含老台账迁移）”的构造函数，数据层不碰业务规则。 */
export function registerBearingInitializer(factory: () => BearingState): void {
  initializer = factory
}

function readStorage(): BearingState {
  if (!initializer) {
    throw new Error('导轴承存储尚未初始化：service 层未注册迁移构造函数')
  }
  const fallback = initializer()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(BEARING_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(BEARING_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as BearingState
  } catch {
    window.localStorage.setItem(BEARING_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

/**
 * 同一时刻并发写入的最后一道闸：写入前强制重读磁盘（含其它标签页刚落下的笔），
 * 业务层在这份最新状态上裁决，保证同一轴承同一班次只可能落下一笔。
 */
export function loadBearingState(): BearingState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** 从磁盘强制刷新（storage 事件与写入裁决前使用）。 */
export function reloadBearingState(): BearingState {
  cache = typeof window !== 'undefined' && window.localStorage
    ? readStorage()
    : cache
  return cache as BearingState
}

export function persistBearingState(state: BearingState): BearingState {
  cache = clone(state)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BEARING_STORAGE_KEY, JSON.stringify(cache))
  }
  return cache
}

/** 重新播种（测试与“回到迁移后初始状态”用）。 */
export function resetBearingState(): BearingState {
  if (!initializer) {
    throw new Error('导轴承存储尚未初始化：service 层未注册迁移构造函数')
  }
  return persistBearingState(initializer())
}

export function bearingStorageKey(): string {
  return BEARING_STORAGE_KEY
}

// 其它标签页写入后，本页缓存作废，下一次读取拿最新，避免跨页并发各读旧值。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key === BEARING_STORAGE_KEY) {
      cache = null
    }
  })
}
