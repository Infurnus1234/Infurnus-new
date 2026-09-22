import type { NextFunction, Request, Response } from 'express';

import { ZodError } from 'zod';

import { AppError } from '../errors/app-error.js';

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
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
      },
    });

    return;
  }

  // ==========================================================
  // HTTP / Body Parser errors (e.g. 413 Payload Too Large)
  // ==========================================================

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
