export interface ProviderBankAccount {
  id: string;
  userId: string;
  accountHolderName: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
  ifscCode: string;
  bankName: string;
  upiId?: string | null;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertBankAccountInput {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  upiId?: string;
}
