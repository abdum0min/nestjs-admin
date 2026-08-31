/**
 * Test environment setup.
 *
 * Registers Testing Library's DOM cleanup so components from one test cannot
 * leak into the next, and fills the two gaps between jsdom and a browser that
 * the interface's own dependencies fall into.
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/*
 * jsdom has no ResizeObserver, and cmdk uses one to keep the command list
 * sized to its content.
 *
 * A stub rather than a real implementation: nothing under test asserts on a
 * measured size, and a faithful polyfill would be simulating a layout engine
 * jsdom does not have. What matters is that constructing one does not throw -
 * without this the command palette silently fails to open, which is how the
 * gap was found.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

/*
 * Radix uses pointer capture to tell a drag from a click. jsdom implements
 * neither, and the methods are called unconditionally.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

/* jsdom does not implement scrollIntoView, which cmdk calls on the active item. */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

afterEach(() => {
  cleanup()
})
