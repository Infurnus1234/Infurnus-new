import type { ProviderBankRepository } from '../repositories/provider-bank.repository.js';
import type { UpsertBankAccountInput } from '../schemas/provider.schemas.js';
import type { ProviderBankAccount } from '../types/provider.js';

export class ProviderService {
  constructor(private readonly bankRepo: ProviderBankRepository) {}

  async getBankAccount(userId: string): Promise<ProviderBankAccount | null> {
    return this.bankRepo.getBankAccount(userId);
  }

  async upsertBankAccount(
    userId: string,
    input: UpsertBankAccountInput,
  ): Promise<ProviderBankAccount> {
    return this.bankRepo.upsertBankAccount(userId, input);
  }
}
