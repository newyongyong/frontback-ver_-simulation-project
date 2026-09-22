"""재고 Import API 응답 형식."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class InventoryImportResponse(BaseModel):
    id: int
    kind: str
    file_name: str
    imported_at: datetime
    item_count: int

    model_config = ConfigDict(from_attributes=True)


class ProductInventoryResponse(BaseModel):
    id: int
    snapshot_date: date
    product_code: str
    process_name: str
    line_name: str
    stock_status: str
    quantity_ton: float

    model_config = ConfigDict(from_attributes=True)


class RawInventoryResponse(BaseModel):
    id: int
    snapshot_date: date
    plant_name: str
    material_code: str
    quantity_ton: float

    model_config = ConfigDict(from_attributes=True)
