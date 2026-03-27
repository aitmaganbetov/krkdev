from fastapi import APIRouter, HTTPException, status
from schemas.auth import LoginRequest, TokenOut
from services.auth_service import authenticate_user_details, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest):
    authenticated, normalized_username, source, role = authenticate_user_details(body.username, body.password)

    if not authenticated:
        detail = "Invalid username or password"
        if source == "ldap_unavailable":
            detail = "LDAP недоступен. Вход возможен только для ранее авторизованных пользователей."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
        )
    token = create_access_token({"sub": normalized_username, "role": role, "auth_source": source})
    return TokenOut(access_token=token, role=role)
