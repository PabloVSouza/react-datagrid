import type { CellPosition, CellRange, SelectionMode } from './types'

export interface Bounds {
  top: number
  bottom: number
  left: number
  right: number
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export const boundsOf = (range: CellRange): Bounds => ({
  top: Math.min(range.anchor.row, range.focus.row),
  bottom: Math.max(range.anchor.row, range.focus.row),
  left: Math.min(range.anchor.col, range.focus.col),
  right: Math.max(range.anchor.col, range.focus.col)
})

export const single = (cell: CellPosition): CellRange => ({ anchor: cell, focus: cell })

/** Row mode: a range always covers every column. */
export const fullRows = (range: CellRange, colCount: number): CellRange => ({
  anchor: { row: range.anchor.row, col: 0 },
  focus: { row: range.focus.row, col: Math.max(0, colCount - 1) }
})

export const normalizeRanges = (
  ranges: readonly CellRange[],
  mode: SelectionMode,
  colCount: number
): CellRange[] => (mode === 'row' ? ranges.map((range) => fullRows(range, colCount)) : [...ranges])

export const inBounds = (bounds: Bounds, row: number, col: number) =>
  row >= bounds.top && row <= bounds.bottom && col >= bounds.left && col <= bounds.right

export const cellSelected = (ranges: readonly CellRange[], row: number, col: number) =>
  ranges.some((range) => inBounds(boundsOf(range), row, col))

export const rowSelected = (ranges: readonly CellRange[], row: number) =>
  ranges.some((range) => {
    const bounds = boundsOf(range)
    return row >= bounds.top && row <= bounds.bottom
  })

/** Ranges that still fit after the rows or columns changed (removed rows, hidden columns). */
export const clampRanges = (
  ranges: readonly CellRange[],
  rowCount: number,
  colCount: number
): CellRange[] => {
  if (rowCount === 0 || colCount === 0) return []
  const fit = (cell: CellPosition): CellPosition => ({
    row: clamp(cell.row, 0, rowCount - 1),
    col: clamp(cell.col, 0, colCount - 1)
  })
  return ranges.map((range) => ({ anchor: fit(range.anchor), focus: fit(range.focus) }))
}

export const sameCell = (a: CellPosition | null | undefined, b: CellPosition | null | undefined) =>
  a === b || (!!a && !!b && a.row === b.row && a.col === b.col)

export const sameRanges = (a: readonly CellRange[], b: readonly CellRange[]) =>
  a.length === b.length &&
  a.every(
    (range, index) =>
      sameCell(range.anchor, b[index]?.anchor) && sameCell(range.focus, b[index]?.focus)
  )

/** Rows covered by the ranges, ascending, without repeats. */
export const selectedRowIndexes = (ranges: readonly CellRange[]): number[] => {
  const rows = new Set<number>()
  for (const range of ranges) {
    const bounds = boundsOf(range)
    for (let row = bounds.top; row <= bounds.bottom; row++) rows.add(row)
  }
  return [...rows].sort((a, b) => a - b)
}
