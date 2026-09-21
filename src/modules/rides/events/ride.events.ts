import { EventEmitter } from 'node:events';
import type { Ride } from '../types/ride.js';

export interface RideEventPayloads {
  'ride:created': Ride;
  'ride:accepted': Ride;
  'ride:cancelled': string;
}

export const rideEvents = new EventEmitter();
