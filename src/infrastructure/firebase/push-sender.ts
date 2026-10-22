import type { Messaging } from 'firebase-admin/messaging';
import type { PushSender } from '../../modules/notifications/services/push-delivery.service.js';
import { offerTransportPolicy } from '../../modules/notifications/services/offer-transport-policy.js';

export function createFirebasePushSender(
  messaging: Pick<Messaging, 'sendEachForMulticast'>,
): PushSender {
  return {
    async send(tokens, job) {
      const lifetime = offerTransportPolicy(job.data?.expiresAt);
      const result = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: job.title, body: job.body },
        data: { ...job.data, notificationId: job.notificationId, type: job.type },
        android: {
          priority: 'high',
          ...(lifetime ? { ttl: lifetime.ttl } : {}),
          collapseKey: job.notificationId,
          notification: { tag: job.notificationId, channelId: 'infurnus_driver_channel' },
        },
        apns: {
          headers: {
            'apns-collapse-id': job.notificationId,
            ...(lifetime ? { 'apns-expiration': lifetime.apnsExpiration } : {}),
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
