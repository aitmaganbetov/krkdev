"""ЭЦП НУЦ РК через KalkanCrypt (C-библиотека SDK для Linux, вызовы через ctypes).

SDK не хранится в репозитории (лицензия НУЦ): .so монтируются в контейнер, путь задаёт KALKAN_LIB.
Публичные корневые сертификаты НУЦ лежат в assets/nca/<профиль>; принимаемые НУЦ задаёт KALKAN_NCA (test, prod
или оба через запятую), у каждого — свой OCSP. Библиотека держит состояние в глобальных переменных
(загруженные сертификаты, хранилище ключей, последняя ошибка), поэтому все вызовы идут под одной блокировкой.
"""
import base64
import ctypes
import glob
import logging
import os
import re
from datetime import datetime
from dataclasses import dataclass, field
from threading import RLock
from typing import Optional

logger = logging.getLogger(__name__)


KC_CERT_CA = 0x00000201
KC_CERT_INTERMEDIATE = 0x00000202

KC_USE_NOTHING = 0x00000401
KC_USE_OCSP = 0x00000404

KC_SIGN_CMS = 0x00000002
KC_IN_BASE64 = 0x00000010
KC_IN2_BASE64 = 0x00000020
KC_DETACHED_DATA = 0x00000040
KC_OUT_PEM = 0x00000200

CERT_PROPS = {
    "subject_dn": 0x0000081B,
    "issuer_dn": 0x0000081A,
    "common_name": 0x0000080A,
    "surname": 0x0000080C,
    "given_name": 0x0000080B,
    "serial_number": 0x0000080D,
    "email": 0x0000080E,
    "org_name": 0x0000080F,
    "org_unit": 0x00000810,
    "not_before": 0x00000813,
    "not_after": 0x00000814,
    "key_usage": 0x00000815,
    "cert_sn": 0x00000819,
}

BUF_SIZE = 64 * 1024
NCA_CERTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "nca")

_c_char_p = ctypes.c_char_p
_c_int_p = ctypes.POINTER(ctypes.c_int)
_c_ulong = ctypes.c_ulong


class _Functions(ctypes.Structure):
    # Порядок полей — как в stKCFunctions (KalkanCrypt.h); неиспользуемые объявлены как void*
    _fields_ = [
        ("KC_Init", ctypes.CFUNCTYPE(_c_ulong)),
        ("KC_GetTokens", ctypes.c_void_p),
        ("KC_GetCertificatesList", ctypes.c_void_p),
        ("KC_LoadKeyStore", ctypes.CFUNCTYPE(_c_ulong, ctypes.c_int, _c_char_p, ctypes.c_int, _c_char_p, ctypes.c_int, _c_char_p)),
        ("X509LoadCertificateFromFile", ctypes.CFUNCTYPE(_c_ulong, _c_char_p, ctypes.c_int)),
        ("X509LoadCertificateFromBuffer", ctypes.c_void_p),
        ("X509ExportCertificateFromStore", ctypes.CFUNCTYPE(_c_ulong, _c_char_p, ctypes.c_int, _c_char_p, _c_int_p)),
        ("X509CertificateGetInfo", ctypes.CFUNCTYPE(_c_ulong, _c_char_p, ctypes.c_int, ctypes.c_int, _c_char_p, _c_int_p)),
        ("X509ValidateCertificate", ctypes.CFUNCTYPE(
            _c_ulong, _c_char_p, ctypes.c_int, ctypes.c_int, _c_char_p, ctypes.c_longlong,
            _c_char_p, _c_int_p, ctypes.c_int, _c_char_p, _c_int_p)),
        ("HashData", ctypes.c_void_p),
        ("SignHash", ctypes.c_void_p),
        ("SignData", ctypes.CFUNCTYPE(
            _c_ulong, _c_char_p, ctypes.c_int, _c_char_p, ctypes.c_int, _c_char_p, ctypes.c_int, _c_char_p, _c_int_p)),
        ("SignXML", ctypes.c_void_p),
        ("VerifyData", ctypes.CFUNCTYPE(
            _c_ulong, _c_char_p, ctypes.c_int, _c_char_p, ctypes.c_int, _c_char_p, ctypes.c_int,
            _c_char_p, _c_int_p, _c_char_p, _c_int_p, ctypes.c_int, _c_char_p, _c_int_p)),
        ("VerifyXML", ctypes.c_void_p),
        ("KC_getCertFromXML", ctypes.c_void_p),
        ("KC_getSigAlgFromXML", ctypes.c_void_p),
        ("KC_GetLastError", ctypes.CFUNCTYPE(_c_ulong)),
        ("KC_GetLastErrorString", ctypes.CFUNCTYPE(_c_ulong, _c_char_p, _c_int_p)),
        ("KC_XMLFinalize", ctypes.c_void_p),
        ("KC_Finalize", ctypes.CFUNCTYPE(None)),
        ("KC_TSASetUrl", ctypes.CFUNCTYPE(None, _c_char_p)),
        ("KC_GetTimeFromSig", ctypes.c_void_p),
        ("KC_SetProxy", ctypes.c_void_p),
        ("KC_GetCertFromCMS", ctypes.CFUNCTYPE(_c_ulong, _c_char_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, _c_char_p, _c_int_p)),
    ]


