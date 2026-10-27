import { AppError } from '../../../common/errors/app-error.js';
export function validateDocumentMetadata(type: string, metadata?: Record<string, unknown>) {
  const code = String(metadata?.documentCode ?? type).toLowerCase();
  const number = metadata?.documentNumber;
  if (
    (code === 'pan' || code === 'pan_card') &&
    number != null &&
    !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(number))
  ) {
    throw new AppError(
      'INVALID_PAN_FORMAT',
      'Enter a valid PAN format; format does not verify identity',
      400,
    );
  }
  if (
    metadata?.holderName != null &&
    (typeof metadata.holderName !== 'string' ||
      metadata.holderName.trim().length < 2 ||
      metadata.holderName.length > 150)
  ) {
    throw new AppError(
      'INVALID_DOCUMENT_HOLDER',
      'Enter the holder name printed on the document',
      400,
    );
  }
}
