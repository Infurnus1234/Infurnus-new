import type { NextFunction, Request, Response } from 'express';
import { createUserSchema, userIdSchema, updateUserSchema } from '../schemas/user.schemas.js';
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
}
