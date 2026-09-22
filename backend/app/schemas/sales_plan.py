"""판매계획 API 요청과 응답 형식."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SalesImportResponse(BaseModel):
    id: int
    file_name: str
    imported_at: datetime
    item_count: int

    model_config = ConfigDict(from_attributes=True)


class SalesPlanItemResponse(BaseModel):
    id: int
    sales_import_id: int
    customer: str
    product_code: str
    year: int
    month: int
    quantity_ton: float

    model_config = ConfigDict(from_attributes=True)


class SalesPlanComparisonItemResponse(BaseModel):
    customer: str
    product_code: str
    year: int
    month: int
    base_quantity_ton: float
    compare_quantity_ton: float
    difference_ton: float
    difference_rate: float | None


class SalesPlanComparisonResponse(BaseModel):
    base_import: SalesImportResponse
    compare_import: SalesImportResponse
    item_count: int
    base_total_ton: float
    compare_total_ton: float
    difference_total_ton: float
    items: list[SalesPlanComparisonItemResponse]
