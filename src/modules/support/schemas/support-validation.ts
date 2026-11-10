import { ZodError } from 'zod';
import { RequestValidationError } from '../../../common/errors/request-validation-error.js';

/** Expose field rules, never the submitted issue text or authentication data. */
export function supportValidationError(error: unknown): unknown {
  if (!(error instanceof ZodError)) return error;
  return new RequestValidationError(
    error.issues.map((issue) => ({
      field: issue.path.join('.') || 'request',
      message:
        issue.code === 'unrecognized_keys'
          ? 'The request contains unsupported fields. Check the support API contract.'
          : issue.message,
    })),
  );
}
