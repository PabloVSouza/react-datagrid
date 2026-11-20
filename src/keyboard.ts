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
}

/**
 * Where a navigation key takes the current cell (desktop grid model, like WinForms DataGridView and WPF
 * DataGrid); `null` when the key does not navigate.
 *
 * - arrows: one cell; Ctrl+arrow: to the edge of the grid in that direction
 * - Home / End: first / last column of the row (cell mode); first / last row (row mode, like a list)
 * - Ctrl+Home / Ctrl+End: first / last cell of the grid
 * - PageUp / PageDown: one page of rows
 */
export const navigate = ({
  key,
  ctrl,
  cell,
  rowCount,
  colCount,
  pageSize,
  mode
}: NavigationInput): CellPosition | null => {
  if (rowCount === 0 || colCount === 0) return null
  const lastRow = rowCount - 1
  const lastCol = colCount - 1
  const to = (row: number, col: number) => ({
    row: clamp(row, 0, lastRow),
    col: clamp(col, 0, lastCol)
  })
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
      if (ctrl) return to(0, 0)
      return mode === 'row' ? to(0, cell.col) : to(cell.row, 0)
    case 'End':
      if (ctrl) return to(lastRow, lastCol)
      return mode === 'row' ? to(lastRow, cell.col) : to(cell.row, lastCol)
    case 'PageUp':
      return to(cell.row - Math.max(1, pageSize), cell.col)
    case 'PageDown':
      return to(cell.row + Math.max(1, pageSize), cell.col)
    default:
      return null
  }
}

/** Tab / Shift+Tab: next / previous cell, wrapping to the next / previous row; `null` past the ends. */
export const tabTarget = (
  cell: CellPosition,
  backwards: boolean,
  rowCount: number,
  colCount: number
): CellPosition | null => {
  const index = cell.row * colCount + cell.col + (backwards ? -1 : 1)
  if (index < 0 || index >= rowCount * colCount) return null
  return { row: Math.floor(index / colCount), col: index % colCount }
}

/** A key that starts editing by typing (a printable character without Ctrl / Meta / Alt). */
export const isTypingKey = (event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
