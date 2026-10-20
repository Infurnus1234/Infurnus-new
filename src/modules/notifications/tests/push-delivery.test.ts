import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../infrastructure/database/postgres.js', () => ({ pool: { query: vi.fn() } }));
import { PushDeliveryService } from '../services/push-delivery.service.js';
import type { PostgresNotificationRepository } from '../repositories/notification.repository.js';
import type { PostgresDeviceTokenRepository } from '../device-tokens/repositories/device-token.repository.js';

function fixture(
  options: { sent?: boolean; invalid?: boolean; transient?: boolean; expired?: boolean } = {},
) {
  const notifications = {
    findById: vi.fn(async () => ({
      userId: 'owner',
      deliveryStatus: options.sent ? 'SENT' : 'PENDING',
    })),
    acceptedDeviceIds: vi.fn(async (): Promise<string[]> => []),
    pushAllowed: vi.fn(async () => true),
    recordDeviceAcceptance: vi.fn(),
    markProcessing: vi.fn(),
    markFailed: vi.fn(),
    markSent: vi.fn(),
    markProcessed: vi.fn(),
  };
  const devices = {
    findActiveByUserId: vi.fn(async () => [{ id: 'device', fcmToken: 'fixture-token' }]),
    deactivateById: vi.fn(),
    deactivateByFcmToken: vi.fn(),
  };
  const sender = {
    send: vi.fn(async () => [
      {
        success: !options.invalid && !options.transient,
        ...(options.invalid ? { code: 'messaging/registration-token-not-registered' } : {}),
        ...(options.transient ? { code: 'messaging/server-unavailable' } : {}),
      },
    ]),
  };
  const service = new PushDeliveryService(
    sender,
    notifications as unknown as PostgresNotificationRepository,
    devices as unknown as PostgresDeviceTokenRepository,
  );
  const job = {
    notificationId: 'notification',
    userId: 'owner',
    type: 'ride.created',
    title: 'New ride offer',
    body: 'Review the current offer',
    ...(options.expired ? { data: { expiresAt: new Date(Date.now() - 10000).toISOString() } } : {}),
  };
  return { service, sender, devices, notifications, job };
}
describe('push provider acceptance semantics', () => {
  it('respects disabled push preference without contacting FCM', async () => {
    const f = fixture();
    f.notifications.pushAllowed.mockResolvedValue(false);
    await f.service.deliver(f.job);
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.notifications.markSent).not.toHaveBeenCalled();
  });
  it('skips a device with durable acceptance when retrying a partially completed job', async () => {
    const f = fixture();
    f.notifications.acceptedDeviceIds.mockResolvedValue(['device']);
    await f.service.deliver(f.job);
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.notifications.markSent).toHaveBeenCalledWith('notification');
  });
  it('marks SENT and PROCESSED only after provider acceptance', async () => {
    const f = fixture();
    await f.service.deliver(f.job);
    expect(f.notifications.markSent).toHaveBeenCalledWith('notification');
    expect(f.notifications.markProcessed).toHaveBeenCalledWith('notification');
    expect(f.notifications.markFailed).not.toHaveBeenCalled();
    expect(f.notifications.recordDeviceAcceptance).toHaveBeenCalledWith(
      'notification',
      'device',
      undefined,
    );
  });
  it('does not resend a notification already accepted by the provider', async () => {
    const f = fixture({ sent: true });
    await f.service.deliver(f.job);
    expect(f.sender.send).not.toHaveBeenCalled();
  });
  it('suppresses expired offers without making a push request', async () => {
    const f = fixture({ expired: true });
    await f.service.deliver(f.job);
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.notifications.markFailed).toHaveBeenCalledWith('notification', 'OFFER_EXPIRED');
  });
  it('deactivates invalid tokens and never reports all-invalid devices as SENT', async () => {
    const f = fixture({ invalid: true });
    await f.service.deliver(f.job);
    expect(f.devices.deactivateByFcmToken).toHaveBeenCalledWith('fixture-token');
    expect(f.devices.deactivateById).not.toHaveBeenCalled();
    expect(f.notifications.markSent).not.toHaveBeenCalled();
    expect(f.notifications.markFailed).toHaveBeenCalledWith('notification', 'NO_VALID_DEVICE');
  });
  it('throws for queue retry on transient provider failure and records no acceptance', async () => {
    const f = fixture({ transient: true });
    await expect(f.service.deliver(f.job)).rejects.toThrow('PUSH_PROVIDER_UNAVAILABLE');
    expect(f.notifications.markSent).not.toHaveBeenCalled();
    expect(f.notifications.markFailed).toHaveBeenCalledWith(
      'notification',
      'PUSH_PROVIDER_UNAVAILABLE',
    );
  });
});
