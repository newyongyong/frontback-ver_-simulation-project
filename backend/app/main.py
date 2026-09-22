"""생산계획 FastAPI 서버 진입점."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.products import router as products_router
from app.api.master_imports import router as master_imports_router
from app.api.sales_imports import router as sales_imports_router
from app.api.inventories import router as inventories_router
from app.api.maintenance import router as maintenance_router
from app.api.planning import router as planning_router
from app.api.scheduler import router as scheduler_router
from app.api.specifications import router as specifications_router
from app.api.production_actuals import router as production_actuals_router
from app.api.data_status import router as data_status_router
from app.database import Base, engine, ensure_planning_requirement_columns, SessionLocal
from app.services.master_importer import sync_production_yields_from_master
from app.models import Product  # noqa: F401 - 테이블 등록을 위한 import

Base.metadata.create_all(bind=engine)
ensure_planning_requirement_columns()
with SessionLocal() as db:
    sync_production_yields_from_master(db)

app = FastAPI(title="Production Planning API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products_router)
app.include_router(master_imports_router)
app.include_router(sales_imports_router)
app.include_router(inventories_router)
app.include_router(maintenance_router)
app.include_router(planning_router)
app.include_router(scheduler_router)
app.include_router(specifications_router)
app.include_router(production_actuals_router)
app.include_router(data_status_router)


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "생산계획 API가 실행 중입니다."}
