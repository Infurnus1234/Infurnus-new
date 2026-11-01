import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fixture, actor } from './fleet-workflow-fixture.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { ManagedDriverRepository } from '../repositories/managed-driver.repository.js';
import { createManagedDriverRouter } from '../routes/managed-driver.routes.js';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')('Fleet Driver draft creation over HTTP',()=>{
 const app=express();app.use(express.json());app.use('/provider',requireAuth,createManagedDriverRouter(new ManagedDriverRepository(pool)));app.use(errorMiddleware);
 const token=(id:string,role='fleet_owner')=>signAccessToken({sub:id,role,type:'access'});
 it('pending Fleet saves and retrieves a pending Driver, retries idempotently, and cannot operate or cross Fleet boundaries',async()=>{
  const f=await fixture(),other=await fixture();
  await pool.query("UPDATE partners SET approval_status='under_review' WHERE id=$1",[f.partner]);
  const auth='Bearer '+await token(f.owner);
  const body={firstName:'TEST_SAMPLE',lastName:'Pending Fleet Driver',email:randomUUID()+'@example.invalid',licenseNumber:'TEST-'+randomUUID(),licenseExpiry:'2090-01-01'};
  const before=(await pool.query('SELECT (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM vehicles) vehicles')).rows[0];
  const saved=await request(app).post('/provider/managed-drivers').set('authorization',auth).send(body);
  expect(saved.status,saved.text).toBe(201);
  expect(saved.body.data.verificationStatus).toBe('pending');
  const again=await request(app).post('/provider/managed-drivers').set('authorization',auth).send(body);
  expect(again.status,again.text).toBe(201);expect(again.body.data.userId).toBe(saved.body.data.userId);
  const listed=await request(app).get('/provider/managed-drivers').set('authorization',auth);
  expect(listed.status,listed.text).toBe(200);expect(listed.body.data.some((r:{userId:string})=>r.userId===saved.body.data.userId)).toBe(true);
  expect((await request(app).get('/provider/managed-drivers/'+saved.body.data.userId).set('authorization','Bearer '+await token(other.owner))).status).toBe(404);
  expect((await request(app).post('/provider/managed-drivers/'+saved.body.data.userId+'/assignment').set('authorization',auth).send({code:f.code})).status).toBe(409);
  expect((await request(app).post('/provider/managed-drivers').set('authorization',auth).send({...body,email:randomUUID()+'@example.invalid'})).status).toBe(409);
  const after=(await pool.query('SELECT (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM vehicles) vehicles')).rows[0];
  expect(after).toEqual({users:before.users+1,vehicles:before.vehicles});
  expect((await pool.query('SELECT 1 FROM user_credentials WHERE user_id=$1',[saved.body.data.userId])).rowCount).toBe(0);
 });
 it('returns useful validation and missing-profile errors without creating records',async()=>{
  const owner=await actor('fleet_owner');
  const auth='Bearer '+await token(owner);
  const body={firstName:'TEST_SAMPLE',lastName:'Validation',email:randomUUID()+'@example.invalid',licenseNumber:'TEST-'+randomUUID(),licenseExpiry:'2090-01-01'};
  expect((await request(app).post('/provider/managed-drivers').set('authorization',auth).send({...body,email:'bad-email'})).status).toBe(400);
  const result=await request(app).post('/provider/managed-drivers').set('authorization',auth).send(body);
  expect(result.status,result.text).toBe(409);expect(result.body.error.code).toBe('BUSINESS_PROFILE_REQUIRED');
 });
});
