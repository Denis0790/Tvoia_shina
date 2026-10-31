"""Общий помощник для тестов: полный флоу регистрации клиента
(почта → код → ticket → пароль + телефон) в одну функцию, чтобы не дублировать в каждом файле.
Почта строится из телефона, поэтому у каждого тестового телефона свой аккаунт."""


async def register_and_login(client, phone: str, password: str = "test1234") -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    email = f"u{digits}@test.local"

    r = await client.post("/auth/request-code", params={"email": email})
    code = r.json()["debug_code"]

    r = await client.post("/auth/verify-code", params={"email": email, "code": code})
    ticket = r.json()["ticket"]

    r = await client.post("/auth/set-password", params={"ticket": ticket, "password": password, "phone": phone, "consent": True})
    return r.json()["access_token"]
