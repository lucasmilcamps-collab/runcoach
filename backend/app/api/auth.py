from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.auth import (
    LoginRequest,
    MeResponse,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.services import auth_service

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.get("/me", response_model=MeResponse)
async def me(user: dict = Depends(get_current_user)):
    """The signed-in user's identity (email) — used for the avatar initials."""
    return MeResponse(email=user["email"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        access_token, refresh_token = await auth_service.register_user(
            db, body.email, body.password
        )
    except auth_service.EmailAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "EMAIL_ALREADY_EXISTS",
                "message": "Un compte existe déjà avec cet email.",
            },
        ) from exc
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        access_token, refresh_token = await auth_service.login_user(db, body.email, body.password)
    except auth_service.InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_CREDENTIALS", "message": "Email ou mot de passe incorrect."},
        ) from exc
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        access_token, refresh_token = await auth_service.refresh_tokens(db, body.refresh_token)
    except auth_service.InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Session invalide, reconnectez-vous."},
        ) from exc
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)
