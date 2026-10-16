# Codex Universal Computer-Use & Browser-Use Harness

Motor universal y servidor MCP de **Computer-Use** y **Browser-Use**, construido a partir de la ingeniería inversa con **REA (*Reverse-Engineer-Anything*)** sobre los binarios de producción de **OpenAI Codex** (`codex.exe`, `codex-command-runner.exe`, `codex-windows-sandbox-setup.exe`).

Este proyecto permite ejecutar la misma arquitectura de interacción y automatización de Codex en **cualquier sistema operativo, framework o harness de agentes de IA** (Antigravity, Claude Code, OpenCode, LangChain, AutoGen, CrewAI o scripts autónomos).

---

## 🚀 ¿Por qué este sistema no se traba en tareas complejas?

Los agentes tradicionales de Computer-Use fallan en tareas cotidianas (como seleccionar cuentas de Gmail, subir archivos a Google Drive, o navegar en X / MercadoLibre) porque se basan en **adivinar coordenadas sobre capturas de pantalla** (*pixel-guessing*).

La arquitectura de Codex resuelve esto mediante un diseño dual:

1. **`browser_annotation_api` (IDs Semánticos `ref_id`):**
   * En lugar de hacer clics ciegos, escanea el DOM e inyecta un identificador numérico único (`ref_id`) y una etiqueta visual de alto contraste sobre cada botón, campo, enlace y dropdown interactivo.
   * La acción del agente es semántica: `cua_browser_click_ref({ ref_id: 4 })` o `cua_browser_fill_ref({ ref_id: 2, text: "mi_correo@gmail.com" })`.
2. **Subida de Archivos Nativa por CDP (`DOM.setFileInputFiles`):**
   * El gran problema de Google Drive o MercadoLibre es que el diálogo de archivos nativo de Windows congela o bloquea a los agentes. Codex bypassa el diálogo inyectando directamente los archivos en el input mediante el Chrome DevTools Protocol (`cua_browser_upload`).
3. **Aislamiento en Escritorio Virtual Win32 (`Winsta0\CodexSandboxDesk`):**
   * En Windows, las tareas de escritorio automatizadas se ejecutan en un escritorio virtual privado para no interferir con la pantalla, el ratón o el trabajo del usuario.
4. **Prevención de Suspensión (`prevent_idle_sleep`):**
   * Mantiene el sistema activo durante tareas largas mediante llamadas Win32 `SetThreadExecutionState`.

---

## 📦 Estructura del Proyecto

```
codex-computer-use/
├── config.example.toml          # Plantilla de configuración y feature flags
├── package.json                 # Metadatos del paquete Node.js (cero dependencias externas)
├── docs/
│   └── SPECIFICATION.md         # Especificación técnica detallada obtenida por REA
└── scripts/
    ├── codex_cua_harness.js     # Motor universal CUA (Desktop + CDP + Annotator)
    ├── codex_mcp_server.js      # Servidor estándar MCP 2026 sobre stdio
    ├── codex_desktop_sandbox.ps1# Lanzador de procesos en Winsta0\CodexSandboxDesk
    └── test_cua.js              # Suite de pruebas automatizadas
```

---

## 🛠️ Requisitos Previos

* **Node.js v22+ o v24+** (utiliza las APIs nativas de `fetch`, `WebSocket` y `child_process`, sin necesidad de `npm install`).
* **Windows 10/11** (para el soporte completo de escritorio nativo Win32 y sandbox).
* Para Browser-Use: Cualquier navegador basado en Chromium (Google Chrome, Microsoft Edge, Brave) iniciado con `--remote-debugging-port=9222`.

---

## 🔌 Integración en Harnesses de Agentes

### 1. Integración con Claude Code / Claude Desktop

Agrega el servidor a tu archivo de configuración de Claude (`claude_desktop_config.json` o `.mcp.json`):

```json
{
  "mcpServers": {
    "codex-computer-use": {
      "command": "node",
      "args": [
        "G:\\Proyectos\\codex-computer-use\\scripts\\codex_mcp_server.js"
      ]
    }
  }
}
```

### 2. Integración con Antigravity / OpenCode

Puedes agregarlo en tu archivo de configuración MCP (`~/.gemini/antigravity/mcp_config.json` o de proyecto):

