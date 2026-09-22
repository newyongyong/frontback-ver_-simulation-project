"""BOM, 원료재고, 원료 입고계획으로 생산 스케줄의 원료 가용성을 검증한다."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import InventoryImport, RawInventoryItem
from app.models.operations import RawInboundItem
from app.models.planning_master import BomItem
from app.models.schedule import ProductionScheduleItem, RawMaterialDailyBalance, RawMaterialValidationRun, ScheduleRun
from app.models.active_source import ActiveDataSource


def _family(product_code: str) -> str:
    return product_code.split("_", 1)[0]


def _plant_key(plant_name: str) -> str:
    """Excel마다 다른 공장명 공백 표기를 같은 공장으로 본다."""
    return "".join(str(plant_name).split()).upper()


def _latest_import_id(db: Session, kind: str) -> int | None:
    source_name = {"raw": "원료 재고", "raw_inbound": "원료 입고계획"}.get(kind)
    active = db.get(ActiveDataSource, source_name) if source_name else None
    if active:
        return active.import_id
    latest = db.scalar(select(InventoryImport).where(InventoryImport.kind == kind).order_by(InventoryImport.imported_at.desc()))
    return latest.id if latest else None


def _bom_by_product(db: Session) -> tuple[dict[str, tuple[str, list[BomItem]]], dict[str, list[BomItem]]]:
    """완제품 제품군별 대표 반제품 BOM을 찾는다.

    BOM에는 CP16S1_H → 원료와 CP16S1_S → CP16S1_H처럼 공정 중간재
    BOM이 함께 있다. 스케줄러가 선택하는 대표 생산품(H)을 출발점으로
    잡고, 아래 단계의 중간재 BOM은 재귀적으로 전개한다.
    """
    by_output: dict[str, list[BomItem]] = defaultdict(list)
    for item in db.scalars(select(BomItem).order_by(BomItem.output_product_code, BomItem.material_slot)):
        by_output[item.output_product_code].append(item)
    by_family: dict[str, tuple[str, list[BomItem]]] = {}
    for output_code in sorted(by_output):
        # 같은 제품군의 첫 BOM 출력은 H 등 대표 반제품으로 사용한다.
        by_family.setdefault(_family(output_code), (output_code, by_output[output_code]))
    return by_family, by_output


def _leaf_material_requirements(
    output_code: str, quantity_ton: float, bom_by_output: dict[str, list[BomItem]], trail: set[str] | None = None
) -> list[tuple[str, float]]:
    """중간재 BOM을 끝까지 전개하여 실제 원료별 소요량을 계산한다."""
    trail = set() if trail is None else trail
    if output_code in trail:
        raise ValueError(f"BOM 순환 참조가 있습니다: {output_code}")
    bom_items = bom_by_output.get(output_code)
    if not bom_items:
        return [(output_code, quantity_ton)]
    results: list[tuple[str, float]] = []
    next_trail = trail | {output_code}
    for bom in bom_items:
        results.extend(_leaf_material_requirements(
            bom.input_material_code,
            quantity_ton * bom.input_ratio,
            bom_by_output,
            next_trail,
        ))
    return results


def validate_schedule_raw_materials(
    db: Session, schedule_run_id: int
) -> tuple[RawMaterialValidationRun, list[RawMaterialDailyBalance]]:
    schedule_run = db.get(ScheduleRun, schedule_run_id)
    if not schedule_run:
        raise ValueError("생산 스케줄 이력을 찾을 수 없습니다.")
    schedule_items = list(db.scalars(
        select(ProductionScheduleItem)
        .where(ProductionScheduleItem.schedule_run_id == schedule_run_id)
        .order_by(ProductionScheduleItem.planned_date, ProductionScheduleItem.id)
    ))
    if not schedule_items:
        raise ValueError("검증할 일자별 생산 스케줄이 없습니다.")

    raw_import_id = _latest_import_id(db, "raw")
    inbound_import_id = _latest_import_id(db, "raw_inbound")
    if raw_import_id is None:
        raise ValueError("원료 재고가 등록되어 있지 않습니다. 원료 재고 Excel을 먼저 등록해 주세요.")
    if inbound_import_id is None:
        raise ValueError("원료 입고계획이 등록되어 있지 않습니다. 원료 입고계획 Excel을 먼저 등록해 주세요.")

    bom_by_product, bom_by_output = _bom_by_product(db)
    daily_usage: dict[tuple[date, str, str], float] = defaultdict(float)
    used_keys: set[tuple[str, str]] = set()
    missing_bom_products: set[str] = set()
    for item in schedule_items:
        recipe = bom_by_product.get(item.product_code)
        if not recipe:
            missing_bom_products.add(item.product_code)
            continue
        output_code, _ = recipe
        for material_code, required_quantity in _leaf_material_requirements(output_code, item.planned_quantity_ton, bom_by_output):
            key = (item.planned_date, item.plant_name, material_code)
            daily_usage[key] += required_quantity
            used_keys.add((item.plant_name, material_code))
    if missing_bom_products:
        names = ", ".join(sorted(missing_bom_products))
        raise ValueError(f"다음 생산 제품의 BOM을 찾을 수 없습니다: {names}")
    if not daily_usage:
        raise ValueError("BOM 기준 원료 소요량을 계산하지 못했습니다.")

    first_day = schedule_items[0].planned_date
    last_day = schedule_items[-1].planned_date
    raw_items = list(db.scalars(select(RawInventoryItem).where(RawInventoryItem.inventory_import_id == raw_import_id)))
    inbound_items = list(db.scalars(select(RawInboundItem).where(RawInboundItem.inventory_import_id == inbound_import_id)))

    # 계획 시작일 이전(또는 당일)의 가장 최신 실사 재고를 시작 재고로 사용한다.
    opening: dict[tuple[str, str], float] = {}
    opening_date: dict[tuple[str, str], date] = {}
    for item in raw_items:
        normalized_key = (_plant_key(item.plant_name), item.material_code)
        matching_keys = [key for key in used_keys if (_plant_key(key[0]), key[1]) == normalized_key]
        if not matching_keys or item.snapshot_date > first_day:
            continue
        for key in matching_keys:
            if key not in opening_date or item.snapshot_date > opening_date[key]:
                opening[key] = item.quantity_ton
                opening_date[key] = item.snapshot_date

    inbound_by_day: dict[tuple[date, str, str], float] = defaultdict(float)
    for item in inbound_items:
        normalized_key = (_plant_key(item.plant_name), item.material_code)
        if first_day <= item.inbound_date <= last_day:
            for key in used_keys:
                if (_plant_key(key[0]), key[1]) == normalized_key:
                    inbound_by_day[(item.inbound_date, *key)] += item.quantity_ton

    validation = RawMaterialValidationRun(schedule_run_id=schedule_run_id)
    db.add(validation)
    db.flush()
    balances: list[RawMaterialDailyBalance] = []
    current_stock = {key: opening.get(key, 0.0) for key in used_keys}
    # 스케줄이 없는 중간 날짜도 입고를 이월하려면 전체 날짜를 순회한다.
    all_days = [date.fromordinal(day) for day in range(first_day.toordinal(), last_day.toordinal() + 1)]
    for current_day in all_days:
        for plant_name, material_code in sorted(used_keys):
            opening_quantity = current_stock[(plant_name, material_code)]
            inbound_quantity = inbound_by_day[(current_day, plant_name, material_code)]
            required_quantity = daily_usage[(current_day, plant_name, material_code)]
            theoretical_ending = opening_quantity + inbound_quantity - required_quantity
            shortage_quantity = max(0.0, -theoretical_ending)
            # 부족분을 외부 조달한 것으로 처리하지 않고 0에서 멈춘다.
            ending_quantity = max(0.0, theoretical_ending)
            current_stock[(plant_name, material_code)] = ending_quantity
            if inbound_quantity or required_quantity or shortage_quantity:
                balance = RawMaterialDailyBalance(
                    validation_run_id=validation.id,
                    balance_date=current_day,
                    plant_name=plant_name,
                    material_code=material_code,
                    opening_quantity_ton=opening_quantity,
                    inbound_quantity_ton=inbound_quantity,
                    required_quantity_ton=required_quantity,
                    ending_quantity_ton=ending_quantity,
                    shortage_quantity_ton=shortage_quantity,
                )
                db.add(balance)
                balances.append(balance)
    db.commit()
    db.refresh(validation)
    for balance in balances:
        db.refresh(balance)
    return validation, balances