class KalkanError(Exception):
    def __init__(self, code: int, message: str, cert: Optional["CertInfo"] = None):
        super().__init__(f"{code:#x}: {message}" if code else message)
        self.code = code
        self.message = message
        # Сертификат из отклонённой CMS (если удалось извлечь) — для понятной причины отказа
        self.cert = cert


@dataclass
class CertInfo:
    pem: str
    subject_dn: str = ""
    issuer_dn: str = ""
    common_name: str = ""
    surname: str = ""
    given_name: str = ""
    email: str = ""
    org_name: str = ""
    not_before: str = ""
    not_after: str = ""
    iin: str = ""
    bin: str = ""
    extra: dict = field(default_factory=dict)


@dataclass
class VerifyResult:
    cert: CertInfo
    data: Optional[bytes]
    info: str
    ocsp_status: Optional[str] = None


_lock = RLock()
_funcs: Optional[_Functions] = None
_lib = None
# DN сертификатов УЦ принимаемых НУЦ → OCSP этого НУЦ: подпись принимается, только если сертификат выдан одним из них
_ca_subjects: dict[str, str] = {}
# Профили НУЦ: тестовый (ключи SDK) и боевой (настоящие ключи); OCSP переопределяется KALKAN_OCSP_URL_<ПРОФИЛЬ>
NCA_OCSP = {"test": "http://test.pki.gov.kz/ocsp/", "prod": "http://ocsp.pki.gov.kz/"}


def lib_path() -> str:
    return os.getenv("KALKAN_LIB", "/opt/kalkan/lib/libkalkancryptwr-64.so.2.0.14")


def nca_profiles() -> dict[str, str]:
    """Принимаемые НУЦ (KALKAN_NCA: «test», «prod» или «test,prod») → OCSP. На проде — только prod,
    на dev — оба: тестовые ключи SDK и настоящие ключи сотрудников."""
    names = [n.strip() for n in os.getenv("KALKAN_NCA", "test").split(",") if n.strip()]
    unknown = set(names) - set(NCA_OCSP)
    if unknown or not names:
        raise KalkanError(0, f"KALKAN_NCA: неизвестный НУЦ {sorted(unknown) or names}")
    return {name: os.getenv(f"KALKAN_OCSP_URL_{name.upper()}", NCA_OCSP[name]) for name in names}


def tsa_url() -> str:
    return os.getenv("KALKAN_TSA_URL", "http://test.pki.gov.kz/tsp/")


def is_available() -> bool:
    return os.path.isfile(lib_path())


def _value(buf, length) -> str:
    return buf.raw[: length.value].split(b"\0", 1)[0].decode("utf-8", "replace")


