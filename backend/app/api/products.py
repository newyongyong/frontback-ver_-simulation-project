"""제품 기준정보 API."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.product import Product
from app.models.active_source import ActiveDataSource
from app.models.master_import import MasterImport, MasterRecord
from app.schemas.product import ProductCreate, ProductResponse

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductResponse])
def list_products(db: Session = Depends(get_db)) -> list[ProductResponse]:
    """현재 적용 Master에 들어 있는 제품만 제품 기준정보로 제공한다."""
    active = db.get(ActiveDataSource, "Master")
    master_import = db.get(MasterImport, active.import_id) if active else db.scalar(
        select(MasterImport).order_by(MasterImport.imported_at.desc())
    )
    if master_import is None:
        return []

    product_rows: dict[str, str] = {}
    for record in db.scalars(select(MasterRecord).where(MasterRecord.import_id == master_import.id)):
        if record.sheet_name not in {"제품(소성) Master", "제품(소성 외) Master"} or len(record.values) < 6:
            continue
        code = str(record.values[4] or "").strip()
        name = str(record.values[5] or "").strip()
        if code and name:
            product_rows[code] = name

    stored = {
        product.code: product.id
        for product in db.scalars(select(Product).where(Product.code.in_(product_rows)))
    } if product_rows else {}
    return [
        ProductResponse(id=stored[code], code=code, name=name)
        for code, name in sorted(product_rows.items())
        if code in stored
    ]


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)) -> Product:
    exists = db.scalar(select(Product).where(Product.code == payload.code))
    if exists:
        raise HTTPException(status_code=409, detail="이미 등록된 제품 코드입니다.")

    product = Product(code=payload.code.strip(), name=payload.name.strip())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db)) -> None:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="제품 기준정보를 찾을 수 없습니다.")
    # 판매계획·재고·스케줄 이력은 제품 코드를 값으로 보관하므로 삭제하지 않는다.
    db.delete(product)
    db.commit()
