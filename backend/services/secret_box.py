"""Шифрование секретов, хранимых в БД (тот же ключ, что у камер и AI: SHA-256 от SECRET_KEY)."""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    secret = os.getenv("SECRET_KEY", "").encode("utf-8")
    if not secret:
        raise RuntimeError("SECRET_KEY is required")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret).digest()))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii") if value else ""


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return ""


def decode_ldap_settings(data: dict) -> dict:
    """Возвращает настройки LDAP с расшифрованным bind_password.

    Новый формат хранит bind_password_encrypted; старые записи с открытым
    bind_password читаются как есть и шифруются при следующем сохранении.
    """
    result = dict(data)
    encrypted = result.pop("bind_password_encrypted", None)
    if encrypted:
        result["bind_password"] = decrypt_secret(encrypted)
    return result
