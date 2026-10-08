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
