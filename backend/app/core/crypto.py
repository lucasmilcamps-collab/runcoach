from cryptography.fernet import Fernet

from app.core.config import settings

_fernet = Fernet(settings.garmin_token_encryption_key.encode())


def encrypt_token_blob(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_token_blob(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()
