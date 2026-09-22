"""제품·원료 재고 Excel을 일자별 스냅샷 데이터로 정규화한다."""

from __future__ import annotations

from datetime import date
from io import BytesIO
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.models.inventory import InventoryImport, ProductInventoryItem, RawInventoryItem
from app.models.active_source import ActiveDataSource

STOCK_SHEET = "현재재고"


def _text(value: Any) -> str:
    return "" if value is None or pd.isna(value) else str(value).strip()


def _quantity(value: Any) -> float:
    if value is None or pd.isna(value):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"재고 수량에 숫자가 아닌 값이 있습니다: {value}") from error


def _stock_sheet(content: bytes) -> pd.DataFrame:
    workbook = BytesIO(content)
    if STOCK_SHEET not in pd.ExcelFile(workbook).sheet_names:
        raise ValueError(f"'{STOCK_SHEET}' 시트를 찾을 수 없습니다.")
    workbook.seek(0)
    return pd.read_excel(workbook, sheet_name=STOCK_SHEET, header=None)


def parse_product_inventory(content: bytes) -> list[tuple[date, str, str, str, str, float]]:
    sheet = _stock_sheet(content)
    if sheet.shape[0] < 5 or sheet.shape[1] < 3:
        raise ValueError("제품 재고 파일의 헤더 또는 데이터 행이 부족합니다.")
    products = sheet.iloc[0].ffill()
    processes = sheet.iloc[1].ffill()
    lines = sheet.iloc[2].ffill()
    statuses = sheet.iloc[3]
    records = []
    for row_index in range(4, sheet.shape[0]):
        current = pd.to_datetime(sheet.iat[row_index, 0], errors="coerce")
        if pd.isna(current):
            continue
        for column in range(2, sheet.shape[1]):
            product, process, line, status = (_text(products.iat[column]), _text(processes.iat[column]), _text(lines.iat[column]), _text(statuses.iat[column]))
            value = sheet.iat[row_index, column]
            # 빈 셀은 재고 0이 아니라 해당 일자의 미입력값이다. 실제 0은 그대로 저장한다.
            if product and status and not pd.isna(value):
                records.append((current.date(), product, process, line, status, _quantity(value)))
    if not records:
        raise ValueError("제품 재고 데이터를 찾을 수 없습니다.")
    return records


def parse_raw_inventory(content: bytes) -> list[tuple[date, str, str, float]]:
    sheet = _stock_sheet(content)
    if sheet.shape[0] < 3 or sheet.shape[1] < 3:
        raise ValueError("원료 재고 파일의 헤더 또는 데이터 행이 부족합니다.")
    plant_name = _text(sheet.iat[1, 0])
    materials = sheet.iloc[1, 2:]
    if not plant_name:
        raise ValueError("원료 재고 파일에서 공장명을 찾을 수 없습니다.")
    records = []
    for row_index in range(2, sheet.shape[0]):
        current = pd.to_datetime(sheet.iat[row_index, 0], errors="coerce")
        if pd.isna(current):
            continue
        for column, material in enumerate(materials, start=2):
            material_code = _text(material)
            value = sheet.iat[row_index, column]
            if material_code and not pd.isna(value):
                records.append((current.date(), plant_name, material_code, _quantity(value)))
    if not records:
        raise ValueError("원료 재고 데이터를 찾을 수 없습니다.")
    return records


def import_product_inventory(db: Session, file_name: str, content: bytes) -> InventoryImport:
    records = parse_product_inventory(content)
    imported = InventoryImport(kind="product", file_name=file_name, item_count=len(records))
    db.add(imported)
    db.flush()
    db.add_all(ProductInventoryItem(inventory_import_id=imported.id, snapshot_date=day, product_code=product, process_name=process, line_name=line, stock_status=status, quantity_ton=quantity) for day, product, process, line, status, quantity in records)
    active = db.get(ActiveDataSource, "제품 재고")
    if active: active.import_id = imported.id
    else: db.add(ActiveDataSource(source_type="제품 재고", import_id=imported.id))
    db.commit()
    db.refresh(imported)
    return imported


def import_raw_inventory(db: Session, file_name: str, content: bytes) -> InventoryImport:
    records = parse_raw_inventory(content)
    imported = InventoryImport(kind="raw", file_name=file_name, item_count=len(records))
    db.add(imported)
    db.flush()
    db.add_all(RawInventoryItem(inventory_import_id=imported.id, snapshot_date=day, plant_name=plant, material_code=material, quantity_ton=quantity) for day, plant, material, quantity in records)
    active = db.get(ActiveDataSource, "원료 재고")
    if active: active.import_id = imported.id
    else: db.add(ActiveDataSource(source_type="원료 재고", import_id=imported.id))
    db.commit()
    db.refresh(imported)
    return imported
