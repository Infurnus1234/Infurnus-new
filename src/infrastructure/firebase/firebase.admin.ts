import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../../config/env.js';

let initialized = false;
export function initFirebaseAdmin() {
  if (initialized) return;
  if (!(env.FIREBASE_PROJECT_ID || env.FIREBASE_CLIENT_EMAIL || env.FIREBASE_PRIVATE_KEY)) return;
  if (!(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY))
    throw new Error('FIREBASE_CONFIGURATION_INCOMPLETE');
  try {
    if (!getApps().length)
      initializeApp({
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    initialized = true;
  } catch {
    throw new Error('FIREBASE_INITIALIZATION_FAILED');
  }
}
export function getFirebaseMessaging() {
  initFirebaseAdmin();
  if (!getApps().length) return null;
  return getMessaging();
}
