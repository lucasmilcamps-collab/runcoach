from datetime import UTC, datetime

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import (
    TokenInvalidError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


class EmailAlreadyExistsError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


async def register_user(db: AsyncIOMotorDatabase, email: str, password: str) -> tuple[str, str]:
    if await db.users.find_one({"email": email}) is not None:
        raise EmailAlreadyExistsError

    result = await db.users.insert_one(
        {
            "email": email,
            "hashed_password": hash_password(password),
            "created_at": datetime.now(UTC),
        }
    )
    user_id = str(result.inserted_id)
    return create_access_token(user_id), create_refresh_token(user_id)


async def login_user(db: AsyncIOMotorDatabase, email: str, password: str) -> tuple[str, str]:
    user = await db.users.find_one({"email": email})
    if user is None or not verify_password(password, user["hashed_password"]):
        raise InvalidCredentialsError

    user_id = str(user["_id"])
    return create_access_token(user_id), create_refresh_token(user_id)


async def refresh_tokens(db: AsyncIOMotorDatabase, refresh_token: str) -> tuple[str, str]:
    try:
        user_id = decode_token(refresh_token, expected_type="refresh")
    except TokenInvalidError as exc:
        raise InvalidCredentialsError from exc

    if await db.users.find_one({"_id": ObjectId(user_id)}) is None:
        raise InvalidCredentialsError

    return create_access_token(user_id), create_refresh_token(user_id)
