import os
from urllib.parse import urlsplit

from fastapi import Request


def get_client_ip(request: Request) -> str:
    """Resolve client IP with support for reverse-proxy headers."""
    # Первые элементы X-Forwarded-For присылает сам клиент и их можно подделать;
    # последний дописан нашим nginx и содержит реальный адрес соединения.
    forwarded_for = (request.headers.get("X-Forwarded-For") or "").strip()
    if forwarded_for:
        last_ip = forwarded_for.rsplit(",", 1)[-1].strip()
        if last_ip:
            return last_ip[:45]

    real_ip = (request.headers.get("X-Real-IP") or "").strip()
    if real_ip:
        return real_ip[:45]

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def public_base_url(request: Request) -> str:
    """Адрес сайта для QR-кодов проверки документов: PUBLIC_BASE_URL, иначе страница, с которой пришёл запрос."""
    configured = (os.getenv("PUBLIC_BASE_URL") or "").strip()
    if configured:
        return configured
    referer = urlsplit(request.headers.get("referer") or "")
    if referer.scheme in ("http", "https") and referer.netloc:
        return f"{referer.scheme}://{referer.netloc}"
    # PDF, открытый в просмотрщике или скачанный, приходит без Referer: адрес сайта — из заголовков
    # прокси (nginx, dev-сервер Vite), а не внутреннее имя контейнера backend:8000
    def first(name: str) -> str:
        return (request.headers.get(name) or "").split(",")[0].strip()
    host = first("x-forwarded-host") or first("host")
    scheme = first("x-forwarded-proto") or request.url.scheme
    if host and scheme in ("http", "https"):
        return f"{scheme}://{host}"
    return str(request.base_url).rstrip("/")
