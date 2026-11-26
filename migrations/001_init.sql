-- Associations, their rulebooks, each rulebook's editions (one per distinct document) and the rules
-- (structure only: number, title, level, page) of each edition. Rule text is not stored; `search` holds
-- the search index built from it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE associations (
  id text PRIMARY KEY,
  name text NOT NULL,
  short_name text NOT NULL,
  country text,
  scope text NOT NULL CHECK (scope IN ('national', 'continental', 'world', 'tour')),
  website text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  removed_at timestamptz
);

CREATE TABLE rulebooks (
  id text PRIMARY KEY,
  association_id text NOT NULL REFERENCES associations (id),
  title text NOT NULL,
  language text NOT NULL,
  page_url text NOT NULL,
  current_edition_id bigint,
  -- last import attempt, and what went wrong if it failed (the current edition stays)
  checked_at timestamptz,
  check_error text,
  removed_at timestamptz
);

CREATE INDEX rulebooks_association ON rulebooks (association_id);

CREATE TABLE editions (
  id bigserial PRIMARY KEY,
  rulebook_id text NOT NULL REFERENCES rulebooks (id),
  label text NOT NULL,
  document_url text NOT NULL,
  sha256 text NOT NULL,
  page_count int NOT NULL,
  rule_count int NOT NULL,
  structure text NOT NULL CHECK (structure IN ('outline', 'headings')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rulebook_id, sha256)
);

ALTER TABLE rulebooks ADD CONSTRAINT rulebooks_current_edition FOREIGN KEY (current_edition_id) REFERENCES editions (id);

CREATE TABLE rules (
  edition_id bigint NOT NULL REFERENCES editions (id) ON DELETE CASCADE,
  key text NOT NULL,
  number text,
  -- null for numbered paragraphs without a heading of their own
  title text,
  level smallint NOT NULL,
  parent_key text,
  page int NOT NULL,
  position int NOT NULL,
  search tsvector NOT NULL,
  PRIMARY KEY (edition_id, key)
);

CREATE INDEX rules_order ON rules (edition_id, position);
CREATE INDEX rules_search ON rules USING gin (search);
CREATE INDEX rules_title_trgm ON rules USING gin (title gin_trgm_ops);

CREATE TABLE import_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed')),
  trigger text NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}',
  errors text[] NOT NULL DEFAULT '{}'
);
