import base64
import hashlib
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from services import ROLE_ADMIN, ROLE_INSPECTOR, require_roles
from services.audit_log import audit_event

router = APIRouter(prefix="/ai", tags=["ai"])

DEFAULT_SETTINGS = {
    "active_provider": "openai",
    "openai": {
        "enabled": False,
        "model": "gpt-5.6-luna",
        "api_key_encrypted": "",
    },
    "gemini": {
        "enabled": False,
        "model": "gemini-2.5-flash",
        "api_key_encrypted": "",
    },
}


class ProviderSettingsIn(BaseModel):
    enabled: bool = False
    model: str = Field(min_length=1, max_length=150)
    api_key: str = Field(default="", max_length=10000)


class AiSettingsIn(BaseModel):
    active_provider: str
    openai: ProviderSettingsIn
    gemini: ProviderSettingsIn


class ProviderSettingsOut(BaseModel):
    enabled: bool
    model: str
    api_key_configured: bool


class AiSettingsOut(BaseModel):
    active_provider: str
    openai: ProviderSettingsOut
    gemini: ProviderSettingsOut


class AiTestOut(BaseModel):
    success: bool
    message: str


class ImproveTextIn(BaseModel):
    text: str = Field(min_length=3, max_length=10000)


class ImproveTextOut(BaseModel):
    text: str
    provider: str
    model: str


