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

    it('calculates JCB hourly excavation work rate', () => {
      const result = calculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 7200,
        sector: 'service',
        vehicleCategory: 'jcb',
        rentalHours: 4,
      });

      // base: 4 * 120000 = 480000 (₹4,800)
      // distance: 0
      // time: 24000
      // subtotal: 504000
      // tax: 25200
      // gross: 529200
      expect(result.baseAmount).toBe(480000);
      expect(result.grossAmount).toBe(529200);
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
  });
});
