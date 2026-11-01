import type { Messaging } from 'firebase-admin/messaging';
import type { PushSender } from '../../modules/notifications/services/push-delivery.service.js';
import { offerTransportPolicy } from '../../modules/notifications/services/offer-transport-policy.js';

export function createFirebasePushSender(
  messaging: Pick<Messaging, 'sendEachForMulticast'>,
): PushSender {
  return {
    async send(tokens, job) {
      const lifetime = offerTransportPolicy(job.data?.expiresAt);
      const channelId =
        job.data?.channelId ??
        (job.type === 'ride.created' || job.type === 'driver.offer'
          ? 'infurnus_driver_channel_v2'
          : job.type.startsWith('ride.')
            ? 'infurnus_ride_updates_v2'
            : 'infurnus_driver_channel_v2');

      const result = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: job.title, body: job.body },
        data: { ...job.data, notificationId: job.notificationId, type: job.type, channelId },
        android: {
          priority: 'high',
          ...(lifetime ? { ttl: lifetime.ttl } : {}),
          collapseKey: job.notificationId,
          notification: {
            tag: job.notificationId,
            channelId,
            sound: 'infurnus_alert',
            defaultSound: false,
          },
        },
        apns: {
          headers: {
            'apns-collapse-id': job.notificationId,
            ...(lifetime ? { 'apns-expiration': lifetime.apnsExpiration } : {}),
          },
          payload: {
            aps: {
              sound: 'infurnus_alert.wav',
            },
          },
        },
      });
      return result.responses.map((response) => ({
        success: response.success,
        ...(response.messageId ? { messageId: response.messageId } : {}),
        ...(response.error?.code ? { code: response.error.code } : {}),
      }));
    },
  };
}
