/** 班次划分：白班 08:00–20:00、夜班 20:00–次日 08:00。 */

export type Shift = '白班' | '夜班'

export function shiftOf(date: string, time = '12:00'): Shift {
  const hour = Number((time || '12:00').split(':')[0])
  return hour >= 8 && hour < 20 ? '白班' : '夜班'
}

/**
 * 同一班次键：夜班跨过零点，归属到「开工日」那一天
 * （00:00–08:00 与前一天 20:00–24:00 算同一个夜班）。
 */
export function shiftKey(date: string, time = '12:00'): string {
  const day = date.slice(0, 10)
  const hour = Number((time || '12:00').split(':')[0])
  if (hour >= 0 && hour < 8) {
    const d = new Date(`${day}T00:00:00`)
    d.setDate(d.getDate() - 1)
    const prev = d.toISOString().slice(0, 10)
    return `${prev} 夜班`
  }
  return `${day} ${shiftOf(date, time)}`
}

/** 同一轴承同一班次的检测只算一次。 */
export function sameShift(
  dateA: string,
  shiftA: string,
  dateB: string,
  timeB: string,
): boolean {
  return dateA === dateB && shiftA === shiftOf(dateB, timeB)
}
