"""라인·일자 단위의 규칙 기반 초기 생산 스케줄러."""

from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.master_import import MasterImport, MasterRecord
from app.models.operations import MaintenanceImport, MaintenanceSchedule
from app.models.planning_master import LineProduct, Plant, ProductionLine, ProductQualitySpec
from app.models.planning_run import PlanningRun, ProductionRequirement
from app.models.schedule import ProductionScheduleItem, ScheduleRun, SchedulerSetting, UnscheduledRequirement, WorkCalendarDay
from app.models.production_actual import ProductionActualImport, ProductionActualItem
from app.models.active_source import ActiveDataSource


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _family(product_code: str) -> str:
    return product_code.split("_", 1)[0]


def _product_specs(db: Session) -> dict[str, tuple[float, float]]:
    """시간 생산량은 원본 Master, 수율은 정규화된 DB 기준정보에서 읽는다."""
    active = db.get(ActiveDataSource, "Master")
    latest = db.get(MasterImport, active.import_id) if active else db.scalar(select(MasterImport).order_by(MasterImport.imported_at.desc()))
    if latest is None:
        return {}
    records = db.scalars(select(MasterRecord).where(MasterRecord.import_id == latest.id))
    yields = {row.semi_product_code: row.production_yield for row in db.scalars(select(ProductQualitySpec))}
    specs: dict[str, tuple[float, float]] = {}
    for record in records:
        values = record.values
        if record.sheet_name == "제품(소성) Master" and len(values) > 13:
            code = _text(values[4])
            if code:
                specs[code] = (_number(values[12]), yields.get(code, _number(values[13], 1.0) or 1.0))
        elif record.sheet_name == "제품(소성 외) Master" and len(values) > 9:
            code = _text(values[4])
            if code:
                specs[code] = (_number(values[9]) / 24.0, yields.get(code, _number(values[6], 1.0) or 1.0))
    return specs


def _downtime_lookup(db: Session) -> dict[tuple[date, str, str], float]:
    active = db.get(ActiveDataSource, "정비휴지일정")
    latest = db.get(MaintenanceImport, active.import_id) if active else db.scalar(select(MaintenanceImport).order_by(MaintenanceImport.imported_at.desc()))
    if latest is None:
        return {}
    schedules = db.scalars(select(MaintenanceSchedule).where(MaintenanceSchedule.maintenance_import_id == latest.id))
    return {(item.scheduled_date, item.plant_name, item.line_name): item.downtime_hours for item in schedules}


def _working_days(db: Session, year: int, month: int) -> list[date]:
    """저장된 휴일을 우선하고, 미설정 상태에서는 매일 24시간 가동을 적용한다."""
    month_days = [date(year, month, day) for day in range(1, monthrange(year, month)[1] + 1)]
    saved = {item.calendar_date: item.is_working for item in db.scalars(select(WorkCalendarDay).where(WorkCalendarDay.calendar_date.in_(month_days)))}
    return [day for day in month_days if saved.get(day, True)]


