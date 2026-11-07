import type { NextFunction, Request, Response } from 'express';

import { ZodError } from 'zod';

import { AppError } from '../errors/app-error.js';
import { RequestValidationError } from '../errors/request-validation-error.js';
import { StorageValidationError } from '../../infrastructure/storage/validation.js';
import { MulterError } from 'multer';

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'P2001') {
    res.status(503).json({
      success: false,
      error: {
        code: 'BOOKING_ID_UNAVAILABLE',
        message: 'Booking ID allocation is temporarily unavailable. Please retry.',
      },
    });
    return;
  }
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    ['P1001', 'P1002', 'P1003'].includes(String(err.code))
  ) {
    const exhausted = err.code === 'P1002';
    const paused = err.code === 'P1003';
    res.status(exhausted || paused ? 503 : 409).json({
      success: false,
      error: {
        code: paused
          ? 'PROVIDER_ID_ALLOCATION_PAUSED'
          : exhausted
            ? 'PROVIDER_ID_CAPACITY_EXHAUSTED'
            : 'PROVIDER_IDENTITY_RECONCILIATION_REQUIRED',
        message: paused
          ? 'Provider registration is temporarily paused.'
          : exhausted
            ? 'Provider ID capacity is exhausted. A Super Admin must activate a larger ID length.'
            : 'Sign in to your existing provider account or verify both accounts before linking them.',
      },
    });
    return;
  }
  if (err && typeof err === 'object' && 'code' in err && err.code === '23514') {
    res.status(409).json({
      success: false,
      error: {
        code: 'CONSTRAINT_VIOLATION',
        message: 'The operation conflicts with current data or configured requirements',
      },
    });
    return;
  }
  if (err instanceof StorageValidationError || err instanceof MulterError) {
    const oversized = err.code === 'FILE_TOO_LARGE' || err.code === 'LIMIT_FILE_SIZE';
    res.status(oversized ? 413 : 400).json({
      success: false,
      error: {
        code: err.code,
        message: oversized ? 'Document exceeds upload limits' : 'Invalid document upload',
      },
    });
    return;
  }
  // ==========================================================
  // Validation errors
  // ==========================================================

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
      },
    });

    return;
  }

  // ==========================================================
  // Expected application errors
  // ==========================================================

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err instanceof RequestValidationError ? { details: err.details } : {}),
      },
    });

    return;
  }

  // ==========================================================
  // HTTP / Body Parser errors (e.g. 413 Payload Too Large)
  // ==========================================================

  if (err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'The request body must contain valid JSON.',
      },
    });
    return;
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    (('status' in err && (err as { status: unknown }).status === 413) ||
      ('statusCode' in err && (err as { statusCode: unknown }).statusCode === 413))
  ) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds maximum allowed size',
      },
    });

    return;
  }

  // ==========================================================
  // Unexpected server errors
  //
  // Never expose internal error details to the client.
  // Do not log the complete unknown error object because it
  // may contain sensitive database/provider/request metadata.
  // ==========================================================

  if (err instanceof Error) {
    console.error(
      JSON.stringify({
        event: 'unhandled_application_error',
        errorType: err.name,
        stack: err.stack,
      }),
    );
  } else {
    console.error(
      JSON.stringify({
        event: 'unhandled_application_error',
        errorType: 'UnknownError',
      }),
    );
  }

  // ==========================================================
  // Generic client response
  // ==========================================================

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    },
  });
}
