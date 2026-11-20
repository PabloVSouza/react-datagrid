import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

/** A cell position: row index in the displayed (sorted) rows, column index in the displayed columns. */
export interface CellPosition {
  row: number
  col: number
}

/** A rectangle of cells; `anchor` is where the range started, `focus` where it ends (either order). */
export interface CellRange {
  anchor: CellPosition
  focus: CellPosition
}

/** `row`: whole rows are selected (list windows). `cell`: the current cell and cell ranges (spreadsheets, reports). */
export type SelectionMode = 'row' | 'cell'

export type ColumnAlign = 'start' | 'center' | 'end'

export type SortDirection = 'asc' | 'desc'

export interface SortItem {
  columnId: string
  direction: SortDirection
}

/** Order, widths, hidden and frozen columns: what a user can change and a host may persist. */
export interface ColumnState {
  order: string[]
  widths: Record<string, number>
  hidden: string[]
  frozenStart: string[]
  frozenEnd: string[]
}

export interface CellContext<T> {
  row: T
  rowIndex: number
  rowId: string
  column: DataGridColumn<T>
  value: unknown
  /** The text of the value (`format`, else `String(value)`): what is copied. */
  text: string
  /** The row is selected (row mode) or the cell is in a selected range (cell mode). */
  selected: boolean
  /** The current cell. */
  active: boolean
}

export interface EditorProps<T> {
  row: T
  rowIndex: number
  column: DataGridColumn<T>
  value: unknown
  /** The text that started the edit (typing a character), replacing the value; else undefined (F2, double-click). */
  initialText?: string
  /**
   * Ends the edit with a value. `move` is where the current cell goes next (`down` after Enter, `right` after
   * Tab…); default `none`.
   */
  commit: (value: unknown, move?: EditMove) => void
  cancel: () => void
}

export type EditMove = 'none' | 'down' | 'up' | 'right' | 'left'

export interface DataGridColumn<T> {
  /** Unique, stable: used for column state, sorting and edit events. */
  id: string
  header: ReactNode
  /** The cell's value: used by sorting, copy, paste and the default cell. Default: `row[id]`. */
  value?: (row: T) => unknown
  /** The text of a value (money, dates…): shown by the default cell and copied. */
  format?: (value: unknown, row: T) => string
  /** Custom cell content. Default: the formatted text. */
  cell?: (context: CellContext<T>) => ReactNode
  /** Width in pixels (default 150), minimum (default 40) and maximum. */
  width?: number
  minWidth?: number
  maxWidth?: number
  /** Extra width share when the grid is wider than its columns (CSS flex-grow). */
  grow?: number
  align?: ColumnAlign
  /** Defaults: `true`. Frozen columns cannot be dragged into the scrolling part. */
  sortable?: boolean
  resizable?: boolean
  reorderable?: boolean
  hideable?: boolean
  /** Initial state (uncontrolled `columnState`): hidden, frozen at the start or the end. */
  hidden?: boolean
  frozen?: 'start' | 'end'
  /** Ascending comparison of two values (the grid reverses it for descending). */
  compare?: (a: unknown, b: unknown) => number
  /** Editable cells (the grid's `editable` must be on too). */
  editable?: boolean | ((row: T) => boolean)
  /** Editor slot. Default: a text input whose text goes through `parse`. */
  editor?: (props: EditorProps<T>) => ReactNode
  /** Text (typed or pasted) to value. Default: the text itself. Return `undefined` to reject it. */
  parse?: (text: string, row: T) => unknown
  /** Header tooltip. */
  title?: string
  headerClassName?: string
  cellClassName?: string | ((row: T) => string | undefined)
}

export interface CellChange<T> {
  row: T
  rowIndex: number
  rowId: string
  columnId: string
  value: unknown
  previousValue: unknown
}

/** What a host key handler gets: the grid's state at the key press. */
export interface GridKeyContext<T> {
  activeCell: CellPosition | null
  activeRow: T | undefined
  editing: boolean
}

