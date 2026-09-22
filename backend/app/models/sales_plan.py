"""판매계획 업로드 이력과 월별 판매계획 테이블."""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SalesImport(Base):
    __tablename__ = "sales_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String(255))
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    item_count: Mapped[int] = mapped_column(Integer)


class SalesPlanItem(Base):
    __tablename__ = "sales_plan_items"
    __table_args__ = (UniqueConstraint("sales_import_id", "customer", "product_code", "year", "month", name="uq_sales_plan_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sales_import_id: Mapped[int] = mapped_column(ForeignKey("sales_imports.id"), index=True)
    customer: Mapped[str] = mapped_column(String(200), index=True)
    product_code: Mapped[str] = mapped_column(String(50), index=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    month: Mapped[int] = mapped_column(Integer, index=True)
    quantity_ton: Mapped[float] = mapped_column(Float)
