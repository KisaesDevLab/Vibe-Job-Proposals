-- Required Postgres extensions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints over ranges
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive job codes