def _raise_last(funcs: _Functions, rv: int, action: str) -> None:
    buf = ctypes.create_string_buffer(BUF_SIZE)
    length = ctypes.c_int(BUF_SIZE)
    funcs.KC_GetLastErrorString(buf, ctypes.byref(length))
    code = funcs.KC_GetLastError() or rv
    message = _value(buf, length).strip() or "unknown error"
    raise KalkanError(code, f"{action}: {message}")


def _load() -> _Functions:
    global _funcs, _lib
    if _funcs is not None:
        return _funcs
    path = lib_path()
    if not os.path.isfile(path):
        raise KalkanError(0, f"KalkanCrypt не найден: {path}")
    # Библиотеки SDK не объявляют свои зависимости (ldd их не видит), поэтому они загружаются глобально заранее:
    # pcsclite/ltdl/zlib — для libkalkancrypto.so (OpenSSL с ГОСТ), она и shim libiconv — для libkalkancryptwr.
    # libiconv_shim.so перенаправляет libiconv* (GNU libiconv) на iconv из glibc, собирается в Dockerfile.
    crypto = os.getenv("KALKAN_CRYPTO_LIB", os.path.join(os.path.dirname(path), "libkalkancrypto.so"))
    for dep in ("libpcsclite.so.1", "libltdl.so.7", "libz.so.1", os.getenv("KALKAN_ICONV_SHIM", "libiconv_shim.so"), crypto):
        ctypes.CDLL(dep, mode=ctypes.RTLD_GLOBAL)
    # Как в примере SDK (dlopen с RTLD_LAZY): ctypes по умолчанию требует разрешить все символы при загрузке
    _lib = ctypes.CDLL(path, mode=os.RTLD_LAZY | os.RTLD_LOCAL)
    funcs_ptr = ctypes.POINTER(_Functions)()
    _lib.KC_GetFunctionList(ctypes.byref(funcs_ptr))
    funcs = funcs_ptr.contents
    rv = funcs.KC_Init()
    if rv:
        _raise_last(funcs, rv, "KC_Init")
    # Корневой и промежуточный сертификаты НУЦ: по ним строится цепочка при проверке подписи.
    # Те же сертификаты Dockerfile кладёт в системное хранилище: Kalkan ищет по нему цепочку при подписи
    profiles = nca_profiles()
    # Сначала корневые сертификаты всех НУЦ, затем промежуточные: при загрузке «корень, промежуточный» по профилям
    # Kalkan в процессе uvicorn теряет цепочку НУЦ, загруженного первым («unable to get issuer certificate»)
    certs = [(name, path) for name in profiles for path in glob.glob(os.path.join(NCA_CERTS_DIR, name, "*.crt"))]
    certs.sort(key=lambda item: ("root" not in os.path.basename(item[1]), item[1]))
    for name, cert_path in certs:
        cert_type = KC_CERT_CA if "root" in os.path.basename(cert_path) else KC_CERT_INTERMEDIATE
        rv = funcs.X509LoadCertificateFromFile(cert_path.encode(), cert_type)
        if rv:
            _raise_last(funcs, rv, f"загрузка {os.path.basename(cert_path)}")
        with open(cert_path, encoding="ascii") as fh:
            subject = _cert_info(funcs, fh.read()).subject_dn
        if subject:
            _ca_subjects[subject] = profiles[name]
    if not _ca_subjects:
        raise KalkanError(0, f"нет сертификатов УЦ в {NCA_CERTS_DIR} для {list(profiles)}")
    # Прогрев: пока Kalkan не построил цепочку какого-нибудь другого сертификата, первая проверка отзыва (OCSP)
    # сертификата пользователя падает без обращения к сети — «unable to get issuer certificate» — и так
    # повторяется для этого сертификата, пока процесс жив. Проверка цепочки загруженных сертификатов НУЦ (без
    # сети) это устраняет; без неё ключи боевого НУЦ не проходили проверку после перезапуска сервера.
    for _, cert_path in certs:
        with open(cert_path, "rb") as fh:
            pem = fh.read()
        out = ctypes.create_string_buffer(BUF_SIZE)
        out_len = ctypes.c_int(BUF_SIZE)
        resp = ctypes.create_string_buffer(BUF_SIZE)
        resp_len = ctypes.c_int(BUF_SIZE)
        if funcs.X509ValidateCertificate(pem, len(pem), KC_USE_NOTHING, b"", 0, out, ctypes.byref(out_len),
                                         0, resp, ctypes.byref(resp_len)):
            logger.warning("Kalkan: цепочка %s не построена: %s", os.path.basename(cert_path), _value(out, out_len)[-200:])
    funcs.KC_TSASetUrl(tsa_url().encode())
    _funcs = funcs
    logger.info("KalkanCrypt загружен: %s, НУЦ: %s", path, ", ".join(profiles))
    return funcs


