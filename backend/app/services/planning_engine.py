"""판매수요와 출하가능 재고를 바탕으로 제품별 필요 생산량을 계산한다."""

from calendar import monthrange
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import InventoryImport, ProductInventoryItem
from app.models.master_import import MasterImport, MasterRecord
from app.models.planning_run import PlanningRun, ProductionRequirement
from app.models.sales_plan import SalesImport, SalesPlanItem
from app.models.active_source import ActiveDataSource

def _active_id(db: Session, source_type: str) -> int | None:
    row = db.get(ActiveDataSource, source_type)
    return row.import_id if row else None


def _latest_product_inventory_import(db: Session) -> InventoryImport | None:
    active_id = _active_id(db, "제품 재고")
    if active_id:
        return db.get(InventoryImport, active_id)
    return db.scalar(
        select(InventoryImport)
        .where(InventoryImport.kind == "product")
        .order_by(InventoryImport.imported_at.desc())
    )


def _opening_inventory(db: Session, import_id: int | None, product_code: str, planning_start: date) -> float:
    if import_id is None:
        return 0.0
    rows = list(db.scalars(
        select(ProductInventoryItem)
        .where(
            ProductInventoryItem.inventory_import_id == import_id,
            ProductInventoryItem.product_code == product_code,
            ProductInventoryItem.process_name == "입고",
            ProductInventoryItem.stock_status == "출하가능",
        )
        .order_by(ProductInventoryItem.snapshot_date)
    ))
    if not rows:
        return 0.0
    eligible_dates = [item.snapshot_date for item in rows if item.snapshot_date <= planning_start]
    selected_date = max(eligible_dates) if eligible_dates else min(item.snapshot_date for item in rows)
    return sum(item.quantity_ton for item in rows if item.snapshot_date == selected_date)


def _add_months(year: int, month: int, offset: int) -> tuple[int, int]:
    total = year * 12 + month - 1 + offset
    return total // 12, total % 12 + 1


def _safety_stock_days(db: Session) -> dict[str, float]:
    """최신 Master의 재고운영 기준에서 완제품 안전재고일수를 읽는다."""
    active = db.get(ActiveDataSource, "Master")
    latest_master = db.get(MasterImport, active.import_id) if active else db.scalar(select(MasterImport).order_by(MasterImport.imported_at.desc()))
    if latest_master is None:
        return {}
    records = db.scalars(select(MasterRecord).where(
        MasterRecord.import_id == latest_master.id,
        MasterRecord.sheet_name == "재고운영 Master",
    ))
    result: dict[str, float] = {}
    for record in records:
        values = record.values
        if len(values) < 10:
            continue
        product_code = str(values[0] or "").strip()
        stock_kind = str(values[4] or "").strip()
        enabled = str(values[9] or "").strip().upper()
        try:
            days = float(values[5])
        except (TypeError, ValueError):
            continue
        if product_code and stock_kind == "완제품재고" and enabled == "Y" and days >= 0:
            result[product_code] = days
    return result


def _average_daily_sales(db: Session, sales_import_id: int, product_code: str, periods: list[tuple[int, int]]) -> float:
    """선택한 계획 구간의 총 판매량 ÷ 해당 구간의 총 일수를 계산한다."""
    total_days = sum(monthrange(period_year, period_month)[1] for period_year, period_month in periods)
    total_sales = 0.0
    for period_year, period_month in periods:
        amount = db.scalars(select(SalesPlanItem.quantity_ton).where(
            SalesPlanItem.sales_import_id == sales_import_id,
            SalesPlanItem.product_code == product_code,
            SalesPlanItem.year == period_year,
            SalesPlanItem.month == period_month,
        )).all()
        total_sales += sum(amount)
    return total_sales / total_days if total_days else 0.0


def create_requirement_run(db: Session, year: int, month: int, end_year: int, end_month: int) -> tuple[PlanningRun, list[ProductionRequirement]]:
    if (end_year, end_month) < (year, month):
        raise ValueError("To는 From과 같거나 이후 월이어야 합니다.")
    periods: list[tuple[int, int]] = []
    current_year, current_month = year, month
    while (current_year, current_month) <= (end_year, end_month):
        periods.append((current_year, current_month))
        current_year, current_month = _add_months(current_year, current_month, 1)
    sales_import = db.get(SalesImport, _active_id(db, "판매계획")) if _active_id(db, "판매계획") else db.scalar(select(SalesImport).order_by(SalesImport.imported_at.desc()))
    if sales_import is None:
        raise ValueError("판매계획을 먼저 업로드해 주세요.")
    sales_items = [
        item for item in db.scalars(select(SalesPlanItem).where(SalesPlanItem.sales_import_id == sales_import.id))
        if (item.year, item.month) in set(periods)
    ]
    if not sales_items:
        raise ValueError("선택한 계획 구간의 판매계획이 없습니다.")

    demand_by_product: dict[str, float] = {}
    for item in sales_items:
        demand_by_product[item.product_code] = demand_by_product.get(item.product_code, 0.0) + item.quantity_ton

    inventory_import = _latest_product_inventory_import(db)
    run = PlanningRun(
        year=year,
        month=month,
        end_year=end_year,
        end_month=end_month,
        sales_import_id=sales_import.id,
        product_inventory_import_id=inventory_import.id if inventory_import else None,
    )
    db.add(run)
    db.flush()
    requirements = []
    planning_start = date(year, month, 1)
    safety_days_by_product = _safety_stock_days(db)
    for product_code, demand in sorted(demand_by_product.items()):
        inventory = _opening_inventory(db, inventory_import.id if inventory_import else None, product_code, planning_start)
        safety_days = safety_days_by_product.get(product_code, 0.0)
        average_daily_sales = _average_daily_sales(db, sales_import.id, product_code, periods)
        safety_target = safety_days * average_daily_sales
        requirement = ProductionRequirement(
            planning_run_id=run.id,
            product_code=product_code,
            sales_demand_ton=demand,
            available_inventory_ton=inventory,
            safety_stock_days=safety_days,
            average_daily_sales_ton=average_daily_sales,
            safety_stock_target_ton=safety_target,
            required_production_ton=max(0.0, demand - inventory + safety_target),
        )
        db.add(requirement)
        requirements.append(requirement)
    db.commit()
    db.refresh(run)
    for requirement in requirements:
        db.refresh(requirement)
    return run, requirements
