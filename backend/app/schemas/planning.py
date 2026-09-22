"""Planning Engine API 요청과 응답 형식."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PlanningRunCreate(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    end_year: int = Field(ge=2000, le=2100)
    end_month: int = Field(ge=1, le=12)


class ProductionRequirementResponse(BaseModel):
    id: int
    product_code: str
    sales_demand_ton: float
    available_inventory_ton: float
    safety_stock_days: float
    average_daily_sales_ton: float
    safety_stock_target_ton: float
    required_production_ton: float
    model_config = ConfigDict(from_attributes=True)


class PlanningRunResponse(BaseModel):
    id: int
    year: int
    month: int
    end_year: int
    end_month: int
    created_at: datetime
    requirements: list[ProductionRequirementResponse]
    model_config = ConfigDict(from_attributes=True)
