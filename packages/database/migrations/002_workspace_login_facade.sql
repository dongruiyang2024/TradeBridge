CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user (email);
CREATE INDEX IF NOT EXISTS idx_internal_session_user_id ON internal_session (user_id);
