"""필요 생산량 계산 API."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.planning_run import PlanningRun, ProductionRequirement
from app.models.schedule import (
    ProductionScheduleItem,
    RawMaterialDailyBalance,
    RawMaterialValidationRun,
    ScheduleRun,
    UnscheduledRequirement,
)
from app.schemas.planning import PlanningRunCreate, PlanningRunResponse, ProductionRequirementResponse
from app.services.planning_engine import create_requirement_run

router = APIRouter(prefix="/planning", tags=["planning"])


def _response(run: PlanningRun, requirements: list[ProductionRequirement]) -> PlanningRunResponse:
    return PlanningRunResponse(
        id=run.id,
        year=run.year,
        month=run.month,
        end_year=run.end_year,
        end_month=run.end_month,
        created_at=run.created_at,
        requirements=[ProductionRequirementResponse.model_validate(item) for item in requirements],
    )


@router.post("/runs", response_model=PlanningRunResponse, status_code=status.HTTP_201_CREATED)
def create_run(payload: PlanningRunCreate, db: Session = Depends(get_db)) -> PlanningRunResponse:
    try:
        run, requirements = create_requirement_run(db, payload.year, payload.month, payload.end_year, payload.end_month)
        return _response(run, requirements)
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/runs/{run_id}", response_model=PlanningRunResponse)
def get_run(run_id: int, db: Session = Depends(get_db)) -> PlanningRunResponse:
    run = db.get(PlanningRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="생산계획 실행 이력을 찾을 수 없습니다.")
    requirements = list(db.scalars(select(ProductionRequirement).where(ProductionRequirement.planning_run_id == run_id).order_by(ProductionRequirement.product_code)))
    return _response(run, requirements)


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_run(run_id: int, db: Session = Depends(get_db)) -> None:
    """계산 이력과 그 이력에서 파생된 모든 스케줄 결과를 함께 제거한다."""
    run = db.get(PlanningRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="삭제할 생산계획 실행 이력을 찾을 수 없습니다.")

    schedule_run_ids = list(db.scalars(select(ScheduleRun.id).where(ScheduleRun.planning_run_id == run_id)))
    if schedule_run_ids:
        validation_ids = list(db.scalars(
            select(RawMaterialValidationRun.id).where(RawMaterialValidationRun.schedule_run_id.in_(schedule_run_ids))
        ))
        if validation_ids:
            db.execute(delete(RawMaterialDailyBalance).where(RawMaterialDailyBalance.validation_run_id.in_(validation_ids)))
            db.execute(delete(RawMaterialValidationRun).where(RawMaterialValidationRun.id.in_(validation_ids)))
        db.execute(delete(ProductionScheduleItem).where(ProductionScheduleItem.schedule_run_id.in_(schedule_run_ids)))
        db.execute(delete(UnscheduledRequirement).where(UnscheduledRequirement.schedule_run_id.in_(schedule_run_ids)))
        db.execute(delete(ScheduleRun).where(ScheduleRun.id.in_(schedule_run_ids)))
    db.execute(delete(ProductionRequirement).where(ProductionRequirement.planning_run_id == run_id))
    db.delete(run)
    db.commit()
