# Выкладка «Твоя Шина» на сервер

Нужно заранее: VPS (Ubuntu 22.04/24.04, от 2 vCPU / 4 ГБ, дата-центр в РФ), домен, почтовый ящик Timeweb Mail.

## 1. DNS (у регистратора домена)
Две A-записи на IP сервера: `@` (ваш-домен) и `api` (api.ваш-домен). Подождать 5–30 минут.

## 2. Первичная настройка сервера (под root)
~~~bash
apt update && apt -y upgrade
adduser deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh
# swap 2 ГБ
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Docker (официальный скрипт)
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
# файрвол: только SSH, HTTP, HTTPS
apt -y install ufw fail2ban
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
~~~
Затем в новом окне проверьте вход `ssh deploy@IP` и только после этого отключите пароль:
в `/etc/ssh/sshd_config` поставьте `PasswordAuthentication no`, `PermitRootLogin no`, затем `systemctl restart ssh`.

## 3. Код и настройки (под deploy)
~~~bash
sudo mkdir -p /opt/tvoya-shina && sudo chown deploy:deploy /opt/tvoya-shina
git clone git@github.com:ВАШ/РЕПО.git /opt/tvoya-shina   # нужен deploy-ключ репозитория (read-only)
cd /opt/tvoya-shina
cp .env.prod.example .env.prod
nano .env.prod
~~~
В `.env.prod` заполнить: `DOMAIN`, пароль БД (`POSTGRES_PASSWORD` и тот же в `DATABASE_URL`),
`JWT_SECRET` (`openssl rand -hex 32`), `CORS_ORIGINS=https://ваш-домен`, `COOKIE_SECURE=true`,
`APP_ENV=production`, `OTP_DEBUG=false`, `SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` (ящик Timeweb Mail).
Не заполнять `CADDY_GLOBAL`. Файл `.env.prod` не коммитить.

## 4. Запуск
~~~bash
cd /opt/tvoya-shina
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl -s https://api.ВАШ-ДОМЕН/health
~~~
Сертификат Caddy получит сам (нужны DNS и открытые 80/443).

## 5. Менеджер
~~~bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec backend python -m app.create_manager
~~~
Логин и пароль (от 10 символов) вводятся в диалоге.

## 6. После запуска
- Зарегистрируйтесь клиентом: код должен прийти на почту. Если нет, смотрите `docker compose ... logs backend`.
- В Timeweb Mail/DNS домена включить SPF и DKIM, иначе письма с кодами уйдут в спам.
- Бэкап БД: сервис `backup` делает дамп раз в сутки (том `pgbackups`, 14 копий). Раз в месяц пробуйте восстановить.
- Заполнить `frontend/src/lib/company.ts` реквизитами ООО, проверить политику и согласие у юриста, подать уведомление в Роскомнадзор.

## 7. Обновление
Кнопка «Run workflow» в GitHub → Actions → Deploy (нужны секреты репозитория `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`)
или вручную на сервере: `git pull --ff-only && docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build`.
