"""원료 입고계획과 정비휴지일정 테이블."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RawInboundItem(Base):
    __tablename__ = "raw_inbound_items"
    __table_args__ = (UniqueConstraint("inventory_import_id", "inbound_date", "plant_name", "material_code", name="uq_raw_inbound_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    inventory_import_id: Mapped[int] = mapped_column(ForeignKey("inventory_imports.id"), index=True)
    inbound_date: Mapped[date] = mapped_column(Date, index=True)
    plant_name: Mapped[str] = mapped_column(String(200), index=True)
    material_code: Mapped[str] = mapped_column(String(50), index=True)
    quantity_ton: Mapped[float] = mapped_column(Float)


class MaintenanceImport(Base):
    __tablename__ = "maintenance_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String(255))
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    item_count: Mapped[int] = mapped_column(Integer)


class MaintenanceSchedule(Base):
    __tablename__ = "maintenance_schedules"
    __table_args__ = (UniqueConstraint("maintenance_import_id", "scheduled_date", "plant_name", "line_name", name="uq_maintenance_schedule"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    maintenance_import_id: Mapped[int] = mapped_column(ForeignKey("maintenance_imports.id"), index=True)
    scheduled_date: Mapped[date] = mapped_column(Date, index=True)
    plant_name: Mapped[str] = mapped_column(String(200), index=True)
    line_name: Mapped[str] = mapped_column(String(200), index=True)
    status: Mapped[str] = mapped_column(String(100))
    downtime_hours: Mapped[float] = mapped_column(Float)
