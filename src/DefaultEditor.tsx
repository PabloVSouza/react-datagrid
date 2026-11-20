import { useEffect, useRef, useState } from 'react'
import type { EditorProps } from './types'

interface DefaultEditorProps<T> extends EditorProps<T> {
  text: string
  parse: (text: string) => unknown
  align: 'start' | 'center' | 'end'
}

/**
 * The text editor: Enter / Shift+Enter commit and move down / up, Tab / Shift+Tab right / left, Esc cancels,
 * leaving the cell commits. A text `parse` rejects (undefined) keeps the editor open, marked invalid; so does
 * a value the host refuses. Read-only while an async `onCellEdit` runs.
 */
export function DefaultEditor<T>({
  text,
  initialText,
  parse,
  commit,
  cancel,
  align,
  column,
  pending,
  rejections
}: DefaultEditorProps<T>) {
  const [draft, setDraft] = useState(initialText ?? text)
  const [invalid, setInvalid] = useState(false)
  const done = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const element = input.current
    if (!element) return
    element.focus()
    if (initialText === undefined) element.select()
    else element.setSelectionRange(element.value.length, element.value.length)
  }, [initialText])

  // The host refused the value (`onCellEdit` returned false or its promise failed): edit again.
  useEffect(() => {
    if (rejections === 0) return
    done.current = false
    setInvalid(true)
    input.current?.focus()
  }, [rejections])

  const finish = (move: Parameters<typeof commit>[1]) => {
    if (pending) return true
    const value = parse(draft)
    if (value === undefined) {
      setInvalid(true)
      return false
    }
    done.current = true
    commit(value, move)
    return true
  }

  return (
    <input
      ref={input}
      className="rdg-editor"
      aria-label={typeof column.header === 'string' ? column.header : column.id}
      aria-invalid={invalid || undefined}
      aria-busy={pending || undefined}
      readOnly={pending}
      value={draft}
      style={{ textAlign: align === 'start' ? 'left' : align === 'end' ? 'right' : 'center' }}
      onChange={(event) => {
        setDraft(event.target.value)
        setInvalid(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(event.shiftKey ? 'up' : 'down')
        } else if (event.key === 'Tab') {
          event.preventDefault()
          finish(event.shiftKey ? 'left' : 'right')
        } else if (event.key === 'Escape') {
          event.preventDefault()
          if (pending) return
          done.current = true
          cancel()
        } else return
        event.stopPropagation()
      }}
      onBlur={() => {
        if (pending) return
        if (!done.current && !finish('none')) {
          // An invalid value on focus loss: drop the edit rather than trap the focus.
          done.current = true
          cancel()
        }
      }}
    />
  )
}
