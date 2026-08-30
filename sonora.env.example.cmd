@echo off
REM Copia este archivo como sonora.env.cmd y modifica solo lo que necesites.

REM Escuchar en todas las interfaces permite el acceso desde la red local.
set HOST=0.0.0.0
set PORT=3000

REM Por defecto, el primer arranque pide crear una cuenta y la convierte en administradora.
REM Activa esta opción solo si prefieres generar automáticamente la cuenta indicada debajo.
set SONORA_SEED_DEFAULT_ADMIN=0
set SONORA_ADMIN_EMAIL=admin@sonora.local
set SONORA_ADMIN_PASSWORD=Sonora59!

REM Las cuentas normales se crean desde el panel Administración.
set SONORA_ALLOW_REGISTRATION=0

REM Para acceso remoto seguro, indica la URL HTTPS del túnel o proxy.
REM set SONORA_PUBLIC_URL=https://musica.ejemplo.com

REM El valor loopback es correcto cuando el proxy HTTPS corre en este PC.
set SONORA_TRUST_PROXY=loopback

REM Solo si el proxy cambia el Host original, añade orígenes HTTPS separados por comas.
REM set SONORA_ALLOWED_ORIGINS=https://musica.ejemplo.com

REM No actives estas opciones salvo diagnóstico: hacen una consulta externa de IP
REM y permiten anunciar una dirección HTTP pública sin cifrar.
set SONORA_DISCOVER_PUBLIC_IP=0
set SONORA_ALLOW_INSECURE_REMOTE=0
