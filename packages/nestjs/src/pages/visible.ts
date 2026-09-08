/**
 * Which pages a principal may open, and what the document says about them.
 *
 * ## Why this is its own file
 *
 * Two callers need it: the admin service, while building the metadata
 * document, and the pages service, before serving a page's body. Putting it in
 * `pages/service.ts` would make the admin service import that file, which
 * imports the admin service - a cycle in the *module graph*, not just in DI,
 * and one whose symptom is a class arriving as `undefined` at injection time
 * with an error naming the wrong parameter.
 *
 * So it lives here, importing neither service. The rule about who sees a page
 * is still written once; only its address changed.
 */
import type { ExecutionContext } from '@nestjs/common'

import { isEmbedPage, isModulePage, type AdminPage, type AdminPages } from './contract.js'
import type { PageDto } from './dto.js'

/**
 * The pages this principal may open, as the metadata carries them.
 *
 * Asked once to decide what to draw, and again to decide what to serve. That is
 * not redundancy - only the second is a permission, because a link that was
 * never rendered has never stopped anyone typing the URL.
 */
export async function visiblePages(
  pages: AdminPages | undefined,
  context: ExecutionContext,
): Promise<readonly PageDto[]> {
  const visible: PageDto[] = []

  for (const page of pages ?? []) {
    if (await pageAllowed(page, context)) visible.push(toPageDto(page))
  }

  return visible
}

/**
 * Whether a page is open to this principal.
 *
 * A page without `can` is open to anyone who reached the admin, which is the
 * default a model without `resourceAuth` already has. A `can` that throws is a
 * denial rather than a 500: the one interpretation that must never happen is
 * treating an exception as permission.
 */
export async function pageAllowed(page: AdminPage, context: ExecutionContext): Promise<boolean> {
  if (page.can === undefined) return true

  try {
    return (await page.can(context)) === true
  } catch {
    return false
  }
}

export function toPageDto(page: AdminPage): PageDto {
  const common = {
    path: page.path,
    title: page.title,
    ...(page.description === undefined ? {} : { description: page.description }),
    ...(page.icon === undefined ? {} : { icon: page.icon }),
  }

  if (isModulePage(page)) return { ...common, kind: 'module', module: page.module }
  if (isEmbedPage(page)) return { ...common, kind: 'embed', url: page.url }
  return { ...common, kind: 'widgets' }
}
