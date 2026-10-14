import { vi } from 'vitest';
import { AdminManagementService } from '../services/admin-management.service.js';
import { permissionCatalog } from '../services/permission-policy.js';
// Existing in-memory controller tests have synthetic identities rather than database users.
// Model their explicitly authorized actor at the new DB identity boundary. JWT verification,
// route permission policy, controller validation and all prior assertions still execute.
// Real grants, revocation, stale roles and zero-grant denial are covered by the database suite.
vi.spyOn(AdminManagementService.prototype, 'identity').mockImplementation(async (id, role) => ({
  id,
  firstName: 'TEST_ONLY',
  lastName: 'Authorized actor',
  email: 'fixture@example.invalid',
  role: role || 'admin',
  status: 'active',
  updatedAt: 'fixture',
  permissions: [...permissionCatalog],
  scoped: false,
}));
