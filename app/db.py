from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'latenttrainer.db'}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    _run_schema_migrations()


def _run_schema_migrations() -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        tables = set(inspector.get_table_names())

        if "generatefunctionconfig" in tables:
            columns = {column["name"] for column in inspector.get_columns("generatefunctionconfig")}
            if "auto_run" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE generatefunctionconfig "
                        "ADD COLUMN auto_run BOOLEAN NOT NULL DEFAULT 0"
                    )
                )

        if "generateconfig" in tables:
            columns = {column["name"] for column in inspector.get_columns("generateconfig")}
            if "architecture" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE generateconfig "
                        "ADD COLUMN architecture VARCHAR NOT NULL DEFAULT 'sdxl'"
                    )
                )


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
