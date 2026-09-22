from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class ActiveDataSource(Base):
    __tablename__ = "active_data_sources"
    source_type: Mapped[str] = mapped_column(String(50), primary_key=True)
    import_id: Mapped[int] = mapped_column(Integer)
