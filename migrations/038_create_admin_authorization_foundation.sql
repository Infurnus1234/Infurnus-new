BEGIN;

-- ============================================================
-- INFURNUS — Admin Authorization Foundation
--
-- Purpose:
--   1. Resource + Action permission catalog
--   2. Custom admin roles
--   3. Role -> Permission mapping
--   4. Admin user -> Role mapping
--   5. Admin scope assignments
--
-- Notes:
--   - Existing users.role is NOT modified.
--   - super_admin remains a platform-level role.
--   - This migration does NOT implement runtime authorization.
--   - Scope enforcement will be implemented in the authorization layer.
-- ============================================================


-- ============================================================
-- 1. Admin permission catalog
-- ============================================================

CREATE TABLE admin_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    resource VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,

    description TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT admin_permissions_resource_ck
        CHECK (length(trim(resource)) > 0),

    CONSTRAINT admin_permissions_action_ck
        CHECK (length(trim(action)) > 0),

    CONSTRAINT admin_permissions_resource_action_uidx
        UNIQUE (resource, action)
);


CREATE INDEX admin_permissions_resource_idx
    ON admin_permissions(resource);

CREATE INDEX admin_permissions_active_idx
    ON admin_permissions(is_active)
    WHERE is_active = TRUE;


CREATE TRIGGER admin_permissions_set_updated_at
BEFORE UPDATE ON admin_permissions
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- 2. Custom Admin Roles
--
-- These are authorization roles inside the Admin system.
-- They do NOT replace users.role.
-- ============================================================

CREATE TABLE admin_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL,
    description TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID
        REFERENCES users(id)
        ON DELETE RESTRICT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT admin_roles_name_ck
        CHECK (length(trim(name)) > 0)
);


CREATE UNIQUE INDEX admin_roles_name_lower_uidx
    ON admin_roles(lower(name));

CREATE INDEX admin_roles_active_idx
    ON admin_roles(is_active)
    WHERE is_active = TRUE;


CREATE TRIGGER admin_roles_set_updated_at
BEFORE UPDATE ON admin_roles
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();


-- ============================================================
-- 3. Admin Role -> Permission mapping
-- ============================================================

CREATE TABLE admin_role_permissions (
    role_id UUID NOT NULL
        REFERENCES admin_roles(id)
        ON DELETE CASCADE,

    permission_id UUID NOT NULL
        REFERENCES admin_permissions(id)
        ON DELETE RESTRICT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (role_id, permission_id)
);


CREATE INDEX admin_role_permissions_permission_idx
    ON admin_role_permissions(permission_id);


-- ============================================================
-- 4. Admin User -> Custom Role mapping
--
-- A user can have multiple authorization roles.
-- Only admin/super_admin identities should be assigned
-- by the application/service layer.
-- ============================================================

CREATE TABLE admin_user_roles (
    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE RESTRICT,

    role_id UUID NOT NULL
        REFERENCES admin_roles(id)
        ON DELETE RESTRICT,

    assigned_by UUID
        REFERENCES users(id)
        ON DELETE RESTRICT,

    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    revoked_at TIMESTAMPTZ,

    PRIMARY KEY (user_id, role_id),

    CONSTRAINT admin_user_roles_revocation_ck
        CHECK (
            revoked_at IS NULL
            OR revoked_at >= assigned_at
        )
);


CREATE INDEX admin_user_roles_user_active_idx
    ON admin_user_roles(user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX admin_user_roles_role_active_idx
    ON admin_user_roles(role_id)
    WHERE revoked_at IS NULL;


-- ============================================================
-- 5. Admin Scope Assignments
--
-- Scope types:
--   STATE
--   DISTRICT
--   CITY
--   PARTNER
--   FLEET
--   VEHICLE
--   DRIVER
--   USER
--
-- scope_value stores the corresponding identifier.
--
-- Examples:
--   STATE    -> Rajasthan
--   DISTRICT -> Jaipur
--   CITY     -> Jaipur
--   PARTNER  -> partner UUID
--   FLEET    -> fleet UUID
--   VEHICLE  -> vehicle UUID
--   DRIVER   -> driver_profile UUID
--   USER     -> user UUID
--
-- Runtime validation and DB-level resource filtering
-- will be implemented by the authorization/query layer.
-- ============================================================

CREATE TYPE admin_scope_type AS ENUM (
    'STATE',
    'DISTRICT',
    'CITY',
    'PARTNER',
    'FLEET',
    'VEHICLE',
    'DRIVER',
    'USER'
);


CREATE TABLE admin_scope_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE RESTRICT,

    scope_type admin_scope_type NOT NULL,

    scope_value VARCHAR(255) NOT NULL,

    assigned_by UUID
        REFERENCES users(id)
        ON DELETE RESTRICT,

    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    revoked_at TIMESTAMPTZ,

    CONSTRAINT admin_scope_value_ck
        CHECK (length(trim(scope_value)) > 0),

    CONSTRAINT admin_scope_revocation_ck
        CHECK (
            revoked_at IS NULL
            OR revoked_at >= assigned_at
        )
);


