BEGIN;

-- Vehicles are defined in 001_create_users_auth_foundation.sql.
-- This migration verifies that the deployed schema contains the required
-- vehicle integrity boundary without recreating or rewriting the table.
DO $$
DECLARE
    missing_count INTEGER;
BEGIN
    IF to_regclass('public.vehicles') IS NULL THEN
        RAISE EXCEPTION 'vehicles table must be created by migration 001 before migration 006';
    END IF;

    SELECT COUNT(*) INTO missing_count
    FROM (VALUES
        ('id'),
        ('driver_profile_id'),
        ('make'),
        ('model'),
        ('color'),
        ('plate_number'),
        ('is_active'),
        ('retired_at'),
        ('created_at'),
        ('updated_at')
    ) AS required(column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vehicles'
          AND information_schema.columns.column_name = required.column_name
    );

    IF missing_count > 0 THEN
        RAISE EXCEPTION 'vehicles table is missing required columns';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.vehicles'::regclass
          AND conname = 'vehicles_active_retirement_ck'
    ) THEN
        RAISE EXCEPTION 'vehicles retirement invariant is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint constraint_row
        JOIN pg_attribute attribute_row
          ON attribute_row.attrelid = constraint_row.conrelid
         AND attribute_row.attnum = ANY (constraint_row.conkey)
        WHERE constraint_row.conrelid = 'public.vehicles'::regclass
          AND constraint_row.contype = 'f'
          AND attribute_row.attname = 'driver_profile_id'
          AND constraint_row.confrelid = 'public.driver_profiles'::regclass
    ) THEN
        RAISE EXCEPTION 'vehicles driver_profile_id foreign key is missing';
    END IF;

    IF to_regclass('public.vehicles_plate_number_active_uidx') IS NULL
       OR to_regclass('public.vehicles_one_active_per_driver_uidx') IS NULL
       OR to_regclass('public.vehicles_driver_profile_id_idx') IS NULL THEN
        RAISE EXCEPTION 'vehicles required indexes are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.vehicles'::regclass
          AND tgname = 'vehicles_set_updated_at'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'vehicles updated_at trigger is missing';
    END IF;
END;
$$;

COMMIT;