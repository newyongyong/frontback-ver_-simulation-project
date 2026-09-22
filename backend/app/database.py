"""SQLite 데이터베이스 연결과 공통 모델 기반 클래스."""

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DATABASE_PATH = DATA_DIR / "production_planning.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    """모든 SQLAlchemy 모델이 상속하는 기반 클래스."""


def ensure_planning_requirement_columns() -> None:
    """초기 SQLite DB를 안전하게 확장한다. 기존 계산 이력은 보존한다."""
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(production_requirements)")}
        additions = {
            "safety_stock_days": "REAL NOT NULL DEFAULT 0",
            "average_daily_sales_ton": "REAL NOT NULL DEFAULT 0",
            "safety_stock_target_ton": "REAL NOT NULL DEFAULT 0",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.exec_driver_sql(f"ALTER TABLE production_requirements ADD COLUMN {name} {definition}")

        planning_run_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(planning_runs)")}
        added_end_columns = False
        for name, definition in {"end_year": "INTEGER NOT NULL DEFAULT 2026", "end_month": "INTEGER NOT NULL DEFAULT 1"}.items():
            if name not in planning_run_columns:
                connection.exec_driver_sql(f"ALTER TABLE planning_runs ADD COLUMN {name} {definition}")
                added_end_columns = True
        if added_end_columns:
            connection.exec_driver_sql("UPDATE planning_runs SET end_year = year, end_month = month")

        schedule_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(production_schedule_items)")}
        if "changeover_hours" not in schedule_columns:
            connection.exec_driver_sql("ALTER TABLE production_schedule_items ADD COLUMN changeover_hours REAL NOT NULL DEFAULT 0")
        if "is_locked" not in schedule_columns:
            connection.exec_driver_sql("ALTER TABLE production_schedule_items ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT 0")
        if "adjustment_note" not in schedule_columns:
            connection.exec_driver_sql("ALTER TABLE production_schedule_items ADD COLUMN adjustment_note VARCHAR(500) NOT NULL DEFAULT ''")
        if "work_rate" not in schedule_columns:
            connection.exec_driver_sql("ALTER TABLE production_schedule_items ADD COLUMN work_rate REAL NOT NULL DEFAULT 1")
        if "yield_rate" not in schedule_columns:
            connection.exec_driver_sql("ALTER TABLE production_schedule_items ADD COLUMN yield_rate REAL NOT NULL DEFAULT 1")
        if "operation_status" not in schedule_columns:
            connection.exec_driver_sql("ALTER TABLE production_schedule_items ADD COLUMN operation_status VARCHAR(20) NOT NULL DEFAULT '가동'")
        quality_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(product_quality_specs)")}
        if "production_yield" not in quality_columns:
            connection.exec_driver_sql("ALTER TABLE product_quality_specs ADD COLUMN production_yield REAL NOT NULL DEFAULT 1")
        run_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(schedule_runs)")}
        for name, definition in {"version": "INTEGER NOT NULL DEFAULT 1", "status": "VARCHAR(20) NOT NULL DEFAULT '작성 중'", "change_reason": "VARCHAR(500) NOT NULL DEFAULT ''", "confirmed_at": "DATETIME"}.items():
            if name not in run_columns:
                connection.exec_driver_sql(f"ALTER TABLE schedule_runs ADD COLUMN {name} {definition}")
