export interface ProviderBankAccount {
  id: string;
  userId: string;
  accountHolderName: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
  ifscCode: string;
  bankName: string;
  branchName?: string | null;
  accountType?: 'SAVINGS' | 'CURRENT' | 'OTHER' | null;
  ownershipType?: 'INDIVIDUAL' | 'BUSINESS';
  legalEntityName?: string | null;
  supportingDocumentId?: string | null;
  upiId?: string | null;
  isVerified: boolean;
  nameComparison?: string;
  supportingDocumentStatus?: string | null;
  supportingDocumentApprovalId?: string | null;
  reviewStatus?: string | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertBankAccountInput {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName?: string | null;
  accountType?: 'SAVINGS' | 'CURRENT' | 'OTHER' | null;
  ownershipType?: 'INDIVIDUAL' | 'BUSINESS';
  legalEntityName?: string | null;
  supportingDocumentId?: string | null;
  upiId?: string;
}
