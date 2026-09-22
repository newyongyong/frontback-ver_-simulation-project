"""기존 생산계획 Master Excel을 SQLite에 적재한다."""

from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
from math import isnan
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.master_import import MasterImport, MasterRecord
from app.models.active_source import ActiveDataSource
from app.models.planning_master import BomItem, LineProduct, Plant, ProductionLine, ProductQualitySpec
from app.models.product import Product

CALCINATION_SHEET = "제품(소성) Master"
NON_CALCINATION_SHEET = "제품(소성 외) Master"
POST_CALCINATION_SHEET = "제품(소성 후) Master"
LINE_SHEET = "공장라인 Master"
BOM_SHEET = "제품 BOM Master"


def _json_value(value: Any) -> object:
    """Excel 셀 값을 SQLite JSON에 안전하게 넣을 수 있는 값으로 바꾼다."""
    if value is None or pd.isna(value) or (isinstance(value, float) and isnan(value)):
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    return value


def _text(value: Any) -> str:
    clean = _json_value(value)
    return "" if clean is None else str(clean).strip()


def _number(value: Any) -> float | None:
    try:
        converted = float(value)
        return None if isnan(converted) else converted
    except (TypeError, ValueError):
        return None


def _read_product_rows(workbook: BytesIO) -> list[tuple[str, str]]:
    """두 제품 Master 시트의 반제품 코드와 제품명을 읽는다.

    현재 제공된 양식은 제품 코드가 다섯 번째 열, 제품명이 여섯 번째 열이다.
    """
    products: dict[str, str] = {}
    for sheet_name in (CALCINATION_SHEET, NON_CALCINATION_SHEET):
        workbook.seek(0)
        if sheet_name not in pd.ExcelFile(workbook).sheet_names:
            continue
        workbook.seek(0)
        frame = pd.read_excel(workbook, sheet_name=sheet_name, header=0)
        for _, row in frame.iterrows():
            if len(row) < 6:
                continue
            code, name = _text(row.iloc[4]), _text(row.iloc[5])
            if code and name:
                products[code] = name
    return sorted(products.items())


def _read_line_rows(workbook: BytesIO) -> list[tuple[str, str, str, str, str, float | None, list[str]]]:
    """공장라인 Master의 공장·라인·공정·가동효율·생산 가능 제품을 읽는다."""
    workbook.seek(0)
    frame = pd.read_excel(workbook, sheet_name=LINE_SHEET)
    rows = []
    for _, row in frame.dropna(how="all").iterrows():
        if len(row) < 7:
            continue
        plant_code, plant_name = _text(row.iloc[0]), _text(row.iloc[1])
        line_code, line_name, process_code = _text(row.iloc[2]), _text(row.iloc[3]), _text(row.iloc[4])
        if not all((plant_code, plant_name, line_code, line_name, process_code)):
            continue
        products = [code for code in (_text(value) for value in row.iloc[6:]) if code]
        rows.append((plant_code, plant_name, line_code, line_name, process_code, _number(row.iloc[5]), products))
    return rows


def _read_bom_rows(workbook: BytesIO) -> list[tuple[str, str, float, int]]:
    """제품 BOM Master의 출력 제품과 두 입력 자재 슬롯을 정규화한다."""
    workbook.seek(0)
    frame = pd.read_excel(workbook, sheet_name=BOM_SHEET)
    rows = []
    for _, row in frame.dropna(how="all").iterrows():
        if len(row) < 10:
            continue
        output = _text(row.iloc[0])
        if not output:
            continue
        for slot, material_column, ratio_column in ((1, 2, 5), (2, 6, 9)):
            material, ratio = _text(row.iloc[material_column]), _number(row.iloc[ratio_column])
            if material and ratio is not None and ratio > 0:
                rows.append((output, material, ratio, slot))
    return rows


def _read_quality_rows(workbook: BytesIO, sheet_names: list[str]) -> list[tuple[str, float, int, float | None]]:
    """Master의 품질합격률·검사기간과 제품별 생산 수율을 함께 읽는다."""
    rows: dict[str, tuple[float, int, float | None]] = {}
    for sheet_name in (CALCINATION_SHEET, NON_CALCINATION_SHEET, POST_CALCINATION_SHEET):
        if sheet_name not in sheet_names:
            continue
        workbook.seek(0)
        frame = pd.read_excel(workbook, sheet_name=sheet_name, header=0)
        columns = {str(column).replace(" ", "").replace("\n", ""): column for column in frame.columns}
        code_column = next((column for key, column in columns.items() if "반제품코드" in key), None)
        rate_column = next((column for key, column in columns.items() if "품질합격률" in key), None)
        days_column = next((column for key, column in columns.items() if "품질검사기간" in key), None)
        yield_column = next((column for key, column in columns.items() if "수율" in key and "품질" not in key), None)
        if not all((code_column, rate_column, days_column)):
            continue
        for _, row in frame.iterrows():
            code = _text(row[code_column])
            rate, days = _number(row[rate_column]), _number(row[days_column])
            production_yield = _number(row[yield_column]) if yield_column else None
            if code and rate is not None and days is not None and rate >= 0 and days >= 0:
                rows[code] = (rate, int(days), production_yield)
    return [(code, rate, days, production_yield) for code, (rate, days, production_yield) in rows.items()]


