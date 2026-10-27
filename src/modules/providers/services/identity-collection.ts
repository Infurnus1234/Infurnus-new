import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';

export function assertIdentityCollectionAllowed(
  type: string,
  metadata?: Record<string, unknown>,
  authorization = env.AADHAAR_COLLECTION_AUTHORIZATION,
) {
  if (
    type.toLowerCase() !== 'aadhaar' &&
    !/^aadhaar(?:_|$)/i.test(String(metadata?.documentCode ?? ''))
  )
    return;
  if (!authorization?.trim())
    throw new AppError(
      'IDENTITY_COLLECTION_DISABLED',
      'Aadhaar collection is not authorized for this service. Use an approved alternative identity workflow.',
      403,
    );
  if (metadata?.identityConsent !== 'true' || metadata?.maskedIdentity !== 'true')
    throw new AppError(
      'MASKED_IDENTITY_CONSENT_REQUIRED',
      'Explicit consent and a permitted masked document are required',
      400,
    );
  if (metadata.documentNumber && !/^(?:[Xx*]{8})[0-9]{4}$/.test(String(metadata.documentNumber)))
    throw new AppError(
      'UNMASKED_IDENTITY_REJECTED',
      'Do not submit an unmasked identity number',
      400,
    );
}
