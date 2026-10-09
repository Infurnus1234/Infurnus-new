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

  async authenticate(
    idToken: string,
    linkUserId?: string,
    driverFlow?: 'signup' | 'signin',
    providerRole?: 'driver' | 'fleet_owner' | 'driver_fleet_owner',
  ) {
    return this.repository.resolve(
      await this.provider.verify(idToken),
      linkUserId,
      driverFlow,
      providerRole,
    );
  }
}
