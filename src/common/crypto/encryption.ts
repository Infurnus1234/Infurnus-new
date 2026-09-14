import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

const ALGORITHM = 'aes-256-gcm';

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const FORMAT_VERSION = 'v1';

type EncryptedSecretParts = [
  version: string,
  ivBase64: string,
  authTagBase64: string,
  ciphertextBase64: string,
];

function getEncryptionKey(): Buffer {
  const key = Buffer.from(env.AUTH_OTP_ENCRYPTION_KEY, 'base64');

  if (key.length !== KEY_LENGTH) {
    throw new AppError('ENCRYPTION_KEY_INVALID', 'Authentication encryption key is invalid', 500);
  }

  return key;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) {
    throw new AppError('ENCRYPTION_INPUT_INVALID', 'Secret value cannot be empty', 500);
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new AppError('ENCRYPTION_FAILED', 'Failed to encrypt secret value', 500);
  }

  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptSecret(value: string): string {
  if (!value) {
    throw new AppError('DECRYPTION_INPUT_INVALID', 'Encrypted value cannot be empty', 500);
  }

  const parts = value.split('.');

  if (parts.length !== 4) {
    throw new AppError('DECRYPTION_FAILED', 'Invalid encrypted value', 500);
  }

  const [version, ivBase64, authTagBase64, ciphertextBase64] = parts as EncryptedSecretParts;

  if (version !== FORMAT_VERSION) {
    throw new AppError('DECRYPTION_FAILED', 'Unsupported encrypted value version', 500);
  }

  try {
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');

    if (iv.length !== IV_LENGTH) {
      throw new Error('Invalid IV length');
    }

    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid authentication tag length');
    }

    if (ciphertext.length === 0) {
      throw new Error('Empty ciphertext');
    }

    const key = getEncryptionKey();

    const decipher = createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return plaintext.toString('utf8');
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('DECRYPTION_FAILED', 'Failed to decrypt secret value', 500);
  }
}
