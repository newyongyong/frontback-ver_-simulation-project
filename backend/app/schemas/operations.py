"""원료 입고·정비휴지 API 응답 형식."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class RawInboundResponse(BaseModel):
    id: int
    inbound_date: date
    plant_name: str
    material_code: str
    quantity_ton: float
    model_config = ConfigDict(from_attributes=True)


class MaintenanceImportResponse(BaseModel):
    id: int
    file_name: str
    imported_at: datetime
    item_count: int
    model_config = ConfigDict(from_attributes=True)


class MaintenanceScheduleResponse(BaseModel):
    id: int
    scheduled_date: date
    plant_name: str
    line_name: str
    status: str
    downtime_hours: float
    model_config = ConfigDict(from_attributes=True)