def _cert_info(funcs: _Functions, pem: str) -> CertInfo:
    raw = pem.encode()
    values = {}
    for name, prop_id in CERT_PROPS.items():
        buf = ctypes.create_string_buffer(BUF_SIZE)
        length = ctypes.c_int(BUF_SIZE)
        if funcs.X509CertificateGetInfo(raw, len(raw), prop_id, buf, ctypes.byref(length)) == 0:
            # Значение приходит как «ключ=значение» (например, serialNumber=IIN123456789012); DN — целиком
            value = _value(buf, length).strip()
            values[name] = value if name.endswith("_dn") else value.split("=", 1)[-1].strip()
    info = CertInfo(pem=pem, **{k: values.get(k, "") for k in (
        "subject_dn", "issuer_dn", "common_name", "surname", "given_name", "email", "org_name", "not_before", "not_after")})
    info.extra = {k: values[k] for k in ("serial_number", "org_unit", "key_usage", "cert_sn") if k in values}
    iin = re.search(r"IIN(\d{12})", values.get("serial_number", "") or info.subject_dn)
    bin_ = re.search(r"BIN(\d{12})", values.get("org_unit", "") or info.subject_dn)
    info.iin = iin.group(1) if iin else ""
    info.bin = bin_.group(1) if bin_ else ""
    return info


def _validate_ocsp(funcs: _Functions, pem: str, url: str) -> str:
    raw = pem.encode()
    out = ctypes.create_string_buffer(BUF_SIZE)
    out_len = ctypes.c_int(BUF_SIZE)
    resp = ctypes.create_string_buffer(BUF_SIZE)
    resp_len = ctypes.c_int(BUF_SIZE)
    rv = funcs.X509ValidateCertificate(
        raw, len(raw), KC_USE_OCSP, url.encode(), 0, out, ctypes.byref(out_len), 0, resp, ctypes.byref(resp_len))
    if rv:
        _raise_last(funcs, rv, "проверка сертификата (OCSP)")
    return _value(out, out_len)


def _normalize_cms(cms: str) -> bytes:
    """NCALayer отдаёт CMS в PEM («-----BEGIN CMS-----», base64 с переносами строк), Kalkan принимает только
    base64 без обёртки: снимаем заголовки и пробельные символы, проверяем, что осталось корректное base64."""
    body = "".join(line for line in cms.splitlines() if not line.strip().startswith("-----"))
    body = "".join(body.split())
    try:
        base64.b64decode(body, validate=True)
    except ValueError:
        raise KalkanError(0, "подпись не в формате base64") from None
    return body.encode()


