import { describe, expect, it } from 'vitest';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import type { FarePricingConfig } from '../types/fare.js';

describe('INFURNUS 4-Sector Fare Calculations', () => {
  const pricing: FarePricingConfig = {
    baseFare: 5000, // ₹50.00
    distanceRatePerKm: 1500, // ₹15.00 / km
    timeRatePerMinute: 200, // ₹2.00 / min
    currency: 'INR',
    pricingVersion: 'v1-sector-test',
  };

  const calculator = new FareCalculatorService(pricing);

  describe('Sector 1: Passenger', () => {
    it('calculates passenger fare with waiting time and 5% GST', () => {
      const result = calculator.calculate({
        distanceMeters: 10000, // 10 km
        durationSeconds: 1200, // 20 mins
        sector: 'passenger',
        vehicleCategory: 'sedan', // 1.25x
        waitingMinutes: 8, // 8 - 3 = 5 billable mins @ ₹2/min = 1000 paise
      });

      // base: 5000 * 1.25 = 6250
      // distance: (10000 * 1500 / 1000) * 1.25 = 18750
      // time: (1200 * 200 / 60) = 4000
      // waiting: 5 * 200 = 1000
      // subtotal: 6250 + 18750 + 4000 + 1000 = 30000 (₹300.00)
      // tax: 0 (passenger uses subtotal directly unless separate tax specified)
      expect(result.baseAmount).toBe(6250);
      expect(result.distanceAmount).toBe(18750);
      expect(result.timeAmount).toBe(4000);
      expect(result.waitingAmount).toBe(1000);
      expect(result.grossAmount).toBe(30000);
    });

    it('scales fare for Auto (0.7x) and SUV (1.6x)', () => {
      const autoFare = calculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 600,
        sector: 'passenger',
        vehicleCategory: 'auto',
      });

      const suvFare = calculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 600,
        sector: 'passenger',
        vehicleCategory: 'suv',
      });

      expect(autoFare.grossAmount).toBeLessThan(suvFare.grossAmount);
      expect(autoFare.baseAmount).toBe(3500); // 5000 * 0.7
      expect(suvFare.baseAmount).toBe(8000); // 5000 * 1.6
    });
  });

  describe('Sector 2: Logistics', () => {
    it('calculates logistics fare with load surcharge, helper fee, and 5% GST', () => {
      const result = calculator.calculate({
        distanceMeters: 15000, // 15 km
        durationSeconds: 1800,
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
        weightKg: 45, // 25kg excess @ ₹5/kg = 12500 paise
        hasLoadingAssistance: true, // 15000 paise (₹150)
      });

      // base: 5000 * 2.5 = 12500
      // distance: (15000 * 1500 / 1000) * 1.8 = 40500
      // time: (1800 * 200 / 60) = 6000
      // weight: 25 * 500 = 12500
      // loading: 15000
      // subtotal: 12500 + 40500 + 6000 + 12500 + 15000 = 86500
      // tax: 86500 * 0.05 = 4325
      // gross: 86500 + 4325 = 90825
      expect(result.baseAmount).toBe(12500);
      expect(result.distanceAmount).toBe(40500);
      expect(result.weightAmount).toBe(12500);
      expect(result.loadingAmount).toBe(15000);
      expect(result.taxAmount).toBe(4325);
      expect(result.grossAmount).toBe(90825);
    });
  });

  describe('Sector 3: Service Vehicle', () => {
    it('calculates Ambulance flat emergency response + distance fare', () => {
      const result = calculator.calculate({
        distanceMeters: 10000, // 10 km
        durationSeconds: 900,
        sector: 'service',
        vehicleCategory: 'ambulance',
      });

      // base: 50000 (₹500)
      // distance: 10 * 2500 = 25000 (₹250)
      // time: (900 * 200 / 60) = 3000
      // subtotal: 50000 + 25000 + 3000 = 78000
      // tax: 78000 * 0.05 = 3900
      // gross: 81900
      expect(result.baseAmount).toBe(50000);
      expect(result.distanceAmount).toBe(25000);
      expect(result.grossAmount).toBe(81900);
    });

    it('calculates Towing Hookup + per-km rate', () => {
      const result = calculator.calculate({
        distanceMeters: 20000, // 20 km
        durationSeconds: 1800,
        sector: 'service',
        vehicleCategory: 'towing',
      });

      // base: 60000 (₹600)
      // distance: 20 * 3000 = 60000 (₹600)
      // time: (1800 * 200 / 60) = 6000
      // subtotal: 126000
      // tax: 126000 * 0.05 = 6300
      // gross: 132300
      expect(result.baseAmount).toBe(60000);
      expect(result.distanceAmount).toBe(60000);
      expect(result.grossAmount).toBe(132300);
    });

    it('calculates JCB trip-based mobilization + distance fare', () => {
      const result = calculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 7200,
        sector: 'service',
        vehicleCategory: 'jcb',
      });

      // base: 120000 (₹1,200 flat mobilization charge)
      // distance: (5000 * 4000 / 1000) = 20000 (₹200 distance charge @ ₹40/km)
      // time: (7200 * 200 / 60) = 24000 (₹240 time charge @ ₹2/min)
      // subtotal: 120000 + 20000 + 24000 = 164000 (₹1,640)
      // tax: 164000 * 0.05 = 8200 (5% GST)
      // gross: 164000 + 8200 = 172200 (₹1,722)
      expect(result.baseAmount).toBe(120000);
      expect(result.distanceAmount).toBe(20000);
      expect(result.timeAmount).toBe(24000);
      expect(result.taxAmount).toBe(8200);
      expect(result.grossAmount).toBe(172200);
    });

    it('proves rentalHours cannot manipulate JCB fare (immunity from hourly tampering)', () => {
      const tripBasedStandard = calculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 7200,
        sector: 'service',
        vehicleCategory: 'jcb',
      });

      const tamperedWithHours = calculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 7200,
        sector: 'service',
        vehicleCategory: 'jcb',
        rentalHours: 10,
      });

      expect(tamperedWithHours.baseAmount).toBe(120000);
      expect(tamperedWithHours.distanceAmount).toBe(20000);
      expect(tamperedWithHours.grossAmount).toBe(172200);
      expect(tamperedWithHours.grossAmount).toBe(tripBasedStandard.grossAmount);
    });

    it('calculates Recovery Vehicle trip-based callout + distance fare', () => {
      const result = calculator.calculate({
        distanceMeters: 10000, // 10 km
        durationSeconds: 1200, // 20 mins
        sector: 'service',
        vehicleCategory: 'recovery',
      });

      // base: 60000 (₹600 callout)
      // distance: (10000 * 3000 / 1000) = 30000 (₹300)
      // time: (1200 * 200 / 60) = 4000 (₹40)
      // subtotal: 60000 + 30000 + 4000 = 94000
      // tax: 94000 * 0.05 = 4700
      // gross: 98700
      expect(result.baseAmount).toBe(60000);
      expect(result.distanceAmount).toBe(30000);
      expect(result.timeAmount).toBe(4000);
      expect(result.taxAmount).toBe(4700);
      expect(result.grossAmount).toBe(98700);

      const aliasResult = calculator.calculate({
        distanceMeters: 10000,
        durationSeconds: 1200,
        sector: 'service',
        vehicleCategory: 'recovery_vehicle',
      });
      expect(aliasResult.grossAmount).toBe(result.grossAmount);
    });

    it('calculates Roadside Service Vehicle trip-based dispatch + distance fare', () => {
      const result = calculator.calculate({
        distanceMeters: 8000, // 8 km
        durationSeconds: 900, // 15 mins
        sector: 'service',
        vehicleCategory: 'roadside_service',
      });

      // base: 60000 (₹600 dispatch)
      // distance: (8000 * 3000 / 1000) = 24000 (₹240)
      // time: (900 * 200 / 60) = 3000 (₹30)
      // subtotal: 60000 + 24000 + 3000 = 87000
      // tax: 87000 * 0.05 = 4350
      // gross: 91350
      expect(result.baseAmount).toBe(60000);
      expect(result.distanceAmount).toBe(24000);
      expect(result.timeAmount).toBe(3000);
      expect(result.taxAmount).toBe(4350);
      expect(result.grossAmount).toBe(91350);

      const aliasResult = calculator.calculate({
        distanceMeters: 8000,
        durationSeconds: 900,
        sector: 'service',
        vehicleCategory: 'roadside_service_vehicle',
      });
      expect(aliasResult.grossAmount).toBe(result.grossAmount);
    });

    it('proves rentalHours cannot manipulate Ambulance, Towing, Recovery, or Roadside fares', () => {
      const categories = ['ambulance', 'towing', 'recovery', 'roadside_service'];

      for (const cat of categories) {
        const standard = calculator.calculate({
          distanceMeters: 10000,
          durationSeconds: 900,
          sector: 'service',
          vehicleCategory: cat,
        });

        const tampered = calculator.calculate({
          distanceMeters: 10000,
          durationSeconds: 900,
          sector: 'service',
          vehicleCategory: cat,
          rentalHours: 8,
        });

        expect(tampered.baseAmount).toBe(standard.baseAmount);
        expect(tampered.distanceAmount).toBe(standard.distanceAmount);
        expect(tampered.grossAmount).toBe(standard.grossAmount);
      }
    });
  });

  describe('Sector 4: Premium Vehicle (Fortuner / Thar)', () => {
    it('calculates hourly package + separate fuel cost (actual GPS distance * fuel rate/km)', () => {
      const result = calculator.calculate({
        distanceMeters: 50000, // 50 km actual distance
        durationSeconds: 14400, // 4 hours
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalHours: 4,
        fuelRatePerKm: 1800, // ₹18.00 / km for Diesel Fortuner
      });

      // base: 4 * 100000 = 400000 (₹4,000)
      // fuel: 50 km * 1800 = 90000 (₹900 separate fuel bill)
      // distanceAmount: 0 (billed via fuelAmount)
      // timeAmount: 0 (covered in hourly base)
      // subtotal: 400000 + 90000 = 490000
      // tax: 490000 * 0.05 = 24500
      // gross: 514500
      expect(result.baseAmount).toBe(400000);
      expect(result.distanceAmount).toBe(0);
      expect(result.fuelAmount).toBe(90000);
      expect(result.taxAmount).toBe(24500);
      expect(result.grossAmount).toBe(514500);
    });

    it('proves Premium rental hours scale base price proportionally', () => {
      const twoHour = calculator.calculate({
        distanceMeters: 50000,
        durationSeconds: 7200,
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalHours: 2,
        fuelRatePerKm: 1800,
      });

      // base: 2 * 100000 = 200000
      // fuel: 50 * 1800 = 90000
      // subtotal: 290000
      // tax: 14500
      // gross: 304500
      expect(twoHour.baseAmount).toBe(200000);
      expect(twoHour.grossAmount).toBe(304500);
    });
  });
});
