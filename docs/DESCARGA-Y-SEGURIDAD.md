# StageMaster · «La app no es segura»: descargar y abrir el .exe

## Por qué pasa

`StageMaster.exe` **no lleva firma digital** (un certificado que identifica a la
empresa que lo publica). Windows (SmartScreen) y los navegadores (Edge, Chrome)
tratan cualquier programa sin firma descargado de Internet como «desconocido».
Según cómo esté configurada cada laptop, solo avisan o directamente bloquean la
descarga. No significa que tenga un virus.

## Soluciones sin coste (ya disponibles)

| Situación | Qué hacer |
|---|---|
| El navegador **no deja descargar** el .exe | Descargar el **.zip** (los navegadores casi nunca lo bloquean): https://github.com/Sleal11/STAGEMASTER/releases/download/prueba/StageMaster-prueba.zip — lleva dentro `StageMaster.exe` y un LEEME con estos pasos |
| **Edge** marca la descarga | En la lista de descargas: **⋯ → Conservar → Mostrar más → Conservar de todos modos** |
| **Chrome** marca la descarga | En la lista de descargas (Ctrl+J): **Conservar** / **Descargar archivo no seguro** |
| Al abrirlo: **«Windows protegió su PC»** | **Más información → Ejecutar de todas formas** |
| Windows no deja abrirlo | Clic derecho en el .exe → **Propiedades** → marcar **Desbloquear** → Aceptar |
| El **antivirus** lo borra | Añadir una excepción para `StageMaster.exe`. Si es Microsoft Defender, se puede enviar el archivo a Microsoft como «falso positivo»: https://www.microsoft.com/wdsi/filesubmission |
| Laptops del evento | **Copiarlo con un USB**: un archivo copiado desde un USB no lleva la marca de «descargado de Internet», así que Windows no avisa |

Recomendación para el día del evento: llevar el `.exe` en un **USB** y
copiarlo a cada laptop.

## Solución definitiva: firmar el .exe (tiene coste)

Con una firma digital, Windows muestra el nombre de la empresa en lugar de
«editor desconocido» y los bloqueos son mucho menos frecuentes. Importante:

- **La firma no quita el aviso de SmartScreen desde el primer día.** Desde 2024
  ni siquiera los certificados EV dan «reputación» inmediata: se gana con el
  tiempo, a medida que se descarga y ejecuta sin problemas.
- Opciones:
  - **Azure Artifact Signing** (antes Trusted Signing), de Microsoft: desde
    unos **9,99 USD/mes**. Hoy solo admite **personas en EE. UU. y Canadá** y
    **empresas de EE. UU., Canadá, la UE y Reino Unido**. Hay que comprobar si
    la empresa puede usarlo.
  - **Certificado OV** de una autoridad de certificación (DigiCert, Sectigo,
    SSL.com, Certum…): del orden de **cientos de USD al año**, con
    verificación de la identidad de la empresa. La clave va en un dispositivo
    seguro o en un servicio de firma en la nube (necesario para firmar
    automáticamente en GitHub).
- Cuando haya certificado, se añade la firma al proceso de compilación de
  GitHub (electron-builder lo admite): cada exe saldría firmado solo.

Lo que necesitamos para hacerlo: decidir el proveedor, los datos legales de la
empresa (nombre, país, registro) y las credenciales del servicio de firma, que
se guardan como «secretos» del repositorio (nunca en el código).

Fuentes: [Opciones de firma de código (Microsoft)](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options) ·
[Reputación de SmartScreen (Microsoft)](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation) ·
[Precios de Artifact Signing](https://azure.microsoft.com/pricing/details/artifact-signing/) ·
[Inicio rápido de Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/quickstart)
