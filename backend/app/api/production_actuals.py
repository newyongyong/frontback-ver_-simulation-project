from io import BytesIO
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.dependencies import get_db
from app.models.production_actual import ProductionActualImport, ProductionActualItem
from app.models.schedule import ProductionScheduleItem, ScheduleRun
from app.models.active_source import ActiveDataSource

router = APIRouter(prefix="/production-actuals", tags=["production actuals"])
ALIASES = {"date": ["일자", "생산일", "date"], "plant": ["공장", "plant"], "line": ["라인", "line"], "product": ["제품", "제품코드", "product"], "quantity": ["생산량", "실적", "수량", "quantity"]}
def _column(columns, name):
    return next((c for c in columns if str(c).strip().lower() in [x.lower() for x in ALIASES[name]]), None)
@router.post("/imports", status_code=status.HTTP_201_CREATED)
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"): raise HTTPException(400, ".xlsx 실적 파일만 등록할 수 있습니다.")
    try:
        frame = pd.read_excel(BytesIO(await file.read()))
        cols = {key: _column(frame.columns, key) for key in ALIASES}
        if not all(cols.values()): raise ValueError("필수 헤더: 일자, 공장, 라인, 제품, 생산량")
        rows=[]
        for _, row in frame.iterrows():
            day=pd.to_datetime(row[cols['date']], errors='coerce')
            if pd.isna(day): continue
            quantity=float(row[cols['quantity']])
            if quantity < 0: raise ValueError("생산량은 0 이상이어야 합니다.")
            rows.append((day.date(), str(row[cols['plant']]).strip(), str(row[cols['line']]).strip(), str(row[cols['product']]).strip(), quantity))
        if not rows: raise ValueError("등록할 생산실적이 없습니다.")
        imported=ProductionActualImport(file_name=file.filename,item_count=len(rows)); db.add(imported); db.flush()
        db.add_all(ProductionActualItem(actual_import_id=imported.id,actual_date=d,plant_name=p,line_name=l,product_code=pr,quantity_ton=q) for d,p,l,pr,q in rows); db.commit(); db.refresh(imported)
        return {"id":imported.id,"file_name":imported.file_name,"item_count":imported.item_count}
    except ValueError as error:
        db.rollback(); raise HTTPException(400, str(error))
@router.get("/comparison/{schedule_run_id}")
def comparison(schedule_run_id:int, db:Session=Depends(get_db)):
    if not db.get(ScheduleRun,schedule_run_id): raise HTTPException(404,"생산 스케줄을 찾을 수 없습니다.")
    active=db.get(ActiveDataSource, "생산실적")
    latest=db.get(ProductionActualImport, active.import_id) if active else db.scalar(select(ProductionActualImport).order_by(ProductionActualImport.imported_at.desc()))
    actuals=list(db.scalars(select(ProductionActualItem).where(ProductionActualItem.actual_import_id==latest.id))) if latest else []
    actual_map={}
    for a in actuals: actual_map[(a.actual_date,a.plant_name.replace(' ',''),a.line_name,a.product_code)]=actual_map.get((a.actual_date,a.plant_name.replace(' ',''),a.line_name,a.product_code),0)+a.quantity_ton
    rows=[]
    for s in db.scalars(select(ProductionScheduleItem).where(ProductionScheduleItem.schedule_run_id==schedule_run_id).order_by(ProductionScheduleItem.planned_date)):
        actual=actual_map.get((s.planned_date,s.plant_name.replace(' ',''),s.line_name,s.product_code),0)
        rows.append({"date":s.planned_date,"plant_name":s.plant_name,"line_name":s.line_name,"product_code":s.product_code,"planned_ton":s.planned_quantity_ton,"actual_ton":actual,"variance_ton":actual-s.planned_quantity_ton})
    return {"actual_import_id":latest.id if latest else None,"rows":rows}
