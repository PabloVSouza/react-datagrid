import { createRef, useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataGrid } from '../src'
import type { CellChange, DataGridColumn, DataGridHandle, DataGridProps } from '../src'

interface Item {
  id: number
  name: string
  qty: number
  price: number
}

const makeRows = (count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Item ${String(index + 1).padStart(4, '0')}`,
    qty: (index * 7) % 13,
    price: (index + 1) * 1.5
  }))

const columns: DataGridColumn<Item>[] = [
  { id: 'id', header: 'Code', width: 80, align: 'end' },
  { id: 'name', header: 'Name', width: 200, editable: true },
  {
    id: 'qty',
    header: 'Qty',
    width: 80,
    align: 'end',
    editable: true,
    parse: (text) => (/^\d+$/.test(text) ? Number(text) : undefined)
  },
  { id: 'price', header: 'Price', width: 100, format: (value) => (value as number).toFixed(2) }
]

const setup = (props: Partial<DataGridProps<Item>> = {}, count = 5) => {
  const ref = createRef<DataGridHandle>()
  const utils = render(
    <DataGrid<Item>
      ref={ref}
      rows={makeRows(count)}
      columns={columns}
      getRowId={(row) => String(row.id)}
      aria-label="Items"
      {...props}
    />
  )
  const grid = screen.getByRole('grid')
  return { ...utils, ref, grid }
}

const press = (element: Element, key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(element, { key, ...init })
const cellAt = (grid: HTMLElement, row: number, col: number) => {
  const rowElement = grid.querySelector(`[role=row][aria-rowindex="${row + 2}"]`)
  if (!rowElement) throw new Error(`row ${row} not rendered`)
  return rowElement.querySelectorAll('[role=gridcell]')[col] as HTMLElement
}
const activeId = (grid: HTMLElement) => grid.getAttribute('aria-activedescendant')
const activeCell = (grid: HTMLElement) => {
  const id = activeId(grid)
  const match = id?.match(/-r(\d+)-c(\d+)$/)
  return match ? { row: Number(match[1]), col: Number(match[2]) } : null
}
const selectedRows = (grid: HTMLElement) =>
  [...grid.querySelectorAll('[role=row][aria-selected=true]')].map(
    (row) => Number(row.getAttribute('aria-rowindex')) - 2
  )
const selectedCells = (grid: HTMLElement) =>
  [...grid.querySelectorAll('[role=gridcell][aria-selected=true]')].map((cell) =>
    cell.id.replace(/^.*-r/, 'r')
  )

describe('rendering and ARIA', () => {
  it('renders a grid with headers, rows and cells, formatted', () => {
    const { grid } = setup()
    expect(grid.getAttribute('aria-label')).toBe('Items')
    expect(grid.getAttribute('aria-rowcount')).toBe('6')
    expect(grid.getAttribute('aria-colcount')).toBe('4')
    expect(grid.getAttribute('aria-multiselectable')).toBe('true')
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual(['Code', 'Name', 'Qty', 'Price'])
    expect(cellAt(grid, 0, 3).textContent).toBe('1.50')
    expect(cellAt(grid, 2, 1).textContent).toBe('Item 0003')
    expect(cellAt(grid, 0, 0).className).toContain('rdg-align-end')
  })

  it('virtualizes: 10 000 rows render only the visible ones (plus overscan)', () => {
    const { grid } = setup({}, 10_000)
    const rendered = grid.querySelectorAll('[role=row][aria-rowindex]').length - 1
    expect(rendered).toBeGreaterThan(5)
    expect(rendered).toBeLessThan(40)
    expect(grid.getAttribute('aria-rowcount')).toBe('10001')
  })

  it('shows the empty content without rows, and no current cell', () => {
    const { grid } = setup({ empty: 'Nothing here' }, 0)
    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(activeId(grid)).toBeNull()
  })

  it('custom cells get value, text, selected and active', () => {
    const cell = vi.fn(
      ({ text, selected, active }) => `${text}${selected ? '*' : ''}${active ? '!' : ''}`
    )
    const { grid } = setup({
      columns: [{ id: 'name', header: 'Name', cell }]
    })
    expect(cellAt(grid, 0, 0).textContent).toBe('Item 0001*!')
    expect(cellAt(grid, 1, 0).textContent).toBe('Item 0002')
  })

  it('applies row classes from the host', () => {
    const { grid } = setup({ rowClassName: (row) => (row.qty === 0 ? 'zero' : undefined) })
    expect(grid.querySelector('[aria-rowindex="2"]')!.className).toContain('zero')
    expect(grid.querySelector('[aria-rowindex="3"]')!.className).not.toContain('zero')
  })
})

describe('row mode (default)', () => {
  it('starts on the first row and moves with the arrows, Home / End, PageUp / PageDown', () => {
    const onActiveRowChange = vi.fn()
    const { grid } = setup({ onActiveRowChange }, 50)
    expect(selectedRows(grid)).toEqual([0])
    press(grid, 'ArrowDown')
    press(grid, 'ArrowDown')
    expect(selectedRows(grid)).toEqual([2])
    expect(onActiveRowChange).toHaveBeenLastCalledWith(2, expect.objectContaining({ id: 3 }))
    press(grid, 'End')
    expect(activeCell(grid)?.row).toBe(49)
    press(grid, 'Home')
    expect(activeCell(grid)?.row).toBe(0)
    press(grid, 'PageDown')
    expect(activeCell(grid)?.row).toBe(10)
    press(grid, 'PageUp')
    expect(activeCell(grid)?.row).toBe(0)
  })

  it('selects row ranges with Shift+arrows and Shift+click; Escape collapses them', () => {
    const { grid } = setup({}, 10)
    press(grid, 'ArrowDown', { shiftKey: true })
    press(grid, 'ArrowDown', { shiftKey: true })
    expect(selectedRows(grid)).toEqual([0, 1, 2])
    press(grid, 'Escape')
    expect(selectedRows(grid)).toEqual([2])
    fireEvent.mouseDown(cellAt(grid, 5, 1), { shiftKey: true })
    expect(selectedRows(grid)).toEqual([2, 3, 4, 5])
  })

  it('adds rows with Ctrl+click and selects all with Ctrl+A', () => {
    const { grid } = setup({}, 6)
    fireEvent.mouseDown(cellAt(grid, 3, 0), { ctrlKey: true })
    expect(selectedRows(grid)).toEqual([0, 3])
    press(grid, 'a', { ctrlKey: true })
    expect(selectedRows(grid)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('without multiSelect only one row is ever selected', () => {
    const { grid } = setup({ multiSelect: false }, 6)
    press(grid, 'ArrowDown', { shiftKey: true })
    fireEvent.mouseDown(cellAt(grid, 3, 0), { ctrlKey: true })
    press(grid, 'a', { ctrlKey: true })
    expect(selectedRows(grid)).toEqual([3])
    expect(grid.getAttribute('aria-multiselectable')).toBeNull()
  })

  it('Enter and double-click activate the row', () => {
    const onRowActivate = vi.fn()
    const { grid } = setup({ onRowActivate })
    press(grid, 'ArrowDown')
    press(grid, 'Enter')
    expect(onRowActivate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2 }), 1)
    fireEvent.doubleClick(cellAt(grid, 3, 0))
    expect(onRowActivate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 4 }), 3)
  })

  it('a controlled row follows the host', () => {
    const Host = () => {
      const [index, setIndex] = useState(2)
      return (
        <>
          <button onClick={() => setIndex(0)}>reset</button>
          <DataGrid<Item>
            rows={makeRows(10)}
            columns={columns}
            getRowId={(row) => String(row.id)}
            activeRowIndex={index}
            onActiveRowChange={setIndex}
          />
          <output>{index}</output>
        </>
      )
    }
    render(<Host />)
    const grid = screen.getByRole('grid')
    expect(selectedRows(grid)).toEqual([2])
    press(grid, 'ArrowDown')
    expect(screen.getByRole('status').textContent).toBe('3')
    expect(selectedRows(grid)).toEqual([3])
    fireEvent.click(screen.getByText('reset'))
    expect(selectedRows(grid)).toEqual([0])
  })

  it('Tab leaves the grid in row mode (not handled)', () => {
    const { grid } = setup()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    grid.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('host keys', () => {
  it('get the key first and can take it over', () => {
    const onKeyDown = vi.fn((event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') event.preventDefault()
    })
    const { grid } = setup({ onKeyDown })
    press(grid, 'ArrowDown')
    expect(activeCell(grid)?.row).toBe(0)
    expect(onKeyDown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ activeCell: { row: 0, col: 0 }, editing: false })
    )
  })

  it('keys the grid does not use reach the window (F-keys, Insert, Delete)', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={(event) => outer(event.key)}>
        <DataGrid<Item> rows={makeRows(3)} columns={columns} getRowId={(row) => String(row.id)} />
      </div>
    )
    const grid = screen.getByRole('grid')
    for (const key of ['F5', 'Insert', 'Delete', 'F3']) press(grid, key)
    press(grid, 'ArrowDown')
    expect(outer.mock.calls.map(([key]) => key)).toEqual(['F5', 'Insert', 'Delete', 'F3'])
  })

  it('Escape with nothing to collapse reaches the window (closes it)', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={(event) => outer(event.key)}>
        <DataGrid<Item> rows={makeRows(3)} columns={columns} getRowId={(row) => String(row.id)} />
      </div>
    )
    press(screen.getByRole('grid'), 'Escape')
    expect(outer).toHaveBeenCalledWith('Escape')
  })
})

describe('cell mode', () => {
  it('moves the current cell in two dimensions; Home / End stay in the row; Ctrl+End goes to the last cell', () => {
    const { grid } = setup({ selectionMode: 'cell' }, 20)
    press(grid, 'ArrowRight')
    press(grid, 'ArrowDown')
    expect(activeCell(grid)).toEqual({ row: 1, col: 1 })
    expect(cellAt(grid, 1, 1).getAttribute('data-active')).toBe('true')
    press(grid, 'End')
    expect(activeCell(grid)).toEqual({ row: 1, col: 3 })
    press(grid, 'Home')
    expect(activeCell(grid)).toEqual({ row: 1, col: 0 })
    press(grid, 'End', { ctrlKey: true })
    expect(activeCell(grid)).toEqual({ row: 19, col: 3 })
    press(grid, 'Home', { ctrlKey: true })
    expect(activeCell(grid)).toEqual({ row: 0, col: 0 })
  })

  it('Tab / Shift+Tab move across cells and wrap rows; past the end focus leaves', () => {
    const { grid } = setup({ selectionMode: 'cell' }, 2)
    press(grid, 'End')
    press(grid, 'Tab')
    expect(activeCell(grid)).toEqual({ row: 1, col: 0 })
    press(grid, 'Tab', { shiftKey: true })
    expect(activeCell(grid)).toEqual({ row: 0, col: 3 })
    press(grid, 'End', { ctrlKey: true })
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    grid.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('selects a rectangle with Shift+arrows and copies it as TSV', () => {
    const { grid, ref } = setup({ selectionMode: 'cell' })
    press(grid, 'ArrowRight')
    press(grid, 'ArrowRight', { shiftKey: true })
    press(grid, 'ArrowDown', { shiftKey: true })
    expect(selectedCells(grid)).toEqual(['r0-c1', 'r0-c2', 'r1-c1', 'r1-c2'])
    expect(ref.current!.getSelectionText()).toBe('Item 0001\t0\nItem 0002\t7')
  })

  it('selects by dragging the mouse across cells', () => {
    const { grid } = setup({ selectionMode: 'cell' })
    fireEvent.mouseDown(cellAt(grid, 1, 0))
    fireEvent.mouseEnter(cellAt(grid, 2, 1))
    fireEvent.mouseEnter(cellAt(grid, 3, 2))
    fireEvent.mouseUp(window)
    fireEvent.mouseEnter(cellAt(grid, 4, 3))
    expect(selectedCells(grid)).toEqual([
      'r1-c0',
      'r1-c1',
      'r1-c2',
      'r2-c0',
      'r2-c1',
      'r2-c2',
      'r3-c0',
      'r3-c1',
      'r3-c2'
    ])
    expect(activeCell(grid)).toEqual({ row: 3, col: 2 })
  })

  it('copies the current cell with Ctrl+C (native copy event) and a range with Ctrl+A', () => {
    const { grid } = setup({ selectionMode: 'cell' }, 2)
    press(grid, 'ArrowDown')
    press(grid, 'End')
    const setData = vi.fn()
    fireEvent.copy(grid, { clipboardData: { setData, getData: () => '' } })
    expect(setData).toHaveBeenLastCalledWith('text/plain', '3.00')
    press(grid, 'a', { ctrlKey: true })
    fireEvent.copy(grid, { clipboardData: { setData, getData: () => '' } })
    expect(setData).toHaveBeenLastCalledWith(
      'text/plain',
      '1\tItem 0001\t0\t1.50\n2\tItem 0002\t7\t3.00'
    )
  })

  it('Ctrl+C also writes through the async clipboard API when there is one', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { grid } = setup({ selectionMode: 'cell' })
    press(grid, 'c', { ctrlKey: true })
    expect(writeText).toHaveBeenCalledWith('1')
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })

  it('copies whole rows in row mode', () => {
    const { grid, ref } = setup({}, 3)
    press(grid, 'ArrowDown', { shiftKey: true })
    expect(ref.current!.getSelectionText()).toBe('1\tItem 0001\t0\t1.50\n2\tItem 0002\t7\t3.00')
  })
})

describe('editing', () => {
  const editableSetup = (extra: Partial<DataGridProps<Item>> = {}) => {
    const onCellEdit = vi.fn<(change: CellChange<Item>) => void | boolean>()
    const result = setup({ selectionMode: 'cell', editable: true, onCellEdit, ...extra })
    return { ...result, onCellEdit }
  }
  const editor = () => screen.getByRole('textbox') as HTMLInputElement

  it('F2 edits the current cell; Enter commits and moves down', () => {
    const { grid, onCellEdit } = editableSetup()
    press(grid, 'ArrowRight')
    press(grid, 'F2')
    expect(editor().value).toBe('Item 0001')
    fireEvent.change(editor(), { target: { value: 'Renamed' } })
    press(editor(), 'Enter')
    expect(onCellEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowIndex: 0,
        rowId: '1',
        columnId: 'name',
        value: 'Renamed',
        previousValue: 'Item 0001'
      })
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(activeCell(grid)).toEqual({ row: 1, col: 1 })
    expect(document.activeElement).toBe(grid)
  })

  it('typing starts editing with that character; Tab commits and moves right', () => {
    const { grid, onCellEdit } = editableSetup()
    press(grid, 'ArrowRight')
    press(grid, 'ArrowRight')
    press(grid, '4')
    expect(editor().value).toBe('4')
    fireEvent.change(editor(), { target: { value: '42' } })
    press(editor(), 'Tab')
    expect(onCellEdit).toHaveBeenCalledWith(expect.objectContaining({ columnId: 'qty', value: 42 }))
    expect(activeCell(grid)).toEqual({ row: 0, col: 3 })
  })

  it('Escape cancels without an edit event', () => {
    const { grid, onCellEdit } = editableSetup()
    press(grid, 'ArrowRight')
    press(grid, 'x')
    press(editor(), 'Escape')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onCellEdit).not.toHaveBeenCalled()
    expect(activeCell(grid)).toEqual({ row: 0, col: 1 })
  })

  it('an invalid value keeps the editor open, marked invalid', () => {
    const { grid, onCellEdit } = editableSetup()
    press(grid, 'ArrowRight')
    press(grid, 'ArrowRight')
    press(grid, 'F2')
    fireEvent.change(editor(), { target: { value: 'abc' } })
    press(editor(), 'Enter')
    expect(editor().getAttribute('aria-invalid')).toBe('true')
    expect(onCellEdit).not.toHaveBeenCalled()
  })

  it('the host can reject a value (onCellEdit returns false)', () => {
    const { grid, onCellEdit } = editableSetup()
    onCellEdit.mockReturnValue(false)
    press(grid, 'ArrowRight')
    press(grid, 'F2')
    fireEvent.change(editor(), { target: { value: 'No' } })
    press(editor(), 'Enter')
    expect(onCellEdit).toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('leaving the editor commits', () => {
    const { grid, onCellEdit } = editableSetup()
    press(grid, 'ArrowRight')
    press(grid, 'F2')
    fireEvent.change(editor(), { target: { value: 'Blurred' } })
    fireEvent.blur(editor())
    expect(onCellEdit).toHaveBeenCalledWith(expect.objectContaining({ value: 'Blurred' }))
  })

  it('does not edit read-only cells, nor without `editable`', () => {
    const { grid } = editableSetup()
    press(grid, 'F2')
    press(grid, 'x')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(cellAt(grid, 0, 0).getAttribute('aria-readonly')).toBe('true')
    expect(cellAt(grid, 0, 1).getAttribute('aria-readonly')).toBe('false')
  })

  it('editable per row', () => {
    const { grid } = editableSetup({
      columns: [{ id: 'name', header: 'Name', editable: (row) => row.id % 2 === 0 }]
    })
    press(grid, 'F2')
    expect(screen.queryByRole('textbox')).toBeNull()
    press(grid, 'ArrowDown')
    press(grid, 'F2')
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('double-click on an editable cell edits it', () => {
    const { grid } = editableSetup()
    fireEvent.doubleClick(cellAt(grid, 2, 1))
    expect(editor().value).toBe('Item 0003')
  })

  it('custom editors commit and cancel through the slot', () => {
    const { grid, onCellEdit } = editableSetup({
      columns: [
        {
          id: 'qty',
          header: 'Qty',
          editable: true,
          editor: ({ value, commit }) => (
            <button onClick={() => commit((value as number) + 1, 'down')}>plus one</button>
          )
        }
      ]
    })
    press(grid, 'F2')
    fireEvent.click(screen.getByText('plus one'))
    expect(onCellEdit).toHaveBeenCalledWith(expect.objectContaining({ value: 1, previousValue: 0 }))
    expect(activeCell(grid)).toEqual({ row: 1, col: 0 })
    press(grid, 'F2')
    press(screen.getByText('plus one'), 'Escape')
    expect(screen.queryByText('plus one')).toBeNull()
  })

  it('Enter without onRowActivate moves down in an editable grid', () => {
    const { grid } = editableSetup()
    press(grid, 'Enter')
    expect(activeCell(grid)).toEqual({ row: 1, col: 0 })
    press(grid, 'Enter', { shiftKey: true })
    expect(activeCell(grid)).toEqual({ row: 0, col: 0 })
  })
})

describe('paste', () => {
  it('pastes a TSV block from the current cell into editable cells (others skipped)', () => {
    const onPaste = vi.fn()
    const { grid } = setup({ selectionMode: 'cell', editable: true, onPaste })
    press(grid, 'ArrowRight')
    fireEvent.paste(grid, {
      clipboardData: { getData: () => 'A\t5\tignored\nB\tx\n', setData: () => undefined }
    })
    const changes = onPaste.mock.calls[0]![0] as CellChange<Item>[]
    expect(changes.map((c) => [c.rowIndex, c.columnId, c.value])).toEqual([
      [0, 'name', 'A'],
      [0, 'qty', 5],
      [1, 'name', 'B']
    ])
    expect(selectedCells(grid)).toEqual(['r0-c1', 'r0-c2', 'r0-c3', 'r1-c1', 'r1-c2', 'r1-c3'])
  })

  it('one value fills the whole selection; without onPaste each cell goes to onCellEdit', () => {
    const onCellEdit = vi.fn()
    const { grid, ref } = setup({ selectionMode: 'cell', editable: true, onCellEdit })
    press(grid, 'ArrowRight')
    press(grid, 'ArrowDown', { shiftKey: true })
    press(grid, 'ArrowDown', { shiftKey: true })
    act(() => ref.current!.paste('Same'))
    expect(onCellEdit.mock.calls.map(([c]) => [c.rowIndex, c.value])).toEqual([
      [0, 'Same'],
      [1, 'Same'],
      [2, 'Same']
    ])
  })

  it('does nothing in a read-only grid', () => {
    const onCellEdit = vi.fn()
    const { grid } = setup({ selectionMode: 'cell', onCellEdit })
    fireEvent.paste(grid, { clipboardData: { getData: () => 'x', setData: () => undefined } })
    expect(onCellEdit).not.toHaveBeenCalled()
  })
})

describe('sorting', () => {
  const names = (grid: HTMLElement) =>
    [...grid.querySelectorAll('[role=row][aria-rowindex]')]
      .slice(1)
      .map((row) => row.querySelectorAll('[role=gridcell]')[2]!.textContent)
  const clickHeader = (name: string, init: Partial<PointerEventInit> = {}) => {
    const header = screen.getByRole('columnheader', { name })
    fireEvent.pointerDown(header, { button: 0, clientX: 10, ...init })
    fireEvent.pointerUp(window, { clientX: 10, ...init })
    return header
  }

  it('cycles ascending, descending, none on header click', () => {
    const onSortingChange = vi.fn()
    const { grid } = setup({ onSortingChange }, 6)
    expect(names(grid)).toEqual(['0', '7', '1', '8', '2', '9'])
    const header = clickHeader('Qty')
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(names(grid)).toEqual(['0', '1', '2', '7', '8', '9'])
    clickHeader('Qty')
    expect(names(grid)).toEqual(['9', '8', '7', '2', '1', '0'])
    expect(header.getAttribute('aria-sort')).toBe('descending')
    clickHeader('Qty')
    expect(header.getAttribute('aria-sort')).toBeNull()
    expect(onSortingChange).toHaveBeenLastCalledWith([])
  })

  it('sorts by several columns with Shift+click', () => {
    const onSortingChange = vi.fn()
    setup({ onSortingChange })
    clickHeader('Qty')
    clickHeader('Name', { shiftKey: true })
    expect(onSortingChange).toHaveBeenLastCalledWith([
      { columnId: 'qty', direction: 'asc' },
      { columnId: 'name', direction: 'asc' }
    ])
  })

  it('uses the column comparator; manual sorting keeps the given order', () => {
    const reversed = [...makeRows(3)].reverse()
    const byName: DataGridColumn<Item> = {
      id: 'name',
      header: 'Name',
      compare: (a, b) => String(b).localeCompare(String(a))
    }
    const { grid, rerender } = setup({
      columns: [byName],
      rows: makeRows(3),
      defaultSorting: [{ columnId: 'name', direction: 'asc' }]
    })
    expect(cellAt(grid, 0, 0).textContent).toBe('Item 0003')
    rerender(
      <DataGrid<Item>
        rows={reversed}
        columns={[byName]}
        getRowId={(row) => String(row.id)}
        manualSorting
        sorting={[{ columnId: 'name', direction: 'desc' }]}
      />
    )
    expect(cellAt(screen.getByRole('grid'), 0, 0).textContent).toBe('Item 0003')
  })

  it('does not sort columns marked sortable: false', () => {
    const onSortingChange = vi.fn()
    setup({ onSortingChange, columns: [{ id: 'name', header: 'Name', sortable: false }] })
    clickHeader('Name')
    expect(onSortingChange).not.toHaveBeenCalled()
  })
})

describe('columns', () => {
  const headerNames = () => screen.getAllByRole('columnheader').map((header) => header.textContent)

  it('resizes by dragging the header edge, within min / max', () => {
    const onColumnStateChange = vi.fn()
    const { container } = setup({
      onColumnStateChange,
      columns: [{ id: 'name', header: 'Name', width: 200, minWidth: 120, maxWidth: 260 }]
    })
    const handle = container.querySelector('.rdg-resize-handle')!
    fireEvent.pointerDown(handle, { clientX: 200 })
    fireEvent.pointerMove(window, { clientX: 230 })
    expect(onColumnStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ widths: { name: 230 } })
    )
    expect((screen.getByRole('columnheader') as HTMLElement).style.width).toBe('230px')
    fireEvent.pointerMove(window, { clientX: 500 })
    expect(onColumnStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ widths: { name: 260 } })
    )
    fireEvent.pointerMove(window, { clientX: 0 })
    expect(onColumnStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ widths: { name: 120 } })
    )
    fireEvent.pointerUp(window)
    fireEvent.doubleClick(handle)
    expect((screen.getByRole('columnheader') as HTMLElement).style.width).toBe('200px')
  })

  it('reorders by dragging a header onto another', () => {
    setup()
    const code = screen.getByRole('columnheader', { name: 'Code' })
    fireEvent.pointerDown(code, { button: 0, clientX: 10 })
    fireEvent.pointerMove(window, { clientX: 200 })
    fireEvent.pointerEnter(screen.getByRole('columnheader', { name: 'Qty' }))
    fireEvent.pointerUp(window, { clientX: 200 })
    expect(headerNames()).toEqual(['Name', 'Qty', 'Code', 'Price'])
    // A drag is not a click: no sort.
    expect(code.getAttribute('aria-sort')).toBeNull()
  })

  it('hides, shows and freezes columns (initial state and through the handle)', () => {
    const { ref, grid } = setup({
      columns: [
        { ...columns[0]!, hidden: true },
        columns[1]!,
        { ...columns[2]!, frozen: 'end' },
        { ...columns[3]!, frozen: 'start' }
      ]
    })
    expect(headerNames()).toEqual(['Price', 'Name', 'Qty'])
    expect(screen.getByRole('columnheader', { name: 'Price' }).getAttribute('data-pinned')).toBe(
      'start'
    )
    expect(cellAt(grid, 0, 0).style.position).toBe('sticky')
    act(() => ref.current!.setColumnHidden('id', false))
    expect(headerNames()).toEqual(['Price', 'Code', 'Name', 'Qty'])
    act(() => ref.current!.setColumnFrozen('price', null))
    act(() => ref.current!.setColumnFrozen('name', 'start'))
    expect(headerNames()).toEqual(['Name', 'Code', 'Price', 'Qty'])
    act(() => ref.current!.moveColumn('qty', 0))
    act(() => ref.current!.setColumnFrozen('qty', null))
    expect(headerNames()).toEqual(['Name', 'Qty', 'Code', 'Price'])
    expect(ref.current!.getColumnState()).toEqual(
      expect.objectContaining({ hidden: [], frozenStart: ['name'], frozenEnd: [] })
    )
  })

  it('takes a controlled column state', () => {
    setup({
      columnState: {
        order: ['price', 'name', 'id', 'qty'],
        widths: { name: 99 },
        hidden: ['qty'],
        frozenStart: [],
        frozenEnd: []
      }
    })
    expect(headerNames()).toEqual(['Price', 'Name', 'Code'])
    expect(screen.getByRole('columnheader', { name: 'Name' }).style.width).toBe('99px')
  })

  it('keeps the current cell inside the grid when columns or rows go away', () => {
    const { grid, rerender } = setup({ selectionMode: 'cell' }, 5)
    press(grid, 'End', { ctrlKey: true })
    expect(activeCell(grid)).toEqual({ row: 4, col: 3 })
    rerender(
      <DataGrid<Item>
        rows={makeRows(2)}
        columns={columns.slice(0, 2)}
        getRowId={(row) => String(row.id)}
        selectionMode="cell"
      />
    )
    expect(activeCell(screen.getByRole('grid'))).toEqual({ row: 1, col: 1 })
  })
})

describe('context menu and touch', () => {
  it('right-click selects the cell and calls onCellContextMenu', () => {
    const onCellContextMenu = vi.fn()
    const { grid } = setup({ onCellContextMenu })
    fireEvent.contextMenu(cellAt(grid, 2, 1), { clientX: 5, clientY: 6 })
    expect(onCellContextMenu).toHaveBeenCalledWith(
      { row: 2, col: 1 },
      expect.objectContaining({ id: 3 }),
      { clientX: 5, clientY: 6 }
    )
    expect(selectedRows(grid)).toEqual([2])
  })

  it('a long press is a context menu; moving the finger cancels it', () => {
    vi.useFakeTimers()
    try {
      const onCellContextMenu = vi.fn()
      const { grid } = setup({ onCellContextMenu })
      fireEvent.touchStart(cellAt(grid, 1, 0), { touches: [{ clientX: 1, clientY: 2 }] })
      fireEvent.touchMove(cellAt(grid, 1, 0))
      act(() => void vi.advanceTimersByTime(1000))
      expect(onCellContextMenu).not.toHaveBeenCalled()
      fireEvent.touchStart(cellAt(grid, 3, 0), { touches: [{ clientX: 1, clientY: 2 }] })
      act(() => void vi.advanceTimersByTime(600))
      expect(onCellContextMenu).toHaveBeenCalledWith(
        { row: 3, col: 0 },
        expect.objectContaining({ id: 4 }),
        { clientX: 1, clientY: 2 }
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('handle and scrolling', () => {
  it('moves, selects and reports through the ref', () => {
    const { ref, grid } = setup({ selectionMode: 'cell' }, 200)
    act(() => ref.current!.setActiveCell({ row: 150, col: 2 }))
    expect(ref.current!.getActiveCell()).toEqual({ row: 150, col: 2 })
    // Scrolled so the row is rendered.
    expect(cellAt(grid, 150, 2).getAttribute('data-active')).toBe('true')
    act(() => ref.current!.selectAll())
    expect(ref.current!.getSelectionText().split('\n')).toHaveLength(200)
    expect(ref.current!.getDisplayedRows()).toHaveLength(200)
    act(() => ref.current!.focus())
    expect(document.activeElement).toBe(grid)
  })

  it('keyboard moves past the rendered rows keep the current row rendered', () => {
    const { grid } = setup({}, 500)
    for (let i = 0; i < 6; i++) press(grid, 'PageDown')
    expect(activeCell(grid)?.row).toBe(60)
    expect(within(grid).getAllByRole('row', { selected: true })).toHaveLength(1)
    expect(cellAt(grid, 60, 0)).toBeTruthy()
    press(grid, 'End', { ctrlKey: true })
    expect(cellAt(grid, 499, 0)).toBeTruthy()
  })
})
