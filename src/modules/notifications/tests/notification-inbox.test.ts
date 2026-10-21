import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../infrastructure/database/postgres.js', () => ({ pool: { query } }));
vi.mock('../../auth/middleware/auth.middleware.js', () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (req.header('authorization') !== 'Bearer fixture') {
      res.status(401).end();
      return;
    }
    req.auth = { userId: 'owner', role: 'driver' };
    next();
  },
}));
import { createNotificationInboxRouter } from '../routes/notification-inbox.routes.js';
import { PostgresNotificationRepository } from '../repositories/notification.repository.js';

function fixture() {
  const repository = {
    inbox: vi.fn(async () => ({ items: [], unreadCount: 0 })),
    readInbox: vi.fn(async () => 1),
  };
  const app = express();
  app.use(express.json());
  app.use('/inbox', createNotificationInboxRouter(repository));
  app.use((error: { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.statusCode ?? 400).json({ error: 'request rejected' });
  });
  return { app, repository };
}
describe('authenticated notification inbox', () => {
  beforeEach(() => query.mockReset());
  it('requires authentication without accessing the repository', async () => {
    const { app, repository } = fixture();
    expect((await request(app).get('/inbox')).status).toBe(401);
    expect(repository.inbox).not.toHaveBeenCalled();
  });
  it('uses the authenticated owner and validates pagination', async () => {
    const { app, repository } = fixture();
    expect(
      (await request(app).get('/inbox?limit=25&offset=50').set('authorization', 'Bearer fixture'))
        .status,
    ).toBe(200);
    expect(repository.inbox).toHaveBeenCalledWith('owner', 25, 50);
    expect(
      (await request(app).get('/inbox?limit=101').set('authorization', 'Bearer fixture')).status,
    ).toBe(400);
  });
  it('cannot inject another owner or an invalid notification ID', async () => {
    const { app, repository } = fixture();
    expect(
      (await request(app).get('/inbox?userId=other').set('authorization', 'Bearer fixture')).status,
    ).toBe(400);
    expect(
      (await request(app).patch('/inbox/not-a-uuid/read').set('authorization', 'Bearer fixture'))
        .status,
    ).toBe(400);
    expect(repository.readInbox).not.toHaveBeenCalled();
  });
  it('marks read using the authenticated owner', async () => {
    const { app, repository } = fixture();
    const id = '87cc662c-4ef6-4709-82ed-241d1e5341bd';
    expect(
      (await request(app).patch(`/inbox/${id}/read`).set('authorization', 'Bearer fixture')).status,
    ).toBe(200);
    expect(repository.readInbox).toHaveBeenCalledWith('owner', id);
    await request(app).patch('/inbox/read-all').set('authorization', 'Bearer fixture');
    expect(repository.readInbox).toHaveBeenCalledWith('owner');
  });
  it('SQL scopes both single-read and mark-all to owner and preserves read timestamps', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new PostgresNotificationRepository();
    await repository.readInbox('owner', 'notification');
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('WHERE user_id=$1 AND id=$2'), [
      'owner',
      'notification',
    ]);
    await repository.readInbox('owner');
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('WHERE user_id=$1 AND read_at IS NULL'),
      ['owner'],
    );
    expect(query.mock.calls[0]![0]).toContain('COALESCE(read_at,NOW())');
  });
});
