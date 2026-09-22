"""데이터 관리 화면의 최신 적용 파일 및 업로드 이력 요약."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.api.dependencies import get_db
from app.models.inventory import InventoryImport
from app.models.master_import import MasterImport
from app.models.operations import MaintenanceImport
from app.models.production_actual import ProductionActualImport
from app.models.sales_plan import SalesImport
from app.models.active_source import ActiveDataSource
from app.models.inventory import ProductInventoryItem, RawInventoryItem
from app.models.master_import import MasterRecord
from app.models.operations import MaintenanceSchedule, RawInboundItem
from app.models.planning_run import PlanningRun
from app.models.production_actual import ProductionActualItem
from app.models.sales_plan import SalesPlanItem

router = APIRouter(prefix="/data-status", tags=["data status"])

def _rows(items, kind: str):
    return [{"id": item.id, "file_name": item.file_name, "imported_at": item.imported_at, "item_count": getattr(item, "item_count", getattr(item, "row_count", 0))} for item in items]

@router.get("")
def get_data_status(db: Session = Depends(get_db)):
    sources = [
        ("Master", list(db.scalars(select(MasterImport).order_by(MasterImport.imported_at.desc())))),
        ("판매계획", list(db.scalars(select(SalesImport).order_by(SalesImport.imported_at.desc())))),
        ("제품 재고", list(db.scalars(select(InventoryImport).where(InventoryImport.kind == "product").order_by(InventoryImport.imported_at.desc())))),
        ("원료 재고", list(db.scalars(select(InventoryImport).where(InventoryImport.kind == "raw").order_by(InventoryImport.imported_at.desc())))),
        ("원료 입고계획", list(db.scalars(select(InventoryImport).where(InventoryImport.kind == "raw_inbound").order_by(InventoryImport.imported_at.desc())))),
        ("정비휴지일정", list(db.scalars(select(MaintenanceImport).order_by(MaintenanceImport.imported_at.desc())))),
        ("생산실적", list(db.scalars(select(ProductionActualImport).order_by(ProductionActualImport.imported_at.desc())))),
    ]
    active = {row.source_type: row.import_id for row in db.scalars(select(ActiveDataSource))}
    return [{"name": name, "latest": next((row for row in _rows(items, name) if row["id"] == active.get(name)), _rows(items[:1], name)[0] if items else None), "history": _rows(items[:5], name)} for name, items in sources]

class ActivateSource(BaseModel):
    source_type: str
    import_id: int

@router.put("/activate")
def activate(payload: ActivateSource, db: Session = Depends(get_db)):
    valid = {"Master": MasterImport, "판매계획": SalesImport, "제품 재고": InventoryImport, "원료 재고": InventoryImport, "원료 입고계획": InventoryImport, "정비휴지일정": MaintenanceImport, "생산실적": ProductionActualImport}
    model = valid.get(payload.source_type)
    if not model or not db.get(model, payload.import_id):
        raise HTTPException(404, "선택한 업로드 이력을 찾을 수 없습니다.")
    source = db.get(ActiveDataSource, payload.source_type)
    if source: source.import_id = payload.import_id
    else: db.add(ActiveDataSource(source_type=payload.source_type, import_id=payload.import_id))
    db.commit()
    return {"source_type": payload.source_type, "import_id": payload.import_id}


@router.delete("/{source_type}/{import_id}", status_code=204)
def delete_import(source_type: str, import_id: int, db: Session = Depends(get_db)):
    """업로드 이력과 해당 이력이 적재한 상세 행을 함께 삭제한다."""
    source_config = {
        "Master": (MasterImport, None, MasterRecord.import_id),
        "판매계획": (SalesImport, None, SalesPlanItem.sales_import_id),
        "제품 재고": (InventoryImport, "product", ProductInventoryItem.inventory_import_id),
        "원료 재고": (InventoryImport, "raw", RawInventoryItem.inventory_import_id),
        "원료 입고계획": (InventoryImport, "raw_inbound", RawInboundItem.inventory_import_id),
        "정비휴지일정": (MaintenanceImport, None, MaintenanceSchedule.maintenance_import_id),
        "생산실적": (ProductionActualImport, None, ProductionActualItem.actual_import_id),
    }
    config = source_config.get(source_type)
    if not config:
        raise HTTPException(status_code=404, detail="삭제할 데이터 유형을 찾을 수 없습니다.")
    model, kind, detail_import_id = config
    imported = db.get(model, import_id)
    if not imported or (kind and imported.kind != kind):
        raise HTTPException(status_code=404, detail="삭제할 업로드 이력을 찾을 수 없습니다.")

    if source_type == "판매계획" and db.scalar(select(PlanningRun.id).where(PlanningRun.sales_import_id == import_id)):
        raise HTTPException(status_code=409, detail="이 판매계획 파일을 사용한 생산계획이 있습니다. 해당 생산계획을 먼저 삭제해 주세요.")
    if source_type == "제품 재고" and db.scalar(select(PlanningRun.id).where(PlanningRun.product_inventory_import_id == import_id)):
        raise HTTPException(status_code=409, detail="이 제품 재고 파일을 사용한 생산계획이 있습니다. 해당 생산계획을 먼저 삭제해 주세요.")

    db.execute(delete(detail_import_id.class_).where(detail_import_id == import_id))
    db.delete(imported)

    active = db.get(ActiveDataSource, source_type)
    if active and active.import_id == import_id:
        replacements = select(model).order_by(model.imported_at.desc())
        if kind:
            replacements = replacements.where(model.kind == kind)
        replacement = db.scalar(replacements)
        if replacement:
            active.import_id = replacement.id
        else:
            db.delete(active)
    db.commit()