export interface DataGridProps<T> {
  rows: readonly T[]
  columns: readonly DataGridColumn<T>[]
  getRowId: (row: T, index: number) => string
  /** Default `row`. */
  selectionMode?: SelectionMode
  /** Ranges (Shift+arrows, Shift+click, drag, Ctrl+click, Ctrl+A). Default `true`. */
  multiSelect?: boolean
  /** Current cell, controlled (`null`: none) or initial. Row indexes are in displayed order. */
  activeCell?: CellPosition | null
  defaultActiveCell?: CellPosition | null
  onActiveCellChange?: (cell: CellPosition | null, row: T | undefined) => void
  /**
   * Row mode convenience: the current row, controlled (`-1`: none), the column staying inside the grid; and
   * its change. Takes precedence over `activeCell`.
   */
  activeRowIndex?: number
  onActiveRowChange?: (rowIndex: number, row: T | undefined) => void
  /** Selected ranges, controlled or initial. */
  selection?: readonly CellRange[]
  defaultSelection?: readonly CellRange[]
  onSelectionChange?: (ranges: CellRange[]) => void
  /** Sorting, controlled or initial. `manualSorting`: the rows come sorted (server side). */
  sorting?: readonly SortItem[]
  defaultSorting?: readonly SortItem[]
  onSortingChange?: (sorting: SortItem[]) => void
  manualSorting?: boolean
  /** Column order, widths, hidden and frozen columns, controlled or initial. */
  columnState?: ColumnState
  defaultColumnState?: Partial<ColumnState>
  onColumnStateChange?: (state: ColumnState) => void
  /** Pixels. Default 32 (rows) and the row height (header). */
  rowHeight?: number
  headerHeight?: number
  /** Rows rendered beyond the visible ones. Default 8. */
  overscan?: number
  /** Turns editing (and paste) on for the columns marked `editable`. */
  editable?: boolean
  /** A cell edit. Return `false` to keep the editor open (invalid value). */
  onCellEdit?: (change: CellChange<T>) => void | boolean
  /** A paste into editable cells. Default: one `onCellEdit` per cell. */
  onPaste?: (changes: CellChange<T>[]) => void
  /** Enter (when not editing a cell) and double-click on a row that cannot be edited. */
  onRowActivate?: (row: T, rowIndex: number) => void
  /** Context menu or long press (touch) on a cell. */
  onCellContextMenu?: (
    cell: CellPosition,
    row: T,
    event: { clientX: number; clientY: number }
  ) => void
  /**
   * Host keys, before the grid's. Call `event.preventDefault()` to stop the grid handling the key. Keys the
   * grid does not use (F-keys, Insert, Delete…) are never stopped, so window shortcuts keep working.
   */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>, context: GridKeyContext<T>) => void
  /** Tab: `cell` moves between cells (cell mode default); `leave` lets focus go to the next control (row mode default). */
  tabBehavior?: 'cell' | 'leave'
  rowClassName?: (row: T, rowIndex: number) => string | undefined
  /** Shown when there are no rows. */
  empty?: ReactNode
  /** Accessible name. */
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
  style?: CSSProperties
  /** Focus the grid on mount. */
  autoFocus?: boolean
}

/** Imperative handle (`ref`). */
export interface DataGridHandle {
  focus: () => void
  scrollToRow: (rowIndex: number) => void
  getActiveCell: () => CellPosition | null
  setActiveCell: (cell: CellPosition | null) => void
  selectAll: () => void
  /** The selection as tab-separated text (what Ctrl+C copies). */
  getSelectionText: () => string
  /** Pastes tab-separated text at the current cell (what Ctrl+V does). */
  paste: (text: string) => void
  /** Starts editing the current cell. */
  startEdit: (initialText?: string) => void
  getColumnState: () => ColumnState
  /** The rows in displayed (sorted) order. */
  getDisplayedRows: () => readonly unknown[]
  /** Column changes a host menu can offer (all reach `onColumnStateChange`). */
  moveColumn: (columnId: string, toIndex: number) => void
  /** `null` restores the column's own width. */
  setColumnWidth: (columnId: string, width: number | null) => void
  setColumnHidden: (columnId: string, hidden: boolean) => void
  setColumnFrozen: (columnId: string, frozen: 'start' | 'end' | null) => void
}
