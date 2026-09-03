/**
 * `ListQuery` -> the server's query string.
 *
 * The server uses colon-delimited, repeatable parameters, not bracket syntax:
 *
 *     ?page=2&perPage=25&search=ada
 *     &sort=email:asc&sort=createdAt:desc
 *     &filter=age:gte:18&filter=role:in:ADMIN,USER
 *
 * `filter[age][gte]=18` would be silently misread - the server splits on
 * colons and never parses brackets. Building the string in one place keeps
 * that decision from being re-derived (or got wrong) per screen.
 */
import type { ListQuery } from './types.js'

export function buildQueryString(query: ListQuery): string {
  // URLSearchParams handles the encoding, and `append` gives the repeated
  // `sort=`/`filter=` parameters the server expects.
  const params = new URLSearchParams()

  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.perPage !== undefined) params.set('perPage', String(query.perPage))

  const search = query.search?.trim()
  if (search) params.set('search', search)

  // Only when it is not the default. A server older than soft delete rejects
  // every parameter it does not know, so sending `deleted=live` on every list
  // would break this build against one.
  if (query.deleted !== undefined && query.deleted !== 'live') {
    params.set('deleted', query.deleted)
  }

  for (const rule of query.sort ?? []) {
    params.append('sort', `${rule.field}:${rule.direction}`)
  }

  for (const rule of query.filters ?? []) {
    // A blank value would become `field:op:`, which the server reads as an
    // empty string rather than "no filter". Dropping it here keeps an
    // untouched filter row from changing the result set.
    if (rule.value === '') continue
    params.append('filter', `${rule.field}:${rule.operator}:${rule.value}`)
  }

  const serialised = params.toString()
  return serialised === '' ? '' : `?${serialised}`
}
