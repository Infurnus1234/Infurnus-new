// Temporary owner-approved policy: only administrative password login skips OTP.
// Re-enabling OTP requires a deliberate backend/frontend contract change and tests.
export function isPasswordOnlyAdmin(role: string): boolean {
  return role === 'admin' || role === 'super_admin';
}
