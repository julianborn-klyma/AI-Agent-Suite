-- Passwort-Login (PBKDF2-Hash in Anwendung) und Google-Login ohne vorherige Session
ALTER TABLE cos_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE cos_oauth_states
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN cos_users.password_hash IS
  'Format: pbkdf2_sha256$<iter>$<hex_salt>$<hex_key>; NULL = nur Google-Login oder Passwort noch nicht gesetzt.';
