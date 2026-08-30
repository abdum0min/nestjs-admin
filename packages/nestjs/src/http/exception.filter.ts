/**
 * Core errors -> HTTP responses.
 *
 * Centralised on purpose: controllers never construct HTTP exceptions, so the
 * mapping cannot drift between endpoints.
 *
 * This filter is applied to the admin controller with `@UseFilters`, not
 * registered as an `APP_FILTER`. A library that installs a global exception
 * filter would silently take over error handling for the entire host
 * application, which is not ours to change.
 */
import {
  isNestAdminError,
  type FieldNotFoundError,
  type ModelNotFoundError,
  type NestAdminError,
  type RecordNotFoundError,
} from '@nest-admin/core'
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common'

import { failure, type AdminErrorCode, type ErrorResponse } from './response.js'

interface MappedError {
  readonly status: number
  readonly code: AdminErrorCode
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

/**
 * The generic failure. Used for everything not explicitly mapped below, so a
 * new internal error type can never start leaking its message by default.
 */
const INTERNAL: MappedError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: 'INTERNAL_ERROR',
  message: 'An internal error occurred while handling the request.',
}

/**
 * Map an error to its HTTP representation.
 *
 * Dispatch is on `error.kind`, not `instanceof`. The published package ships
 * two CommonJS entrypoints that each inline their own copy of Core, so an error
 * thrown inside the Prisma adapter is an instance of a different class object
 * than the one imported here - `instanceof` answered `false` and mapped every
 * adapter-raised error to a generic 500. See `errors.ts` in Core, and
 * reports/009-consumer-acceptance.md.
 *
 * Only errors on this allowlist have their message forwarded to the client.
 * That is a security decision, not a stylistic one: `AdapterError` wraps raw
 * ORM failures whose messages contain filesystem paths and generated query
 * fragments, and the Prisma schema errors carry absolute paths. Everything
 * unrecognised becomes the generic 500 above, and the real error is logged.
 */
function mapError(error: unknown): MappedError {
  if (!isNestAdminError(error)) return INTERNAL

  switch (error.kind) {
    // Auth first. No `details` on either: echoing anything about why a request
    // was refused hands a prober information it did not have.
    case 'unauthorized':
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: 'UNAUTHORIZED',
        message: error.message,
      }

    case 'forbidden':
      return {
        status: HttpStatus.FORBIDDEN,
        code: 'FORBIDDEN',
        message: error.message,
      }

    case 'model-not-found':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'MODEL_NOT_FOUND',
        message: error.message,
        details: { model: (error as ModelNotFoundError).model },
      }

    case 'record-not-found':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'RECORD_NOT_FOUND',
        message: error.message,
        details: {
          model: (error as RecordNotFoundError).model,
          id: (error as RecordNotFoundError).id,
        },
      }

    case 'field-not-found':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'FIELD_NOT_FOUND',
        message: error.message,
        details: {
          model: (error as FieldNotFoundError).model,
          field: (error as FieldNotFoundError).field,
        },
      }

    // Raised by application code to refuse an input. The message is
    // forwarded, which is what it is for.
    case 'validation':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: error.message,
      }

    case 'invalid-query':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_QUERY',
        message: error.message,
      }

    // 'adapter', 'unknown', and any kind added later without a mapping. The
    // default stays generic so a new internal error cannot start leaking.
    default:
      return INTERNAL
  }
}

@Catch()
export class AdminExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('NestAdmin')

  catch(exception: unknown, host: ArgumentsHost): void {
    // Let Nest's own exceptions through untouched - a 404 from an unmatched
    // route or a payload-too-large is not ours to reinterpret.
    if (exception instanceof HttpException) {
      throw exception
    }

    const mapped = mapError(exception)

    if (mapped.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // The client gets a generic message; the operator gets everything.
      this.logger.error(
        isNestAdminError(exception) && exception.kind === 'adapter'
          ? `Adapter failure: ${exception.message}`
          : 'Unhandled error while handling an admin request',
        exception instanceof Error ? exception.stack : String(exception),
      )
    }

    const body: ErrorResponse = failure(mapped.code, mapped.message, mapped.details)
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(body: unknown): void }
    }>()
    response.status(mapped.status).json(body)
  }
}

/**
 * Exported for tests and for consumers that want the same mapping elsewhere.
 *
 * Delegates to Core's brand check rather than `instanceof` for the reason given
 * on `mapError`: duplicate copies of Core mean class identity is not reliable.
 */
export function isFrameworkError(error: unknown): error is NestAdminError {
  return isNestAdminError(error)
}
