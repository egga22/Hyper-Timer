CREATE TABLE IF NOT EXISTS timer_accounts (
  user_id text PRIMARY KEY REFERENCES "user"(id),
  legacy_id text UNIQUE NOT NULL,
  email_original text NOT NULL,
  role_original jsonb NOT NULL,
  payload jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  source_digest text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS migration_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ready boolean NOT NULL DEFAULT false,
  imported_at timestamptz,
  verified_at timestamptz
);
INSERT INTO migration_state(id) VALUES(true) ON CONFLICT DO NOTHING;
