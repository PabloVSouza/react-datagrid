import { clamp } from './selection'
import type { CellPosition, SelectionMode } from './types'

export interface NavigationInput {
  key: string
  ctrl: boolean
  cell: CellPosition
  rowCount: number
  colCount: number
  pageSize: number
  mode: SelectionMode
  /**
   * Legacy (xBase browse) Home / End: first / last row in both modes, and Ctrl+Home / Ctrl+End keep the
   * column. Default `false` (desktop grid: the row's first / last cell in cell mode).
   */
  homeEndRows?: boolean
  /** Rows the current cell may land on (group / heading rows may not). Default: all. */
  isNavigable?: (row: number) => boolean
}

/**
 * Where a navigation key takes the current cell (desktop grid model, like WinForms DataGridView and WPF
 * DataGrid); `null` when the key does not navigate.
 *
 * - arrows: one cell; Ctrl+arrow: to the edge of the grid in that direction
 * - Home / End: first / last column of the row (cell mode); first / last row (row mode, like a list)
 * - Ctrl+Home / Ctrl+End: first / last cell of the grid
 * - with `homeEndRows`: Home / End and Ctrl+Home / Ctrl+End go to the first / last row, same column
 * - PageUp / PageDown: one page of rows; Ctrl+PageUp / Ctrl+PageDown: first / last row
 *
 * A row that is not navigable is skipped: the nearest navigable row in the direction of the move, else
 * the other way.
 */
export const navigate = ({
  key,
  ctrl,
  cell,
  rowCount,
  colCount,
  pageSize,
  mode,
  homeEndRows = false,
  isNavigable
}: NavigationInput): CellPosition | null => {
  if (rowCount === 0 || colCount === 0) return null
  const lastRow = rowCount - 1
  const lastCol = colCount - 1
  const to = (row: number, col: number): CellPosition | null => {
    const target = clamp(row, 0, lastRow)
    const found = nearestNavigable(target, target < cell.row ? -1 : 1, rowCount, isNavigable)
    return found < 0 ? null : { row: found, col: clamp(col, 0, lastCol) }
  }
  switch (key) {
    case 'ArrowUp':
      return to(ctrl ? 0 : cell.row - 1, cell.col)
    case 'ArrowDown':
      return to(ctrl ? lastRow : cell.row + 1, cell.col)
    case 'ArrowLeft':
      return to(cell.row, ctrl ? 0 : cell.col - 1)
    case 'ArrowRight':
      return to(cell.row, ctrl ? lastCol : cell.col + 1)
    case 'Home':
      if (homeEndRows) return to(0, cell.col)
      if (ctrl) return to(0, 0)
      return mode === 'row' ? to(0, cell.col) : to(cell.row, 0)
    case 'End':
      if (homeEndRows) return to(lastRow, cell.col)
      if (ctrl) return to(lastRow, lastCol)
      return mode === 'row' ? to(lastRow, cell.col) : to(cell.row, lastCol)
    case 'PageUp':
      return to(ctrl ? 0 : cell.row - Math.max(1, pageSize), cell.col)
    case 'PageDown':
      return to(ctrl ? lastRow : cell.row + Math.max(1, pageSize), cell.col)
    default:
      return null
  }
}

/**
 * The navigable row nearest to `row`: itself, else searching in `direction` (1 down, -1 up), else the other
 * way; -1 when there is none.
 */
export const nearestNavigable = (
  row: number,
  direction: 1 | -1,
  rowCount: number,
  isNavigable?: (row: number) => boolean
): number => {
  if (!isNavigable) return row
  for (const step of [direction, -direction]) {
    for (let index = row; index >= 0 && index < rowCount; index += step)
      if (isNavigable(index)) return index
  }
  return -1
}

/**
 * Tab / Shift+Tab: next / previous cell, wrapping to the next / previous row; `null` past the ends. `accept`
 * limits the cells it stops on (navigable rows, editable cells).
 */
export const tabTarget = (
  cell: CellPosition,
  backwards: boolean,
  rowCount: number,
  colCount: number,
  accept?: (cell: CellPosition) => boolean
): CellPosition | null => {
  const total = rowCount * colCount
  for (
    let index = cell.row * colCount + cell.col + (backwards ? -1 : 1);
    index >= 0 && index < total;
    index += backwards ? -1 : 1
  ) {
    const next = { row: Math.floor(index / colCount), col: index % colCount }
    if (!accept || accept(next)) return next
  }
  return null
}

/** Type-ahead text compared without case and accents. */
export const normalizeSeek = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()

/** A key that starts editing by typing (a printable character without Ctrl / Meta / Alt). */
export const isTypingKey = (event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
