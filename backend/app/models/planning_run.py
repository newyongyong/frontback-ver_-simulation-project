"""생산계획 계산 실행 이력과 제품별 필요 생산량."""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PlanningRun(Base):
    __tablename__ = "planning_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    month: Mapped[int] = mapped_column(Integer, index=True)
    end_year: Mapped[int] = mapped_column(Integer, default=2026)
    end_month: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    sales_import_id: Mapped[int] = mapped_column(ForeignKey("sales_imports.id"))
    product_inventory_import_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_imports.id"), nullable=True)


class ProductionRequirement(Base):
    __tablename__ = "production_requirements"
    __table_args__ = (UniqueConstraint("planning_run_id", "product_code", name="uq_production_requirement"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    planning_run_id: Mapped[int] = mapped_column(ForeignKey("planning_runs.id"), index=True)
    product_code: Mapped[str] = mapped_column(String(50), index=True)
    sales_demand_ton: Mapped[float] = mapped_column(Float)
    available_inventory_ton: Mapped[float] = mapped_column(Float)
    safety_stock_days: Mapped[float] = mapped_column(Float, default=0.0)
    average_daily_sales_ton: Mapped[float] = mapped_column(Float, default=0.0)
    safety_stock_target_ton: Mapped[float] = mapped_column(Float, default=0.0)
    required_production_ton: Mapped[float] = mapped_column(Float)
