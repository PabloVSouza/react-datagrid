# @pablovsouza/react-datagrid

Keyboard-first data grid for React that behaves like a desktop grid (WinForms `DataGridView`, WPF `DataGrid`):

- Virtualized rows: tens of thousands of rows, only the visible ones in the DOM
- Columns: width, min / max, resize (drag the header edge), reorder (drag the header), hide, freeze at the start
  or the end, alignment, value formatting, flexible width
- Sorting: click a header (ascending, descending, none), Shift+click for several columns, custom comparators,
  or server-side (`manualSorting`)
- Row selection (default) or cell selection, with ranges: Shift+arrows, Shift+click, mouse drag, Ctrl+click,
  Ctrl+A
- Clipboard: Ctrl+C copies the selection as tab-separated text (pastes into Excel, LibreOffice, Google Sheets);
  Ctrl+V pastes into editable cells (one value fills the selection)
- In-place editing: F2, double-click or typing starts; Enter / Tab commit and move; Esc cancels; editor slots per
  column; commit / cancel events with validation
- Theming by CSS variables; ARIA `grid` roles; touch (tap, long press, native swipe scrolling)

Status: `0.1.0`, developed against a real ERP (SAPE). Not published yet.

## Installation

```bash
npm install @pablovsouza/react-datagrid
```

Peer dependencies: `react@^19`, `react-dom@^19`. The package ships ES modules for bundlers (Vite, webpack,
Next.js) and its own stylesheet, imported by the entry (no Tailwind or other setup in the app).

## Quick start

```tsx
import { DataGrid, type DataGridColumn } from '@pablovsouza/react-datagrid'

interface Product {
  id: number
  name: string
  stock: number
  price: number
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const columns: DataGridColumn<Product>[] = [
  { id: 'id', header: 'Code', width: 80, align: 'end', frozen: 'start' },
  { id: 'name', header: 'Name', width: 260, grow: 1, editable: true },
  { id: 'stock', header: 'Stock', width: 90, align: 'end' },
  {
    id: 'price',
    header: 'Price',
    width: 120,
    align: 'end',
    format: (value) => money.format(value as number)
  }
]

export function Products({ rows }: { rows: Product[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => String(row.id)}
      onRowActivate={(row) => open(row)}
      aria-label="Products"
      style={{ height: 400 }}
    />
  )
}
```

The grid fills the height you give it (`style`, `className`, or a flex parent) and scrolls inside.

## Why TanStack Table and TanStack Virtual inside

Writing a grid from scratch means re-solving virtualization (scroll anchoring, overscan, `scrollToIndex` with
sticky headers) and the column model (ordering with hidden and pinned columns, sizing, multi-column sorting).
Two mature MIT libraries already do exactly that, headless, with no markup or styles of their own:

