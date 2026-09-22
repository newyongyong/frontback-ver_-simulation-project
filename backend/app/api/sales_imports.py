"""판매계획 Excel 업로드 및 조회 API."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.sales_plan import SalesImport, SalesPlanItem
from app.models.product import Product
from app.models.active_source import ActiveDataSource
from app.schemas.sales_plan import SalesImportResponse, SalesPlanComparisonResponse, SalesPlanItemResponse
from app.services.sales_importer import import_sales_workbook, validate_sales_workbook, validation_report_workbook

router = APIRouter(prefix="/sales", tags=["sales plans"])


async def _validate_upload(file: UploadFile, db: Session):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail=".xlsx 형식의 판매계획 파일만 검증할 수 있습니다.")
    return validate_sales_workbook(await file.read(), {row.code for row in db.scalars(select(Product))})


@router.post("/imports/validate")
async def validate_sales_import(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await _validate_upload(file, db)


@router.post("/imports/validation-report")
async def download_validation_report(file: UploadFile = File(...), db: Session = Depends(get_db)):
    validation = await _validate_upload(file, db)
    output = validation_report_workbook(validation)
    headers = {"Content-Disposition": 'attachment; filename="sales_plan_validation_errors.xlsx"'}
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@router.post("/imports", response_model=SalesImportResponse, status_code=status.HTTP_201_CREATED)
async def upload_sales_plan(file: UploadFile = File(...), db: Session = Depends(get_db)) -> SalesImport:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail=".xlsx 형식의 판매계획 파일만 업로드할 수 있습니다.")
    try:
        return import_sales_workbook(db, file.filename, await file.read())
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"판매계획 파일을 읽을 수 없습니다: {error}") from error


@router.get("/imports", response_model=list[SalesImportResponse])
def list_sales_imports(db: Session = Depends(get_db)) -> list[SalesImport]:
    return list(db.scalars(select(SalesImport).order_by(SalesImport.imported_at.desc())))


@router.get("/items", response_model=list[SalesPlanItemResponse])
def list_sales_items(import_id: int | None = None, db: Session = Depends(get_db)) -> list[SalesPlanItem]:
    selected_import_id = import_id
    if selected_import_id is None:
        active = db.get(ActiveDataSource, "판매계획")
        latest = db.get(SalesImport, active.import_id) if active else db.scalar(select(SalesImport).order_by(SalesImport.imported_at.desc()))
        if latest is None:
            return []
        selected_import_id = latest.id
    return list(db.scalars(
        select(SalesPlanItem)
        .where(SalesPlanItem.sales_import_id == selected_import_id)
        .order_by(SalesPlanItem.year, SalesPlanItem.month, SalesPlanItem.customer, SalesPlanItem.product_code)
    ))


@router.get("/comparison", response_model=SalesPlanComparisonResponse)
def compare_sales_imports(
    base_import_id: int,
    compare_import_id: int,
    db: Session = Depends(get_db),
) -> SalesPlanComparisonResponse:
    """두 판매계획 업로드본을 고객사·제품·연월 기준으로 비교한다."""
    if base_import_id == compare_import_id:
        raise HTTPException(status_code=400, detail="서로 다른 판매계획 파일을 선택해 주세요.")

    base_import = db.get(SalesImport, base_import_id)
    compare_import = db.get(SalesImport, compare_import_id)
    if base_import is None or compare_import is None:
        raise HTTPException(status_code=404, detail="선택한 판매계획 업로드 이력을 찾을 수 없습니다.")

    def quantities(import_id: int) -> dict[tuple[str, str, int, int], float]:
        rows = db.scalars(select(SalesPlanItem).where(SalesPlanItem.sales_import_id == import_id))
        return {
            (row.customer, row.product_code, row.year, row.month): row.quantity_ton
            for row in rows
        }

    base_rows = quantities(base_import_id)
    compare_rows = quantities(compare_import_id)
    items = []
    for customer, product_code, year, month in sorted(set(base_rows) | set(compare_rows), key=lambda row: (row[2], row[3], row[0], row[1])):
        base_quantity = base_rows.get((customer, product_code, year, month), 0.0)
        compare_quantity = compare_rows.get((customer, product_code, year, month), 0.0)
        difference = compare_quantity - base_quantity
        items.append({
            "customer": customer,
            "product_code": product_code,
            "year": year,
            "month": month,
            "base_quantity_ton": base_quantity,
            "compare_quantity_ton": compare_quantity,
            "difference_ton": difference,
            "difference_rate": difference / base_quantity * 100 if base_quantity else None,
        })

    return SalesPlanComparisonResponse(
        base_import=base_import,
        compare_import=compare_import,
        item_count=len(items),
        base_total_ton=sum(base_rows.values()),
        compare_total_ton=sum(compare_rows.values()),
        difference_total_ton=sum(compare_rows.values()) - sum(base_rows.values()),
        items=items,
    )
