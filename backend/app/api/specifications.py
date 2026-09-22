"""공장·라인 제원치 조회 및 가동효율 수정 API."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.planning_master import BomItem, LineProduct, Plant, ProductionLine, ProductQualitySpec

router = APIRouter(prefix="/specifications", tags=["specifications"])

class LineSpecification(BaseModel):
    code: str
    name: str
    plant_code: str
    plant_name: str
    process_code: str
    operating_efficiency: float | None
    model_config = ConfigDict(from_attributes=True)

class EfficiencyUpdate(BaseModel):
    operating_efficiency: float = Field(ge=0, le=1.5)

class QualitySpecification(BaseModel):
    semi_product_code: str
    quality_pass_rate: float
    quality_inspection_days: int
    production_yield: float
    is_final_before_p: bool

class ProductProcessSpecification(BaseModel):
    product_code: str
    process_codes: list[str]

class BomSpecification(BaseModel):
    output_product_code: str
    input_material_code: str

@router.get("/lines", response_model=list[LineSpecification])
def list_lines(db: Session = Depends(get_db)):
    rows = db.execute(select(ProductionLine, Plant.name).join(Plant, Plant.code == ProductionLine.plant_code).order_by(Plant.name, ProductionLine.code)).all()
    return [LineSpecification(code=line.code, name=line.name, plant_code=line.plant_code, plant_name=plant_name, process_code=line.process_code, operating_efficiency=line.operating_efficiency) for line, plant_name in rows]

@router.get("/quality", response_model=list[QualitySpecification])
def list_quality_specs(db: Session = Depends(get_db)):
    consumed_codes = set(db.scalars(select(BomItem.input_material_code)))
    return [
        QualitySpecification(
            semi_product_code=spec.semi_product_code,
            quality_pass_rate=spec.quality_pass_rate,
            quality_inspection_days=spec.quality_inspection_days,
            production_yield=spec.production_yield,
            is_final_before_p=spec.semi_product_code not in consumed_codes,
        )
        for spec in db.scalars(select(ProductQualitySpec).order_by(ProductQualitySpec.semi_product_code))
    ]

@router.get("/product-processes", response_model=list[ProductProcessSpecification])
def list_product_processes(db: Session = Depends(get_db)):
    rows = db.execute(select(LineProduct.product_code, ProductionLine.process_code).join(ProductionLine, ProductionLine.code == LineProduct.line_code)).all()
    products: dict[str, set[str]] = {}
    for semi_product_code, process_code in rows:
        product_code = semi_product_code.rsplit("_", 1)[0]
        products.setdefault(product_code, set()).add(process_code)
    return [ProductProcessSpecification(product_code=code, process_codes=sorted(processes)) for code, processes in sorted(products.items())]

@router.get("/boms", response_model=list[BomSpecification])
def list_boms(db: Session = Depends(get_db)):
    return [BomSpecification(output_product_code=row.output_product_code, input_material_code=row.input_material_code) for row in db.scalars(select(BomItem).order_by(BomItem.output_product_code, BomItem.input_material_code))]

@router.patch("/lines/{line_code}", response_model=LineSpecification)
def update_line(line_code: str, payload: EfficiencyUpdate, db: Session = Depends(get_db)):
    line = db.get(ProductionLine, line_code)
    if not line:
        raise HTTPException(404, "생산라인을 찾을 수 없습니다.")
    line.operating_efficiency = payload.operating_efficiency
    db.commit()
    plant = db.get(Plant, line.plant_code)
    return LineSpecification(code=line.code, name=line.name, plant_code=line.plant_code, plant_name=plant.name if plant else line.plant_code, process_code=line.process_code, operating_efficiency=line.operating_efficiency)
