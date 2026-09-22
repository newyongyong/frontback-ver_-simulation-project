"""제품·원료 재고 업로드와 최신 스냅샷 조회 API."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.inventory import InventoryImport, ProductInventoryItem, RawInventoryItem
from app.models.operations import RawInboundItem
from app.models.active_source import ActiveDataSource
from app.schemas.inventory import InventoryImportResponse, ProductInventoryResponse, RawInventoryResponse
from app.schemas.operations import RawInboundResponse
from app.services.inventory_importer import import_product_inventory, import_raw_inventory
from app.services.operations_importer import import_raw_inbound

router = APIRouter(prefix="/inventories", tags=["inventories"])


async def _import(file: UploadFile, db: Session, importer):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail=".xlsx 형식의 재고 파일만 업로드할 수 있습니다.")
    try:
        return importer(db, file.filename, await file.read())
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"재고 파일을 읽을 수 없습니다: {error}") from error


@router.post("/product/imports", response_model=InventoryImportResponse, status_code=status.HTTP_201_CREATED)
async def upload_product_inventory(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await _import(file, db, import_product_inventory)


@router.post("/raw/imports", response_model=InventoryImportResponse, status_code=status.HTTP_201_CREATED)
async def upload_raw_inventory(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await _import(file, db, import_raw_inventory)


@router.post("/raw-inbound/imports", response_model=InventoryImportResponse, status_code=status.HTTP_201_CREATED)
async def upload_raw_inbound(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await _import(file, db, import_raw_inbound)


def _latest_import_id(db: Session, kind: str) -> int | None:
    source_name = {"product": "제품 재고", "raw": "원료 재고", "raw_inbound": "원료 입고계획"}[kind]
    active = db.get(ActiveDataSource, source_name)
    if active:
        return active.import_id
    latest = db.scalar(select(InventoryImport).where(InventoryImport.kind == kind).order_by(InventoryImport.imported_at.desc()))
    return latest.id if latest else None


@router.get("/product/items", response_model=list[ProductInventoryResponse])
def list_product_inventory(db: Session = Depends(get_db)):
    import_id = _latest_import_id(db, "product")
    if import_id is None:
        return []
    return list(db.scalars(select(ProductInventoryItem).where(ProductInventoryItem.inventory_import_id == import_id).order_by(ProductInventoryItem.snapshot_date, ProductInventoryItem.product_code)))


@router.get("/raw/items", response_model=list[RawInventoryResponse])
def list_raw_inventory(db: Session = Depends(get_db)):
    import_id = _latest_import_id(db, "raw")
    if import_id is None:
        return []
    return list(db.scalars(select(RawInventoryItem).where(RawInventoryItem.inventory_import_id == import_id).order_by(RawInventoryItem.snapshot_date, RawInventoryItem.material_code)))


@router.get("/raw-inbound/items", response_model=list[RawInboundResponse])
def list_raw_inbound(db: Session = Depends(get_db)):
    import_id = _latest_import_id(db, "raw_inbound")
    if import_id is None:
        return []
    return list(db.scalars(select(RawInboundItem).where(RawInboundItem.inventory_import_id == import_id).order_by(RawInboundItem.inbound_date, RawInboundItem.material_code)))
