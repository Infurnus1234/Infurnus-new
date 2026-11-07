import { randomUUID } from 'node:crypto';
import { beforeAll,describe,expect,it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from './administrative-test-database.js';
import { AdminOperationsRepository,operationQuerySchema } from '../repositories/operations.repository.js';
describe.runIf(process.env.PROVIDER_DB_TESTS==='true')('Admin public Booking ID records',()=>{
 beforeAll(()=>requireDisposableAdministrativeDatabase());
 it('projects and searches the existing public ID while retaining permanent row identity',async()=>{
  const customer=randomUUID();await pool.query("INSERT INTO users(id,first_name,last_name,role) VALUES($1,'Booking UI','Fixture','customer')",[customer]);
  const ride=(await pool.query("INSERT INTO rides(customer_id,sector,status,pickup_location,destination_location) VALUES($1,'logistics','searching',ST_SetSRID(ST_MakePoint(85,25),4326)::geography,ST_SetSRID(ST_MakePoint(85.2,25.2),4326)::geography) RETURNING id,booking_id",[customer])).rows[0];
  const repository=new AdminOperationsRepository(pool);
  const list=await repository.list('rides',operationQuerySchema.parse({search:ride.booking_id,pageSize:10}));
  expect(list.items.some(row=>row.id===ride.id&&row.booking_id===ride.booking_id)).toBe(true);
  const detail=await repository.list('rides',operationQuerySchema.parse({recordId:ride.id,pageSize:1}));
  expect(detail.items[0]?.id).toBe(ride.id);expect(detail.items[0]?.booking_id).toBe(ride.booking_id);
 });
});
