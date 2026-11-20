import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  type Ref
} from 'react'
import {
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState
} from '@tanstack/react-table'
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { DefaultEditor } from './DefaultEditor'
import { parseTsv, toTsv } from './clipboard'
import { isTypingKey, navigate, nearestNavigable, normalizeSeek, tabTarget } from './keyboard'
import {
  boundsOf,
  cellSelected,
  clamp,
  clampRanges,
  inBounds,
  normalizeRanges,
  rowSelected,
  sameCell,
  single
} from './selection'
import type {
  CellChange,
  CellPosition,
  CellRange,
  ColumnState,
  DataGridColumn,
  DataGridHandle,
  DataGridProps,
  EditMove,
  RowContext,
  SortItem
} from './types'

/** TanStack Table: column order, widths, visibility, pinning and sorting. */
const features = tableFeatures({
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel()
})

const DEFAULT_WIDTH = 150
const DEFAULT_MIN_WIDTH = 40
const LONG_PRESS_MS = 550
const TYPE_AHEAD_MS = 1000

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof (value as PromiseLike<unknown>).then === 'function'

/** A value that is controlled when the prop is not `undefined`, else kept inside. */
function useControlled<V>(
  controlled: V | undefined,
  initial: () => V,
  onChange: ((value: V) => void) | undefined
): [V, (value: V) => void] {
  const [inner, setInner] = useState(initial)
  const isControlled = controlled !== undefined
  const set = useCallback(
    (value: V) => {
      if (!isControlled) setInner(() => value)
      onChange?.(value)
    },
    [isControlled, onChange]
  )
  return [isControlled ? controlled : inner, set]
}

