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
  /** The current cell is on this row (any column). */
  rowActive: boolean
  /** The row is marked (`markedRowIds`). */
  marked: boolean
}

/** What `renderRow` and `renderGroupRow` get. */
export interface RowContext<T> {
  row: T
  rowIndex: number
  rowId: string
  /** The row is selected (in a selected range). */
  selected: boolean
  /** The current cell is on this row. */
  rowActive: boolean
  marked: boolean
}

export interface TypeAheadOptions<T> {
  /** The column searched. Default: the first sorted column, else the current column. */
  columnId?: string
  /** Milliseconds without typing before the typed text resets. Default 1000. */
  timeout?: number
  /** Whether a row matches the typed text. Default: the column's text starts with it (no case, no accents). */
  match?: (row: T, text: string) => boolean
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
  /** An async `onCellEdit` is running: the editor stays open and should not take input. */
  pending: boolean
  /** Times `onCellEdit` refused a value in this edit (`false` or a rejected promise): the editor stays open. */
  rejections: number
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
  /** Footer cell content for each of the grid's `footerRows`. Default: the formatted value. */
  footer?: (row: T) => ReactNode
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
  /**
   * A cell edit. Return `false` to keep the editor open (invalid value). A promise keeps the editor open
   * (`pending`) until it settles: `false` or a rejection keeps it open, anything else commits and moves.
   */
  onCellEdit?: (change: CellChange<T>) => void | boolean | Promise<void | boolean>
  /** Enter on an editable cell starts editing it (before `onRowActivate`). Default `false`. */
  enterEdits?: boolean
  /**
   * Where Enter / Tab go after an edit (and Enter / Tab when not editing, if they move): `cell`, the next
   * cell below / right (default); `editable`, the next editable cell in reading order (Shift: previous),
   * wrapping into the next row, like a legacy entry grid (code, qty, price, discount, next item).
   */
  editNext?: 'cell' | 'editable'
  /** After an edit that moves, start editing the cell it moves to (when editable). Default `false`. */
  keepEditing?: boolean
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
  /** Legacy Home / End: first / last row in both modes; Ctrl+Home / Ctrl+End keep the column. Default `false`. */
  homeEndRows?: boolean
  /**
   * Type-ahead seek: typing (when it does not start an edit) jumps to the first row whose text starts with
   * the typed characters; Backspace removes the last one, Esc clears them. Default `false`.
   */
  typeAhead?: boolean | TypeAheadOptions<T>
  /** The typed type-ahead text changed (`''`: cleared), to show it. */
  onTypeAheadChange?: (text: string) => void
  /** Marked rows (by row id), shown with `--rdg-marked-*` and `data-marked`. Independent of the selection. */
  markedRowIds?: ReadonlySet<string> | readonly string[]
  /**
   * Group / heading rows: drawn across the whole width (`renderGroupRow`, default the first column's text),
   * skipped by the keyboard, never selected, copied or edited. Sort them yourself (`manualSorting`).
   */
  isGroupRow?: (row: T, rowIndex: number) => boolean
  renderGroupRow?: (context: RowContext<T>) => ReactNode
  /** Rows fixed under the body (totals), drawn with each column's `footer` or formatted value. */
  footerRows?: readonly T[]
  /** Show the header row. Default `true`. */
  showHeader?: boolean
  /**
   * Custom row content across the whole width instead of the cells (a menu, cards). The row keeps the grid's
   * selection, keys and mouse handling.
   */
  renderRow?: (context: RowContext<T>) => ReactNode
  /** A single click activates the row (`onRowActivate`), like a menu. Default `false`. */
  activateOnClick?: boolean
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

/** Imperative handle (`ref`). `T`: the row type (`any` by default, so an untyped ref fits any grid). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DataGridHandle<T = any> {
  focus: () => void
  scrollToRow: (rowIndex: number) => void
  /** Scrolls a cell into view (both directions) without moving the current cell. */
  scrollToCell: (cell: CellPosition) => void
  /** Moves the current cell to a row, keeping the column (the nearest navigable row). */
  setActiveRow: (rowIndex: number) => void
  /** The displayed index of the first row (from `from`) matching, or -1. */
  findRow(predicate: (row: T, rowIndex: number) => boolean, from?: number): number
  /** The displayed index of a row id, or -1. */
  getRowIndex: (rowId: string) => number
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
  getDisplayedRows: () => readonly T[]
  /** Column changes a host menu can offer (all reach `onColumnStateChange`). */
  moveColumn: (columnId: string, toIndex: number) => void
  /** `null` restores the column's own width. */
  setColumnWidth: (columnId: string, width: number | null) => void
  setColumnHidden: (columnId: string, hidden: boolean) => void
  setColumnFrozen: (columnId: string, frozen: 'start' | 'end' | null) => void
}
