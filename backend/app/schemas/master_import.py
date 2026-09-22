"""Master Excel Import API 응답 형식."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MasterImportResponse(BaseModel):
    id: int
    file_name: str
    imported_at: datetime
    sheet_count: int
    row_count: int
    product_count: int

    model_config = ConfigDict(from_attributes=True)


class MasterImportResult(MasterImportResponse):
    plant_count: int
    line_count: int
    line_product_count: int
    bom_item_count: int
