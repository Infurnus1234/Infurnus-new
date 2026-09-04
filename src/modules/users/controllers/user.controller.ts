import type { NextFunction, Request, Response } from 'express';
import {
  createAddressSchema,
  createUserSchema,
  updateAddressSchema,
  updatePreferencesSchema,
  userAddressParamsSchema,
  userIdSchema,
  updateUserSchema,
} from '../schemas/user.schemas.js';
import type { UserService } from '../services/user.service.js';

export class UserController {
  constructor(private readonly service: UserService) {}

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const data = createUserSchema.parse(request.body);
      const user = await this.service.createUser(data);
      response.status(201).json({ success: true, data: user, message: 'User created' });
    } catch (error) {
      next(error);
    }
  };

  getById = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = userIdSchema.parse(request.params);
      const user = await this.service.getUser(id);
      response.json({ success: true, data: user, message: 'User retrieved' });
    } catch (error) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = userIdSchema.parse(request.params);
      const data = updateUserSchema.parse(request.body);
      const user = await this.service.updateUser(id, data);
      response.json({ success: true, data: user, message: 'User updated' });
    } catch (error) {
      next(error);
    }
  };

  createAddress = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = userIdSchema.parse(request.params);
      const address = await this.service.createAddress(id, createAddressSchema.parse(request.body));
      response.status(201).json({ success: true, data: address, message: 'Address created' });
    } catch (error) {
      next(error);
    }
  };

  updateAddress = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id, addressId } = userAddressParamsSchema.parse(request.params);
      const address = await this.service.updateAddress(id, addressId, updateAddressSchema.parse(request.body));
      response.json({ success: true, data: address, message: 'Address updated' });
    } catch (error) {
      next(error);
    }
  };

  getAddresses = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = userIdSchema.parse(request.params);
      const addresses = await this.service.getAddresses(id);
      response.json({ success: true, data: addresses, message: 'Addresses retrieved' });
    } catch (error) {
      next(error);
    }
  };

  getPreferences = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = userIdSchema.parse(request.params);
      const preferences = await this.service.getPreferences(id);
      response.json({ success: true, data: preferences, message: 'Preferences retrieved' });
    } catch (error) {
      next(error);
    }
  };

  updatePreferences = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = userIdSchema.parse(request.params);
      const preferences = await this.service.updatePreferences(id, updatePreferencesSchema.parse(request.body));
      response.json({ success: true, data: preferences, message: 'Preferences updated' });
    } catch (error) {
      next(error);
    }
  };
}
