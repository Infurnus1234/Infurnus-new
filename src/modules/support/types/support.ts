export interface SupportTicket {
  id: string;
  ticketNumber: string;
  userId: string;
  role: string;
  category: string;
  subject: string;
  message: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupportTicketInput {
  category: string;
  subject: string;
  message: string;
}
