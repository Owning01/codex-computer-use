# Especificación Técnica: OpenAI Codex Computer-Use & Browser-Use Architecture
**Fuente:** Ingeniería inversa con REA (*Reverse-Engineer-Anything*) sobre `codex.exe` v0.163.0 (x86_64 PE32+).

---

## 1. Visión General del Sistema

OpenAI Codex implementa la interacción con la computadora dividiéndola en dos capas complementarias coordinadas por el motor **Guardian v2**:

1. **`computer_use` (Nivel Sistema Operativo & Escritorio):**
   * Gestiona el control de ventanas nativas, clics, teclado y ejecución en sandbox.
   * La acción inicial del agente se cataloga en la taxonomía interna como `initial_cua_call` (*Computer Use Agent*).
   * Puede operar bajo el modo `computer_use_only` donde las herramientas de shell quedan confinadas exclusivamente al agente CUA.
2. **`browser_use` (Nivel Navegación Web & DOM):**
   * Automatización basada en Chrome DevTools Protocol (`full_cdp_access`).
   * Soporta **WebMCP** (`allow_webmcp`), permitiendo inyectar servidores y herramientas MCP directamente en la sesión web.
   * Filtrado estricto por orígenes (`BrowserUseOriginPolicy`) para evitar exfiltración de cookies y sesiones.

---

## 2. Esquemas de Datos Reconstruidos (Rust Structs)

### A. Requisitos de Computer-Use (`ComputerUseRequirements`)

```rust
pub struct ComputerUseRequirements {
    pub allow_locked_computer_use: bool,
    pub allow_persistent_approval: bool,
    pub default_app_access: AppAccessPolicy,
    pub macos: ComputerUseMacosRequirements,
    pub windows: ComputerUseWindowsRequirements,
}

pub struct ComputerUseWindowsRequirements {
    pub aumids: Vec<String>,
    pub exes: Vec<ComputerUseWindowsExeRequirement>,
}

pub struct ComputerUseWindowsExeRequirement {
    pub publisher_name: String, // Verificación Authenticode (ej: "Google LLC")
    pub product_name: String,   // Nombre oficial del producto
    pub binary_name: String,    // Nombre del ejecutable (ej: "chrome.exe")
}

pub struct ComputerUseMacosRequirements {
    pub bundle_ids: Vec<String>, // IDs de bundle permitidos (ej: "com.google.Chrome")
}
```

### B. Requisitos de Browser-Use (`BrowserUseRequirements`)

```rust
pub struct BrowserUseRequirements {
    pub full_cdp_access: bool,
    pub allow_webmcp: bool,
    pub allow_history_access: bool,
    pub disable_auto_review: bool,
    pub allow_global_persistent_approval: bool,
    pub default_origin_policy: OriginPolicy,
    pub origins: Vec<OriginRule>,
}

pub struct OriginRule {
    pub pattern: String,
    pub full_cdp: bool,
    pub allow_downloads: bool,
    pub allow_uploads: bool,
}
```

### C. Comandos y Acciones de CUA (`SearchCommands` / `CuaAction`)

Estructura de 11 elementos extraída del crate `codex_api::search`:

```rust
pub struct SearchCommands {
    pub search_query: Option<Vec<SearchQuery>>,         // { q, recency, domains }
    pub image_query: Option<Vec<ImageQuery>>,           // { q }
    pub open: Option<Vec<OpenOperation>>,               // { ref_id, lineno }
    pub click: Option<Vec<ClickOperation>>,             // { ref_id, id }
    pub find: Option<Vec<FindOperation>>,               // { ref_id, pattern }
    pub screenshot: Option<Vec<ScreenshotOperation>>,   // { ref_id, pageno }
    pub finance: Option<Vec<FinanceOperation>>,         // { ticker, type, market }
    pub weather: Option<Vec<WeatherOperation>>,         // { location, start, duration }
    pub sports: Option<Vec<SportsOperation>>,           // { fn, league, team, opponent, date_from, date_to, num_games, locale }
    pub time: Option<Vec<TimeOperation>>,               // { utc_offset }
    pub response_length: Option<String>,                // "short" | "medium" | "long"
}
```

### D. Directivas de Decisión del Agente (System Prompt de CUA extraído)

Codex instruye a su modelo con las siguientes reglas explícitas para el uso de la computadora y la web:

1. **Agrupación de Comandos (*Batching*):**
   * El modelo debe agrupar múltiples comandos en una sola llamada para máxima velocidad:
     `{"search_query": [{"q": "bitcoin news"}], "finance":[{"ticker":"BTC","type":"crypto","market":""}], "find": [{"ref_id": "turn0search0", "pattern": "Annie Case"}]}`
2. **Citas y Rastreo de Referencias:**
   * Las referencias de navegación se rastrean con el formato `turn{T}search{S}` y `turn{T}fetch{F}` (ejemplo: `turn0fetch3`).
   * No se exponen estos IDs al usuario final; solo se citan mediante Markdown links limpios.
3. **Frontera de Decisión Obligatoria (`<situations_where_you_must_browse_the_internet>`):**
   * El agente debe navegar obligatoriamente si hay un >10% de probabilidad de que la información haya cambiado temporalmente (precios, versiones de librerías, normas, noticias, directivos de empresas).

---

## 3. Arquitectura de Aislamiento en Windows

Codex incluye dos binarios satélites de seguridad en `codex-resources`:

### 1. `codex-command-runner.exe`
* **Desktop Win32 Aislado:** Llama a `OpenDesktopW` creando un escritorio virtual secundario en la estación de ventanas interactiva:
  `Winsta0\CodexSandboxDesk\...`
* **Tokens Restringidos:**
  * Obtiene el token del proceso con `OpenProcessToken`.
  * Genera un token restringido con privilegios mínimos mediante `CreateRestrictedToken`.
  * Asigna listas de control de acceso por defecto con `SetTokenInformation(TokenDefaultDacl)`.
  * Lanza la aplicación automatizada con `CreateProcessAsUserW`.

### 2. `codex-windows-sandbox-setup.exe`
* Crea dos cuentas de usuario locales de Windows:
  * `offline_username`: Para tareas que no requieren conectividad exterior.
  * `online_username`: Con salida a red filtrada mediante proxy local.
* Las credenciales de estos usuarios se protegen con **Windows DPAPI** (`dpapi protect for offline/online user`).
* Las carpetas compartidas se bloquean con descriptores de seguridad DACL:
  `D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;SID)`

---

## 4. Banderas de Características (*Feature Flags*)

Las siguientes banderas controlan el comportamiento de Computer-Use en `~/.codex/config.toml`:

| Feature Flag | Estado | Función |
| :--- | :--- | :--- |
| `in_app_local_automation` | `stable` | Habilita el control y ejecución de automatización en aplicaciones de escritorio. |
| `in_app_browser` | `stable` | Activa el navegador integrado de Codex. |
| `browser_use_full_cdp_access` | `under development` | Otorga control completo del Chrome DevTools Protocol para interactuar con páginas. |
| `browser_annotation_api` | `under development` | Inyecta etiquetas y IDs semánticos en el DOM para clics basados en `ref_id`. |
| `prevent_idle_sleep` | `experimental` | Invoca `SetThreadExecutionState` en Windows para evitar que la PC se suspenda. |
| `allowBrowserAndComputerUse` | `enterprise/mdm` | Llave maestra administrada para autorizar CUA en organizaciones. |
| `windows_sandbox_service` | `under development` | Servicio de gestión dinámica de contenedores de escritorio Windows. |