def _ensure_settings_table(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS system_settings (
            `key` VARCHAR(128) PRIMARY KEY,
            value_text LONGTEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    """))
    db.commit()


def _fernet() -> Fernet:
    secret = os.getenv("SECRET_KEY", "").encode("utf-8")
    if not secret:
        raise RuntimeError("SECRET_KEY is required")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret).digest()))


def _encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii") if value else ""


def _decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return ""


def _load_settings(db: Session) -> dict:
    _ensure_settings_table(db)
    row = db.execute(
        text("SELECT value_text FROM system_settings WHERE `key` = 'ai' LIMIT 1")
    ).mappings().first()
    saved = json.loads(row["value_text"]) if row else {}
    result = json.loads(json.dumps(DEFAULT_SETTINGS))
    if isinstance(saved, dict):
        if saved.get("active_provider") in {"openai", "gemini"}:
            result["active_provider"] = saved["active_provider"]
        for provider in ("openai", "gemini"):
            if isinstance(saved.get(provider), dict):
                result[provider].update(saved[provider])
    return result


def _serialize(settings: dict) -> AiSettingsOut:
    return AiSettingsOut(
        active_provider=settings["active_provider"],
        openai=ProviderSettingsOut(
            enabled=bool(settings["openai"]["enabled"]),
            model=settings["openai"]["model"],
            api_key_configured=bool(settings["openai"].get("api_key_encrypted")),
        ),
        gemini=ProviderSettingsOut(
            enabled=bool(settings["gemini"]["enabled"]),
            model=settings["gemini"]["model"],
            api_key_configured=bool(settings["gemini"].get("api_key_encrypted")),
        ),
    )


def _post_json(url: str, payload: dict, headers: dict[str, str]) -> dict:
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            provider_error = json.loads(exc.read().decode("utf-8")).get("error", {})
            detail = provider_error.get("message") if isinstance(provider_error, dict) else str(provider_error)
        except Exception:
            detail = ""
        raise HTTPException(
            status_code=502,
            detail=f"AI-провайдер отклонил запрос{': ' + detail[:300] if detail else ''}",
        ) from exc
    except (URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="AI-провайдер временно недоступен") from exc


def _call_openai(api_key: str, model: str, prompt: str) -> str:
    data = _post_json(
        "https://api.openai.com/v1/responses",
        {
            "model": model,
            "input": prompt,
            "store": False,
            "text": {"verbosity": "low"},
        },
        {"Authorization": f"Bearer {api_key}"},
    )
    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()
    parts = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                parts.append(content["text"])
    return "\n".join(parts).strip()


def _call_gemini(api_key: str, model: str, prompt: str) -> str:
    data = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent",
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2},
        },
        {"x-goog-api-key": api_key},
    )
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    return "\n".join(
        part.get("text", "")
        for part in candidates[0].get("content", {}).get("parts", [])
        if part.get("text")
    ).strip()


def _call_provider(provider: str, settings: dict, prompt: str) -> tuple[str, str]:
    provider_settings = settings[provider]
    if not provider_settings.get("enabled"):
        raise HTTPException(status_code=409, detail=f"{provider.title()} отключён в настройках системы")
    api_key = _decrypt_secret(provider_settings.get("api_key_encrypted", ""))
    if not api_key:
        raise HTTPException(status_code=409, detail=f"API-ключ {provider.title()} не настроен")
    model = str(provider_settings.get("model") or "").strip()
    if not model:
        raise HTTPException(status_code=409, detail=f"Модель {provider.title()} не указана")
    result = (
        _call_openai(api_key, model, prompt)
        if provider == "openai"
        else _call_gemini(api_key, model, prompt)
    )
    if not result:
        raise HTTPException(status_code=502, detail="AI-провайдер вернул пустой ответ")
    return result, model


@router.get("/settings", response_model=AiSettingsOut)
def get_ai_settings(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    try:
        return _serialize(_load_settings(db))
    except (SQLAlchemyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=500, detail="Не удалось загрузить настройки AI") from exc


@router.patch("/settings", response_model=AiSettingsOut)
def save_ai_settings(
    body: AiSettingsIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    if body.active_provider not in {"openai", "gemini"}:
        raise HTTPException(status_code=422, detail="Неизвестный AI-провайдер")
    try:
        current = _load_settings(db)
        payload = {"active_provider": body.active_provider}
        for provider in ("openai", "gemini"):
            incoming = getattr(body, provider)
            encrypted = current[provider].get("api_key_encrypted", "")
            if incoming.api_key.strip():
                encrypted = _encrypt_secret(incoming.api_key.strip())
            payload[provider] = {
                "enabled": incoming.enabled,
                "model": incoming.model.strip(),
                "api_key_encrypted": encrypted,
            }
        db.execute(
            text("""
                INSERT INTO system_settings (`key`, value_text)
                VALUES ('ai', :value_text)
                ON DUPLICATE KEY UPDATE value_text = :value_text
            """),
            {"value_text": json.dumps(payload, ensure_ascii=False)},
        )
        db.commit()
        audit_event(
            action="admin.settings.ai.save",
            outcome="success",
            actor=context.get("username"),
            details={
                "active_provider": payload["active_provider"],
                "openai_enabled": payload["openai"]["enabled"],
                "gemini_enabled": payload["gemini"]["enabled"],
            },
        )
        return _serialize(payload)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось сохранить настройки AI") from exc


@router.post("/test/{provider}", response_model=AiTestOut)
def test_ai_provider(
    provider: str,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    if provider not in {"openai", "gemini"}:
        raise HTTPException(status_code=404, detail="AI-провайдер не найден")
    result, model = _call_provider(provider, _load_settings(db), "Ответь только одним словом: OK")
    audit_event(
        action="admin.settings.ai.test",
        outcome="success",
        actor=context.get("username"),
        details={"provider": provider, "model": model},
    )
    return AiTestOut(success=True, message=f"Подключение работает: {result[:100]}")


@router.post("/improve", response_model=ImproveTextOut)
def improve_violation_text(
    body: ImproveTextIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    settings = _load_settings(db)
    provider = settings["active_provider"]
    prompt = (
        "Улучши текст описания нарушения для официального акта внутреннего контроля. "
        "Сохрани язык исходного текста, все факты, имена, даты и числа. "
        "Не добавляй новых фактов и не делай выводов, которых нет в исходном тексте. "
        "Исправь орфографию и пунктуацию, сделай формулировку ясной, нейтральной и деловой. "
        "Верни только готовый улучшенный текст без заголовка и пояснений.\n\n"
        f"Исходный текст:\n{body.text.strip()}"
    )
    improved, model = _call_provider(provider, settings, prompt)
    audit_event(
        action="monitoring.violation.ai_improve",
        outcome="success",
        actor=context.get("username"),
        details={"provider": provider, "model": model, "input_length": len(body.text)},
    )
    return ImproveTextOut(text=improved, provider=provider, model=model)
