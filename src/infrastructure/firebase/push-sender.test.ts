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
      data: {
        rideId: 'ride',
        notificationId: 'notification',
        type: 'ride.created',
        expiresAt,
        channelId: 'infurnus_driver_channel_v2',
      },
      android: {
        priority: 'high',
        collapseKey: 'notification',
      },
      apns: {
        payload: {
          aps: {
            sound: 'infurnus_alert.wav',
          },
        },
      },
    });
    expect(sendEachForMulticast.mock.calls[0]![0]).not.toHaveProperty('notification');
    expect(sendEachForMulticast.mock.calls[0]![0].android).not.toHaveProperty('notification');
    expect(sendEachForMulticast.mock.calls[0]![0].apns.payload.aps.alert).toEqual({
      title: 'Ride offer',
      body: 'Open the app',
    });
    expect(sendEachForMulticast.mock.calls[0]![0].android.ttl).toBeGreaterThan(0);
    expect(results).toEqual([
      { success: true, messageId: 'fixture-id' },
      { success: false, code: 'messaging/registration-token-not-registered' },
    ]);
  });

  it('selects customer channel for customer ride updates', async () => {
    const sendEachForMulticast = vi.fn().mockResolvedValue({
      responses: [{ success: true, messageId: 'fixture-id' }],
    });
    const sender = createFirebasePushSender({ sendEachForMulticast } as unknown as Pick<
      Messaging,
      'sendEachForMulticast'
    >);
    await sender.send(['fixture-token-1'], {
      notificationId: 'cust-notif',
      userId: 'customer-1',
      title: 'Driver Arrived',
      body: 'Your driver is here',
      type: 'ride.driver_arrived',
      data: { rideId: 'ride-123' },
    });
    expect(sendEachForMulticast).toHaveBeenCalledOnce();
    expect(sendEachForMulticast.mock.calls[0]![0]).toMatchObject({
      android: {
        notification: {
          channelId: 'infurnus_ride_updates_v2',
          sound: 'infurnus_alert',
        },
      },
    });
  });

  it('delivers offer invalidation to the background handler without an OS sound or banner', async () => {
    const sendEachForMulticast = vi.fn().mockResolvedValue({ responses: [{ success: true }] });
    const sender = createFirebasePushSender({ sendEachForMulticast });
    await sender.send(['fixture-token'], {
      notificationId: 'offer-ended',
      userId: 'driver',
      title: 'Withdrawn',
      body: 'Offer ended',
      type: 'ride.cancelled',
      data: { rideId: 'ride-123', offerInvalidated: 'true', silentOfferUpdate: 'true' },
    });
    const message = sendEachForMulticast.mock.calls[0]![0];
    expect(message).not.toHaveProperty('notification');
    expect(message.android).not.toHaveProperty('notification');
    expect(message.apns.payload.aps).toEqual({ contentAvailable: true });
    expect(message.data).toMatchObject({ rideId: 'ride-123', silentOfferUpdate: 'true' });
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
