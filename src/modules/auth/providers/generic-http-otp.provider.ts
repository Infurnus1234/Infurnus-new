import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error.js';
import type { OtpProvider } from './otp.provider.js';
import type { ResendOtpProvider } from './resend-otp.provider.js';

type Channel = 'email' | 'sms';
type Operation = 'send' | 'verify' | 'resend';
export type Match = { path: string; equals?: string | boolean | number; contains?: string };
export interface HttpOtpOperation {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  success?: Match[];
  invalid?: Match[];
  rejected?: Match[];
}
export interface HttpOtpProfile {
  id: string;
  timeoutMs?: number;
  variables?: Record<string, string>;
  operations: Record<Operation, HttpOtpOperation>;
  response: {
    sessionIdPath?: string;
    sessionTokenPath?: string;
    sessionTokenValue?: string;
    expiresAtPath?: string;
    ttlSeconds?: number;
    attemptsPath?: string;
  };
}
export interface HttpOtpConfiguration {
  emailFallbackOnMissing?: boolean;
  email?: HttpOtpProfile;
  sms?: HttpOtpProfile;
  retained?: Partial<Record<Channel, Record<string, HttpOtpProfile>>>;
}

const matchSchema = z
  .object({
    path: z.string().min(1),
    equals: z.union([z.string(), z.boolean(), z.number()]).optional(),
    contains: z.string().min(1).optional(),
  })
  .refine((value) => (value.equals !== undefined) !== (value.contains !== undefined));
const operationSchema = z.object({
  url: z.string().min(1),
  method: z.enum(['GET', 'POST']),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  success: z.array(matchSchema).min(1).optional(),
  invalid: z.array(matchSchema).min(1).optional(),
  rejected: z.array(matchSchema).min(1).optional(),
});
const profileSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .refine((value) => value !== 'resend'),
  timeoutMs: z.number().int().min(1).max(60000).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  operations: z.object({ send: operationSchema, verify: operationSchema, resend: operationSchema }),
  response: z
    .object({
      sessionIdPath: z.string().min(1).optional(),
      sessionTokenPath: z.string().min(1).optional(),
      sessionTokenValue: z.string().min(1).optional(),
      expiresAtPath: z.string().min(1).optional(),
      ttlSeconds: z.number().int().min(1).max(600).optional(),
      attemptsPath: z.string().min(1).optional(),
    })
    .refine((value) => Boolean(value.sessionTokenPath) !== Boolean(value.sessionTokenValue))
    .refine((value) => Boolean(value.expiresAtPath) || Boolean(value.ttlSeconds)),
});

const safeError = (code = 'OTP_PROVIDER_CONFIGURATION_INVALID', status = 503) =>
  new AppError(code, 'Verification service is temporarily unavailable', status);
const pathValue = (value: unknown, path: string): unknown => {
  for (const key of path.split('.')) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !value ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key)
    )
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};
const matches = (data: unknown, match: Match) => {
  const value = pathValue(data, match.path);
  return match.contains !== undefined
    ? typeof value === 'string' && value.toLowerCase().includes(match.contains.toLowerCase())
    : value === match.equals;
};

/** Only controlled data mapping: no dynamic code, vendor branches or response logging. */
export class GenericHttpOtpProvider implements OtpProvider {
  constructor(
    private readonly configuration: () => HttpOtpConfiguration,
    private readonly fallback?: ResendOtpProvider,
    private readonly request = fetch,
    private readonly secrets: Record<string, string | undefined> = process.env,
  ) {}

  sendSmsOtp(phone: string) {
    return this.send('sms', phone);
  }
  sendEmailOtp(email: string) {
    return this.send('email', email);
  }
  verifySmsOtp(token: string, otp: string) {
    return this.verify('sms', token, otp);
  }
  verifyEmailOtp(token: string, otp: string) {
    return this.verify('email', token, otp);
  }
  resendSmsOtp(token: string) {
    return this.resend('sms', token);
  }
  resendEmailOtp(token: string) {
    return this.resend('email', token);
  }

