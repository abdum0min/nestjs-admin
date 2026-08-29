/**
 * Hands the request's `ExecutionContext` to a controller handler.
 *
 * Resource authorization is enforced in `AdminService`, because that is the one
 * place both the metadata document and every CRUD operation pass through. But
 * the policy needs the request - that is where the host attached its principal -
 * and a service is not request-aware.
 *
 * The two obvious ways to bridge that are both worse than this one:
 *
 * - Making `AdminService` request-scoped changes the DI semantics of a provider
 *   the module exports, and makes the controller request-scoped with it.
 * - Having the guard stash the context on the request object couples the
 *   service to the guard having run.
 *
 * A parameter decorator's factory is handed the `ExecutionContext` directly, so
 * the controller can simply pass it down. No scope change, no hidden coupling.
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

export const AdminContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ExecutionContext => context,
)
