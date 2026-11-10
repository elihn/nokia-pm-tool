-- ====================================================================
-- NOKIA PM TOOL - SCHEMA POSTGRESQL SUPABASE DE GESTION DES LICENCES
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABLE DES ADMINISTRATEURS (Accès Espace Admin)
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'auditor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. TABLE DES TECHNICIENS
CREATE TABLE IF NOT EXISTS public.technicians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. TABLE DES LICENCES
CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_key TEXT UNIQUE NOT NULL,
    technician_id UUID NOT NULL REFERENCES public.technicians(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
    license_type TEXT NOT NULL DEFAULT '1_MONTH' CHECK (license_type IN ('1_MONTH', '3_MONTHS', '6_MONTHS', '1_YEAR', 'PERMANENT')),
    start_date TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    expiration_date TIMESTAMPTZ, -- NULL si PERMANENT
    max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index pour recherche rapide par clé de licence et par technicien
CREATE INDEX IF NOT EXISTS idx_licenses_key ON public.licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_tech ON public.licenses(technician_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON public.licenses(status);

-- 4. TABLE DES TÉLÉPHONES / APPAREILS ASSOCIÉS
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
    installation_id TEXT NOT NULL,
    public_key TEXT NOT NULL, -- Clé publique de l'appareil (générée par Android Keystore)
    device_name TEXT,
    activation_date TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_sync TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT uq_license_installation UNIQUE (license_id, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_license ON public.devices(license_id);
CREATE INDEX IF NOT EXISTS idx_devices_installation ON public.devices(installation_id);

-- 5. TABLE DES JOURNAUX D'AUDIT / LOGS
CREATE TABLE IF NOT EXISTS public.license_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_id UUID REFERENCES public.licenses(id) ON DELETE SET NULL,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'ACTIVATION', 'SYNC', 'SUSPEND', 'REVOKE', 'RENEW', 'UNBIND_DEVICE', 'FAILED_ATTEMPT'
    timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    details JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_logs_license ON public.license_logs(license_id);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON public.license_logs(timestamp DESC);

-- ====================================================================
-- POLITIQUES DE SÉCURITÉ RLS (Row Level Security)
-- ====================================================================

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_logs ENABLE ROW LEVEL SECURITY;

-- 1. Les Edge Functions utilisent la 'service_role' key et ont un accès total côté serveur.
-- 2. Pour l'Espace Admin (Supabase Auth) : Seuls les utilisateurs authentifiés listés dans admin_users ont accès.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE email = auth.jwt() ->> 'email'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Politiques pour admin_users
CREATE POLICY "Admins can view admin_users" ON public.admin_users
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- Politiques pour technicians
CREATE POLICY "Admins can manage technicians" ON public.technicians
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Politiques pour licenses
CREATE POLICY "Admins can manage licenses" ON public.licenses
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Politiques pour devices
CREATE POLICY "Admins can manage devices" ON public.devices
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Politiques pour license_logs
CREATE POLICY "Admins can view license_logs" ON public.license_logs
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- ====================================================================
-- FONCTIONS UTILITAIRES SQL
-- ====================================================================

-- Fonction pour calculer la date d'expiration d'une licence
CREATE OR REPLACE FUNCTION public.calculate_expiration(
    p_type TEXT,
    p_start TIMESTAMPTZ DEFAULT now()
) RETURNS TIMESTAMPTZ AS $$
BEGIN
    CASE p_type
        WHEN '1_MONTH' THEN RETURN p_start + INTERVAL '1 month';
        WHEN '3_MONTHS' THEN RETURN p_start + INTERVAL '3 months';
        WHEN '6_MONTHS' THEN RETURN p_start + INTERVAL '6 months';
        WHEN '1_YEAR' THEN RETURN p_start + INTERVAL '1 year';
        WHEN 'PERMANENT' THEN RETURN NULL;
        ELSE RETURN p_start + INTERVAL '1 month';
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger pour définir automatiquement expiration_date à la création si non renseigné
CREATE OR REPLACE FUNCTION public.set_license_expiration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expiration_date IS NULL AND NEW.license_type != 'PERMANENT' THEN
        NEW.expiration_date := public.calculate_expiration(NEW.license_type, NEW.start_date);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_license_expiration ON public.licenses;
CREATE TRIGGER trg_set_license_expiration
BEFORE INSERT ON public.licenses
FOR EACH ROW
EXECUTE FUNCTION public.set_license_expiration();