CREATE UNIQUE INDEX admin_scope_assignments_active_uidx
    ON admin_scope_assignments(
        user_id,
        scope_type,
        scope_value
    )
    WHERE revoked_at IS NULL;


CREATE INDEX admin_scope_assignments_user_idx
    ON admin_scope_assignments(user_id)
    WHERE revoked_at IS NULL;


CREATE INDEX admin_scope_assignments_type_value_idx
    ON admin_scope_assignments(scope_type, scope_value)
    WHERE revoked_at IS NULL;


-- ============================================================
-- 6. Basic integrity trigger for admin role assignments
--
-- Only users whose platform role is admin or super_admin
-- may receive an admin authorization role.
--
-- This prevents accidental assignment of an admin role to
-- customer/driver accounts at the database level.
-- ============================================================

CREATE OR REPLACE FUNCTION validate_admin_user_role_assignment()
RETURNS TRIGGER AS $$
DECLARE
    assigned_user_role user_role;
BEGIN
    SELECT role
    INTO assigned_user_role
    FROM users
    WHERE id = NEW.user_id
      AND deleted_at IS NULL;

    IF assigned_user_role IS NULL THEN
        RAISE EXCEPTION
            'Cannot assign admin authorization role to a missing or deleted user';
    END IF;

    IF assigned_user_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION
            'Only admin or super_admin users can receive admin authorization roles';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER admin_user_roles_validate_user
BEFORE INSERT OR UPDATE OF user_id
ON admin_user_roles
FOR EACH ROW
EXECUTE FUNCTION validate_admin_user_role_assignment();


-- ============================================================
-- 7. Basic integrity trigger for admin scope assignments
--
-- Scope assignments are intended for admin identities.
-- ============================================================

CREATE OR REPLACE FUNCTION validate_admin_scope_assignment()
RETURNS TRIGGER AS $$
DECLARE
    assigned_user_role user_role;
BEGIN
    SELECT role
    INTO assigned_user_role
    FROM users
    WHERE id = NEW.user_id
      AND deleted_at IS NULL;

    IF assigned_user_role IS NULL THEN
        RAISE EXCEPTION
            'Cannot assign scope to a missing or deleted user';
    END IF;

    IF assigned_user_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION
            'Only admin or super_admin users can receive admin scopes';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER admin_scope_assignments_validate_user
BEFORE INSERT OR UPDATE OF user_id
ON admin_scope_assignments
FOR EACH ROW
EXECUTE FUNCTION validate_admin_scope_assignment();


-- ============================================================
-- 8. Comments
-- ============================================================

COMMENT ON TABLE admin_permissions IS
    'Central Resource + Action permission catalog for Admin authorization.';

COMMENT ON TABLE admin_roles IS
    'Custom authorization roles used by platform administrators.';

COMMENT ON TABLE admin_role_permissions IS
    'Maps custom admin roles to resource/action permissions.';

COMMENT ON TABLE admin_user_roles IS
    'Maps admin users to one or more custom authorization roles.';

COMMENT ON TABLE admin_scope_assignments IS
    'Defines the resources or geographic boundaries an admin is authorized to access.';

COMMENT ON COLUMN admin_permissions.resource IS
    'Protected resource such as users, drivers, vehicles, rides, payments, coupons, etc.';

COMMENT ON COLUMN admin_permissions.action IS
    'Action allowed on the resource such as read, create, update, delete, approve, reject, verify, etc.';

COMMENT ON COLUMN admin_scope_assignments.scope_value IS
    'Identifier/value associated with the selected scope type.';


COMMIT;