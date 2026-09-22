"""Master Excel 업로드 API."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.master_import import MasterImport
from app.schemas.master_import import MasterImportResponse, MasterImportResult
from app.services.master_importer import import_master_workbook

router = APIRouter(prefix="/master-imports", tags=["master imports"])


@router.get("", response_model=list[MasterImportResponse])
def list_master_imports(db: Session = Depends(get_db)) -> list[MasterImport]:
    return list(db.scalars(select(MasterImport).order_by(MasterImport.imported_at.desc())))


@router.post("", response_model=MasterImportResult, status_code=status.HTTP_201_CREATED)
async def upload_master(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> MasterImportResult:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail=".xlsx 형식의 Master Excel 파일만 업로드할 수 있습니다.")
    try:
        master_import, summary = import_master_workbook(db, file.filename, await file.read())
        base = MasterImportResponse.model_validate(master_import)
        return MasterImportResult(**base.model_dump(), **summary)
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Master 파일을 읽을 수 없습니다: {error}") from error
