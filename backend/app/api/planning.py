"""필요 생산량 계산 API."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.planning_run import PlanningRun, ProductionRequirement
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
