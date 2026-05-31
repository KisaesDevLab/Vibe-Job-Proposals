-- Phase 2: audit log foundation.
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES users(id),
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,
  summary     text NOT NULL,
  detail      jsonb
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_at_idx ON audit_log (at);
