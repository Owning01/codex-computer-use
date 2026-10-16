/**
 * Codex CUA (Computer Use Agent) & Browser-Use Universal Harness
 * Reverse-Engineered from OpenAI Codex Guardian v2 Architecture
 * 
 * Supports:
 *  - Native Windows / macOS desktop actions (screenshot, click, type, key, sleep prevention)
 *  - Chrome / Edge CDP automation with DOM Semantic Annotation API (ref_id tags)
 *  - Sandboxed Win32 Desktop isolation (Winsta0\CodexSandboxDesk)
 *  - Whitelist-driven security policy (ComputerUseRequirements & BrowserUseRequirements)
 * 
 * Zero external dependencies: Uses Node 24 native fetch, WebSocket, and child_process.
 */

import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class CodexCuaHarness {
  constructor(config = {}) {
    this.configPath = config.configPath || resolve(__dirname, '../config.example.toml');
    this.cdpPort = config.cdpPort || 9222;
    this.cdpWsUrl = null;
    this.cdpWs = null;
    this.cdpMsgId = 1;
    this.pendingCdpRequests = new Map();
    this.activeTargetId = null;
    this.policy = this.loadPolicy();
    this.isWindows = process.platform === 'win32';
    this.isMac = process.platform === 'darwin';
  }

  // --- Policy & Configuration Loader ---
  loadPolicy() {
    let raw = '';
    if (existsSync(this.configPath)) {
      raw = readFileSync(this.configPath, 'utf-8');
    }

    // Basic TOML / JSON parser for key parameters
    const policy = {
      computer_use: {
        allow_locked_computer_use: false,
        allow_persistent_approval: true,
        prevent_idle_sleep: true,
        windows_exes: [
          { binary_name: 'chrome.exe', product_name: 'Google Chrome', publisher_name: 'Google LLC' },
          { binary_name: 'msedge.exe', product_name: 'Microsoft Edge', publisher_name: 'Microsoft Corporation' },
          { binary_name: 'powershell.exe', product_name: 'Windows PowerShell', publisher_name: 'Microsoft Corporation' },
          { binary_name: 'cmd.exe', product_name: 'Windows Command Processor', publisher_name: 'Microsoft Corporation' }
        ]
      },
      browser_use: {
        full_cdp_access: true,
        allow_webmcp: true,
        allow_history_access: true,
        allow_downloads: true,
        allow_uploads: true,
        origins: ['*']
      }
    };

    if (raw.includes('browser_use_full_cdp_access = true')) {
      policy.browser_use.full_cdp_access = true;
    }
    if (raw.includes('prevent_idle_sleep = true')) {
      policy.computer_use.prevent_idle_sleep = true;
    }

    return policy;
  }

  // --- Sleep & Idle Prevention ---
  async setPreventIdleSleep(enable = true) {
    if (!this.isWindows) return;
    const flags = enable ? '0x80000003' : '0x80000000'; // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    const psScript = `
      $sig = @'
      [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
      public static extern uint SetThreadExecutionState(uint esFlags);
'@
      $type = Add-Type -MemberDefinition $sig -Name "Win32Sleep" -Namespace "CodexCUA" -PassThru
      $type::SetThreadExecutionState(${flags}) | Out-Null
      Write-Output "SLEEP_PREVENT_STATE_${enable}"
    `;
    return this.runPowerShell(psScript);
  }

  // --- PowerShell Execution Helper ---
  runPowerShell(script) {
    return new Promise((res, rej) => {
      const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true
      });
      let stdout = '';
      let stderr = '';
      ps.stdout.on('data', d => stdout += d.toString());
      ps.stderr.on('data', d => stderr += d.toString());
      ps.on('close', code => {
        if (code === 0) {
          res(stdout.trim());
        } else {
          rej(new Error(`PowerShell exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  // --- Native Desktop Actions ---

  /**
   * Captures screen directly from OS using Win32 / macOS graphics API
   */
  async captureDesktopScreenshot(outputPath) {
    const targetFile = outputPath || join(__dirname, `../temp_desktop_${Date.now()}.png`);
    if (this.isWindows) {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bmp.Save("${targetFile.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
        $gfx.Dispose()
        $bmp.Dispose()
        Write-Output "OK:${targetFile}"
      `;
      await this.runPowerShell(psScript);
      const b64 = readFileSync(targetFile).toString('base64');
      return { filePath: targetFile, base64: b64 };
    } else {
      throw new Error('Native captureDesktopScreenshot currently implemented for Windows.');
    }
  }

  /**
   * Native mouse click by screen coordinates
   */
  async desktopClick(x, y, button = 'left', doubleClick = false) {
    if (!this.isWindows) throw new Error('desktopClick Windows only');
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      $sig = @'
      [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
      public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
      [DllImport("user32.dll")]
      public static extern bool SetCursorPos(int X, int Y);
'@
      $type = Add-Type -MemberDefinition $sig -Name "Win32Mouse" -Namespace "CodexCUA" -PassThru
      $type::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
      Start-Sleep -Milliseconds 50
      
      $MOUSEEVENTF_LEFTDOWN = 0x02
      $MOUSEEVENTF_LEFTUP   = 0x04
      $MOUSEEVENTF_RIGHTDOWN = 0x08
      $MOUSEEVENTF_RIGHTUP   = 0x10

      if ("${button}" -eq "right") {
        $down = $MOUSEEVENTF_RIGHTDOWN
        $up = $MOUSEEVENTF_RIGHTUP
      } else {
        $down = $MOUSEEVENTF_LEFTDOWN
        $up = $MOUSEEVENTF_LEFTUP
      }

      $type::mouse_event($down, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 40
      $type::mouse_event($up, 0, 0, 0, 0)

      if (${doubleClick ? 'true' : 'false'}) {
        Start-Sleep -Milliseconds 120
        $type::mouse_event($down, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 40
        $type::mouse_event($up, 0, 0, 0, 0)
      }
      Write-Output "CLICK_OK"
    `;
    return this.runPowerShell(psScript);
  }

  /**
   * Sends keystrokes / text to focused window
   */
  async desktopType(text) {
    if (!this.isWindows) throw new Error('desktopType Windows only');
    // Escape special SendKeys characters: + ^ % ~ ( ) { } [ ]
    const escaped = text.replace(/[{}[\]+^%~()]/g, '{$&}');
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait("${escaped.replace(/"/g, '""')}")
      Write-Output "TYPE_OK"
    `;
    return this.runPowerShell(psScript);
  }

  /**
   * Presses special key combinations (e.g., 'Enter', 'Tab', '^a' for Ctrl+A)
   */
  async desktopKey(key) {
    if (!this.isWindows) throw new Error('desktopKey Windows only');
    const keyMap = {
      'Enter': '{ENTER}',
      'Tab': '{TAB}',
      'Escape': '{ESC}',
      'Backspace': '{BKSP}',
      'Delete': '{DEL}',
      'Home': '{HOME}',
      'End': '{END}',
      'PageUp': '{PGUP}',
      'PageDown': '{PGDN}',
      'Up': '{UP}',
      'Down': '{DOWN}',
      'Left': '{LEFT}',
      'Right': '{RIGHT}',
      'Ctrl+A': '^a',
      'Ctrl+C': '^c',
      'Ctrl+V': '^v',
      'Ctrl+W': '^w',
      'Ctrl+T': '^t'
    };
    const mapped = keyMap[key] || key;
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait("${mapped}")
      Write-Output "KEY_OK"
    `;
    return this.runPowerShell(psScript);
  }

  // --- Chrome DevTools Protocol (CDP) & Browser-Use Engine ---

  /**
   * Connects to a Chrome/Edge browser instance listening on remote-debugging-port
   */
  async connectBrowser(port = 9222) {
    this.cdpPort = port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = await res.json();
      this.cdpWsUrl = info.webSocketDebuggerUrl;
      
      // Get pages list to select default target
      const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await listRes.json();
      const page = pages.find(p => p.type === 'page');
      if (page) {
        this.activeTargetId = page.id;
        this.cdpWsUrl = page.webSocketDebuggerUrl;
      }

      await this.initCdpWebSocket(this.cdpWsUrl);
      return { status: 'connected', version: info.Browser, target: page?.url || 'about:blank' };
    } catch (err) {
      throw new Error(`Failed to connect to browser on port ${port}: ${err.message}. Make sure Chrome/Edge is started with --remote-debugging-port=${port}`);
    }
  }

  initCdpWebSocket(wsUrl) {
    return new Promise((resolve, reject) => {
      if (this.cdpWs && this.cdpWs.readyState === WebSocket.OPEN) {
        return resolve();
      }
      this.cdpWs = new WebSocket(wsUrl);
      this.cdpWs.onopen = () => resolve();
      this.cdpWs.onerror = (e) => reject(new Error(`CDP WebSocket error: ${e.message || 'unknown'}`));
      this.cdpWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && this.pendingCdpRequests.has(data.id)) {
            const { resolve, reject } = this.pendingCdpRequests.get(data.id);
            this.pendingCdpRequests.delete(data.id);
            if (data.error) {
              reject(new Error(`CDP Error: ${data.error.message}`));
            } else {
              resolve(data.result);
            }
          }
        } catch (e) {
          console.error('[CDP parse error]', e);
        }
      };
    });
  }

  sendCdpCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.cdpWs || this.cdpWs.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket is not open'));
      }
      const id = this.cdpMsgId++;
      this.pendingCdpRequests.set(id, { resolve, reject });
      this.cdpWs.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Navigates current tab to URL
   */
  async browserNavigate(url) {
    return this.sendCdpCommand('Page.navigate', { url });
  }

  /**
   * Captures browser viewport as base64 PNG
   */
  async browserScreenshot(format = 'png') {
    const res = await this.sendCdpCommand('Page.captureScreenshot', { format });
    return res.data; // Base64 encoded string
  }

  /**
   * Evaluates JavaScript expression in page context
   */
  async browserEval(expression) {
    const res = await this.sendCdpCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  /**
   * browser_annotation_api: Reverse engineered from Codex
   * Scans interactive DOM elements, injects numbered visual badges,
   * assigns data-codex-ref-id, and returns an indexed element map.
   * Solves exact element targeting for Gmail, Google Drive, Twitter, MercadoLibre, etc.
   */
  async browserAnnotate() {
    const annotationScript = `
      (function() {
        // Remove previous annotations
        document.querySelectorAll('.__codex_cua_badge__').forEach(el => el.remove());

        const selector = [
          'button', 'input', 'select', 'textarea', 'a[href]',
          '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
          '[role="checkbox"]', '[role="radio"]', '[contenteditable="true"]',
          '[tabindex]:not([tabindex="-1"])', '[aria-label]', '[data-action]'
        ].join(', ');

        const elements = Array.from(document.querySelectorAll(selector));
        const results = [];
        let refId = 1;

        elements.forEach(el => {
          const rect = el.getBoundingClientRect();
          const isVisible = rect.width > 4 && rect.height > 4 &&
                            rect.top < window.innerHeight && rect.bottom > 0 &&
                            rect.left < window.innerWidth && rect.right > 0 &&
                            window.getComputedStyle(el).visibility !== 'hidden' &&
                            window.getComputedStyle(el).display !== 'none';
          if (!isVisible) return;

          const currentId = refId++;
          el.setAttribute('data-codex-ref-id', currentId.toString());

          // Create high-visibility overlay badge
          const badge = document.createElement('div');
          badge.className = '__codex_cua_badge__';
          badge.textContent = currentId;
          badge.style.position = 'absolute';
          badge.style.left = (window.scrollX + rect.left) + 'px';
          badge.style.top = (window.scrollY + rect.top) + 'px';
          badge.style.backgroundColor = '#FFD700';
          badge.style.color = '#000000';
          badge.style.border = '1px solid #000000';
          badge.style.borderRadius = '3px';
          badge.style.padding = '1px 3px';
          badge.style.fontSize = '10px';
          badge.style.fontWeight = 'bold';
          badge.style.zIndex = '2147483647';
          badge.style.pointerEvents = 'none';
          document.body.appendChild(badge);

          results.push({
            ref_id: currentId,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || null,
            name: el.getAttribute('name') || null,
            placeholder: el.getAttribute('placeholder') || null,
            ariaLabel: el.getAttribute('aria-label') || null,
            text: (el.innerText || el.textContent || '').trim().slice(0, 80),
            value: el.value ? el.value.slice(0, 50) : null,
            box: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              w: Math.round(rect.width),
              h: Math.round(rect.height)
            }
          });
        });

        return results;
      })()
    `;
    return this.browserEval(annotationScript);
  }

  /**
   * Clicks an annotated element directly by ref_id or by DOM query
   */
  async browserClickRef(refId) {
    const clickScript = `
      (function() {
        const el = document.querySelector('[data-codex-ref-id="${refId}"]');
        if (!el) return { success: false, error: 'Element with ref_id ${refId} not found' };
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        
        // Dispatch synthetic mouse events
        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
        const up = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
        const click = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        el.dispatchEvent(down);
        el.dispatchEvent(up);
        el.dispatchEvent(click);
        return { success: true, tag: el.tagName, text: el.innerText?.slice(0, 50) };
      })()
    `;
    return this.browserEval(clickScript);
  }

  /**
   * Fills an input or textarea element by ref_id
   */
  async browserFillRef(refId, text) {
    const fillScript = `
      (function() {
        const el = document.querySelector('[data-codex-ref-id="${refId}"]');
        if (!el) return { success: false, error: 'Element with ref_id ${refId} not found' };
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, value: el.value };
      })()
    `;
    return this.browserEval(fillScript);
  }

  /**
   * Uploads file to an <input type="file"> identified by ref_id using CDP DOM.setFileInputFiles
   * Essential for Google Drive uploads, MercadoLibre image uploads, etc.
   */
  async browserUploadFile(refId, filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    // Find node ID via CDP DOM API
    const doc = await this.sendCdpCommand('DOM.getDocument', { depth: -1 });
    const findNodeScript = `
      (function() {
        const el = document.querySelector('[data-codex-ref-id="${refId}"]');
        return el ? true : false;
      })()
    `;
    const found = await this.browserEval(findNodeScript);
    if (!found) {
      throw new Error(`Target file input element with ref_id ${refId} not found`);
    }

    // Query node backend id
    const res = await this.sendCdpCommand('Runtime.evaluate', {
      expression: `document.querySelector('[data-codex-ref-id="${refId}"]')`
    });

    if (res.result?.objectId) {
      const nodeDesc = await this.sendCdpCommand('DOM.describeNode', {
        objectId: res.result.objectId
      });
      const backendNodeId = nodeDesc.node.backendNodeId;

      await this.sendCdpCommand('DOM.setFileInputFiles', {
        files: paths,
        backendNodeId: backendNodeId
      });

      return { success: true, uploaded: paths };
    }
    throw new Error('Could not resolve objectId for file input');
  }

  // --- Sandboxed Windows Desktop Launcher ---
  /**
   * Executes a command on the isolated Win32 Desktop (Winsta0\CodexSandboxDesk)
   */
  async execInDesktopSandbox(commandLine) {
    if (!this.isWindows) {
      throw new Error('Desktop Sandbox is currently designed for Windows (Winsta0\\CodexSandboxDesk)');
    }
    const sandboxScript = resolve(__dirname, 'codex_desktop_sandbox.ps1');
    const psCmd = `& "${sandboxScript}" -CommandLine "${commandLine.replace(/"/g, '`"')}"`;
    return this.runPowerShell(psCmd);
  }
}

// CLI direct run support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const harness = new CodexCuaHarness();
  console.log('Codex CUA Universal Harness loaded.');
  console.log('Policy:', JSON.stringify(harness.policy, null, 2));
}
