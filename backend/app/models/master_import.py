"""Master Excel 업로드 이력과 원본 행 보관 테이블."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MasterImport(Base):
    __tablename__ = "master_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String(255))
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    sheet_count: Mapped[int] = mapped_column(Integer)
    row_count: Mapped[int] = mapped_column(Integer)
    product_count: Mapped[int] = mapped_column(Integer)


class MasterRecord(Base):
    """향후 공장·라인·BOM 테이블로 확장할 수 있도록 원본 행을 그대로 보관한다."""

    __tablename__ = "master_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_id: Mapped[int] = mapped_column(ForeignKey("master_imports.id"), index=True)
    sheet_name: Mapped[str] = mapped_column(String(200), index=True)
    row_number: Mapped[int] = mapped_column(Integer)
    values: Mapped[list[object]] = mapped_column(JSON)