def _working_days_in_range(db: Session, start_year: int, start_month: int, end_year: int, end_month: int) -> list[date]:
    days: list[date] = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        days.extend(_working_days(db, year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return days


def _changeover_hours(db: Session) -> float:
    settings = db.get(SchedulerSetting, 1)
    return settings.changeover_hours if settings else 0.0


def create_schedule_run(db: Session, planning_run_id: int, initial_conditions: list[Any] | None = None) -> tuple[ScheduleRun, list[ProductionScheduleItem], list[UnscheduledRequirement]]:
    planning_run = db.get(PlanningRun, planning_run_id)
    if not planning_run:
        raise ValueError("필요 생산량 계산 이력을 찾을 수 없습니다.")
    requirements = list(db.scalars(select(ProductionRequirement).where(ProductionRequirement.planning_run_id == planning_run_id)))
    if not requirements:
        raise ValueError("배분할 필요 생산량이 없습니다.")

    lines = list(db.scalars(select(ProductionLine)))
    line_products = list(db.scalars(select(LineProduct)))
    plants = {plant.code: plant.name for plant in db.scalars(select(Plant))}
    specs = _product_specs(db)
    if not lines or not line_products or not specs:
        raise ValueError("Master의 라인 또는 제품 생산성 정보를 찾을 수 없습니다.")
    products_by_line: dict[str, list[str]] = {}
    for item in line_products:
        products_by_line.setdefault(item.line_code, []).append(item.product_code)
    downtime = _downtime_lookup(db)
    custom_conditions = {(item.planned_date, item.line_code): item for item in initial_conditions or []}

    run = ScheduleRun(planning_run_id=planning_run_id)
    db.add(run)
    db.flush()
    days = _working_days_in_range(db, planning_run.year, planning_run.month, planning_run.end_year, planning_run.end_month)
    if not days:
        raise ValueError("근무일 캘린더에 생산 가능한 날짜가 없습니다.")
    default_changeover_hours = _changeover_hours(db)
    used_line_days: set[tuple[date, str]] = set()
    last_product_by_line: dict[str, str] = {}
    items: list[ProductionScheduleItem] = []
    shortages: list[UnscheduledRequirement] = []

    # 부족량이 큰 제품부터 배정해 한정된 라인의 우선순위를 명확하게 한다.
    for requirement in sorted(requirements, key=lambda row: row.required_production_ton, reverse=True):
        remaining = requirement.required_production_ton
        candidates = []
        for line in lines:
            matching_codes = [code for code in products_by_line.get(line.code, []) if _family(code) == requirement.product_code]
            for semi_product_code in matching_codes:
                hourly_rate, yield_rate = specs.get(semi_product_code, (0.0, 1.0))
                if hourly_rate > 0:
                    candidates.append((line, hourly_rate, yield_rate))
        # 생산성 높은 라인을 먼저 사용한다.
        candidates.sort(key=lambda item: item[1] * (item[0].operating_efficiency or 1.0) * item[2], reverse=True)
        for line, hourly_rate, yield_rate in candidates:
            if remaining <= 0:
                break
            plant_name = plants.get(line.plant_code, line.plant_code)
            for current_day in days:
                if remaining <= 0:
                    break
                if (current_day, line.code) in used_line_days:
                    continue
                condition = custom_conditions.get((current_day, line.code))
                downtime_hours = min(24.0, max(0.0, condition.downtime_hours if condition else downtime.get((current_day, plant_name, line.name), 0.0)))
                changeover_hours = default_changeover_hours if last_product_by_line.get(line.code) not in (None, requirement.product_code) else 0.0
                available_hours = max(0.0, 24.0 - downtime_hours - changeover_hours)
                capacity = available_hours * hourly_rate * (line.operating_efficiency or 1.0) * yield_rate
                if capacity <= 0:
                    continue
                quantity = min(remaining, capacity)
                item = ProductionScheduleItem(
                    schedule_run_id=run.id,
                    planned_date=current_day,
                    plant_name=plant_name,
                    line_code=line.code,
                    line_name=line.name,
                    product_code=requirement.product_code,
                    planned_quantity_ton=quantity,
                    available_capacity_ton=capacity,
                    downtime_hours=downtime_hours,
                    work_rate=line.operating_efficiency or 1.0,
                    yield_rate=yield_rate,
                    operation_status=condition.operation_status if condition else ("휴지" if downtime_hours >= 24 else "가동"),
                    changeover_hours=changeover_hours,
                )
                db.add(item)
                items.append(item)
                used_line_days.add((current_day, line.code))
                last_product_by_line[line.code] = requirement.product_code
                remaining -= quantity
        shortages.append(UnscheduledRequirement(
            schedule_run_id=run.id,
            product_code=requirement.product_code,
            required_quantity_ton=requirement.required_production_ton,
            scheduled_quantity_ton=requirement.required_production_ton - remaining,
            unallocated_quantity_ton=max(0.0, remaining),
        ))
    db.add_all(shortages)
    db.commit()
    db.refresh(run)
    for item in items:
        db.refresh(item)
    for shortage in shortages:
        db.refresh(shortage)
    return run, items, shortages


def update_schedule_item(db: Session, item_id: int, planned_date: date, product_code: str, quantity_ton: float | None, downtime_hours: float | None, work_rate: float | None, operation_status: str | None, auto_calculate: bool, is_locked: bool, adjustment_note: str) -> tuple[ScheduleRun, list[ProductionScheduleItem], list[UnscheduledRequirement]]:
    """수동 수정값을 CAPA·라인 가능 제품·근무일 조건 안에서 저장한다."""
    item = db.get(ProductionScheduleItem, item_id)
    if not item:
        raise ValueError("수정할 생산 스케줄을 찾을 수 없습니다.")
    if item.is_locked and is_locked and (
        planned_date != item.planned_date
        or product_code != item.product_code
        or (quantity_ton is not None and abs(quantity_ton - item.planned_quantity_ton) > 1e-8)
        or adjustment_note.strip() != item.adjustment_note
    ):
        raise ValueError("고정된 일정입니다. '고정' 체크를 해제한 뒤 수정해 주세요.")
    run = db.get(ScheduleRun, item.schedule_run_id)
    planning_run = db.get(PlanningRun, run.planning_run_id) if run else None
    if not run or not planning_run:
        raise ValueError("스케줄의 계획 기준을 찾을 수 없습니다.")
    if run.status == "확정":
        raise ValueError("확정된 스케줄은 수정할 수 없습니다. 새 버전을 복사해 수정해 주세요.")
    period_start = date(planning_run.year, planning_run.month, 1)
    period_end = date(planning_run.year + ((planning_run.month + 2) // 12), ((planning_run.month + 2) % 12) + 1, 1) - __import__("datetime").timedelta(days=1)
    if not period_start <= planned_date <= period_end:
        raise ValueError("생산계획 구간 안의 날짜만 지정할 수 있습니다.")
    duplicate = db.scalar(select(ProductionScheduleItem).where(ProductionScheduleItem.schedule_run_id == run.id, ProductionScheduleItem.planned_date == planned_date, ProductionScheduleItem.line_code == item.line_code, ProductionScheduleItem.id != item.id))
    if duplicate:
        raise ValueError("같은 라인·날짜에 이미 다른 생산 스케줄이 있습니다.")
    valid_products = {row.product_code for row in db.scalars(select(ProductionRequirement).where(ProductionRequirement.planning_run_id == planning_run.id))}
    if product_code not in valid_products:
        raise ValueError("이번 필요 생산량에 포함된 제품만 지정할 수 있습니다.")
    line = db.get(ProductionLine, item.line_code)
    specs = _product_specs(db)
    matching = [row.product_code for row in db.scalars(select(LineProduct).where(LineProduct.line_code == item.line_code)) if _family(row.product_code) == product_code]
    choices = [specs[code] for code in matching if code in specs and specs[code][0] > 0]
    if not line or not choices:
        raise ValueError("선택한 제품은 이 라인에서 생산할 수 없습니다.")
    hourly_rate, yield_rate = max(choices, key=lambda spec: spec[0] * spec[1])
    plants = {plant.code: plant.name for plant in db.scalars(select(Plant))}
    default_downtime = _downtime_lookup(db).get((planned_date, plants.get(line.plant_code, line.plant_code), line.name), 0.0)
    downtime = min(24.0, max(0.0, item.downtime_hours if downtime_hours is None else downtime_hours))
    status = operation_status or item.operation_status
    if status not in {"가동", "휴지"}:
        raise ValueError("설비 상태는 가동 또는 휴지만 지정할 수 있습니다.")
    if status == "휴지":
        downtime = 24.0
    elif downtime_hours is None and item.operation_status == "휴지":
        downtime = min(24.0, max(0.0, default_downtime))
    changeover = item.changeover_hours if product_code == item.product_code else _changeover_hours(db)
    rate = min(1.0, max(0.0, item.work_rate if work_rate is None else work_rate / 100.0))
    capacity = max(0.0, 24.0 - downtime - changeover) * hourly_rate * rate * yield_rate
    new_quantity = capacity if auto_calculate else (item.planned_quantity_ton if quantity_ton is None else quantity_ton)
    if new_quantity > capacity + 1e-8:
        raise ValueError(f"입력 생산량이 해당 라인의 가용능력({capacity:.2f}톤)을 초과합니다.")
    item.planned_date, item.product_code = planned_date, product_code
    item.planned_quantity_ton, item.available_capacity_ton = new_quantity, capacity
    item.downtime_hours, item.work_rate, item.yield_rate, item.operation_status, item.changeover_hours = downtime, rate, yield_rate, status, changeover
    item.is_locked, item.adjustment_note = is_locked, adjustment_note.strip()
    all_items = list(db.scalars(select(ProductionScheduleItem).where(ProductionScheduleItem.schedule_run_id == run.id)))
    scheduled_by_product: dict[str, float] = {}
    for row in all_items:
        scheduled_by_product[row.product_code] = scheduled_by_product.get(row.product_code, 0.0) + row.planned_quantity_ton
    shortages = list(db.scalars(select(UnscheduledRequirement).where(UnscheduledRequirement.schedule_run_id == run.id)))
    for shortage in shortages:
        shortage.scheduled_quantity_ton = scheduled_by_product.get(shortage.product_code, 0.0)
        shortage.unallocated_quantity_ton = max(0.0, shortage.required_quantity_ton - shortage.scheduled_quantity_ton)
    db.commit()
    items = list(db.scalars(select(ProductionScheduleItem).where(ProductionScheduleItem.schedule_run_id == run.id).order_by(ProductionScheduleItem.planned_date, ProductionScheduleItem.line_code)))
    for row in items + shortages:
        db.refresh(row)
    return run, items, shortages


def reschedule_shortfalls(db: Session, schedule_run_id: int) -> tuple[ScheduleRun, list[ProductionScheduleItem], list[UnscheduledRequirement], dict[str, float]]:
    """실적 마감일까지의 미달 물량을 이후 미고정 일정의 잔여 CAPA에 보충한다."""
    run = db.get(ScheduleRun, schedule_run_id)
    active = db.get(ActiveDataSource, "생산실적")
    latest = db.get(ProductionActualImport, active.import_id) if active else db.scalar(select(ProductionActualImport).order_by(ProductionActualImport.imported_at.desc()))
    if not run or not latest:
        raise ValueError("재스케줄하려면 생산 스케줄과 생산실적을 먼저 등록해 주세요.")
    if run.status == "확정":
        raise ValueError("확정된 스케줄은 재스케줄할 수 없습니다. 새 버전을 복사해 수정해 주세요.")
    actuals = list(db.scalars(select(ProductionActualItem).where(ProductionActualItem.actual_import_id == latest.id)))
    if not actuals:
        raise ValueError("재스케줄할 생산실적이 없습니다.")
    cutoff = max(row.actual_date for row in actuals)
    actual_by_key: dict[tuple[date, str, str, str], float] = {}
    for row in actuals:
        key = (row.actual_date, "".join(row.plant_name.split()), row.line_name, row.product_code)
        actual_by_key[key] = actual_by_key.get(key, 0.0) + row.quantity_ton
    items = list(db.scalars(select(ProductionScheduleItem).where(ProductionScheduleItem.schedule_run_id == run.id).order_by(ProductionScheduleItem.planned_date)))
    deficits: dict[str, float] = {}
    for row in items:
        if row.planned_date <= cutoff:
            actual = actual_by_key.get((row.planned_date, "".join(row.plant_name.split()), row.line_name, row.product_code), 0.0)
            deficits[row.product_code] = deficits.get(row.product_code, 0.0) + max(0.0, row.planned_quantity_ton - actual)
    recovered: dict[str, float] = {}
    for product, deficit in deficits.items():
        remaining = deficit
        for row in items:
            if remaining <= 0:
                break
            if row.is_locked or row.product_code != product or row.planned_date <= cutoff:
                continue
            spare = max(0.0, row.available_capacity_ton - row.planned_quantity_ton)
            added = min(remaining, spare)
            row.planned_quantity_ton += added
            remaining -= added
        recovered[product] = deficit - remaining
    db.commit()
    shortages = list(db.scalars(select(UnscheduledRequirement).where(UnscheduledRequirement.schedule_run_id == run.id).order_by(UnscheduledRequirement.product_code)))
    return run, items, shortages, recovered
