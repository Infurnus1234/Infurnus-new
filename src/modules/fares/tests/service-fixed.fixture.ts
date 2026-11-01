import { canonicalVehicleCode } from '../config/fare.config.js';
import type { FareCalculationInput } from '../types/fare.js';
import type { FareCalculatorService } from '../services/fare-calculator.service.js';

/** Synthetic test prices only. Production Service fares are never seeded. */
export function calculateServiceFixture(calculator: FareCalculatorService, input: FareCalculationInput) {
  const code = canonicalVehicleCode('service', input.vehicleCategory ?? '');
  const serviceFixedFare = code === 'jcb' ? 1200 : code === 'ambulance' ? 500 : 600;
  const quote = calculator.calculateEstimate(input, {
    id:'service-unit-fixture', code, name:'TEST ONLY', sector:'service', active:true,
    baseFare:null, perKmRate:null, serviceFixedFare, serviceRadiusMeters:25000,
    currency:'INR', version:1, createdAt:new Date(0), updatedAt:new Date(0),
  });
  if (!('bookingFare' in quote) || !quote.bookingFare) throw Error('Missing Service fixed fare');
  return quote.bookingFare;
}
