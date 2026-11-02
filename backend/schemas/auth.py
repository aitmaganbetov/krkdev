from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    # Длины ограничены размерами колонок users/audit_logs: иначе запись аудита падает
    username: str = Field(max_length=255)
    password: str = Field(max_length=1024)


class EcpLoginRequest(BaseModel):
    # CMS (base64) от NCALayer с подписанным nonce; с сертификатом и меткой времени — единицы КБ
    cms: str = Field(min_length=1, max_length=65536)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str = "staff"
