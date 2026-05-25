-- =============================================
-- LifeOS: Complete table schemas
-- Run once in Supabase SQL Editor, or let the MCP servers auto-create on first startup
-- =============================================

-- =============================================
-- 1. PERSONAL ASSISTANT tables
-- =============================================

-- 1a. Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1b. personal_entries
CREATE TABLE IF NOT EXISTS personal_entries
(
    id             BIGSERIAL PRIMARY KEY,
    raw_input      TEXT           NOT NULL,
    processed_text TEXT,
    entry_type     TEXT           NOT NULL DEFAULT 'note',
    status         TEXT           NOT NULL DEFAULT 'open',
    priority       INTEGER        NOT NULL DEFAULT 0,
    tags           TEXT[]                  DEFAULT '{}',
    remarks        JSONB          NOT NULL DEFAULT '[]'::JSONB,
    metadata       JSONB                   DEFAULT '{}'::JSONB,
    search_text    TEXT,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_personal_entries_updated_at'
    ) THEN
        CREATE TRIGGER trigger_personal_entries_updated_at
            BEFORE UPDATE ON personal_entries
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_personal_entries_entry_type ON personal_entries (entry_type);
CREATE INDEX IF NOT EXISTS idx_personal_entries_status ON personal_entries (status);
CREATE INDEX IF NOT EXISTS idx_personal_entries_priority ON personal_entries (priority);
CREATE INDEX IF NOT EXISTS idx_personal_entries_deleted_at_null ON personal_entries (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_personal_entries_created_at ON personal_entries (created_at);

-- 1c. personal_entry_dates
CREATE TABLE IF NOT EXISTS personal_entry_dates
(
    id                 BIGSERIAL PRIMARY KEY,
    personal_entry_id  BIGINT         NOT NULL REFERENCES personal_entries (id),
    date_at            TIMESTAMPTZ    NOT NULL,
    description        TEXT           NOT NULL,
    deleted_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_personal_entry_dates_updated_at'
    ) THEN
        CREATE TRIGGER trigger_personal_entry_dates_updated_at
            BEFORE UPDATE ON personal_entry_dates
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_personal_entry_dates_entry_id ON personal_entry_dates (personal_entry_id);
CREATE INDEX IF NOT EXISTS idx_personal_entry_dates_date_at ON personal_entry_dates (date_at);
CREATE INDEX IF NOT EXISTS idx_personal_entry_dates_deleted_at_null ON personal_entry_dates (deleted_at) WHERE deleted_at IS NULL;

-- 1d. Disable RLS
ALTER TABLE personal_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE personal_entry_dates DISABLE ROW LEVEL SECURITY;


-- =============================================
-- 2. FINANCIAL ASSISTANT tables
-- =============================================

-- 2a. Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2b. expenses
CREATE TABLE IF NOT EXISTS expenses
(
    id               BIGSERIAL PRIMARY KEY,
    total_amount     NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    currency         TEXT           NOT NULL DEFAULT 'MYR',
    transaction_date DATE           NOT NULL DEFAULT CURRENT_DATE,
    merchant_name    TEXT,
    merchant_info    JSONB                   DEFAULT '{}'::JSONB,
    items            JSONB          NOT NULL DEFAULT '[]'::JSONB,
    remarks          JSONB          NOT NULL DEFAULT '[]'::JSONB,
    payment_method   TEXT           NOT NULL,
    is_paylater      BOOLEAN        NOT NULL DEFAULT FALSE,
    deleted_at       TIMESTAMPTZ,
    correction_of    BIGINT REFERENCES expenses (id),
    correction_at    TIMESTAMPTZ,
    search_vector    tsvector,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- 2c. Functions & Triggers
CREATE OR REPLACE FUNCTION expenses_update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.merchant_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.payment_method, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.merchant_info::text, '{}')), 'C') ||
        setweight(to_tsvector('english', coalesce(NEW.remarks::text, '[]')), 'C') ||
        setweight(to_tsvector('english', (
            SELECT string_agg(
                COALESCE(item->>'name', '') || ' ' ||
                COALESCE(item->>'seller', '') || ' ' ||
                COALESCE(item->'category'::text, '[]') || ' ' ||
                COALESCE(item->'remarks'::text, '[]'),
                ' '
            )
            FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) item
        )), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_expenses_search_vector'
    ) THEN
        CREATE TRIGGER trigger_expenses_search_vector
            BEFORE INSERT OR UPDATE ON expenses
            FOR EACH ROW EXECUTE FUNCTION expenses_update_search_vector();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_expenses_updated_at'
    ) THEN
        CREATE TRIGGER trigger_expenses_updated_at
            BEFORE UPDATE ON expenses
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- 2d. Soft delete function
CREATE OR REPLACE FUNCTION soft_delete_expense(p_id BIGINT)
RETURNS VOID AS $$
BEGIN
    UPDATE expenses
    SET deleted_at = NOW()
    WHERE id = p_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- 2e. Active expenses view
CREATE OR REPLACE VIEW active_expenses AS
SELECT * FROM expenses WHERE deleted_at IS NULL;

-- 2f. Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_search_vector ON expenses USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_expenses_merchant_name_trgm ON expenses USING GIN (merchant_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_expenses_transaction_date ON expenses (transaction_date);
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at_null ON expenses (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_correction_of ON expenses (correction_of);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON expenses (payment_method);
CREATE INDEX IF NOT EXISTS idx_expenses_is_paylater ON expenses (is_paylater);

-- 2g. Disable RLS
ALTER TABLE expenses DISABLE ROW LEVEL SECURITY;
