/**
 * The CSV reader and writer.
 *
 * Almost all of this is about the cases a `split(',')` implementation gets
 * wrong, because those are the ones that corrupt data rather than fail: a file
 * that imports cleanly and puts half a product description in the price column
 * is worse than one that is refused.
 */
import { describe, expect, it } from 'vitest'

import { BOM, csvHeader, csvRow, parseCsv } from '../src/transfer/csv.js'

const rows = (text: string) => parseCsv(text).map((row) => [...row])

describe('writing', () => {
  it('quotes a value containing the delimiter, a quote or a newline', () => {
    const line = csvRow(['plain', 'a, b', 'say "hi"', 'one\ntwo'])

    expect(line).toBe('plain,"a, b","say ""hi""","one\ntwo"\r\n')
  })

  it('writes nothing at all for null and undefined', () => {
    expect(csvRow([null, undefined, ''])).toBe(',,\r\n')
  })

  it('writes a date as ISO 8601, which survives a spreadsheet in another locale', () => {
    expect(csvRow([new Date('2024-03-17T09:30:00.000Z')])).toBe('2024-03-17T09:30:00.000Z\r\n')
  })

  it('puts a byte-order mark on the header, so Excel reads UTF-8 as UTF-8', () => {
    expect(csvHeader(['ism', 'ҳисобот'])).toBe(`${BOM}ism,ҳисобот\r\n`)
    expect(csvHeader(['ism'], { bom: false })).toBe('ism\r\n')
  })

  it('honours a semicolon delimiter, and quotes on that character instead', () => {
    expect(csvRow(['a;b', 'a,b'], { delimiter: ';' })).toBe('"a;b";a,b\r\n')
  })
})

describe('formula injection', () => {
  /*
   * The attack: a product name of `=cmd|'/c calc'!A1` is a formula to Excel,
   * and it runs when the person who exported the file opens it.
   */
  it('defuses a cell that Excel would run as a formula', () => {
    expect(csvRow(['=1+1'])).toBe("'=1+1\r\n")
    expect(csvRow(["=cmd|'/c calc'!A1"])).toBe("'=cmd|'/c calc'!A1\r\n")
    expect(csvRow(['+44 7700 900000'])).toBe("'+44 7700 900000\r\n")
    expect(csvRow(['@here'])).toBe("'@here\r\n")
  })

  it('leaves an ordinary value alone', () => {
    expect(csvRow(['3-4', 'a=b'])).toBe('3-4,a=b\r\n')
  })

  it('takes the apostrophe back off on the way in, so a round trip is lossless', () => {
    const value = '=SUM(A1:A9)'
    const [row] = rows(csvHeader(['formula']) + csvRow([value]))

    expect(row).toEqual(['formula'])
    expect(rows(csvRow([value]))[0]).toEqual([value])
  })

  it('leaves an apostrophe somebody typed themselves', () => {
    expect(rows('"\'twas"\r\n')[0]).toEqual(["'twas"])
  })
})

describe('reading', () => {
  it('reads a quoted field containing commas, newlines and doubled quotes', () => {
    const text = 'name,note\r\n"Ada","a, b\nc ""quoted"""\r\n'

    expect(rows(text)).toEqual([
      ['name', 'note'],
      ['Ada', 'a, b\nc "quoted"'],
    ])
  })

  it('accepts CRLF, LF and a trailing newline without inventing a row', () => {
    expect(rows('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(rows('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('strips a byte-order mark rather than putting it in the first column name', () => {
    expect(rows(`${BOM}id,name\r\n1,Ada\r\n`)[0]).toEqual(['id', 'name'])
  })

  it('detects a semicolon file, which is what Excel writes in much of Europe', () => {
    expect(rows('id;name\r\n1;Ada, Lovelace\r\n')).toEqual([
      ['id', 'name'],
      ['1', 'Ada, Lovelace'],
    ])
  })

  it('detects a tab file', () => {
    expect(rows('id\tname\n1\tAda\n')).toEqual([
      ['id', 'name'],
      ['1', 'Ada'],
    ])
  })

  it('counts the delimiter outside quotes only, so a quoted comma does not decide', () => {
    // One real semicolon, two commas - but both commas are inside the quoted
    // header, so the file is semicolon-separated.
    expect(rows('"last, first, middle";age\r\n"Lovelace, Ada";36\r\n')).toEqual([
      ['last, first, middle', 'age'],
      ['Lovelace, Ada', '36'],
    ])
  })

  it('keeps empty cells rather than collapsing them', () => {
    expect(rows('a,b,c\r\n1,,3\r\n')[1]).toEqual(['1', '', '3'])
  })

  it('reads an empty document as no rows', () => {
    expect(rows('')).toEqual([])
    expect(rows('   \n')).toEqual([])
  })

  it('survives a round trip of everything awkward', () => {
    const original = ['a, b', 'say "hi"', 'line\nbreak', '=formula', '', 'ҳисобот']
    const text = csvHeader(['x']) + csvRow(original)

    expect(rows(text)[1]).toEqual(original)
  })
})
