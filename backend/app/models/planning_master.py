"""생산계획 엔진이 직접 사용할 공장·라인·BOM 기준정보 테이블."""

from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Plant(Base):
    __tablename__ = "plants"

    code: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))


class ProductionLine(Base):
    __tablename__ = "production_lines"

    code: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    plant_code: Mapped[str] = mapped_column(ForeignKey("plants.code"), index=True)
    process_code: Mapped[str] = mapped_column(String(50), index=True)
    operating_efficiency: Mapped[float | None] = mapped_column(Float, nullable=True)


class LineProduct(Base):
    __tablename__ = "line_products"
    __table_args__ = (UniqueConstraint("line_code", "product_code", name="uq_line_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    line_code: Mapped[str] = mapped_column(ForeignKey("production_lines.code"), index=True)
    product_code: Mapped[str] = mapped_column(String(50), index=True)


class BomItem(Base):
    __tablename__ = "bom_items"
    __table_args__ = (UniqueConstraint("output_product_code", "input_material_code", "material_slot", name="uq_bom_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    output_product_code: Mapped[str] = mapped_column(String(50), index=True)
    input_material_code: Mapped[str] = mapped_column(String(50), index=True)
    input_ratio: Mapped[float] = mapped_column(Float)
    material_slot: Mapped[int] = mapped_column()


class ProductQualitySpec(Base):
    """반제품별 품질검사 완료 시점과 합격 수율.

    생산일에 이 값을 적용해 P 공정 입고 가능일과 입고 가능 수량을 계산한다.
    """

    __tablename__ = "product_quality_specs"

    semi_product_code: Mapped[str] = mapped_column(String(50), primary_key=True)
    quality_pass_rate: Mapped[float] = mapped_column(Float)
    quality_inspection_days: Mapped[int] = mapped_column(Integer)
    # Master의 제품별 공정 수율. 품질합격률과 별도로 생산 CAPA에 적용한다.
    production_yield: Mapped[float] = mapped_column(Float, default=1.0)
