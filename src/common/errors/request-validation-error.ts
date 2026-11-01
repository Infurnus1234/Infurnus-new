import { AppError } from './app-error.js';

export class RequestValidationError extends AppError {
  constructor(public readonly details: { field: string; message: string }[]) {
    super('VALIDATION_ERROR', details.map((detail) => detail.message).join(' '), 400);
    this.name = 'RequestValidationError';
  }
}
