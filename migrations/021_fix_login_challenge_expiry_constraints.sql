BEGIN;

ALTER TABLE login_challenges
    DROP CONSTRAINT login_challenges_expiry_check;

ALTER TABLE login_challenges
    DROP CONSTRAINT login_challenges_provider_expiry_check;

COMMIT;