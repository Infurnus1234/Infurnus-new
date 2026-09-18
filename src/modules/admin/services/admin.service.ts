import { AppError } from '../../../common/errors/app-error.js';
import type { AdminRepository } from '../repositories/admin.repository.js';
import type { AdminFilters } from '../types/admin.js';

export class AdminService {
  constructor(private readonly repository: AdminRepository) {}

  listUsers(filters: AdminFilters) {
    return this.repository.listUsers(filters);
  }

  async getUser(id: string) {
    const user = await this.repository.getUser(id);
    if (!user) throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    return user;
  }

  listPartners(filters: AdminFilters) {
    return this.repository.listPartners(filters);
  }

  async getPartner(id: string) {
    const partner = await this.repository.getPartner(id);
    if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    return partner;
  }

  listVehicles(filters: AdminFilters) {
    return this.repository.listVehicles(filters);
  }

  async getVehicle(id: string) {
    const vehicle = await this.repository.getVehicle(id);
    if (!vehicle) throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    return vehicle;
  }

  dashboard() {
    return this.repository.dashboard();
  }

  async verifyDriver(driverId: string, status: string, rejectionReason?: string) {
    const success = await this.repository.verifyDriver(driverId, status, rejectionReason);
    if (!success) throw new AppError('DRIVER_NOT_FOUND', 'Driver profile not found', 404);
    return { success: true, driverId, status };
  }

  async verifyVehicle(vehicleId: string, status: string, rejectionReason?: string) {
    const success = await this.repository.verifyVehicle(vehicleId, status, rejectionReason);
    if (!success) throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    return { success: true, vehicleId, status };
  }

  async verifyDocument(documentId: string, status: string, comments?: string) {
    const success = await this.repository.verifyDocument(documentId, status, comments);
    if (!success) throw new AppError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    return { success: true, documentId, status };
  }
}
