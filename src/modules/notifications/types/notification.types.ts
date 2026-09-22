export const NOTIFICATION_TYPES = {
  RIDE_CREATED: 'ride.created',
  RIDE_ACCEPTED: 'ride.accepted',
  RIDE_DRIVER_ARRIVED: 'ride.driver_arrived',
  RIDE_STARTED: 'ride.started',
  RIDE_COMPLETED: 'ride.completed',
  RIDE_CANCELLED: 'ride.cancelled',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export interface NotificationPayload {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}
