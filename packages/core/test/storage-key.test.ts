/**
 * Turning a filename into a storage key.
 *
 * Twenty lines of string handling that decide whether a key can be read as a
 * path, so every case is here rather than inferred from the regex.
 *
 * There is a specific reason for that. This function shipped twice with a
 * broken pattern: first a character class whose stray range swallowed the space
 * it meant to replace, then an escape lost in an edit, leaving `/.{2,}/` - which
 * replaces *any two characters* and would have turned every filename into a
 * single dot. Neither was visible by reading the line; both are obvious the
 * moment something calls it.
 */
import { describe, expect, it } from 'vitest'

import { nameFromKey, safeName, storageKeyFor } from '../src/index.js'

describe('safeName', () => {
  it('keeps a name that is already safe', () => {
    expect(safeName('photo.png')).toBe('photo.png')
    expect(safeName('quarterly_report.v2.pdf')).toBe('quarterly_report.v2.pdf')
  })

  it('replaces a space rather than keeping it', () => {
    // The first bug. A space in a key becomes `%20` in a URL, which is legal
    // and then confusing everywhere it is read back.
    expect(safeName('ada avatar.png')).toBe('ada-avatar.png')
    expect(safeName('a   b.png')).toBe('a-b.png')
  })

  it('does not eat the extension', () => {
    // The second bug: `/.{2,}/` matched everything, not a run of dots.
    expect(safeName('report.pdf')).toContain('.pdf')
    expect(safeName('a.png')).toBe('a.png')
  })

  it('removes everything a path resolver would act on', () => {
    expect(safeName('../../etc/passwd')).toBe('etc-passwd')
    expect(safeName('..\\..\\windows')).toBe('windows')
    expect(safeName('/absolute/path.txt')).toBe('absolute-path.txt')
    expect(safeName('....png')).toBe('png')
  })

  it('drops characters a filesystem or a shell would read', () => {
    expect(safeName('re:port*?.txt')).toBe('re-port-.txt')
    expect(safeName('<script>.png')).toBe('script-.png')
    expect(safeName('a"b|c.png')).toBe('a-b-c.png')
  })

  it('survives a name made entirely of removed characters', () => {
    expect(safeName('///')).toBe('file')
    expect(safeName('')).toBe('file')
    expect(safeName('...')).toBe('file')
  })

  it('keeps a non-Latin name intact', () => {
    // An ASCII allowlist collapsed these to a dash and lost the extension with
    // them, which is the wrong answer for most of the world. Unicode letters
    // and digits are letters and digits.
    expect(safeName('ҳисобот.pdf')).toBe('ҳисобот.pdf')
    expect(safeName('報告.png')).toBe('報告.png')
    expect(safeName('hisobot 2026.pdf')).toBe('hisobot-2026.pdf')
  })

  it('still refuses what a path resolver reads, in any script', () => {
    expect(safeName('../ҳисобот.pdf')).toBe('ҳисобот.pdf')
    // Zero-width and direction marks are format characters, not letters, so
    // the allowlist excludes them without having to name them.
    expect(safeName('a​b.png')).toBe('a-b.png')
  })

  it('caps the length', () => {
    expect(safeName('a'.repeat(500)).length).toBe(100)
  })
})

describe('storageKeyFor', () => {
  it('puts the date, the random part and the name in that order', () => {
    const key = storageKeyFor('photo.png', 'abc123')
    expect(key).toMatch(/^\d{4}\/\d{2}\/abc123-photo\.png$/)
  })

  it('produces a key with no space and no traversal, whatever it is given', () => {
    const key = storageKeyFor('../../ evil name.png', 'abc123')

    expect(key).not.toContain(' ')
    expect(key).not.toContain('..')
    // Exactly two separators: the two date segments. Anything more would mean
    // the name introduced structure of its own.
    expect(key.split('/')).toHaveLength(3)
  })
})

describe('nameFromKey', () => {
  it('gives back what a person should see', () => {
    expect(nameFromKey('2026/09/abc123-photo.png')).toBe('photo.png')
    expect(nameFromKey('2026/09/abc123-my-report.pdf')).toBe('my-report.pdf')
  })

  it('copes with a key that was not built here', () => {
    expect(nameFromKey('plain.png')).toBe('plain.png')
  })
})
