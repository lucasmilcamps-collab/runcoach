from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str


class MeResponse(BaseModel):
    email: EmailStr


class UserDocument(BaseModel):
    """Shape of a `users` collection document (not returned directly by any route)."""

    email: EmailStr
    hashed_password: str
    created_at: datetime
