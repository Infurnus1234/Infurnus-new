import { describe, it, expect, vi } from 'vitest';
import type { Messaging } from 'firebase-admin/messaging';
import { createFirebasePushSender } from './push-sender.js';
describe('FCM adapter request contract (mock SDK, no FCM network acceptance)', () => {
  it('sends ride navigation data, high priority, offer expiry and the established Android channel', async () => {
    const sendEachForMulticast = vi.fn().mockResolvedValue({
      responses: [
        { success: true, messageId: 'fixture-id' },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    const sender = createFirebasePushSender({ sendEachForMulticast } as unknown as Pick<
      Messaging,
      'sendEachForMulticast'
    >);
    const expiresAt = new Date(Date.now() + 30000).toISOString();
    const results = await sender.send(['fixture-token-1', 'fixture-token-2'], {
      notificationId: 'notification',
      userId: 'user',
      title: 'Ride offer',
      body: 'Open the app',
      type: 'ride.created',
      data: { rideId: 'ride', expiresAt },
    });
    expect(sendEachForMulticast).toHaveBeenCalledOnce();
    expect(sendEachForMulticast.mock.calls[0]![0]).toMatchObject({
      tokens: ['fixture-token-1', 'fixture-token-2'],
      data: { rideId: 'ride', notificationId: 'notification', type: 'ride.created', expiresAt },
      android: {
        priority: 'high',
        collapseKey: 'notification',
        notification: { channelId: 'infurnus_driver_channel', tag: 'notification' },
      },
    });
    expect(sendEachForMulticast.mock.calls[0]![0].android.ttl).toBeGreaterThan(0);
    expect(results).toEqual([
      { success: true, messageId: 'fixture-id' },
      { success: false, code: 'messaging/registration-token-not-registered' },
    ]);
  });
  it('propagates SDK failures to the delivery retry policy without claiming acceptance', async () => {
    const sender = createFirebasePushSender({
      sendEachForMulticast: vi.fn().mockRejectedValue(new Error('fixture outage')),
    } as unknown as Pick<Messaging, 'sendEachForMulticast'>);
    await expect(
      sender.send(['fixture'], {
        notificationId: 'id',
        userId: 'user',
        type: 'ride.created',
        title: 'Ride',
        body: 'Open',
      }),
    ).rejects.toThrow('fixture outage');
  });
});
