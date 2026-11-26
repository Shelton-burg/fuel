// FUEL — Postgres schema for the dormant database layer (activated by DATABASE_URL).
// All statements are idempotent (CREATE TABLE IF NOT EXISTS) so boot-time
// schema setup is safe to run on every connection.
//
// Column conventions: snake_case (Postgres folds unquoted identifiers to
// lowercase). `extra` JSONB on users carries every gist-era field that has no
// dedicated column (slot, pinSalt/pinHash, verify*, reset*, passwordChangedAt…)
// so a DB row round-trips to the exact same shape auth.mjs already uses.

export const TABLES = {
  users: `CREATE TABLE IF NOT EXISTS users (
    uid             TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL DEFAULT '',
    hash            TEXT NOT NULL,
    salt            TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 1,
    has_pin         BOOLEAN NOT NULL DEFAULT false,
    email_verified  BOOLEAN NOT NULL DEFAULT false,
    recovery_hash   TEXT,
    plan            TEXT NOT NULL DEFAULT 'free',
    created_at      BIGINT NOT NULL,
    extra           JSONB NOT NULL DEFAULT '{}'::jsonb
  )`,

  // Client-encrypted sync blob — stored EXACTLY as the client sends it
  // (AES-GCM ciphertext the server cannot read). One row per account.
  sync_blobs: `CREATE TABLE IF NOT EXISTS sync_blobs (
    uid        TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    key_hash   TEXT,
    updated_at BIGINT NOT NULL
  )`,

  // Automatic safety backup — server-side AES-256-GCM envelope, stored as-is.
  autobak_blobs: `CREATE TABLE IF NOT EXISTS autobak_blobs (
    uid        TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,

  // Privacy-safe analytics: aggregate event counts per {day, event, sha256(uid)}.
  analytics_events: `CREATE TABLE IF NOT EXISTS analytics_events (
    day_key   TEXT NOT NULL,
    ev        TEXT NOT NULL,
    user_hash TEXT NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day_key, ev, user_hash)
  )`,

  db_meta: `CREATE TABLE IF NOT EXISTS db_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
};

export const SCHEMA = [
  TABLES.users,
  // Lazy column add — CREATE TABLE IF NOT EXISTS does nothing for an existing
  // table, so columns added after the original schema need an idempotent
  // ALTER to reach already-provisioned databases (v67: plan).
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'`,
  TABLES.sync_blobs, TABLES.autobak_blobs, TABLES.analytics_events, TABLES.db_meta,
];

export const USER_EXTRA_FIELDS = [
  'slot', 'pinSalt', 'pinHash', 'recoverySalt', 'verifySalt', 'verifyHash',
  'verifyExp', 'verifyTries', 'resetSalt', 'resetHash', 'resetExp', 'resetTries',
  'verifiedAt', 'passwordChangedAt',
];
