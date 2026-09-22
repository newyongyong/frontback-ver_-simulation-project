"""정비휴지일정 업로드와 최신 일정 조회 API."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.operations import MaintenanceImport, MaintenanceSchedule
from app.schemas.operations import MaintenanceImportResponse, MaintenanceScheduleResponse
from app.services.operations_importer import import_maintenance

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


@router.post("/imports", response_model=MaintenanceImportResponse, status_code=status.HTTP_201_CREATED)
async def upload_maintenance(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail=".xlsx 형식의 정비휴지 파일만 업로드할 수 있습니다.")
    try:
        return import_maintenance(db, file.filename, await file.read())
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"정비휴지 파일을 읽을 수 없습니다: {error}") from error


@router.get("/schedules", response_model=list[MaintenanceScheduleResponse])
def list_maintenance(db: Session = Depends(get_db)):
    latest = db.scalar(select(MaintenanceImport).order_by(MaintenanceImport.imported_at.desc()))
    if latest is None:
        return []
    return list(db.scalars(select(MaintenanceSchedule).where(MaintenanceSchedule.maintenance_import_id == latest.id).order_by(MaintenanceSchedule.scheduled_date, MaintenanceSchedule.plant_name, MaintenanceSchedule.line_name)))
