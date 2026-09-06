import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';

import { joinAuthorizedRideRoom, leaveRideRoom, rideRoom } from '../socket.rooms.js';

function createSocket(auth?: { userId: string; role: string }): Socket {
  return {
    data: auth ? { auth } : {},
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  } as unknown as Socket;
}

describe('socket ride rooms', () => {
  it('builds a namespaced ride room', () => {
    expect(rideRoom('ride-123')).toBe('ride:ride-123');
  });

  it('joins an authorized ride room using the authenticated user identity', async () => {
    const socket = createSocket({
      userId: 'customer-123',
      role: 'customer',
    });

    const isAuthorized = vi.fn().mockResolvedValue(true);

    await joinAuthorizedRideRoom(socket, 'ride-123', isAuthorized);

    expect(isAuthorized).toHaveBeenCalledTimes(1);
    expect(isAuthorized).toHaveBeenCalledWith('customer-123', 'ride-123');
    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(socket.join).toHaveBeenCalledWith('ride:ride-123');
  });

  it('rejects an unauthorized ride room', async () => {
    const socket = createSocket({
      userId: 'customer-123',
      role: 'customer',
    });

    const isAuthorized = vi.fn().mockResolvedValue(false);

    await expect(joinAuthorizedRideRoom(socket, 'ride-123', isAuthorized)).rejects.toThrow(
      'Ride room authorization failed',
    );

    expect(isAuthorized).toHaveBeenCalledTimes(1);
    expect(isAuthorized).toHaveBeenCalledWith('customer-123', 'ride-123');
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('does not accept a client-supplied user id for authorization', async () => {
    const socket = createSocket({
      userId: 'authenticated-user',
      role: 'customer',
    });

    const isAuthorized = vi.fn().mockResolvedValue(true);

    await joinAuthorizedRideRoom(socket, 'ride-123', isAuthorized);

    expect(isAuthorized).toHaveBeenCalledWith('authenticated-user', 'ride-123');
    expect(isAuthorized).not.toHaveBeenCalledWith('attacker-supplied-user', 'ride-123');
  });

  it('does not join when the authorization check fails with an error', async () => {
    const socket = createSocket({
      userId: 'customer-123',
      role: 'customer',
    });

    const authorizationError = new Error('Database unavailable');
    const isAuthorized = vi.fn().mockRejectedValue(authorizationError);

    await expect(joinAuthorizedRideRoom(socket, 'ride-123', isAuthorized)).rejects.toBe(
      authorizationError,
    );

    expect(isAuthorized).toHaveBeenCalledWith('customer-123', 'ride-123');
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('does not join an unauthenticated socket', async () => {
    const socket = createSocket();

    const isAuthorized = vi.fn().mockResolvedValue(true);

    await expect(joinAuthorizedRideRoom(socket, 'ride-123', isAuthorized)).rejects.toThrow(
      'Socket authentication required',
    );

    expect(isAuthorized).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('leaves the authenticated socket from the ride room', async () => {
    const socket = createSocket({
      userId: 'customer-123',
      role: 'customer',
    });

    await leaveRideRoom(socket, 'ride-123');

    expect(socket.leave).toHaveBeenCalledTimes(1);
    expect(socket.leave).toHaveBeenCalledWith('ride:ride-123');
  });

  it('does not allow an unauthenticated socket to leave a ride room', async () => {
    const socket = createSocket();

    await expect(leaveRideRoom(socket, 'ride-123')).rejects.toThrow(
      'Socket authentication required',
    );

    expect(socket.leave).not.toHaveBeenCalled();
  });

  it('propagates room join failures without hiding them', async () => {
    const socket = createSocket({
      userId: 'customer-123',
      role: 'customer',
    });

    const joinError = new Error('Socket transport failure');

    vi.mocked(socket.join).mockRejectedValue(joinError);

    const isAuthorized = vi.fn().mockResolvedValue(true);

    await expect(joinAuthorizedRideRoom(socket, 'ride-123', isAuthorized)).rejects.toBe(joinError);

    expect(isAuthorized).toHaveBeenCalledWith('customer-123', 'ride-123');
    expect(socket.join).toHaveBeenCalledWith('ride:ride-123');
  });

  it('propagates room leave failures without hiding them', async () => {
    const socket = createSocket({
      userId: 'customer-123',
      role: 'customer',
    });

    const leaveError = new Error('Socket transport failure');

    vi.mocked(socket.leave).mockRejectedValue(leaveError);

    await expect(leaveRideRoom(socket, 'ride-123')).rejects.toBe(leaveError);

    expect(socket.leave).toHaveBeenCalledWith('ride:ride-123');
  });
});