def _upsert_planning_master(db: Session, workbook: BytesIO) -> dict[str, int]:
    workbook.seek(0)
    sheet_names = pd.ExcelFile(workbook).sheet_names
    line_rows = _read_line_rows(workbook) if LINE_SHEET in sheet_names else []
    bom_rows = _read_bom_rows(workbook) if BOM_SHEET in sheet_names else []
    quality_rows = _read_quality_rows(workbook, sheet_names)

    for plant_code, plant_name, line_code, line_name, process_code, efficiency, products in line_rows:
        plant = db.get(Plant, plant_code)
        if plant:
            plant.name = plant_name
        else:
            db.add(Plant(code=plant_code, name=plant_name))
        line = db.get(ProductionLine, line_code)
        if line:
            line.name, line.plant_code, line.process_code, line.operating_efficiency = line_name, plant_code, process_code, efficiency
        else:
            db.add(ProductionLine(code=line_code, name=line_name, plant_code=plant_code, process_code=process_code, operating_efficiency=efficiency))
        for product_code in products:
            exists = db.scalar(select(LineProduct).where(LineProduct.line_code == line_code, LineProduct.product_code == product_code))
            if not exists:
                db.add(LineProduct(line_code=line_code, product_code=product_code))

    for output, material, ratio, slot in bom_rows:
        exists = db.scalar(select(BomItem).where(BomItem.output_product_code == output, BomItem.input_material_code == material, BomItem.material_slot == slot))
        if exists:
            exists.input_ratio = ratio
        else:
            db.add(BomItem(output_product_code=output, input_material_code=material, input_ratio=ratio, material_slot=slot))

    for code, rate, days, production_yield in quality_rows:
        spec = db.get(ProductQualitySpec, code)
        if spec:
            spec.quality_pass_rate, spec.quality_inspection_days = rate, days
            if production_yield is not None:
                spec.production_yield = production_yield
        else:
            db.add(ProductQualitySpec(semi_product_code=code, quality_pass_rate=rate, quality_inspection_days=days, production_yield=production_yield if production_yield is not None else 1.0))

    return {
        "plant_count": len({row[0] for row in line_rows}),
        "line_count": len(line_rows),
        "line_product_count": sum(len(row[6]) for row in line_rows),
        "bom_item_count": len(bom_rows),
        "quality_spec_count": len(quality_rows),
    }


def sync_production_yields_from_master(db: Session) -> None:
    """기존에 등록된 Master도 수율 컬럼을 추가한 뒤 다시 업로드하지 않아도 동기화한다."""
    active = db.get(ActiveDataSource, "Master")
    latest = db.get(MasterImport, active.import_id) if active else db.scalar(select(MasterImport).order_by(MasterImport.imported_at.desc()))
    if not latest:
        return
    yields: dict[str, float] = {}
    for record in db.scalars(select(MasterRecord).where(MasterRecord.import_id == latest.id)):
        values = record.values
        if record.sheet_name == CALCINATION_SHEET and len(values) > 13:
            code, value = _text(values[4]), _number(values[13])
        elif record.sheet_name == NON_CALCINATION_SHEET and len(values) > 9:
            code, value = _text(values[4]), _number(values[6])
        else:
            continue
        if code and value is not None:
            yields[code] = value
    for code, value in yields.items():
        spec = db.get(ProductQualitySpec, code)
        if spec:
            spec.production_yield = value
    db.commit()


def import_master_workbook(db: Session, file_name: str, content: bytes) -> tuple[MasterImport, dict[str, int]]:
    """Excel 전체 행을 보존하고 제품 기준정보를 갱신한다."""
    workbook = BytesIO(content)
    excel_file = pd.ExcelFile(workbook)
    if not excel_file.sheet_names:
        raise ValueError("시트가 없는 Excel 파일입니다.")

    workbook.seek(0)
    products = _read_product_rows(workbook)
    workbook.seek(0)
    summary = _upsert_planning_master(db, workbook)
    master_import = MasterImport(
        file_name=file_name,
        sheet_count=len(excel_file.sheet_names),
        row_count=0,
        product_count=len(products),
    )
    db.add(master_import)
    db.flush()

    record_count = 0
    for sheet_name in excel_file.sheet_names:
        workbook.seek(0)
        frame = pd.read_excel(workbook, sheet_name=sheet_name, header=None)
        for row_number, row in enumerate(frame.itertuples(index=False, name=None), start=1):
            values = [_json_value(value) for value in row]
            if not any(value is not None and str(value).strip() for value in values):
                continue
            db.add(MasterRecord(
                import_id=master_import.id,
                sheet_name=sheet_name,
                row_number=row_number,
                values=values,
            ))
            record_count += 1

    for code, name in products:
        existing = db.scalar(select(Product).where(Product.code == code))
        if existing:
            existing.name = name
        else:
            db.add(Product(code=code, name=name))

    master_import.row_count = record_count
    db.commit()
    db.refresh(master_import)
    return master_import, summary
