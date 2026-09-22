"""제품 API 요청과 응답 모델."""

from pydantic import BaseModel, ConfigDict, Field


class ProductCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50, examples=["CN19G1"])
    name: str = Field(min_length=1, max_length=200, examples=["양극재 제품"])


class ProductResponse(ProductCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)
