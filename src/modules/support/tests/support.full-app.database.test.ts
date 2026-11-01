import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { PostgresSupportRepository } from '../repositories/support.repository.js';
import { signAccessToken } from '../../auth/utils/jwt.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'support through the real app factory and PostgreSQL',
  () => {
    // Deliberately omit the support dependency: this previously removed all support routes.
    const app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      new PostgresAdminRepository(pool),
    );
    const accounts = {
      customer: randomUUID(),
      driver: randomUUID(),
      other: randomUUID(),
      super_admin: randomUUID(),
      admin: randomUUID(),
      reviewer: randomUUID(),
    };
    const headers: Record<string, string> = {};
    const payload = {
      category: 'App',
      subject: 'Unable to book a ride',
      message: 'The booking screen could not submit my ride.',
    };
    beforeAll(async () => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Disposable local database required');
      for (const [role, id] of Object.entries(accounts)) {
        const actualRole = role === 'other' ? 'customer' : role === 'reviewer' ? 'admin' : role;
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role,status) VALUES($1,'TEST_SAMPLE','Support',$2,$3,'active')",
          [id, id + '@example.invalid', actualRole],
        );
        headers[role] =
          'Bearer ' + (await signAccessToken({ sub: id, role: actualRole, type: 'access' }));
      }
      const grant = await pool.query('INSERT INTO admin_roles(name) VALUES($1) RETURNING id', [
        'TEST_SAMPLE support ' + randomUUID(),
      ]);
      for (const action of ['read', 'update']) {
        await pool.query(
          "INSERT INTO admin_permissions(resource,action) VALUES('support',$1) ON CONFLICT(resource,action) DO NOTHING",
          [action],
        );
        await pool.query(
          "INSERT INTO admin_role_permissions(role_id,permission_id) SELECT $1,id FROM admin_permissions WHERE resource='support' AND action=$2",
          [grant.rows[0].id, action],
        );
      }
      await pool.query(
        'INSERT INTO admin_user_roles(user_id,role_id,assigned_by) VALUES($1,$2,$3)',
        [accounts.reviewer, grant.rows[0].id, accounts.super_admin],
      );
    });
    it('registers support even without an injected repository; missing authentication is 401', async () => {
      expect((await request(app).get('/support/tickets')).status).toBe(401);
      expect((await request(app).post('/support/tickets').send(payload)).status).toBe(401);
    });
    it.each(['customer', 'driver'] as const)(
      'persists the complete %s lifecycle, ticket number, ownership and audit trail',
      async (role) => {
        const submission = { ...payload, requestId: randomBytes(16).toString('hex') };
        const created = await request(app)
          .post('/support/tickets')
          .set('Authorization', headers[role]!)
          .send(submission);
        expect(created.status).toBe(201);
        const ticket = created.body.data;
        expect(ticket).toMatchObject({ userId: accounts[role], role, status: 'OPEN', version: 1 });
        expect(ticket.ticketNumber).toMatch(/^INF-SUP-\d{6,19}$/);
        const replay = await request(app)
          .post('/support/tickets')
          .set('Authorization', headers[role]!)
          .send(submission);
        expect(replay.status).toBe(201);
        expect(replay.body.data.id).toBe(ticket.id);
        expect(
          (
            await request(app)
              .post('/support/tickets')
              .set('Authorization', headers[role]!)
              .send({ ...submission, message: 'Different issue with the same request identifier' })
          ).status,
        ).toBe(409);
        for (const identifier of [ticket.id, ticket.ticketNumber]) {
          expect(
            (
              await request(app)
                .get('/support/tickets/' + identifier)
                .set('Authorization', headers[role]!)
            ).body.data,
          ).toMatchObject(ticket);
          expect(
            (
              await request(app)
                .get('/support/tickets/' + identifier)
                .set('Authorization', headers.other!)
            ).status,
          ).toBe(403);
        }
        const adminPath = '/admin/operations/support/' + ticket.id + '/status';
        expect(
          (
            await request(app)
              .patch(adminPath)
              .set('Authorization', headers[role]!)
              .send({ status: 'RESOLVED', expectedVersion: 1 })
          ).status,
        ).toBe(403);
        expect(
          (
            await request(app)
              .patch(adminPath)
              .set('Authorization', headers.admin!)
              .send({ status: 'RESOLVED', expectedVersion: 1 })
          ).status,
        ).toBe(403);
        const listed = await request(app)
          .get('/admin/operations/support?search=' + ticket.ticketNumber)
          .set('Authorization', headers.super_admin!);
        expect(listed.status).toBe(200);
        expect(listed.body.data.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: ticket.id,
              ticket_number: ticket.ticketNumber,
              role,
              message: payload.message,
              status: 'OPEN',
              account_display_name: 'TEST_SAMPLE Support',
            }),
          ]),
        );
        expect(
          (
            await request(app)
              .patch(adminPath)
              .set('Authorization', headers.super_admin!)
              .send({ status: 'CLOSED', expectedVersion: 1 })
          ).status,
        ).toBe(409);
        let version = 1;
        for (const status of ['UNDER_REVIEW', 'RESOLVED', 'CLOSED']) {
          const updated = await request(app)
            .patch(adminPath)
            .set(
              'Authorization',
              status === 'UNDER_REVIEW' ? headers.reviewer! : headers.super_admin!,
            )
            .send({ status, expectedVersion: version });
          expect(updated.status).toBe(200);
          version++;
          expect(updated.body.data).toMatchObject({ status, version });
          expect(
            (
              await request(app)
                .get('/support/tickets/' + ticket.ticketNumber)
                .set('Authorization', headers[role]!)
            ).body.data.status,
          ).toBe(status);
          expect(
            (await request(app).get('/support/tickets').set('Authorization', headers[role]!)).body
              .data,
          ).toEqual(expect.arrayContaining([expect.objectContaining({ id: ticket.id, status })]));
          const visible = await request(app)
            .get('/admin/operations/support?recordId=' + ticket.id)
            .set('Authorization', headers.super_admin!);
          expect(visible.body.data.items[0].status).toBe(status);
        }
        expect(
          (await new PostgresSupportRepository(pool).getTicketById(accounts[role], ticket.id))
            ?.status,
        ).toBe('CLOSED');
        expect(
          (
            await request(app)
              .patch(adminPath)
              .set('Authorization', headers.super_admin!)
              .send({ status: 'OPEN', expectedVersion: 4 })
          ).status,
        ).toBe(409);
        expect(
          (
            await request(app)
              .patch(adminPath)
              .set('Authorization', headers.super_admin!)
              .send({ status: 'CLOSED', expectedVersion: 1 })
          ).status,
        ).toBe(409);
        const before = (
          await pool.query(
            'SELECT count(*)::int AS n FROM user_history WHERE entity_type=$1 AND entity_id=$2',
            ['support_ticket', ticket.id],
          )
        ).rows[0].n;
        expect(before).toBe(4);
        expect(
          (
            await request(app)
              .patch(adminPath)
              .set('Authorization', headers.super_admin!)
              .send({ status: 'CLOSED', expectedVersion: 4 })
          ).status,
        ).toBe(200);
        expect(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM user_history WHERE entity_type=$1 AND entity_id=$2',
              ['support_ticket', ticket.id],
            )
          ).rows[0].n,
        ).toBe(before);
      },
    );
    it('validates references, input and administrative status requests with meaningful HTTP codes', async () => {
      for (const [identifier, status] of [
        ['bad-id', 400],
        [randomUUID(), 404],
        ['INF-SUP-999999999', 404],
      ])
        expect(
          (
            await request(app)
              .get('/support/tickets/' + identifier)
              .set('Authorization', headers.customer!)
          ).status,
        ).toBe(status);
      for (const body of [
        {},
        { ...payload, status: 'CLOSED' },
        { ...payload, userId: accounts.other },
        { ...payload, subject: ' ' },
        { ...payload, requestId: 'bad' },
      ])
        expect(
          (
            await request(app)
              .post('/support/tickets')
              .set('Authorization', headers.customer!)
              .send(body)
          ).status,
        ).toBe(400);
      expect(
        (
          await request(app)
            .patch('/admin/operations/support/' + randomUUID() + '/status')
            .set('Authorization', headers.super_admin!)
            .send({ status: 'RESOLVED', expectedVersion: 1 })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .patch('/admin/operations/support/' + randomUUID() + '/status')
            .set('Authorization', headers.super_admin!)
            .send({ status: 'NOT_A_STATUS', expectedVersion: 1 })
        ).status,
      ).toBe(400);
    });
    it.each(['customer', 'driver'] as const)(
      'returns actionable validation errors without persisting rejected %s submissions',
      async (role) => {
        const count = async () =>
          Number(
            (
              await pool.query('SELECT count(*) AS n FROM support_tickets WHERE user_id=$1', [
                accounts[role],
              ])
            ).rows[0].n,
          );
        const before = await count();
        const cases: [Record<string, unknown>, string, string][] = [
          [
            { subject: payload.subject, message: payload.message },
            'category',
            'Category is required',
          ],
          [{ category: 'App', message: payload.message }, 'subject', 'Subject is required'],
          [{ category: 'App', subject: payload.subject }, 'message', 'Message is required'],
          [{ ...payload, subject: 42 }, 'subject', 'Subject is required and must be text'],
          [
            { ...payload, message: ['private issue'] },
            'message',
            'Message is required and must be text',
          ],
          [{ ...payload, category: null }, 'category', 'Category is required'],
          [{ ...payload, subject: '  ' }, 'subject', 'Subject must be at least 3'],
          [{ ...payload, message: 'tiny' }, 'message', 'Message must be at least 5'],
          [{ ...payload, subject: 's'.repeat(201) }, 'subject', 'Subject must be at most 200'],
          [{ ...payload, message: 'm'.repeat(5001) }, 'message', 'Message must be at most 5000'],
          [{ ...payload, category: 'c'.repeat(51) }, 'category', 'Category must be at most 50'],
          [{ ...payload, requestId: 'bad' }, 'requestId', 'Submission identifier must contain 32'],
          [{ ...payload, description: 'private issue' }, 'request', 'unsupported fields'],
        ];
        for (const [body, field, message] of cases) {
          const result = await request(app)
            .post('/support/tickets')
            .set('Authorization', headers[role]!)
            .send(body);
          expect(result.status).toBe(400);
          expect(result.body.success).toBe(false);
          expect(result.body.error.code).toBe('VALIDATION_ERROR');
          expect(result.body.error.message).toContain(message);
          expect(result.body.error.details).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ field, message: expect.stringContaining(message) }),
            ]),
          );
          expect(JSON.stringify(result.body)).not.toContain('private issue');
        }
        const malformed = await request(app)
          .post('/support/tickets')
          .set('Authorization', headers[role]!)
          .set('Content-Type', 'application/json')
          .send('{"subject":');
        expect(malformed.status).toBe(400);
        expect(malformed.body.error).toEqual({
          code: 'INVALID_JSON',
          message: 'The request body must contain valid JSON.',
        });
        expect(await count()).toBe(before);
        for (const query of ['page=0', 'pageSize=101', 'page=abc', 'includePagination=false']) {
          const invalid = await request(app)
            .get('/support/tickets?' + query)
            .set('Authorization', headers[role]!);
          expect(invalid.status).toBe(400);
          expect(invalid.body.error.details).toHaveLength(1);
        }
        for (const query of ['page=1&pageSize=25', 'page=1&pageSize=25&includePagination=true']) {
          const valid = await request(app)
            .get('/support/tickets?' + query)
            .set('Authorization', headers[role]!);
          expect(valid.status).toBe(200);
          expect(Array.isArray(valid.body.data)).toBe(true);
        }
      },
    );
    it('allocates unique persistent numbers under concurrency and coalesces identical submission retries', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          request(app).post('/support/tickets').set('Authorization', headers.driver!).send(payload),
        ),
      );
      expect(results.every((response) => response.status === 201)).toBe(true);
      expect(new Set(results.map((response) => response.body.data.ticketNumber)).size).toBe(20);
      const body = { ...payload, requestId: randomBytes(16).toString('hex') };
      const retries = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(app).post('/support/tickets').set('Authorization', headers.driver!).send(body),
        ),
      );
      expect(retries.every((response) => response.status === 201)).toBe(true);
      expect(new Set(retries.map((response) => response.body.data.id)).size).toBe(1);
    });
    it('permits only one concurrent administrative update at a given version', async () => {
      const created = await request(app)
        .post('/support/tickets')
        .set('Authorization', headers.customer!)
        .send(payload);
      const path = '/admin/operations/support/' + created.body.data.id + '/status';
      const changes = await Promise.all(
        ['UNDER_REVIEW', 'RESOLVED'].map((status) =>
          request(app)
            .patch(path)
            .set('Authorization', headers.super_admin!)
            .send({ status, expectedVersion: 1 }),
        ),
      );
      expect(changes.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(
        (
          await pool.query('SELECT version FROM support_tickets WHERE id=$1', [
            created.body.data.id,
          ])
        ).rows[0].version,
      ).toBe(2);
    });
  },
);
