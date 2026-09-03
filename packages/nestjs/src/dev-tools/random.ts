/**
 * Randomness you can ask for twice.
 *
 * Seeded on purpose. A demo whose data changes on every reload cannot be
 * screenshotted, cannot be described to somebody else ("the third order"), and
 * cannot be got back after a truncate. The same seed produces the same
 * database, which turns generated data from a novelty into something a person
 * can build a walkthrough on.
 *
 * `Math.random()` cannot do this - it has no seed - so the generator is
 * thirty lines of mulberry32 rather than a dependency. It is not cryptographic
 * and must never be used for anything that pretends to be.
 */

/** A string to a 32-bit seed, so a seed can be a word rather than a number. */
export function seedFrom(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    // FNV-1a's prime, as shifts: the multiply overflows 32 bits in JavaScript.
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

export interface Random {
  /** A float in [0, 1). */
  next(): number
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number
  /** One of them. Never called with an empty list. */
  pick<T>(values: readonly T[]): T
  /** True with this probability. */
  chance(probability: number): boolean
  /** A short, unlikely-to-repeat string, for keeping unique columns unique. */
  token(length?: number): string
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

export function randomFrom(seed: string | number): Random {
  let state = (typeof seed === 'number' ? seed : seedFrom(seed)) || 1

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))

  return {
    next,
    int,
    pick: <T>(values: readonly T[]): T => values[int(0, values.length - 1)] as T,
    chance: (probability: number) => next() < probability,
    token: (length = 4) =>
      Array.from({ length }, () => ALPHABET[int(0, ALPHABET.length - 1)]).join(''),
  }
}
