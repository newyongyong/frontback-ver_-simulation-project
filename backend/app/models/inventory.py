"""제품·원료 재고 업로드 이력과 일자별 재고 스냅샷."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class InventoryImport(Base):
    __tablename__ = "inventory_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)  # product 또는 raw
    file_name: Mapped[str] = mapped_column(String(255))
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    item_count: Mapped[int] = mapped_column(Integer)


class ProductInventoryItem(Base):
    __tablename__ = "product_inventory_items"
    __table_args__ = (UniqueConstraint("inventory_import_id", "snapshot_date", "product_code", "process_name", "line_name", "stock_status", name="uq_product_inventory_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    inventory_import_id: Mapped[int] = mapped_column(ForeignKey("inventory_imports.id"), index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    product_code: Mapped[str] = mapped_column(String(50), index=True)
    process_name: Mapped[str] = mapped_column(String(100))
    line_name: Mapped[str] = mapped_column(String(200))
    stock_status: Mapped[str] = mapped_column(String(100))
    quantity_ton: Mapped[float] = mapped_column(Float)


class RawInventoryItem(Base):
    __tablename__ = "raw_inventory_items"
    __table_args__ = (UniqueConstraint("inventory_import_id", "snapshot_date", "plant_name", "material_code", name="uq_raw_inventory_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    inventory_import_id: Mapped[int] = mapped_column(ForeignKey("inventory_imports.id"), index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    plant_name: Mapped[str] = mapped_column(String(200), index=True)
    material_code: Mapped[str] = mapped_column(String(50), index=True)
    quantity_ton: Mapped[float] = mapped_column(Float)
