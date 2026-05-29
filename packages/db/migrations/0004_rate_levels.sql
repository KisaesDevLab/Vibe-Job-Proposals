-- Phase 4: rate levels master list.
CREATE TABLE rate_levels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO rate_levels (name, sort_order) VALUES
  ('Foreman', 0),
  ('Journeyman', 1),
  ('Apprentice Yr 1', 2),
  ('Apprentice Yr 2', 3),
  ('Apprentice Yr 3', 4),
  ('Apprentice Yr 4', 5),
  ('Apprentice Yr 5', 6),
  ('Apprentice Yr 6', 7),
  ('Apprentice Yr 7', 8)
ON CONFLICT DO NOTHING;
