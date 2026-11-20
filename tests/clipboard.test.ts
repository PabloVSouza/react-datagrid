import { describe, expect, it } from 'vitest'
import { parseTsv, toTsv } from '../src/clipboard'

describe('TSV', () => {
  it('joins cells with tabs and rows with line breaks', () => {
    expect(
      toTsv([
        ['a', 'b'],
        ['1', '2']
      ])
    ).toBe('a\tb\n1\t2')
  })

  it('quotes fields with tabs, line breaks or quotes, doubling the quotes', () => {
    expect(toTsv([['x\ty', 'line\nbreak', 'say "hi"', 'plain']])).toBe(
      '"x\ty"\t"line\nbreak"\t"say ""hi"""\tplain'
    )
  })

  it('parses what it writes (round trip)', () => {
    const matrix = [
      ['x\ty', 'line\nbreak', 'say "hi"'],
      ['', 'R$ 1.234,56', '-']
    ]
    expect(parseTsv(toTsv(matrix))).toEqual(matrix)
  })

  it('parses spreadsheet text: CRLF, trailing line break, empty cells', () => {
    expect(parseTsv('a\t\tc\r\n1\t2\t3\r\n')).toEqual([
      ['a', '', 'c'],
      ['1', '2', '3']
    ])
  })

  it('parses one value and empty text', () => {
    expect(parseTsv('42')).toEqual([['42']])
    expect(parseTsv('')).toEqual([])
  })

  it('keeps a quote inside an unquoted field literal', () => {
    expect(parseTsv('5" pipe\tok')).toEqual([['5" pipe', 'ok']])
  })
})