def verify_cms(cms_b64: str, data: Optional[bytes] = None, check_ocsp: bool = True) -> VerifyResult:
    """Проверяет CMS-подпись (base64, как отдаёт NCALayer).

    data — исходные данные для отсоединённой подписи; для присоединённой не передаётся,
    данные возвращаются в результате. Цепочка до корня НУЦ проверяется всегда, отзыв — по OCSP.
    """
    cms = _normalize_cms(cms_b64)
    flags = KC_SIGN_CMS | KC_IN2_BASE64 | KC_IN_BASE64
    in_data = b""
    if data is not None:
        flags |= KC_DETACHED_DATA
        in_data = base64.b64encode(data)
    with _lock:
        funcs = _load()
        out_data = ctypes.create_string_buffer(max(BUF_SIZE, len(cms) * 2))
        out_data_len = ctypes.c_int(len(out_data))
        out_info = ctypes.create_string_buffer(BUF_SIZE)
        out_info_len = ctypes.c_int(BUF_SIZE)
        out_cert = ctypes.create_string_buffer(BUF_SIZE)
        out_cert_len = ctypes.c_int(BUF_SIZE)
        rv = funcs.VerifyData(
            b"", flags, in_data, len(in_data), cms, len(cms),
            out_data, ctypes.byref(out_data_len), out_info, ctypes.byref(out_info_len),
            0, out_cert, ctypes.byref(out_cert_len))
        info = _value(out_info, out_info_len)
        # При части ошибок VerifyData возвращает 0, а сбой виден только в outVerifyInfo — проверяем оба признака
        if rv or funcs.KC_GetLastError() or "CMS Verify - OK" not in info:
            try:
                if rv or funcs.KC_GetLastError():
                    _raise_last(funcs, rv, "проверка подписи")
                raise KalkanError(0, f"проверка подписи: {info.strip() or 'нет результата'}")
            except KalkanError as exc:
                exc.cert = _cms_cert_quietly(funcs, cms)
                raise
        # Данные возвращаются как есть, без base64, несмотря на KC_IN_BASE64 на входе
        signed = out_data.raw[: out_data_len.value] if data is None else None
        pem = _cms_cert(funcs, cms)
        result = VerifyResult(cert=_cert_info(funcs, pem), data=signed, info=info)
        # Цепочку Kalkan строит по всему системному хранилищу (там и публичные TLS-центры) — издатель только НУЦ
        if result.cert.issuer_dn not in _ca_subjects:
            raise KalkanError(0, f"сертификат выдан не НУЦ РК: {result.cert.issuer_dn}", cert=result.cert)
        if check_ocsp:
            # Отзыв проверяется в OCSP того НУЦ, который выдал сертификат
            result.ocsp_status = _validate_ocsp(funcs, pem, _ca_subjects[result.cert.issuer_dn])
        return result


def _cms_cert_quietly(funcs: _Functions, cms: bytes) -> Optional["CertInfo"]:
    """Сертификат подписанта из CMS без проверки цепочки (для причины отказа); None — не удалось."""
    try:
        return _cert_info(funcs, _cms_cert(funcs, cms))
    except KalkanError:
        return None


def rejection_reason(exc: KalkanError) -> Optional[tuple[str, str]]:
    """Понятная причина отказа по сертификату из отклонённой подписи: (код, текст для пользователя)."""
    cert = exc.cert
    if "REVOKED" in str(exc):
        return "cert_revoked", "Сертификат ЭЦП отозван"
    if not cert:
        return None
    try:
        not_after = datetime.strptime(cert.not_after[:19], "%d.%m.%Y %H:%M:%S")
    except ValueError:
        not_after = None
    if not_after and not_after < datetime.utcnow():
        return "cert_expired", f"Срок действия сертификата истёк {not_after:%d.%m.%Y}. Выберите в NCALayer действующий ключ"
    if cert.issuer_dn and cert.issuer_dn not in _ca_subjects:
        issuer = re.search(r"CN\s*=\s*([^,]+)", cert.issuer_dn)
        name = issuer.group(1).strip() if issuer else cert.issuer_dn
        return "issuer_untrusted", f"Ключ выдан центром «{name}», которому система не доверяет. Выберите в NCALayer ключ НУЦ РК (GOST 2022)"
    return None


def _cms_cert(funcs: _Functions, cms: bytes) -> str:
    out = ctypes.create_string_buffer(BUF_SIZE)
    out_len = ctypes.c_int(BUF_SIZE)
    rv = funcs.KC_GetCertFromCMS(cms, len(cms), 1, KC_SIGN_CMS | KC_IN_BASE64 | KC_OUT_PEM, out, ctypes.byref(out_len))
    if rv:
        _raise_last(funcs, rv, "сертификат из CMS")
    return _value(out, out_len)