- **[TanStack Table](https://tanstack.com/table)** (v9): sorted row model, column order, sizing, visibility and
  pinning. The grid owns the state (controlled or not) and feeds it in.
- **[TanStack Virtual](https://tanstack.com/virtual)** (v3): row virtualization.

What they do not give, this package adds: the desktop keyboard model, the current cell, row / cell selection with
ranges, clipboard, in-place editing, mouse and touch gestures, ARIA, theming. Full grids were considered and
rejected: AG Grid (the useful parts — range selection, clipboard — are in the paid Enterprise edition), MUI X
Data Grid (same: Pro / Premium, plus Material UI), Glide Data Grid (canvas: no DOM cells for custom React
content, harder ARIA), react-data-grid (closest fit, MIT, but its keyboard and selection model is not a desktop
grid's and cell ranges are not built in). Wrapping headless engines keeps the behaviour ours and the hard generic
parts maintained by others.

## Columns

```ts
interface DataGridColumn<T> {
  id: string // unique, stable (state, sorting, events)
  header: ReactNode
  value?: (row: T) => unknown // default row[id]; used by sort, copy, paste, default cell
  format?: (value: unknown, row: T) => string // shown and copied text
  cell?: (context: CellContext<T>) => ReactNode // custom content
  width?: number // default 150
  minWidth?: number // default 40
  maxWidth?: number
  grow?: number // share of extra width (flex-grow)
  align?: 'start' | 'center' | 'end'
  sortable?: boolean // default true
  resizable?: boolean // default true
  reorderable?: boolean // default true
  hideable?: boolean // default true
  hidden?: boolean // initial
  frozen?: 'start' | 'end' // initial
  compare?: (a: unknown, b: unknown) => number // ascending; default: numbers, dates, natural text
  editable?: boolean | ((row: T) => boolean)
  editor?: (props: EditorProps<T>) => ReactNode // default: text input
  parse?: (text: string, row: T) => unknown // typed / pasted text to value; undefined rejects
  title?: string // header tooltip
  headerClassName?: string
  cellClassName?: string | ((row: T) => string | undefined)
}
```

`CellContext<T>`: `{ row, rowIndex, rowId, column, value, text, selected, active }`.

## Props

| Prop                                                               | Type                           | Default                                    |                                                                                              |
| ------------------------------------------------------------------ | ------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `rows`                                                             | `readonly T[]`                 |                                            | Keep the array stable between renders.                                                       |
| `columns`                                                          | `readonly DataGridColumn<T>[]` |                                            | Keep stable (module scope or `useMemo`).                                                     |
| `getRowId`                                                         | `(row, index) => string`       |                                            |                                                                                              |
| `selectionMode`                                                    | `'row' \| 'cell'`              | `'row'`                                    |                                                                                              |
| `multiSelect`                                                      | `boolean`                      | `true`                                     | Ranges, Ctrl+click, Ctrl+A.                                                                  |
| `activeCell` / `defaultActiveCell` / `onActiveCellChange`          | `CellPosition \| null`         | first cell                                 | Controlled or not.                                                                           |
| `activeRowIndex` / `onActiveRowChange`                             | `number`                       |                                            | Row-mode shortcut for the current row (`-1`: none).                                          |
| `selection` / `defaultSelection` / `onSelectionChange`             | `CellRange[]`                  |                                            | The ranges always contain the current cell.                                                  |
| `sorting` / `defaultSorting` / `onSortingChange`                   | `SortItem[]`                   | `[]`                                       | `{ columnId, direction }`.                                                                   |
| `manualSorting`                                                    | `boolean`                      | `false`                                    | Rows come sorted (server side).                                                              |
| `columnState` / `defaultColumnState` / `onColumnStateChange`       | `ColumnState`                  | from columns                               | `{ order, widths, hidden, frozenStart, frozenEnd }`: persist it to remember a user's layout. |
| `rowHeight` / `headerHeight`                                       | `number`                       | `32` / row height                          | Pixels.                                                                                      |
| `overscan`                                                         | `number`                       | `8`                                        | Rows rendered beyond the visible ones.                                                       |
| `editable`                                                         | `boolean`                      | `false`                                    | Turns on editing and paste for `editable` columns.                                           |
| `onCellEdit`                                                       | `(change) => void \| false`    |                                            | `false` keeps the editor open.                                                               |
| `onPaste`                                                          | `(changes) => void`            | one `onCellEdit` per cell                  |                                                                                              |
| `onRowActivate`                                                    | `(row, rowIndex) => void`      |                                            | Enter and double-click (on cells that are not edited).                                       |
| `onCellContextMenu`                                                | `(cell, row, point) => void`   |                                            | Right-click and long press.                                                                  |
| `onKeyDown`                                                        | `(event, context) => void`     |                                            | Runs first; `event.preventDefault()` stops the grid handling the key.                        |
| `tabBehavior`                                                      | `'cell' \| 'leave'`            | `cell` mode: `'cell'`, row mode: `'leave'` |                                                                                              |
| `rowClassName`                                                     | `(row, rowIndex) => string`    |                                            |                                                                                              |
| `empty`                                                            | `ReactNode`                    |                                            | Shown without rows.                                                                          |
| `aria-label`, `aria-labelledby`, `className`, `style`, `autoFocus` |                                |                                            |                                                                                              |

`CellChange<T>`: `{ row, rowIndex, rowId, columnId, value, previousValue }`. Row indexes are positions in the
displayed (sorted) rows.

## Handle (`ref`)

```ts
const grid = useRef<DataGridHandle>(null)
grid.current.focus()
grid.current.scrollToRow(500)
grid.current.getActiveCell() // { row, col } | null
grid.current.setActiveCell({ row: 0, col: 2 })
grid.current.selectAll()
grid.current.getSelectionText() // what Ctrl+C copies
grid.current.paste('a\tb\n1\t2') // what Ctrl+V does
grid.current.startEdit()
grid.current.getDisplayedRows()
grid.current.getColumnState()
grid.current.moveColumn('price', 0)
grid.current.setColumnWidth('name', 300) // null: back to the column's width
grid.current.setColumnHidden('stock', true)
grid.current.setColumnFrozen('id', 'start') // or 'end', null
```

## Keyboard

| Key                      | Row mode                                   | Cell mode                                               |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| ↑ ↓                      | previous / next row                        | cell above / below                                      |
| ← →                      | current column (scrolls sideways)          | cell left / right                                       |
| Ctrl+arrow               | first / last row or column                 | edge of the grid in that direction                      |
| Home / End               | first / last row                           | first / last cell of the row                            |
| Ctrl+Home / Ctrl+End     | first / last row                           | first / last cell of the grid                           |
| PageUp / PageDown        | one page of rows                           | one page of rows                                        |
| Shift + any of the above | extends the range                          | extends the range                                       |
| Tab / Shift+Tab          | leaves the grid (`tabBehavior`)            | next / previous cell, wrapping rows; leaves at the ends |
| Enter / Shift+Enter      | `onRowActivate`; else (editable) down / up | the same                                                |
| F2 / typing              | edits the current cell (editable columns)  | the same                                                |
| Esc                      | collapses a range; else not handled        | the same                                                |
| Ctrl+A                   | selects all                                | selects all                                             |
| Ctrl+C / Ctrl+V          | copies / pastes                            | copies / pastes                                         |

While editing (default editor): Enter / Shift+Enter commit and move down / up, Tab / Shift+Tab commit and move
right / left, Esc cancels, leaving the cell commits. Custom editors call `commit(value, move)` and `cancel()`;
the slot cancels on Esc unless the editor called `preventDefault()` (an open dropdown, say).

Keys the grid does not use (F-keys, Insert, Delete, Space, Esc with nothing to collapse…) bubble normally, so
window or app shortcuts keep working. Keys it handles are stopped (`preventDefault` + `stopPropagation`).
Ctrl means Cmd on macOS.

## Mouse and touch

Click selects (Shift extends, Ctrl / Cmd adds a range), dragging across cells selects a range, double-click edits
or activates, right-click calls `onCellContextMenu`. Header click sorts, dragging a header onto another moves it
there, dragging the header edge resizes and double-clicking it restores the width. On touch screens a tap
selects, a long press (550 ms) calls `onCellContextMenu`, and scrolling is the browser's own (both axes).

## Theming

Set the variables on `.rdg`, a parent or `:root`:

| Variable                                                   | Default                       |                                            |
| ---------------------------------------------------------- | ----------------------------- | ------------------------------------------ |
| `--rdg-bg`, `--rdg-fg`                                     | `Canvas`, `CanvasText`        | Grid colours.                              |
| `--rdg-border`                                             | 14% text colour               | Row and header lines.                      |
| `--rdg-header-bg`, `--rdg-header-fg`                       |                               |                                            |
| `--rdg-row-odd-bg`, `--rdg-row-hover-bg`                   |                               | Striping, hover.                           |
| `--rdg-selected-bg`, `--rdg-selected-fg`                   | `Highlight`, `HighlightText`  | Selected rows.                             |
| `--rdg-selected-bg-inactive`, `--rdg-selected-fg-inactive` | the same                      | Selected rows while the grid has no focus. |
| `--rdg-range-bg`, `--rdg-range-fg`                         | 22% selection colour, inherit | Cell mode ranges.                          |
| `--rdg-active-outline`                                     | selection colour              | Current cell (cell mode).                  |
| `--rdg-editor-bg`, `--rdg-editor-fg`, `--rdg-invalid`      |                               | Editor.                                    |
| `--rdg-font-size`, `--rdg-cell-padding`                    | inherit, `0 8px`              |                                            |

Mapping an app's theme, e.g. one with its own selection variables:

```css
.rdg {
  --rdg-bg: var(--background);
  --rdg-fg: var(--foreground);
  --rdg-border: var(--border);
  --rdg-selected-bg: var(--app-selected-bg);
  --rdg-selected-fg: var(--app-selected-fg);
}
```

The base styles are in the CSS layer `rdg`, so any app stylesheet overrides them. The selected-row text colour
is deliberately unlayered: whatever colour a cell sets for itself (status colours, utility classes such as
Tailwind's `text-*`), selected text takes `--rdg-selected-fg` and never disappears into the selection
background. Change the colour through the variables.

## Accessibility

`role="grid"` with `aria-rowcount` / `aria-colcount` (all rows, not just the rendered ones), `aria-multiselectable`,
`aria-readonly`; header `role="columnheader"` with `aria-sort`; rows `role="row"` with `aria-rowindex` and
`aria-selected` (row mode); cells `role="gridcell"` with `aria-colindex`, `aria-selected` (cell mode) and
`aria-readonly` (editable grids). The grid keeps the focus and points at the current cell with
`aria-activedescendant`, so screen readers follow it through virtualization.

## Development

```bash
npm install
npm test           # vitest + Testing Library (jsdom)
npm run typecheck
npm run build      # dist/: ES modules, .d.ts, styles.css
npm run format:check
```

## License

MIT
