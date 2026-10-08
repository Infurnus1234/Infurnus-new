import { GoogleIdentityProvider } from '../providers/google-identity.provider.js';
import { PostgresGoogleIdentityRepository } from '../repositories/google-identity.repository.js';

export class GoogleAuthService {
  constructor(
    private readonly provider: Pick<
      GoogleIdentityProvider,
      'verify'
    > = new GoogleIdentityProvider(),
    private readonly repository: Pick<
      PostgresGoogleIdentityRepository,
      'resolve'
    > = new PostgresGoogleIdentityRepository(),
  ) {}

  async authenticate(idToken: string, linkUserId?: string) {
    return this.repository.resolve(await this.provider.verify(idToken), linkUserId);
  }
}
