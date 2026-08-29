/**
 * Test environment setup.
 *
 * Registers Testing Library's DOM cleanup so components from one test cannot
 * leak into the next, and gives the API client a default base URL - the app
 * reads `VITE_ADMIN_API_BASE`, which is unset under test.
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
