from datetime import date, datetime
from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class ProductionActualImport(Base):
    __tablename__ = "production_actual_imports"
    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String(255))
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    item_count: Mapped[int] = mapped_column(Integer)

class ProductionActualItem(Base):
    __tablename__ = "production_actual_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    actual_import_id: Mapped[int] = mapped_column(ForeignKey("production_actual_imports.id"), index=True)
    actual_date: Mapped[date] = mapped_column(Date, index=True)
    plant_name: Mapped[str] = mapped_column(String(200))
    line_name: Mapped[str] = mapped_column(String(200))
    product_code: Mapped[str] = mapped_column(String(50))
    quantity_ton: Mapped[float] = mapped_column(Float)