```json
{
  "mcpServers": {
    "codex-cua": {
      "command": "node",
      "args": ["G:/Proyectos/codex-computer-use/scripts/codex_mcp_server.js"]
    }
  }
}
```

### 3. Integración en Python (LangChain / AutoGen / Scripts Propios)

```python
import subprocess
import json

class CodexCUAClient:
    def __init__(self, server_path="G:/Proyectos/codex-computer-use/scripts/codex_mcp_server.js"):
        self.proc = subprocess.Popen(
            ["node", server_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        self._init_session()

    def _call(self, method, params):
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def _init_session(self):
        return self._call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}})

    def screenshot(self):
        return self._call("tools/call", {"name": "cua_desktop_screenshot", "arguments": {}})

    def annotate_browser(self):
        return self._call("tools/call", {"name": "cua_browser_annotate", "arguments": {}})

    def click_ref(self, ref_id):
        return self._call("tools/call", {"name": "cua_browser_click_ref", "arguments": {"ref_id": ref_id}})

    def fill_ref(self, ref_id, text):
        return self._call("tools/call", {"name": "cua_browser_fill_ref", "arguments": {"ref_id": ref_id, "text": text}})
```

---

## 🧰 Catálogo de Herramientas MCP Disponibles

| Herramienta | Propósito | Argumentos Clave |
| :--- | :--- | :--- |
| `cua_status` | Inspecciona el estado de la política, SO y conexión CDP | Ninguno |
| `cua_desktop_screenshot` | Captura la pantalla completa de Windows/macOS | `output_path` (opcional) |
| `cua_desktop_click` | Clic nativo en coordenadas `(x, y)` | `x`, `y`, `button`, `double_click` |
| `cua_desktop_type` | Escribe texto en la ventana nativa enfocada | `text` |
| `cua_desktop_key` | Presiona teclas especiales o combinaciones | `key` (`Enter`, `Tab`, `Ctrl+A`, etc.) |
| `cua_browser_connect` | Conecta el harness a Chrome/Edge vía CDP | `port` (default: `9222`) |
| `cua_browser_navigate` | Navega a una URL en la pestaña activa | `url` |
| `cua_browser_screenshot` | Captura el viewport del navegador | Ninguno |
| `cua_browser_annotate` | **Genera los `ref_id` e inyecta badges en el DOM** | Ninguno |
| `cua_browser_click_ref` | Clic directo a un elemento por su `ref_id` | `ref_id` |
| `cua_browser_fill_ref` | Escribe en un input/textarea por su `ref_id` | `ref_id`, `text` |
| `cua_browser_upload` | Sube archivos por CDP (Google Drive, MercadoLibre) | `ref_id`, `file_paths` |
| `cua_browser_eval` | Ejecuta JavaScript en la página y retorna el valor | `expression` |
| `cua_exec_sandboxed` | Lanza un proceso en `Winsta0\CodexSandboxDesk` | `command_line` |
| `cua_desktop_mouse_move` | Mueve el cursor a `(x, y)` sin hacer clic (hover / tooltips) | `x`, `y` |
| `cua_desktop_scroll` | Rueda de scroll del ratón vertical | `delta_y`, `x`, `y` |
| `cua_desktop_drag` | Arrastrar y soltar (*drag & drop*) interpolado | `start_x`, `start_y`, `end_x`, `end_y`, `steps` |
| `cua_clipboard_get` | Lee el contenido de texto del portapapeles del sistema | Ninguno |
| `cua_clipboard_set` | Escribe texto en el portapapeles del sistema | `text` |
| `cua_window_list` | Lista las ventanas abiertas y sus identificadores | Ninguno |
| `cua_window_focus` | Enfoca y restaura una ventana por título o proceso | `query` |
| `cua_search_commands` | Ejecuta el lote unificado de `SearchCommands` de Codex | `commands` |

---

## 🧪 Verificación y Pruebas

Para verificar que todos los subsistemas, APIs nativas Win32 y el servidor MCP funcionan correctamente:

```powershell
node scripts/test_cua.js
```

---

## 🔒 Seguridad y Guardian Policy

El archivo `config.example.toml` permite definir:
* Lista blanca de ejecutables autorizados por firma Authenticode (`publisher_name`, `product_name`, `binary_name`).
* Lista blanca de orígenes web permitidos para CUA (`BrowserUseOriginPolicy`).
* Activación o desactivación de descargas y subidas de archivos.
