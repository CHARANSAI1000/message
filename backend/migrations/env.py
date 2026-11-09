from logging.config import fileConfig

from alembic import context

from app.core.database import engine
from app.models import Base

config = context.config
target_metadata = Base.metadata

# The app passes its own connection (holding the migration lock); the CLI uses the app engine.
shared_connection = config.attributes.get("connection")
if shared_connection is None and config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)


def run_offline() -> None:
    context.configure(url=engine.url.render_as_string(hide_password=False), target_metadata=target_metadata,
                      literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_online() -> None:
    if shared_connection is not None:
        context.configure(connection=shared_connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
