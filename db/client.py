from supabase import create_client, Client
from config import settings


def get_service_client() -> Client:
    """Return a Supabase client using the service role key (bypasses RLS)."""
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# Singleton admin client (service role — used for sync, webhooks, default categories)
supabase_admin = get_service_client()
