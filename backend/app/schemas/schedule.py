"""초기 생산 스케줄러 API 응답 형식."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ProductionScheduleItemResponse(BaseModel):
    id: int
    planned_date: date
    plant_name: str
    line_code: str
    line_name: str
    product_code: str
    planned_quantity_ton: float
    available_capacity_ton: float
    downtime_hours: float
    work_rate: float
    yield_rate: float
    operation_status: str
    changeover_hours: float
    is_locked: bool
    adjustment_note: str
    model_config = ConfigDict(from_attributes=True)


class UnscheduledRequirementResponse(BaseModel):
    id: int
    product_code: str
    required_quantity_ton: float
    scheduled_quantity_ton: float
    unallocated_quantity_ton: float
    model_config = ConfigDict(from_attributes=True)


class ScheduleRunResponse(BaseModel):
    id: int
    planning_run_id: int
    created_at: datetime
    items: list[ProductionScheduleItemResponse]
    shortages: list[UnscheduledRequirementResponse]
    version: int
    status: str
    planning_mode: str
    change_reason: str
    confirmed_at: datetime | None

class ScheduleStatusUpdate(BaseModel):
    status: str
    change_reason: str = Field(default="", max_length=500)

class ScheduleCopyRequest(BaseModel):
    change_reason: str = Field(min_length=1, max_length=500)


class InitialScheduleCondition(BaseModel):
    planned_date: date
    line_code: str
    operation_status: str = Field(default="가동", max_length=20)
    downtime_hours: float = Field(default=0, ge=0, le=24)


class ScheduleCreateRequest(BaseModel):
    conditions: list[InitialScheduleCondition] = Field(default_factory=list)
    planning_mode: str = Field(default="판매 목표 우선", pattern="^(판매 목표 우선|원료 제약 반영)$")


class RawMaterialDailyBalanceResponse(BaseModel):
    id: int
    balance_date: date
    plant_name: str
    material_code: str
    opening_quantity_ton: float
    inbound_quantity_ton: float
    required_quantity_ton: float
    ending_quantity_ton: float
    shortage_quantity_ton: float
    model_config = ConfigDict(from_attributes=True)


class RawMaterialValidationResponse(BaseModel):
    id: int
    schedule_run_id: int
    created_at: datetime
    balances: list[RawMaterialDailyBalanceResponse]


class CalendarSettingsUpdate(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    non_working_dates: list[date] = []
    weekend_working: bool = True
    changeover_hours: float = Field(default=0, ge=0, le=24)


class CalendarDayResponse(BaseModel):
    calendar_date: date
    is_working: bool
    note: str
    model_config = ConfigDict(from_attributes=True)


class CalendarSettingsResponse(BaseModel):
    changeover_hours: float
    days: list[CalendarDayResponse]


class ScheduleItemUpdate(BaseModel):
    planned_date: date
    product_code: str = Field(min_length=1, max_length=50)
    planned_quantity_ton: float | None = Field(default=None, ge=0)
    downtime_hours: float | None = Field(default=None, ge=0, le=24)
    work_rate: float | None = Field(default=None, ge=0, le=100)
    operation_status: str | None = Field(default=None, max_length=20)
    auto_calculate: bool = False
    is_locked: bool = False
    adjustment_note: str = Field(default="", max_length=500)


class ScheduleItemCreate(ScheduleItemUpdate):
    line_code: str = Field(min_length=1, max_length=50)
