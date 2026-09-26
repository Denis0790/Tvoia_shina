"""Общий помощник для тестов: полный флоу регистрации клиента по телефону
(код → ticket → пароль) в одну функцию, чтобы не дублировать в каждом файле."""


async def register_and_login(client, phone: str, password: str = "test1234") -> str:
    r = await client.post("/auth/request-code", params={"phone": phone})
    code = r.json()["debug_code"]

    r = await client.post("/auth/verify-code", params={"phone": phone, "code": code})
    ticket = r.json()["ticket"]

    r = await client.post("/auth/set-password", params={"ticket": ticket, "password": password})
    return r.json()["access_token"]
