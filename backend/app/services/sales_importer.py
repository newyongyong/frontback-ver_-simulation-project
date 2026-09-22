"""기존 판매계획(월별) Excel을 월별 행 데이터로 정규화한다."""

from __future__ import annotations

from io import BytesIO
from typing import Any

import pandas as pd
from openpyxl import Workbook
from sqlalchemy.orm import Session

from app.models.sales_plan import SalesImport, SalesPlanItem

SALES_SHEET = "판매계획(월별)"


def _text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def _year(value: Any) -> int | None:
    if isinstance(value, (int, float)) and not pd.isna(value) and float(value).is_integer():
        parsed = int(value)
        return parsed if parsed >= 1000 else 2000 + parsed if 0 <= parsed <= 99 else None
    if isinstance(value, (pd.Timestamp,)):
        return value.year
    digits = "".join(character for character in _text(value) if character.isdigit())
    if not digits:
        return None
    parsed = int(digits)
    return parsed if parsed >= 1000 else 2000 + parsed


def _month(value: Any) -> int | None:
    if isinstance(value, (int, float)) and not pd.isna(value) and float(value).is_integer():
        parsed = int(value)
        return parsed if 1 <= parsed <= 12 else None
    if isinstance(value, (pd.Timestamp,)):
        return value.month
    digits = "".join(character for character in _text(value) if character.isdigit())
    if not digits:
        return None
    parsed = int(digits)
    return parsed if 1 <= parsed <= 12 else None


def _has_year_label(value: Any) -> bool:
    """일반 판매 수량과 구분되는 연도 헤더 후보인지 확인한다."""
    label = _text(value)
    parsed = _year(value)
    return "년" in label or (parsed is not None and parsed >= 2000)


def _has_month_label(value: Any) -> bool:
    """일반 판매 수량과 구분되는 월 헤더 후보인지 확인한다."""
    return "월" in _text(value) or _month(value) is not None


def _header_column(sheet: pd.DataFrame, header_end_row: int, labels: tuple[str, ...], fallback: int) -> int:
    """고객사·제품명 헤더의 열 위치를 찾아, 기존 양식에는 기본 열을 사용한다."""
    for row in range(header_end_row):
        for column in range(sheet.shape[1]):
            label = _text(sheet.iat[row, column]).casefold()
            if any(candidate.casefold() in label for candidate in labels):
                return column
    return fallback


def _find_header_rows(sheet: pd.DataFrame) -> tuple[int, int]:
    """연도 행과 그 아래 월 행을 찾는다. 앞쪽에 제목·빈 행이 추가돼도 동작한다."""
    search_rows = min(15, sheet.shape[0] - 1)
    # '26년'과 '1월'처럼 단위가 적힌 표준 양식을 가장 먼저 찾는다.
    for year_row in range(search_rows):
        if not any("년" in _text(sheet.iat[year_row, column]) for column in range(sheet.shape[1])):
            continue
        for month_row in range(year_row + 1, min(year_row + 4, sheet.shape[0])):
            if any("월" in _text(sheet.iat[month_row, column]) for column in range(sheet.shape[1])):
                return year_row, month_row
    # 신규 양식에서 연도·월을 숫자 또는 날짜 셀로 넣은 경우를 처리한다.
    for year_row in range(search_rows):
        if not any(_has_year_label(sheet.iat[year_row, column]) for column in range(sheet.shape[1])):
            continue
        for month_row in range(year_row + 1, min(year_row + 4, sheet.shape[0])):
            if any(_has_month_label(sheet.iat[month_row, column]) for column in range(sheet.shape[1])):
                return year_row, month_row
    raise ValueError("판매계획 파일에서 '2026년'과 '1월'처럼 표시된 연도·월 헤더를 찾을 수 없습니다.")


def _number(value: Any) -> float:
    if value is None or pd.isna(value):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"판매량에 숫자가 아닌 값이 있습니다: {value}") from error