export const defaultCompare = (a: unknown, b: unknown): number => {
  if (a == null || a === '') return b == null || b === '' ? 0 : -1
  if (b == null || b === '') return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

const valueOf = <T,>(column: DataGridColumn<T>, row: T): unknown =>
  column.value ? column.value(row) : (row as Record<string, unknown>)[column.id]

const textOf = <T,>(column: DataGridColumn<T>, row: T, value = valueOf(column, row)): string =>
  column.format ? column.format(value, row) : value == null ? '' : String(value)

const canEditColumn = <T,>(column: DataGridColumn<T> | undefined, row: T | undefined) =>
  !!column &&
  row !== undefined &&
  (typeof column.editable === 'function' ? column.editable(row) : !!column.editable)

const initialColumnState = <T,>(
  columns: readonly DataGridColumn<T>[],
  partial: Partial<ColumnState> | undefined
): ColumnState => ({
  order: partial?.order ?? columns.map((column) => column.id),
  widths: partial?.widths ?? {},
  hidden: partial?.hidden ?? columns.filter((column) => column.hidden).map((column) => column.id),
  frozenStart:
    partial?.frozenStart ??
    columns.filter((column) => column.frozen === 'start').map((column) => column.id),
  frozenEnd:
    partial?.frozenEnd ??
    columns.filter((column) => column.frozen === 'end').map((column) => column.id)
})

interface VisibleColumn<T> {
  def: DataGridColumn<T>
  width: number
  pinned: false | 'start' | 'end'
  /** Sticky offset of a frozen column. */
  offset: number
}

interface EditingState {
  row: number
  col: number
  initialText?: string
  pending?: boolean
  rejections?: number
}

function DataGridInner<T extends RowData>(
  props: DataGridProps<T>,
  ref: ForwardedRef<DataGridHandle<T>>
) {
  const {
    rows,
    columns,
    getRowId,
    selectionMode = 'row',
    multiSelect = true,
    rowHeight = 32,
    overscan = 8,
    editable = false,
    manualSorting = false,
    tabBehavior = selectionMode === 'cell' ? 'cell' : 'leave',
    homeEndRows = false,
    editNext = 'cell',
    showHeader = true
  } = props
  const headerHeight = showHeader ? (props.headerHeight ?? rowHeight) : 0
  const footerRows = props.footerRows ?? []
  const footerHeight = footerRows.length * rowHeight
  // ARIA row numbers start at 1, with the header row first when shown.
  const rowBase = showHeader ? 2 : 1
  const gridId = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── State (each one controlled or not) ──
  const [columnState, setColumnState] = useControlled<ColumnState>(
    props.columnState,
    () => initialColumnState(columns, props.defaultColumnState),
    props.onColumnStateChange
  )
  const [sorting, setSorting] = useControlled<readonly SortItem[]>(
    props.sorting,
    () => props.defaultSorting ?? [],
    props.onSortingChange as ((value: readonly SortItem[]) => void) | undefined
  )
  // `undefined` inside: the first cell once there are rows.
  const [activeInner, setActiveInner] = useState<CellPosition | null | undefined>(
    props.defaultActiveCell
  )
  const [rangesInner, setRangesInner] = useState<readonly CellRange[]>(
    () => props.defaultSelection ?? []
  )
  const [editing, setEditing] = useState<EditingState | null>(null)

  // ── TanStack Table: sorted rows and the visible columns in order ──
  const columnDefs = useMemo<ColumnDef<typeof features, T, unknown>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: (row: T) => valueOf(column, row),
        header: column.id,
        size: column.width ?? DEFAULT_WIDTH,
        minSize: column.minWidth ?? DEFAULT_MIN_WIDTH,
        maxSize: column.maxWidth ?? Number.MAX_SAFE_INTEGER,
        enableSorting: column.sortable ?? true,
        enableHiding: column.hideable ?? true,
        sortFn: (a, b, id) => (column.compare ?? defaultCompare)(a.getValue(id), b.getValue(id))
      })),
    [columns]
  )
  const tableSorting = useMemo<SortingState>(
    () => sorting.map((item) => ({ id: item.columnId, desc: item.direction === 'desc' })),
    [sorting]
  )
  const tableState = useMemo(
    () => ({
      sorting: tableSorting,
      columnOrder: columnState.order,
      columnSizing: columnState.widths,
      columnVisibility: Object.fromEntries(columnState.hidden.map((id) => [id, false])),
      columnPinning: { start: columnState.frozenStart, end: columnState.frozenEnd }
    }),
    [tableSorting, columnState]
  )
  const table = useTable({
    features,
    columns: columnDefs,
    data: rows as T[],
    getRowId: (row: T, index: number) => getRowId(row, index),
    state: tableState,
    manualSorting
  })
  const displayed = table.getRowModel().rows
  const displayedRows = useMemo(() => displayed.map((row) => row.original), [displayed])
  const byId = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns])
  const visibleColumns: VisibleColumn<T>[] = [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns()
  ].flatMap((column) => {
    const def = byId.get(column.id)
    if (!def) return []
    const pinned = column.getIsPinned()
    return [
      {
        def,
        width: column.getSize(),
        pinned,
        offset:
          pinned === 'start'
            ? column.getStart('start')
            : pinned === 'end'
              ? column.getAfter('end')
              : 0
      }
    ]
  })
  const rowCount = displayedRows.length
  const colCount = visibleColumns.length
  const { isGroupRow } = props
  const groupFlags = useMemo(
    () => (isGroupRow ? displayedRows.map((row, index) => isGroupRow(row, index)) : null),
    [displayedRows, isGroupRow]
  )
  const isNavigable = useMemo(
    () => (groupFlags ? (row: number) => !groupFlags[row] : undefined),
    [groupFlags]
  )
  const marked = useMemo(
    () => (props.markedRowIds ? new Set(props.markedRowIds) : null),
    [props.markedRowIds]
  )

  // ── Current cell and selection, kept inside the grid ──
  const activeControlled =
    props.activeRowIndex !== undefined
      ? props.activeRowIndex < 0
        ? null
        : { row: props.activeRowIndex, col: activeInner?.col ?? 0 }
      : props.activeCell !== undefined
        ? props.activeCell
        : (activeInner ?? undefined)
  const firstRow = rowCount > 0 ? nearestNavigable(0, 1, rowCount, isNavigable) : -1
  const rawActive =
    activeControlled === undefined
      ? firstRow >= 0 && colCount > 0
        ? { row: firstRow, col: 0 }
        : null
      : activeControlled
  const active: CellPosition | null =
    rawActive && rowCount > 0 && colCount > 0
      ? { row: clamp(rawActive.row, 0, rowCount - 1), col: clamp(rawActive.col, 0, colCount - 1) }
      : null
  const rangesSource = props.selection ?? rangesInner
  // The selection always holds the current cell (a host that moves the current cell resets it).
  const ranges: CellRange[] = useMemo(() => {
    const fitted = clampRanges(rangesSource, rowCount, colCount)
    const last = fitted.at(-1)
    const valid = active && last && inBounds(boundsOf(last), active.row, active.col)
    const base = valid ? fitted : active ? [single(active)] : []
    return normalizeRanges(base, selectionMode, colCount)
  }, [rangesSource, rowCount, colCount, active?.row, active?.col, selectionMode])

  const latest = useRef({
    active,
    ranges,
    rowCount,
    colCount,
    displayedRows,
    visibleColumns,
    editing,
    groupFlags
  })
  latest.current = {
    active,
    ranges,
    rowCount,
    colCount,
    displayedRows,
    visibleColumns,
    editing,
    groupFlags
  }

  const setActive = useCallback(
    (cell: CellPosition | null) => {
      const previous = latest.current.active
      setActiveInner(cell)
      const row = cell ? latest.current.displayedRows[cell.row] : undefined
      props.onActiveCellChange?.(cell, row)
      if (cell && cell.row !== previous?.row) props.onActiveRowChange?.(cell.row, row)
    },
    [props.onActiveCellChange, props.onActiveRowChange]
  )
  const setRanges = useCallback(
    (next: CellRange[]) => {
      setRangesInner(next)
      props.onSelectionChange?.(next)
    },
    [props.onSelectionChange]
  )

  // ── Virtual rows ──
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
    scrollPaddingEnd: footerHeight,
    // A scroller with no size yet (not laid out, a hidden window, a test DOM without layout) still
    // renders the rows a screen would show, instead of none.
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) =>
        callback(rect.height > 0 ? rect : { width: rect.width, height: window.innerHeight || 600 })
      )
  })

  const scrollIntoView = useCallback(
    (cell: CellPosition) => {
      virtualizer.scrollToIndex(cell.row, { align: 'auto' })
      const scroller = scrollRef.current
      const column = latest.current.visibleColumns[cell.col]
      if (!scroller || !column || column.pinned) return
      let left = 0
      let startPinned = 0
      let endPinned = 0
      for (const [index, item] of latest.current.visibleColumns.entries()) {
        if (index < cell.col) left += item.width
        if (item.pinned === 'start') startPinned += item.width
        if (item.pinned === 'end') endPinned += item.width
      }
      const viewStart = scroller.scrollLeft + startPinned
      const viewEnd = scroller.scrollLeft + scroller.clientWidth - endPinned
      if (left < viewStart) scroller.scrollLeft = left - startPinned
      else if (left + column.width > viewEnd)
        scroller.scrollLeft = left + column.width - scroller.clientWidth + endPinned
    },
    [virtualizer]
  )

  /** Moves the current cell: alone, extending the last range (Shift) or adding a range (Ctrl). */
  const moveTo = useCallback(
    (cell: CellPosition, how: 'replace' | 'extend' | 'add' = 'replace') => {
      const { ranges: current } = latest.current
      if (how === 'extend' && multiSelect && current.length > 0) {
        const last = current.at(-1)!
        setRanges([...current.slice(0, -1), { anchor: last.anchor, focus: cell }])
      } else if (how === 'add' && multiSelect) {
        setRanges([...current, single(cell)])
      } else setRanges([single(cell)])
      if (!sameCell(latest.current.active, cell)) setActive(cell)
      scrollIntoView(cell)
    },
    [multiSelect, setActive, setRanges, scrollIntoView]
  )

  const selectAll = useCallback(() => {
    const { rowCount: count, colCount: cols, active: current } = latest.current
    if (!multiSelect || count === 0 || cols === 0) return
    const all = { anchor: { row: 0, col: 0 }, focus: { row: count - 1, col: cols - 1 } }
    setRanges([all])
    if (!current) setActive({ row: 0, col: 0 })
  }, [multiSelect, setActive, setRanges])

  // ── Clipboard ──
  const getSelectionText = useCallback(() => {
    const { ranges: current, displayedRows: data, visibleColumns: cols } = latest.current
    const blocks = [...current]
      .map(boundsOf)
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((bounds) => {
        const matrix: string[][] = []
        for (let row = bounds.top; row <= bounds.bottom; row++) {
          const item = data[row]
          if (item === undefined || latest.current.groupFlags?.[row]) continue
          const line: string[] = []
          for (let col = bounds.left; col <= bounds.right; col++) {
            const column = cols[col]
            if (column) line.push(textOf(column.def, item))
          }
          matrix.push(line)
        }
        return toTsv(matrix)
      })
    return blocks.join('\n')
  }, [])

  const commitChanges = useCallback(
    (changes: CellChange<T>[]) => {
      if (changes.length === 0) return
      if (props.onPaste) props.onPaste(changes)
      else for (const change of changes) props.onCellEdit?.(change)
    },
    [props.onPaste, props.onCellEdit]
  )

  const paste = useCallback(
    (text: string) => {
      const {
        ranges: current,
        active: at,
        displayedRows: data,
        visibleColumns: cols
      } = latest.current
      if (!editable || !at) return
      const matrix = parseTsv(text)
      if (matrix.length === 0) return
      const last = current.at(-1)
      const bounds = last
        ? boundsOf(last)
        : { top: at.row, bottom: at.row, left: at.col, right: at.col }
      // One value into a larger selection fills it (as spreadsheets do); else the block from the top-left cell.
      const fill = matrix.length === 1 && matrix[0]!.length === 1
      const height = fill ? bounds.bottom - bounds.top + 1 : matrix.length
      const width = fill
        ? bounds.right - bounds.left + 1
        : Math.max(...matrix.map((line) => line.length))
      const changes: CellChange<T>[] = []
      for (let r = 0; r < height; r++) {
        const rowIndex = bounds.top + r
        const row = data[rowIndex]
        if (row === undefined) break
        if (latest.current.groupFlags?.[rowIndex]) continue
        for (let c = 0; c < width; c++) {
          const column = cols[bounds.left + c]?.def
          const source = fill ? matrix[0]![0] : matrix[r]?.[c]
          if (!column || source === undefined || !canEditColumn(column, row)) continue
          const value = column.parse ? column.parse(source, row) : source
          if (value === undefined) continue
          changes.push({
            row,
            rowIndex,
            rowId: getRowId(row, rowIndex),
            columnId: column.id,
            value,
            previousValue: valueOf(column, row)
          })
        }
      }
      commitChanges(changes)
      const bottom = Math.min(bounds.top + height - 1, data.length - 1)
      const right = Math.min(bounds.left + width - 1, cols.length - 1)
      setRanges([
        { anchor: { row: bounds.top, col: bounds.left }, focus: { row: bottom, col: right } }
      ])
      setActive({ row: bounds.top, col: bounds.left })
    },
    [editable, commitChanges, getRowId, setActive, setRanges]
  )

  // ── Editing ──
  const startEdit = useCallback(
    (initialText?: string, cell?: CellPosition) => {
      const { displayedRows: data, visibleColumns: cols } = latest.current
      const at = cell ?? latest.current.active
      if (!editable || !at || latest.current.groupFlags?.[at.row]) return false
      if (!canEditColumn(cols[at.col]?.def, data[at.row])) return false
      scrollIntoView(at)
      setEditing({ row: at.row, col: at.col, initialText })
      return true
    },
    [editable, scrollIntoView]
  )

  const navigableCell = (cell: CellPosition) => !latest.current.groupFlags?.[cell.row]
  const editableCell = (cell: CellPosition) =>
    navigableCell(cell) &&
    canEditColumn(
      latest.current.visibleColumns[cell.col]?.def,
      latest.current.displayedRows[cell.row]
    )

  const stepFrom = (cell: CellPosition, move: EditMove): CellPosition | null => {
    const { rowCount: count, colCount: cols } = latest.current
    if (move === 'none') return null
    if (editNext === 'editable')
      return tabTarget(cell, move === 'up' || move === 'left', count, cols, editableCell)
    if (move === 'down' || move === 'up') {
      const step = move === 'down' ? 1 : -1
      for (let row = cell.row + step; row >= 0 && row < count; row += step)
        if (navigableCell({ row, col: cell.col })) return { row, col: cell.col }
      return null
    }
    return tabTarget(cell, move === 'left', count, cols, navigableCell)
  }

  /** Closes the editor and moves; `keepEditing` edits the next cell. */
  const finishEdit = (from: CellPosition, move: EditMove, cancelled: boolean) => {
    setEditing(null)
    rootRef.current?.focus({ preventScroll: true })
    const next = cancelled ? null : stepFrom(from, move)
    if (!next) return
    moveTo(next)
    if (props.keepEditing) startEdit(undefined, next)
  }

  const endEdit = useCallback(
    (value: unknown, move: EditMove = 'none', cancelled = false) => {
      const current = latest.current.editing
      if (!current || current.pending) return
      const row = latest.current.displayedRows[current.row]
      const column = latest.current.visibleColumns[current.col]?.def
      const reject = () => {
        const editingNow = latest.current.editing
        if (editingNow?.row !== current.row || editingNow.col !== current.col) return
        const rejected = {
          ...current,
          pending: false,
          rejections: (current.rejections ?? 0) + 1
        }
        latest.current.editing = rejected
        setEditing(rejected)
      }
      if (!cancelled && row !== undefined && column) {
        const previousValue = valueOf(column, row)
        if (!Object.is(previousValue, value)) {
          const result = props.onCellEdit?.({
            row,
            rowIndex: current.row,
            rowId: getRowId(row, current.row),
            columnId: column.id,
            value,
            previousValue
          })
          if (result === false) return reject()
          if (isThenable(result)) {
            const waiting = { ...current, pending: true }
            latest.current.editing = waiting
            setEditing(waiting)
            result.then(
              (settled) => {
                if (latest.current.editing !== waiting) return
                if (settled === false) reject()
                else finishEdit(current, move, false)
              },
              () => {
                if (latest.current.editing === waiting) reject()
              }
            )
            return
          }
        }
      }
      finishEdit(current, move, cancelled)
    },
    [props.onCellEdit, getRowId, moveTo, startEdit, editNext, props.keepEditing]
  )

  // ── Type-ahead seek ──
  const seekText = useRef('')
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeAhead = props.typeAhead ? (props.typeAhead === true ? {} : props.typeAhead) : null
  const setSeek = (text: string) => {
    if (seekTimer.current) clearTimeout(seekTimer.current)
    seekTimer.current = null
    if (seekText.current !== text) {
      seekText.current = text
      props.onTypeAheadChange?.(text)
    }
    if (text && typeAhead)
      seekTimer.current = setTimeout(() => setSeek(''), typeAhead.timeout ?? TYPE_AHEAD_MS)
  }
  useEffect(
    () => () => {
      if (seekTimer.current) clearTimeout(seekTimer.current)
    },
    []
  )
  /** The first navigable row matching the text, or -1. */
  const seekRow = (text: string): number => {
    if (!typeAhead || !active) return -1
    const columnId =
      typeAhead.columnId ?? sorting[0]?.columnId ?? visibleColumns[active.col]?.def.id
    const column = columnId ? byId.get(columnId) : undefined
    const wanted = normalizeSeek(text)
    for (let index = 0; index < rowCount; index++) {
      if (groupFlags?.[index]) continue
      const row = displayedRows[index]!
      const hit = typeAhead.match
        ? typeAhead.match(row, text)
        : !!column && normalizeSeek(textOf(column, row)).startsWith(wanted)
      if (hit) return index
    }
    return -1
  }
  const seekTo = (text: string) => {
    const index = seekRow(text)
    if (index >= 0 && active) moveTo({ row: index, col: active.col })
    return index >= 0
  }

  // ── Keyboard ──
  const pageSize = () => {
    const height = scrollRef.current?.clientHeight ?? 0
    return Math.max(1, Math.floor((height - headerHeight - footerHeight) / rowHeight) || 10)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(event, {
      activeCell: active,
      activeRow: active ? displayedRows[active.row] : undefined,
      editing: !!editing
    })
    if (event.defaultPrevented || editing) return
    if (event.target !== rootRef.current) return
    const ctrl = event.ctrlKey || event.metaKey
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (ctrl && (event.key === 'a' || event.key === 'A')) {
      if (!multiSelect) return
      selectAll()
      return handled()
    }
    if (ctrl && (event.key === 'c' || event.key === 'C')) {
      // The native copy event (onCopy) fills the clipboard; this covers webviews without one.
      const text = getSelectionText()
      navigator.clipboard?.writeText(text).catch(() => undefined)
      return
    }
    if (!active) return
    const target = navigate({
      key: event.key,
      ctrl,
      cell: active,
      rowCount,
      colCount,
      pageSize: pageSize(),
      mode: selectionMode,
      homeEndRows,
      isNavigable
    })
    if (target) {
      if (seekText.current) setSeek('')
      moveTo(target, event.shiftKey ? 'extend' : 'replace')
      return handled()
    }
    switch (event.key) {
      case 'Tab': {
        if (tabBehavior !== 'cell' || ctrl || event.altKey) return
        const next =
          editNext === 'editable'
            ? stepFrom(active, event.shiftKey ? 'left' : 'right')
            : tabTarget(active, event.shiftKey, rowCount, colCount, navigableCell)
        if (!next) return
        moveTo(next)
        return handled()
      }
      case 'Backspace':
        if (!typeAhead || !seekText.current) return
        setSeek(seekText.current.slice(0, -1))
        if (seekText.current) seekTo(seekText.current)
        return handled()
      case 'Enter': {
        if (ctrl || event.altKey) return
        if (props.enterEdits && !event.shiftKey && startEdit()) return handled()
        const row = displayedRows[active.row]
        if (props.onRowActivate && row !== undefined && !event.shiftKey) {
          props.onRowActivate(row, active.row)
          return handled()
        }
        if (!editable) return
        const next = stepFrom(active, event.shiftKey ? 'up' : 'down')
        if (next) moveTo(next)
        return handled()
      }
      case 'F2':
        if (startEdit()) handled()
        return
      case 'Escape':
        if (seekText.current) {
          setSeek('')
          handled()
        } else if (
          ranges.length > 1 ||
          (ranges[0] && !sameRangeAsCell(ranges[0], active, selectionMode))
        ) {
          moveTo(active)
          handled()
        }
        return
      default: {
        if (!isTypingKey(event)) return
        if (startEdit(event.key)) return handled()
        if (!typeAhead || (event.key === ' ' && !seekText.current)) return
        const text = seekText.current + event.key
        // No match: the typed text stays as it was (the legacy seek ignores the key).
        if (seekTo(text)) setSeek(text)
        else setSeek(seekText.current)
        handled()
      }
    }
  }

  // ── Mouse and touch ──
  const dragging = useRef(false)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const stop = () => {
      dragging.current = false
    }
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mouseup', stop)
      if (longPress.current) clearTimeout(longPress.current)
    }
  }, [])

  const onCellMouseDown = (event: ReactMouseEvent, cell: CellPosition) => {
    if (event.button !== 0) return
    if (groupFlags?.[cell.row]) return
    if (editing && sameCell(editing, cell)) return
    if (!editing) rootRef.current?.focus({ preventScroll: true })
    const how = event.shiftKey ? 'extend' : event.ctrlKey || event.metaKey ? 'add' : 'replace'
    moveTo(cell, how)
    dragging.current = multiSelect && how !== 'add'
    // No text selection while selecting cells.
    event.preventDefault()
  }
  const onCellMouseEnter = (cell: CellPosition) => {
    if (dragging.current && !groupFlags?.[cell.row]) moveTo(cell, 'extend')
  }
  const onCellClick = (event: ReactMouseEvent, cell: CellPosition) => {
    const row = displayedRows[cell.row]
    if (!props.activateOnClick || row === undefined || groupFlags?.[cell.row]) return
    if (event.shiftKey || event.ctrlKey || event.metaKey) return
    props.onRowActivate?.(row, cell.row)
  }
  const onCellDoubleClick = (cell: CellPosition) => {
    const row = displayedRows[cell.row]
    if (row === undefined || groupFlags?.[cell.row]) return
    if (editable && canEditColumn(visibleColumns[cell.col]?.def, row)) {
      if (!sameCell(active, cell)) moveTo(cell)
      startEdit(undefined, cell)
    } else if (!props.activateOnClick) props.onRowActivate?.(row, cell.row)
  }
  const onCellContextMenu = (event: ReactMouseEvent, cell: CellPosition) => {
    const row = displayedRows[cell.row]
    if (!props.onCellContextMenu || row === undefined || groupFlags?.[cell.row]) return
    event.preventDefault()
    if (!cellSelected(ranges, cell.row, cell.col)) moveTo(cell)
    props.onCellContextMenu(cell, row, { clientX: event.clientX, clientY: event.clientY })
  }
  const onCellTouchStart = (event: ReactTouchEvent, cell: CellPosition) => {
    const touch = event.touches[0]
    if (!props.onCellContextMenu || !touch || event.touches.length > 1) return
    const point = { clientX: touch.clientX, clientY: touch.clientY }
    if (longPress.current) clearTimeout(longPress.current)
    longPress.current = setTimeout(() => {
      longPress.current = null
      const row = latest.current.displayedRows[cell.row]
      if (row === undefined) return
      moveTo(cell)
      props.onCellContextMenu?.(cell, row, point)
    }, LONG_PRESS_MS)
  }
  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current)
    longPress.current = null
  }

  // ── Columns: sort, resize, reorder ──
  const toggleSort = (columnId: string, multi: boolean) => {
    const current = sorting.find((item) => item.columnId === columnId)
    const nextItem: SortItem | null = !current
      ? { columnId, direction: 'asc' }
      : current.direction === 'asc'
        ? { columnId, direction: 'desc' }
        : null
    const others = multi ? sorting.filter((item) => item.columnId !== columnId) : []
    setSorting(nextItem ? [...others, nextItem] : others)
  }

  const columnStateRef = useRef(columnState)
  columnStateRef.current = columnState
  const updateColumns = useCallback(
    (change: (state: ColumnState) => ColumnState) => setColumnState(change(columnStateRef.current)),
    [setColumnState]
  )
  const moveColumn = useCallback(
    (columnId: string, toIndex: number) =>
      updateColumns((state) => {
        const order = [
          ...state.order.filter((id) => byId.has(id)),
          ...columns.map((column) => column.id).filter((id) => !state.order.includes(id))
        ].filter((id) => id !== columnId)
        order.splice(clamp(toIndex, 0, order.length), 0, columnId)
        return { ...state, order }
      }),
    [updateColumns, byId, columns]
  )

  const resizing = useRef<{ id: string; startX: number; startWidth: number } | null>(null)
  const onResizeStart = (event: ReactPointerEvent, column: VisibleColumn<T>) => {
    event.preventDefault()
    event.stopPropagation()
    resizing.current = { id: column.def.id, startX: event.clientX, startWidth: column.width }
    const move = (moveEvent: PointerEvent) => {
      const current = resizing.current
      if (!current) return
      const def = byId.get(current.id)
      const width = clamp(
        Math.round(current.startWidth + moveEvent.clientX - current.startX),
        def?.minWidth ?? DEFAULT_MIN_WIDTH,
        def?.maxWidth ?? Number.MAX_SAFE_INTEGER
      )
      updateColumns((state) => ({ ...state, widths: { ...state.widths, [current.id]: width } }))
    }
    const up = () => {
      resizing.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const headerDrag = useRef<{ id: string; x: number; moved: boolean; over: string | null } | null>(
    null
  )
  const onHeaderPointerDown = (event: ReactPointerEvent, column: VisibleColumn<T>) => {
    if (event.button !== 0) return
    headerDrag.current = { id: column.def.id, x: event.clientX, moved: false, over: null }
    const move = (moveEvent: PointerEvent) => {
      const drag = headerDrag.current
      if (drag && Math.abs(moveEvent.clientX - drag.x) > 4) drag.moved = true
    }
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const drag = headerDrag.current
      headerDrag.current = null
      if (!drag) return
      if (drag.moved && drag.over && drag.over !== drag.id) {
        const from = byId.get(drag.id)
        if (from?.reorderable === false) return
        const target = latest.current.visibleColumns.find((item) => item.def.id === drag.over)
        if (!target || target.def.reorderable === false) return
        // Dropped on a column: takes its place (hidden columns keep theirs).
        const saved = columnStateRef.current.order
        const fullOrder = [
          ...saved.filter((id) => byId.has(id)),
          ...columns.map((item) => item.id).filter((id) => !saved.includes(id))
        ]
        moveColumn(drag.id, fullOrder.indexOf(drag.over))
      } else if (!drag.moved) {
        const def = byId.get(drag.id)
        if (def?.sortable !== false) toggleSort(drag.id, upEvent.shiftKey)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── Imperative handle ──
  const rowIndexById = useRef(new Map<string, number>())
  rowIndexById.current = useMemo(
    () => new Map(displayed.map((row, index) => [row.id, index])),
    [displayed]
  )
  useImperativeHandle(
    ref,
    (): DataGridHandle => ({
      focus: () => rootRef.current?.focus(),
      scrollToRow: (rowIndex) =>
        virtualizer.scrollToIndex(clamp(rowIndex, 0, Math.max(0, latest.current.rowCount - 1))),
      scrollToCell: (cell) => {
        const { rowCount: count, colCount: cols } = latest.current
        if (count === 0 || cols === 0) return
        scrollIntoView({ row: clamp(cell.row, 0, count - 1), col: clamp(cell.col, 0, cols - 1) })
      },
      setActiveRow: (rowIndex) => {
        const {
          rowCount: count,
          colCount: cols,
          active: current,
          groupFlags: groups
        } = latest.current
        if (count === 0 || cols === 0) return
        const target = clamp(rowIndex, 0, count - 1)
        const row = nearestNavigable(
          target,
          1,
          count,
          groups ? (index) => !groups[index] : undefined
        )
        if (row >= 0) moveTo({ row, col: current?.col ?? 0 })
      },
      findRow: (predicate, from = 0) => {
        const data = latest.current.displayedRows
        for (let index = Math.max(0, from); index < data.length; index++)
          if (predicate(data[index]!, index)) return index
        return -1
      },
      getRowIndex: (rowId) => rowIndexById.current.get(rowId) ?? -1,
      getActiveCell: () => latest.current.active,
      setActiveCell: (cell) => (cell ? moveTo(cell) : setActive(null)),
      selectAll,
      getSelectionText,
      paste,
      startEdit: (initialText) => void startEdit(initialText),
      getColumnState: () => columnStateRef.current,
      getDisplayedRows: () => latest.current.displayedRows,
      moveColumn,
      setColumnWidth: (columnId, width) =>
        updateColumns((state) => {
          const widths = { ...state.widths }
          if (width === null) delete widths[columnId]
          else widths[columnId] = width
          return { ...state, widths }
        }),
      setColumnHidden: (columnId, hidden) =>
        updateColumns((state) => ({
          ...state,
          hidden: hidden
            ? [...state.hidden.filter((id) => id !== columnId), columnId]
            : state.hidden.filter((id) => id !== columnId)
        })),
      setColumnFrozen: (columnId, frozen) =>
        updateColumns((state) => ({
          ...state,
          frozenStart:
            frozen === 'start'
              ? [...state.frozenStart.filter((id) => id !== columnId), columnId]
              : state.frozenStart.filter((id) => id !== columnId),
          frozenEnd:
            frozen === 'end'
              ? [...state.frozenEnd.filter((id) => id !== columnId), columnId]
              : state.frozenEnd.filter((id) => id !== columnId)
        }))
    }),
    [
      virtualizer,
      scrollIntoView,
      moveTo,
      setActive,
      selectAll,
      getSelectionText,
      paste,
      startEdit,
      moveColumn,
      updateColumns
    ]
  )

  useEffect(() => {
    // On mount only.
    if (props.autoFocus) rootRef.current?.focus()
  }, [])

  // ── Render ──
  const totalWidth = visibleColumns.reduce((sum, column) => sum + column.width, 0)
  const cellId = (cell: CellPosition) => `${gridId}-r${cell.row}-c${cell.col}`
  const columnStyle = (column: VisibleColumn<T>) => ({
    width: column.width,
    minWidth: column.width,
    flexGrow: column.def.grow ?? 0,
    ...(column.pinned === 'start'
      ? { position: 'sticky' as const, left: column.offset, zIndex: 1 }
      : column.pinned === 'end'
        ? { position: 'sticky' as const, right: column.offset, zIndex: 1 }
        : {})
  })
  const alignClass = (column: DataGridColumn<T>) => `rdg-align-${column.align ?? 'start'}`
  const sortOf = (columnId: string) => sorting.find((item) => item.columnId === columnId)

  const header = showHeader && (
    <div
      role="rowgroup"
      className="rdg-header"
      style={{ height: headerHeight, minWidth: totalWidth }}
    >
      <div role="row" aria-rowindex={1} className="rdg-header-row" style={{ height: headerHeight }}>
        {visibleColumns.map((column, index) => {
          const sort = sortOf(column.def.id)
          return (
            <div
              key={column.def.id}
              role="columnheader"
              aria-colindex={index + 1}
              aria-sort={sort ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
              title={column.def.title}
              data-column-id={column.def.id}
              data-pinned={column.pinned || undefined}
              className={[
                'rdg-header-cell',
                alignClass(column.def),
                column.def.sortable !== false && 'rdg-sortable',
                active?.col === index && 'rdg-header-cell-active',
                column.def.headerClassName
              ]
                .filter(Boolean)
                .join(' ')}
              style={columnStyle(column)}
              onPointerDown={(event) => onHeaderPointerDown(event, column)}
              onPointerEnter={() => {
                if (headerDrag.current) headerDrag.current.over = column.def.id
              }}
            >
              <span className="rdg-header-label">{column.def.header}</span>
              {sort && (
                <span className="rdg-sort-indicator" aria-hidden="true">
                  {sort.direction === 'asc' ? '▲' : '▼'}
                  {sorting.length > 1 ? sorting.indexOf(sort) + 1 : ''}
                </span>
              )}
              {column.def.resizable !== false && (
                <span
                  className="rdg-resize-handle"
                  aria-hidden="true"
                  onPointerDown={(event) => onResizeStart(event, column)}
                  onDoubleClick={() =>
                    updateColumns((state) => {
                      const widths = { ...state.widths }
                      delete widths[column.def.id]
                      return { ...state, widths }
                    })
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const renderCell = (row: T, rowIndex: number, column: VisibleColumn<T>, colIndex: number) => {
    const value = valueOf(column.def, row)
    const text = textOf(column.def, row, value)
    const position = { row: rowIndex, col: colIndex }
    const isActive = sameCell(active, position)
    const selected =
      selectionMode === 'row'
        ? rowSelected(ranges, rowIndex)
        : cellSelected(ranges, rowIndex, colIndex)
    const isEditing = editing?.row === rowIndex && editing.col === colIndex
    const extra =
      typeof column.def.cellClassName === 'function'
        ? column.def.cellClassName(row)
        : column.def.cellClassName
    let content: ReactNode
    if (isEditing) {
      const editorProps = {
        row,
        rowIndex,
        column: column.def,
        value,
        initialText: editing.initialText,
        pending: !!editing.pending,
        rejections: editing.rejections ?? 0,
        commit: (next: unknown, move?: EditMove) => endEdit(next, move),
        cancel: () => {
          if (!latest.current.editing?.pending) endEdit(undefined, 'none', true)
        }
      }
      content = column.def.editor ? (
        <div
          className="rdg-editor-slot"
          onKeyDown={(event) => {
            if (!event.defaultPrevented && event.key === 'Escape') {
              event.preventDefault()
              editorProps.cancel()
            }
            event.stopPropagation()
          }}
        >
          {column.def.editor(editorProps)}
        </div>
      ) : (
        <DefaultEditor
          {...editorProps}
          text={text}
          align={column.def.align ?? 'start'}
          parse={(input) => (column.def.parse ? column.def.parse(input, row) : input)}
        />
      )
    } else if (column.def.cell) {
      content = column.def.cell({
        row,
        rowIndex,
        rowId: getRowId(row, rowIndex),
        column: column.def,
        value,
        text,
        selected,
        active: isActive,
        rowActive: active?.row === rowIndex,
        marked: !!marked?.has(getRowId(row, rowIndex))
      })
    } else content = <span className="rdg-cell-text">{text}</span>
    return (
      <div
        key={column.def.id}
        id={cellId(position)}
        role="gridcell"
        aria-colindex={colIndex + 1}
        aria-selected={selectionMode === 'cell' ? selected : undefined}
        aria-readonly={editable ? !canEditColumn(column.def, row) : undefined}
        title={typeof content === 'string' ? content : undefined}
        data-active={isActive || undefined}
        data-editing={isEditing || undefined}
        data-pinned={column.pinned || undefined}
        className={['rdg-cell', alignClass(column.def), extra].filter(Boolean).join(' ')}
        style={columnStyle(column)}
        onMouseDown={(event) => onCellMouseDown(event, position)}
        onMouseEnter={() => onCellMouseEnter(position)}
        onClick={(event) => onCellClick(event, position)}
        onDoubleClick={() => onCellDoubleClick(position)}
        onContextMenu={(event) => onCellContextMenu(event, position)}
        onTouchStart={(event) => onCellTouchStart(event, position)}
        onTouchMove={cancelLongPress}
        onTouchEnd={cancelLongPress}
      >
        {content}
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  const body =
    rowCount === 0 ? (
      <div className="rdg-empty" role="presentation">
        {props.empty}
      </div>
    ) : (
      <div
        role="rowgroup"
        className="rdg-body"
        style={{ height: virtualizer.getTotalSize(), minWidth: totalWidth }}
      >
        {items.map((item) => {
          const row = displayedRows[item.index]
          if (row === undefined) return null
          const rowIndex = item.index
          const group = !!groupFlags?.[rowIndex]
          const selected = !group && rowSelected(ranges, rowIndex)
          const rowId = getRowId(row, rowIndex)
          const isMarked = !group && !!marked?.has(rowId)
          const rowActive = active?.row === rowIndex
          const context: RowContext<T> = {
            row,
            rowIndex,
            rowId,
            selected,
            rowActive,
            marked: isMarked
          }
          // A group row or a custom row: one cell across the whole width.
          const wide = group || !!props.renderRow
          const position = { row: rowIndex, col: rowActive && active ? active.col : 0 }
          return (
            <div
              key={displayed[rowIndex]?.id ?? rowIndex}
              role="row"
              aria-rowindex={rowIndex + rowBase}
              aria-selected={selectionMode === 'row' && !group ? selected : undefined}
              data-active={(!group && rowActive) || undefined}
              data-marked={isMarked || undefined}
              data-group={group || undefined}
              className={[
                'rdg-row',
                rowIndex % 2 === 1 && 'rdg-row-odd',
                group && 'rdg-group-row',
                isMarked && 'rdg-row-marked',
                props.rowClassName?.(row, rowIndex)
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ height: rowHeight, transform: `translateY(${item.start - headerHeight}px)` }}
            >
              {wide ? (
                <div
                  id={group ? undefined : cellId(position)}
                  role="gridcell"
                  aria-colindex={1}
                  aria-colspan={colCount}
                  aria-selected={!group && selectionMode === 'cell' ? selected : undefined}
                  data-active={(!group && rowActive) || undefined}
                  className={group ? 'rdg-cell rdg-group-cell' : 'rdg-cell rdg-row-content'}
                  style={{ flex: '1 0 auto', minWidth: totalWidth }}
                  onMouseDown={(event) => onCellMouseDown(event, position)}
                  onMouseEnter={() => onCellMouseEnter(position)}
                  onClick={(event) => onCellClick(event, position)}
                  onDoubleClick={() => onCellDoubleClick(position)}
                  onContextMenu={(event) => onCellContextMenu(event, position)}
                  onTouchStart={(event) => onCellTouchStart(event, position)}
                  onTouchMove={cancelLongPress}
                  onTouchEnd={cancelLongPress}
                >
                  {group
                    ? props.renderGroupRow
                      ? props.renderGroupRow(context)
                      : visibleColumns[0] && (
                          <span className="rdg-cell-text">
                            {textOf(visibleColumns[0].def, row)}
                          </span>
                        )
                    : props.renderRow!(context)}
                </div>
              ) : (
                visibleColumns.map((column, colIndex) =>
                  renderCell(row, rowIndex, column, colIndex)
                )
              )}
            </div>
          )
        })}
      </div>
    )

  const footer = footerRows.length > 0 && (
    <div role="rowgroup" className="rdg-footer" style={{ minWidth: totalWidth }}>
      {footerRows.map((row, index) => (
        <div
          key={index}
          role="row"
          aria-rowindex={rowCount + rowBase + index}
          className="rdg-footer-row"
          style={{ height: rowHeight }}
        >
          {visibleColumns.map((column, colIndex) => (
            <div
              key={column.def.id}
              role="gridcell"
              aria-colindex={colIndex + 1}
              data-pinned={column.pinned || undefined}
              className={['rdg-cell', 'rdg-footer-cell', alignClass(column.def)].join(' ')}
              style={columnStyle(column)}
            >
              {column.def.footer ? (
                column.def.footer(row)
              ) : (
                <span className="rdg-cell-text">{textOf(column.def, row)}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <div
      ref={rootRef}
      id={gridId}
      role="grid"
      tabIndex={0}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-rowcount={rowCount + footerRows.length + (showHeader ? 1 : 0)}
      aria-colcount={colCount}
      aria-multiselectable={multiSelect || undefined}
      aria-readonly={!editable || undefined}
      aria-activedescendant={active && !editing ? cellId(active) : undefined}
      data-selection-mode={selectionMode}
      className={['rdg', props.className].filter(Boolean).join(' ')}
      style={props.style}
      onKeyDown={onKeyDown}
      onCopy={(event) => {
        if (editing || event.target !== rootRef.current) return
        event.clipboardData.setData('text/plain', getSelectionText())
        event.preventDefault()
      }}
      onPaste={(event) => {
        if (editing || event.target !== rootRef.current || !editable) return
        event.preventDefault()
        paste(event.clipboardData.getData('text/plain'))
      }}
    >
      <div ref={scrollRef} className="rdg-scroller">
        {header}
        {body}
        {footer}
      </div>
    </div>
  )
}

const sameRangeAsCell = (range: CellRange, cell: CellPosition, mode: 'row' | 'cell') => {
  const bounds = boundsOf(range)
  return mode === 'row'
    ? bounds.top === cell.row && bounds.bottom === cell.row
    : bounds.top === cell.row &&
        bounds.bottom === cell.row &&
        bounds.left === cell.col &&
        bounds.right === cell.col
}

/**
 * Keyboard-first data grid: virtualized rows, row or cell selection with ranges, clipboard, in-place
 * editing, sortable / resizable / reorderable / hideable / frozen columns. See README.
 */
export const DataGrid = forwardRef(DataGridInner) as <T>(
  props: DataGridProps<T> & { ref?: Ref<DataGridHandle<T>> }
) => ReactElement
