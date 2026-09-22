"""초기 생산 스케줄러 실행 이력과 일별 라인 배정 결과."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ScheduleRun(Base):
    __tablename__ = "schedule_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    planning_run_id: Mapped[int] = mapped_column(ForeignKey("planning_runs.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    version: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(20), default="작성 중")
    change_reason: Mapped[str] = mapped_column(String(500), default="")
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ProductionScheduleItem(Base):
    __tablename__ = "production_schedule_items"
    __table_args__ = (UniqueConstraint("schedule_run_id", "planned_date", "line_code", name="uq_schedule_line_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_run_id: Mapped[int] = mapped_column(ForeignKey("schedule_runs.id"), index=True)
    planned_date: Mapped[date] = mapped_column(Date, index=True)
    plant_name: Mapped[str] = mapped_column(String(200))
    line_code: Mapped[str] = mapped_column(String(50), index=True)
    line_name: Mapped[str] = mapped_column(String(200))
    product_code: Mapped[str] = mapped_column(String(50), index=True)
    planned_quantity_ton: Mapped[float] = mapped_column(Float)
    available_capacity_ton: Mapped[float] = mapped_column(Float)
    downtime_hours: Mapped[float] = mapped_column(Float)
    # 일별 편집 화면에서 조정하는 실제 작업률(0~1)과 설비 상태
    work_rate: Mapped[float] = mapped_column(Float, default=1.0)
    yield_rate: Mapped[float] = mapped_column(Float, default=1.0)
    operation_status: Mapped[str] = mapped_column(String(20), default="가동")
    changeover_hours: Mapped[float] = mapped_column(Float, default=0.0)
    is_locked: Mapped[bool] = mapped_column(default=False)
    adjustment_note: Mapped[str] = mapped_column(String(500), default="")


class UnscheduledRequirement(Base):
    __tablename__ = "unscheduled_requirements"
    __table_args__ = (UniqueConstraint("schedule_run_id", "product_code", name="uq_unscheduled_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_run_id: Mapped[int] = mapped_column(ForeignKey("schedule_runs.id"), index=True)
    product_code: Mapped[str] = mapped_column(String(50), index=True)
    required_quantity_ton: Mapped[float] = mapped_column(Float)
    scheduled_quantity_ton: Mapped[float] = mapped_column(Float)
    unallocated_quantity_ton: Mapped[float] = mapped_column(Float)


class RawMaterialValidationRun(Base):
    """생산 스케줄에 대한 원료 가용성 검증 이력."""

    __tablename__ = "raw_material_validation_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_run_id: Mapped[int] = mapped_column(ForeignKey("schedule_runs.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class RawMaterialDailyBalance(Base):
    """공장·원료·일자별 입고, 소요량, 기말 재고 및 부족량."""

    __tablename__ = "raw_material_daily_balances"
    __table_args__ = (
        UniqueConstraint("validation_run_id", "balance_date", "plant_name", "material_code", name="uq_raw_material_daily_balance"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    validation_run_id: Mapped[int] = mapped_column(ForeignKey("raw_material_validation_runs.id"), index=True)
    balance_date: Mapped[date] = mapped_column(Date, index=True)
    plant_name: Mapped[str] = mapped_column(String(200), index=True)
    material_code: Mapped[str] = mapped_column(String(50), index=True)
    opening_quantity_ton: Mapped[float] = mapped_column(Float)
    inbound_quantity_ton: Mapped[float] = mapped_column(Float)
    required_quantity_ton: Mapped[float] = mapped_column(Float)
    ending_quantity_ton: Mapped[float] = mapped_column(Float)
    shortage_quantity_ton: Mapped[float] = mapped_column(Float)


class WorkCalendarDay(Base):
    """스케줄러가 사용하는 근무일 캘린더. 미등록일은 24시간 가동이 기본이다."""

    __tablename__ = "work_calendar_days"

    calendar_date: Mapped[date] = mapped_column(Date, primary_key=True)
    is_working: Mapped[bool] = mapped_column(default=True)
    note: Mapped[str] = mapped_column(String(200), default="")


class SchedulerSetting(Base):
    """초기 스케줄러의 공통 가정값."""

    __tablename__ = "scheduler_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    changeover_hours: Mapped[float] = mapped_column(Float, default=0.0)