def parse_sales_workbook(content: bytes) -> list[tuple[str, str, int, int, float]]:
    workbook = BytesIO(content)
    if SALES_SHEET not in pd.ExcelFile(workbook).sheet_names:
        raise ValueError(f"'{SALES_SHEET}' 시트를 찾을 수 없습니다.")
    workbook.seek(0)
    sheet = pd.read_excel(workbook, sheet_name=SALES_SHEET, header=None)
    if sheet.shape[0] < 4 or sheet.shape[1] < 5:
        raise ValueError("판매계획 파일의 행 또는 열 구성이 올바르지 않습니다.")

    year_row, month_row = _find_header_rows(sheet)
    customer_column = _header_column(sheet, month_row, ("고객사", "고객", "customer"), fallback=1)
    product_column = _header_column(sheet, month_row, ("품목명", "제품명", "제품", "product"), fallback=2)

    active_year: int | None = None
    periods: list[tuple[int, int] | None] = []
    for column in range(sheet.shape[1]):
        year = _year(sheet.iat[year_row, column])
        if year:
            active_year = year
        month = _month(sheet.iat[month_row, column])
        periods.append((active_year, month) if active_year and month else None)

    if not any(periods):
        raise ValueError("판매계획 파일에서 연도와 월 헤더를 찾을 수 없습니다.")

    customer = ""
    records: list[tuple[str, str, int, int, float]] = []
    for row_index in range(month_row + 1, sheet.shape[0]):
        customer_value = _text(sheet.iat[row_index, customer_column])
        if customer_value:
            customer = customer_value
        product_code = _text(sheet.iat[row_index, product_column])
        if not product_code:
            continue
        if not customer:
            raise ValueError(f"{row_index + 1}행 제품 '{product_code}'의 고객사를 찾을 수 없습니다.")
        for column, period in enumerate(periods):
            if not period:
                continue
            year, month = period
            records.append((customer, product_code, year, month, _number(sheet.iat[row_index, column])))
    if not records:
        raise ValueError("판매계획 데이터 행을 찾을 수 없습니다.")
    return records


def validate_sales_workbook(content: bytes, known_product_codes: set[str]) -> dict[str, Any]:
    """판매계획 적재 전에 기준정보·중복·기간 연속성을 검사한다."""
    errors: list[dict[str, Any]] = []
    try:
        records = parse_sales_workbook(content)
    except ValueError as error:
        return {
            "valid": False, "parsed_row_count": 0, "error_count": 1,
            "unknown_product_count": 0, "duplicate_count": 0, "missing_period_count": 0,
            "errors": [{"category": "파일 형식", "customer": "", "product_code": "", "period": "", "message": str(error)}],
        }

    unknown_codes = sorted({product for _, product, _, _, _ in records if known_product_codes and product not in known_product_codes})
    for product_code in unknown_codes:
        errors.append({"category": "없는 제품코드", "customer": "", "product_code": product_code, "period": "", "message": "Master 제품 기준정보에 없는 제품코드입니다."})

    seen: set[tuple[str, str, int, int]] = set()
    duplicate_keys: set[tuple[str, str, int, int]] = set()
    for customer, product_code, year, month, _ in records:
        key = (customer, product_code, year, month)
        if key in seen:
            duplicate_keys.add(key)
        seen.add(key)
    for customer, product_code, year, month in sorted(duplicate_keys):
        errors.append({"category": "중복 행", "customer": customer, "product_code": product_code, "period": f"{year}-{month:02d}", "message": "고객사·제품·연월 조합이 중복되었습니다."})

    periods = sorted({(year, month) for _, _, year, month, _ in records})
    missing_periods: list[tuple[int, int]] = []
    if periods:
        start, end = periods[0], periods[-1]
        current = start
        period_set = set(periods)
        while current <= end:
            if current not in period_set:
                missing_periods.append(current)
            year, month = current
            current = (year + 1, 1) if month == 12 else (year, month + 1)
    for year, month in missing_periods:
        errors.append({"category": "기간 누락", "customer": "", "product_code": "", "period": f"{year}-{month:02d}", "message": "연속된 판매계획 기간 중 해당 월이 없습니다."})

    return {
        "valid": not errors, "parsed_row_count": len(records), "error_count": len(errors),
        "unknown_product_count": len(unknown_codes), "duplicate_count": len(duplicate_keys),
        "missing_period_count": len(missing_periods), "errors": errors,
    }


def validation_report_workbook(validation: dict[str, Any]) -> BytesIO:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "검증 오류"
    sheet.append(["오류 구분", "고객사", "제품코드", "연월", "오류 내용"])
    for error in validation["errors"]:
        sheet.append([error["category"], error["customer"], error["product_code"], error["period"], error["message"]])
    sheet.freeze_panes = "A2"
    for column, width in {"A": 16, "B": 20, "C": 18, "D": 14, "E": 48}.items():
        sheet.column_dimensions[column].width = width
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output


def import_sales_workbook(db: Session, file_name: str, content: bytes) -> SalesImport:
    records = parse_sales_workbook(content)
    sales_import = SalesImport(file_name=file_name, item_count=len(records))
    db.add(sales_import)
    db.flush()
    db.add_all(
        SalesPlanItem(
            sales_import_id=sales_import.id,
            customer=customer,
            product_code=product_code,
            year=year,
            month=month,
            quantity_ton=quantity,
        )
        for customer, product_code, year, month, quantity in records
    )
    db.commit()
    db.refresh(sales_import)
    return sales_import
