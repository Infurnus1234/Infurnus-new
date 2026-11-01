/**
 * POST /notifications/test-push
 *
 * Admin-only endpoint to send a test push notification to any user (by userId).
 * Used to verify custom notification sound on real devices.
 *
 * Request body:
 *   {
 *     "userId": "<target-user-uuid>",
 *     "audience": "driver" | "customer",   // controls channel ID in FCM payload
 *     "title": "optional override",
 *     "body": "optional override"
 *   }
 *
 * The endpoint reuses the production NotificationService so the FCM path,
 * channel selection, sound key and APNs payload are exactly the same as live
 * notifications. Do NOT expose this route in production without admin auth.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import { NotificationService } from '../services/notification.service.js';

const testPushSchema = z
  .object({
    userId: z.string().uuid('userId must be a valid UUID'),
    audience: z.enum(['driver', 'customer']).default('customer'),
    title: z.string().min(1).max(120).default('ðŸ”” Infurnus test notification'),
    body: z
      .string()
      .min(1)
      .max(300)
      .default('If you hear the custom sound, setup is correct! âœ…'),
  })
  .strict();

export function createTestPushRouter(): Router {
  const router = Router();

  // Require a valid JWT AND admin/super_admin role.
  router.use(requireAuth, requireRoles('admin', 'super_admin'));

  router.post('/', async (req, res, next) => {
    try {
      const input = testPushSchema.parse(req.body);

      // Channel IDs must match what the Flutter apps register.
      const androidChannelId =
        input.audience === 'driver'
          ? 'infurnus_driver_channel_v2'
          : 'infurnus_ride_updates_v2';

      const service = new NotificationService();
      const notificationId = await service.send({
        userId: input.userId,
        type: 'ride.accepted', // reuse an existing NotificationType
        title: input.title,
        body: input.body,
        // resourceId + eventVersion: use a test-specific value that is unique
        // per request so repeated calls each produce a new notification.
        resourceId: `test-push:${input.userId}:${Date.now()}`,
        eventVersion: Date.now(),
        data: {
          androidChannelId,
          testPush: 'true',
        },
      });

      res.status(202).json({
        success: true,
        data: {
          notificationId,
          targetUserId: input.userId,
          audience: input.audience,
          androidChannelId,
          iOSSound: 'infurnus_alert.wav',
          message:
            'Notification enqueued. Check the target device â€” you should hear infurnus_alert sound.',
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

