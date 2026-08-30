# Acceso a Sonora desde otros dispositivos

## Red local

Sonora escucha por defecto en `0.0.0.0:3000`. Al ejecutar `iniciar.bat`, la consola y la pantalla de acceso muestran la dirección que debes abrir desde otro móvil, tablet u ordenador conectado al mismo router, por ejemplo `http://192.168.0.182:3000`.

El PC servidor debe permanecer encendido y la conexión doméstica de Windows debe estar marcada como **Privada**. No es necesario modificar el router para acceder desde la misma red local.

### Firewall de Windows

Abre PowerShell como administrador y ejecuta:

```powershell
Set-Location "C:\ruta\a\Reproductor del bueno"
.\scripts\permitir-red-local.ps1
```

La regla solo permite `node.exe` en TCP 3000 desde `LocalSubnet` y únicamente en el perfil **Privado**. Para retirarla:

```powershell
.\scripts\quitar-red-local.ps1
```

## Acceso desde fuera de casa

No redirijas directamente el puerto `3000` de Sonora a Internet: la conexión sería HTTP y expondría contraseñas, cookies y audio sin cifrado. Utiliza una VPN privada o un túnel/proxy HTTPS. Cuando dispongas de una URL HTTPS, copia `sonora.env.example.cmd` como `sonora.env.cmd` y configura:

```bat
set SONORA_PUBLIC_URL=https://musica.ejemplo.com
set SONORA_TRUST_PROXY=loopback
```

Sonora detectará las peticiones HTTPS reenviadas y añadirá `Secure` a la cookie de sesión. El proxy debe conservar la cabecera `Host` y enviar `X-Forwarded-Proto: https`.

El registro de cuentas adicionales queda cerrado por defecto tras crear la primera. Para abrirlo temporalmente, usa `set SONORA_ALLOW_REGISTRATION=1`, reinicia Sonora, crea las cuentas necesarias y vuelve a ponerlo en `0`.

## Vodafone Station / router de fibra Vodafone

Para uso dentro de casa no abras ningún puerto. Si instalas un proxy HTTPS en el PC y necesitas publicar ese proxy:

1. Reserva en el DHCP del router la IP local del PC para que no cambie.
2. Entra en el router usando la dirección, usuario y contraseña indicados en su pegatina.
3. Cambia a **Modo Experto** si aparece esa opción.
4. Ve a **Internet → Redirección de puertos** y pulsa **+**.
5. Selecciona el PC de Sonora o escribe su IP local.
6. Crea una regla **TCP**, puerto público `443`, puerto LAN `443`.
7. Solo si el proxy lo necesita para emitir o renovar certificados, crea también TCP `80` → `80`.
8. Guarda o pulsa **Aplicar**.

El destino de estas reglas debe ser el proxy HTTPS, no Sonora directamente en el puerto 3000. Los nombres exactos cambian según el modelo de Vodafone Station.

Vodafone indica que estos pasos de redirección son para routers de fibra, no para routers 4G/5G. Si la IP WAN del router está entre `100.64.0.0` y `100.127.255.255`, o no coincide con la IP pública, probablemente hay CGNAT y una redirección no funcionará; en ese caso solicita a Vodafone una IPv4 pública o utiliza un túnel/VPN que no requiera abrir puertos.

Documentación oficial:

- [Cómo entrar a tu router Vodafone](https://ayudacliente.vodafone.es/particulares/internet-y-fijo/wifi-y-router/como-acceder-a-tu-router/)
- [Cómo abrir los puertos de tu router Vodafone](https://ayudacliente.vodafone.es/particulares/internet-y-fijo/wifi-y-router/como-abrir-los-puertos-de-tu-router/)
- [Configuración por modelo de router Vodafone](https://ayudacliente.vodafone.es/particulares/internet-y-fijo/wifi-y-router/configuracion-de-routers/)
- [Información de Vodafone sobre CGNAT](https://www.vodafone.es/c/conectate/consejos/como-desactivar-cgnat-operador/)
- [Riesgos de permitir aplicaciones en Firewall de Windows](https://support.microsoft.com/es-es/windows/security/firewall/risks-of-allowing-apps-through-windows-firewall)
