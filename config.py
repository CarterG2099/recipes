from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    FASTAPI_SECRET_KEY: str
    IS_PRODUCTION: bool = False
    PORT: int = 8000
    SENTRY_DSN: str | None = None
    # Comma-separated emails allowed to edit recipes (besides admins and the
    # allowed_emails table). Reading recipes is always public; only writes are
    # gated. Empty env + empty table = only admins can edit.
    ALLOWED_EMAILS: str = ""
    # Admins can always edit and manage the allowed_emails table in the UI.
    ADMIN_EMAILS: str = ""

    @property
    def allowed_emails(self) -> frozenset[str]:
        return frozenset(
            e.strip().lower() for e in self.ALLOWED_EMAILS.split(",") if e.strip()
        )

    @property
    def admin_emails(self) -> frozenset[str]:
        return frozenset(
            e.strip().lower() for e in self.ADMIN_EMAILS.split(",") if e.strip()
        )


settings = Settings()