  private config() {
    try {
      const config = this.configuration();
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw safeError();
      return config;
    } catch {
      throw safeError();
    }
  }
  private profile(channel: Channel, id?: string) {
    const config = this.config();
    const active = config[channel];
    const profile = !id || active?.id === id ? active : config.retained?.[channel]?.[id];
    if (!profile) throw safeError('OTP_PROVIDER_NOT_CONFIGURED');
    const parsed = profileSchema.safeParse(profile);
    if (!parsed.success) throw safeError();
    return profile;
  }
  private map(value: unknown, variables: Record<string, string>, depth = 0): unknown {
    if (depth > 12) throw safeError();
    if (typeof value === 'string')
      return value.replace(/\{\{([^{}]+)\}\}/g, (_match, name: string) => {
        const replacement = name.startsWith('env:') ? this.secrets[name.slice(4)] : variables[name];
        if (replacement === undefined || replacement === '')
          throw safeError('OTP_PROVIDER_NOT_CONFIGURED');
        return replacement;
      });
    if (Array.isArray(value)) return value.map((item) => this.map(item, variables, depth + 1));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) throw safeError();
          return [key, this.map(item, variables, depth + 1)];
        }),
      );
    return value;
  }
  private async call(
    profile: HttpOtpProfile,
    operation: Operation,
    variables: Record<string, string>,
  ) {
    const spec = profile.operations[operation];
    if (!spec || !['GET', 'POST'].includes(spec.method)) throw safeError();
    let url: URL;
    try {
      url = new URL(spec.url);
    } catch {
      throw safeError();
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw safeError();
    const timeout = profile.timeoutMs ?? 10000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw safeError();
    const values = {
      ...(this.map(profile.variables ?? {}, variables) as Record<string, string>),
      ...variables,
    };
    const headers = this.map(spec.headers ?? {}, values) as Record<string, string>;
    const query = this.map(spec.query ?? {}, values) as Record<string, string>;
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const body = this.map(spec.body, values);
    if (operation === 'verify' && !spec.success?.length) throw safeError();
    try {
      const response = await this.request(url, {
        method: spec.method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        ...(spec.method === 'POST' && body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw safeError(`OTP_PROVIDER_${operation.toUpperCase()}_FAILED`, 502);
      const text = await response.text();
      if (text.length > 1048576) throw safeError();
      const data: unknown = JSON.parse(text);
      if (spec.rejected?.some((match) => matches(data, match)))
        throw safeError(`OTP_PROVIDER_${operation.toUpperCase()}_FAILED`, 502);
      if (operation === 'verify' && spec.invalid?.some((match) => matches(data, match)))
        return { data, verified: false };
      if (spec.success && !spec.success.every((match) => matches(data, match)))
        throw safeError(`OTP_PROVIDER_${operation.toUpperCase()}_FAILED`, 502);
      return { data, verified: true };
    } catch {
      // Preserve existing operation error taxonomy and email fallback policy. Never forward raw errors.
      throw safeError(`OTP_PROVIDER_${operation.toUpperCase()}_FAILED`, 502);
    }
  }
  private expiry(profile: HttpOtpProfile, data: unknown) {
    const raw = profile.response.expiresAtPath
      ? pathValue(data, profile.response.expiresAtPath)
      : undefined;
    const ttl = profile.response.ttlSeconds;
    const date =
      typeof raw === 'string'
        ? new Date(raw)
        : ttl && Number.isInteger(ttl) && ttl > 0 && ttl <= 600
          ? new Date(Date.now() + ttl * 1000)
          : new Date(NaN);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
      throw safeError('OTP_PROVIDER_INVALID_RESPONSE', 502);
    return date.toISOString();
  }
  private async send(channel: Channel, recipient: string) {
    try {
      if (
        channel === 'email' &&
        !this.config().email &&
        this.config().emailFallbackOnMissing &&
        this.fallback
      ) {
        const result = await this.fallback.sendEmailOtp(recipient);
        return { ...result, sessionToken: `resend:${result.sessionToken}`, provider: 'resend' };
      }
      const profile = this.profile(channel);
      const variables = { recipient, recipientDigits: recipient.replace(/^\+/, ''), channel };
      const { data } = await this.call(profile, 'send', variables);
      const token = profile.response.sessionTokenPath
        ? pathValue(data, profile.response.sessionTokenPath)
        : this.map(profile.response.sessionTokenValue, variables);
      const id = profile.response.sessionIdPath
        ? pathValue(data, profile.response.sessionIdPath)
        : randomUUID();
      if (typeof token !== 'string' || !token || typeof id !== 'string' || !id)
        throw safeError('OTP_PROVIDER_INVALID_RESPONSE', 502);
      return {
        sessionId: id,
        sessionToken: `${profile.id}:${token}`,
        expiresAt: this.expiry(profile, data),
        provider: profile.id,
      };
    } catch (error) {
      // Exactly the existing fallback trigger; configuration/invalid-response errors do not switch providers.
      if (
        channel !== 'email' ||
        !this.fallback ||
        !(error instanceof AppError) ||
        error.code !== 'OTP_PROVIDER_SEND_FAILED'
      )
        throw error;
      const result = await this.fallback.sendEmailOtp(recipient);
      return { ...result, sessionToken: `resend:${result.sessionToken}`, provider: 'resend' };
    }
  }
  private session(channel: Channel, session: string) {
    const separator = session.indexOf(':');
    if (separator < 1 || !session.slice(separator + 1))
      throw safeError('OTP_PROVIDER_SESSION_INVALID', 400);
    const id = session.slice(0, separator),
      token = session.slice(separator + 1);
    if (id === 'resend' && channel === 'email' && this.fallback)
      return { token, fallback: this.fallback };
    return { token, profile: this.profile(channel, id) };
  }
  private async verify(channel: Channel, token: string, otp: string) {
    if (!/^\d{6}$/.test(otp)) throw safeError('INVALID_OTP', 400);
    const session = this.session(channel, token);
    if (session.fallback) return session.fallback.verifyEmailOtp(session.token, otp);
    const { data, verified } = await this.call(session.profile!, 'verify', {
      sessionToken: session.token,
      otp,
      channel,
    });
    const attempts = session.profile!.response.attemptsPath
      ? pathValue(data, session.profile!.response.attemptsPath)
      : null;
    if (
      session.profile!.response.attemptsPath &&
      (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0)
    )
      throw safeError('OTP_PROVIDER_INVALID_RESPONSE', 502);
    return { verified, attemptsRemaining: attempts as number | null };
  }
  private async resend(channel: Channel, token: string) {
    const session = this.session(channel, token);
    if (session.fallback) return session.fallback.resendEmailOtp(session.token);
    const { data } = await this.call(session.profile!, 'resend', {
      sessionToken: session.token,
      channel,
    });
    return { expiresAt: this.expiry(session.profile!, data) };
  }
}
