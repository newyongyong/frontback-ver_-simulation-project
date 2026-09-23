"""원료 입고와 정비휴지 Excel을 운영 데이터로 정규화한다."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import InventoryImport
from app.models.operations import MaintenanceImport, MaintenanceSchedule, RawInboundItem
from app.models.active_source import ActiveDataSource

STOCK_SHEET = "현재재고"


def _text(value: Any) -> str:
    return "" if value is None or pd.isna(value) else str(value).strip()


def _number(value: Any) -> float:
    if value is None or pd.isna(value):
        return 0.0
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError) as error:
        raise ValueError(f"수량 또는 휴지시간에 숫자가 아닌 값이 있습니다: {value}") from error


def parse_raw_inbound(content: bytes):
    workbook = BytesIO(content)
    if STOCK_SHEET not in pd.ExcelFile(workbook).sheet_names:
        raise ValueError(f"'{STOCK_SHEET}' 시트를 찾을 수 없습니다.")
    workbook.seek(0)
    sheet = pd.read_excel(workbook, sheet_name=STOCK_SHEET, header=None)
    plant_name = _text(sheet.iat[1, 0]) if sheet.shape[0] > 1 else ""
    if not plant_name:
        raise ValueError("원료 입고 파일에서 공장명을 찾을 수 없습니다.")
    records = []
    for row_index in range(2, sheet.shape[0]):
        current = pd.to_datetime(sheet.iat[row_index, 0], errors="coerce")
        if pd.isna(current):
            continue
        for column, material in enumerate(sheet.iloc[1, 2:], start=2):
            material_code = _text(material)
            if material_code:
                records.append((current.date(), plant_name, material_code, _number(sheet.iat[row_index, column])))
    if not records:
        raise ValueError("원료 입고계획 데이터를 찾을 수 없습니다.")
    return records


def _raw_inbound_key(day, plant_name: str, material_code: str) -> tuple[object, str, str]:
    return (day, "".join(plant_name.split()).upper(), material_code)


def import_raw_inbound(db: Session, file_name: str, content: bytes, merge: bool = False) -> InventoryImport:
    records = parse_raw_inbound(content)
    active = db.get(ActiveDataSource, "원료 입고계획")
    merged: dict[tuple[object, str, str], tuple[object, str, str, float]] = {}
    if merge and active:
        for item in db.scalars(select(RawInboundItem).where(RawInboundItem.inventory_import_id == active.import_id)):
            merged[_raw_inbound_key(item.inbound_date, item.plant_name, item.material_code)] = (item.inbound_date, item.plant_name, item.material_code, item.quantity_ton)
    incoming: dict[tuple[object, str, str], tuple[object, str, str, float]] = {}
    for day, plant, material, quantity in records:
        key = _raw_inbound_key(day, plant, material)
        current = incoming.get(key)
        incoming[key] = (day, plant, material, (current[3] if current else 0.0) + quantity)
    # 같은 일자·공장·원료는 새 파일의 값을 사용하고, 새 키는 기존 계획에 추가한다.
    merged.update(incoming)
    applied_records = list(merged.values()) if merge else list(incoming.values())
    imported = InventoryImport(kind="raw_inbound", file_name=file_name, item_count=len(applied_records))
    db.add(imported)
    db.flush()
    db.add_all(RawInboundItem(inventory_import_id=imported.id, inbound_date=day, plant_name=plant, material_code=material, quantity_ton=quantity) for day, plant, material, quantity in applied_records)
    if active:
        active.import_id = imported.id
    else:
        db.add(ActiveDataSource(source_type="원료 입고계획", import_id=imported.id))
    db.commit()
    db.refresh(imported)
    return imported


def parse_maintenance(content: bytes):
    workbook = BytesIO(content)
    excel_file = pd.ExcelFile(workbook)
    records = []
    for plant_name in excel_file.sheet_names:
        if plant_name == "수동Upload":
            continue
        workbook.seek(0)
        sheet = pd.read_excel(workbook, sheet_name=plant_name, header=None)
        if sheet.shape[0] < 4:
            continue
        for row_index in range(3, sheet.shape[0]):
            current = pd.to_datetime(sheet.iat[row_index, 0], errors="coerce")
            if pd.isna(current):
                continue
            for status_column in range(2, sheet.shape[1] - 1, 2):
                line_name = _text(sheet.iat[1, status_column])
                status = _text(sheet.iat[row_index, status_column]) or "가동"
                downtime = min(24.0, _number(sheet.iat[row_index, status_column + 1]))
                if line_name and (status != "가동" or downtime > 0):
                    if status == "비가동":
                        downtime = 24.0
                    records.append((current.date(), plant_name, line_name, status, downtime))
    if not records:
        raise ValueError("정비휴지일정 데이터를 찾을 수 없습니다.")
    return records


def import_maintenance(db: Session, file_name: str, content: bytes) -> MaintenanceImport:
    records = parse_maintenance(content)
    imported = MaintenanceImport(file_name=file_name, item_count=len(records))
    db.add(imported)
    db.flush()
    db.add_all(MaintenanceSchedule(maintenance_import_id=imported.id, scheduled_date=day, plant_name=plant, line_name=line, status=status, downtime_hours=downtime) for day, plant, line, status, downtime in records)
    db.commit()
    db.refresh(imported)
    return imported
