#!/usr/bin/env node
/**
 * Codex MCP (Model Context Protocol) Server
 * Exposes Codex CUA and Browser-Use capabilities to any AI Agent Harness.
 * 
 * Compliant with MCP JSON-RPC 2.0 stdio transport.
 */

import { CodexCuaHarness } from './codex_cua_harness.js';
import * as readline from 'node:readline';

const harness = new CodexCuaHarness();

const TOOLS = [
  {
    name: 'cua_status',
    description: 'Get current CUA status, active policies, and connection states',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'cua_desktop_screenshot',
    description: 'Captures full OS desktop screenshot and returns base64 PNG',
    inputSchema: {
      type: 'object',
      properties: {
        output_path: { type: 'string', description: 'Optional custom output file path' }
      }
    }
  },
  {
    name: 'cua_desktop_click',
    description: 'Sends native OS mouse click to specific screen coordinates (x, y)',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Screen X coordinate' },
        y: { type: 'number', description: 'Screen Y coordinate' },
        button: { type: 'string', enum: ['left', 'right'], default: 'left' },
        double_click: { type: 'boolean', default: false }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'cua_desktop_type',
    description: 'Types text into the currently active native desktop window',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to send' }
      },
      required: ['text']
    }
  },
  {
    name: 'cua_desktop_key',
    description: 'Sends special keypress or combination (Enter, Tab, Escape, Ctrl+A, Ctrl+C, Ctrl+V, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name or combination' }
      },
      required: ['key']
    }
  },
  {
    name: 'cua_browser_connect',
    description: 'Connects to local Chrome / Edge instance with remote debugging enabled (--remote-debugging-port=9222)',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', default: 9222, description: 'CDP port' }
      }
    }
  },
  {
    name: 'cua_browser_navigate',
    description: 'Navigates the active browser tab to a specified URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Destination URL' }
      },
      required: ['url']
    }
  },
  {
    name: 'cua_browser_screenshot',
    description: 'Captures the active browser viewport as base64 PNG',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'cua_browser_annotate',
    description: 'Scans the DOM for interactive elements, assigns high-contrast numeric badges (ref_id), and returns an element manifest. Solves getting stuck on Gmail, Drive, Twitter, MercadoLibre by providing stable element references.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'cua_browser_click_ref',
    description: 'Clicks an interactive web element by its assigned ref_id from cua_browser_annotate',
    inputSchema: {
      type: 'object',
      properties: {
        ref_id: { type: 'number', description: 'The ref_id assigned to the target element' }
      },
      required: ['ref_id']
    }
  },
  {
    name: 'cua_browser_fill_ref',
    description: 'Fills a text input or textarea element by its assigned ref_id',
    inputSchema: {
      type: 'object',
      properties: {
        ref_id: { type: 'number', description: 'The ref_id assigned to the input' },
        text: { type: 'string', description: 'Text to input' }
      },
      required: ['ref_id', 'text']
    }
  },
  {
    name: 'cua_browser_upload',
    description: 'Uploads one or more local files directly to an <input type="file"> via CDP (Google Drive, MercadoLibre, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        ref_id: { type: 'number', description: 'The ref_id of the file input' },
        file_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths of the files to upload'
        }
      },
      required: ['ref_id', 'file_paths']
    }
  },
  {
    name: 'cua_browser_eval',
    description: 'Evaluates JavaScript in the active browser page context and returns result',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JavaScript expression' }
      },
      required: ['expression']
    }
  },
  {
    name: 'cua_exec_sandboxed',
    description: 'Executes a command inside the isolated Win32 Desktop (Winsta0\\CodexSandboxDesk) without disturbing the user session',
    inputSchema: {
      type: 'object',
      properties: {
        command_line: { type: 'string', description: 'Executable command line to launch' }
      },
      required: ['command_line']
    }
  }
];

// JSON-RPC Handling over stdio
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id, code, message, data = null) {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message, data }
  }) + '\n');
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'codex-computer-use-mcp',
            version: '1.0.0'
          }
        });
        break;

      case 'notifications/initialized':
        // No response needed for notifications
        break;

      case 'ping':
        sendResponse(id, {});
        break;

      case 'tools/list':
        sendResponse(id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const result = await handleToolCall(name, args);
        sendResponse(id, result);
        break;
      }

      default:
        sendError(id, -32601, `Method not found: ${method}`);
        break;
    }
  } catch (err) {
    sendError(id, -32000, err.message || 'Internal error');
  }
});

async function handleToolCall(name, args) {
  switch (name) {
    case 'cua_status': {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            platform: process.platform,
            policy: harness.policy,
            cdp: {
              port: harness.cdpPort,
              connected: !!(harness.cdpWs && harness.cdpWs.readyState === 1),
              target: harness.activeTargetId
            }
          }, null, 2)
        }]
      };
    }

    case 'cua_desktop_screenshot': {
      const res = await harness.captureDesktopScreenshot(args.output_path);
      return {
        content: [
          { type: 'text', text: `Desktop screenshot saved to ${res.filePath}` },
          { type: 'image', data: res.base64, mimeType: 'image/png' }
        ]
      };
    }

    case 'cua_desktop_click': {
      const res = await harness.desktopClick(args.x, args.y, args.button, args.double_click);
      return { content: [{ type: 'text', text: `Click executed: ${res}` }] };
    }

    case 'cua_desktop_type': {
      const res = await harness.desktopType(args.text);
      return { content: [{ type: 'text', text: `Type executed: ${res}` }] };
    }

    case 'cua_desktop_key': {
      const res = await harness.desktopKey(args.key);
      return { content: [{ type: 'text', text: `Key sent: ${res}` }] };
    }

    case 'cua_browser_connect': {
      const res = await harness.connectBrowser(args.port || 9222);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'cua_browser_navigate': {
      const res = await harness.browserNavigate(args.url);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'cua_browser_screenshot': {
      const b64 = await harness.browserScreenshot();
      return {
        content: [
          { type: 'text', text: 'Browser viewport screenshot captured' },
          { type: 'image', data: b64, mimeType: 'image/png' }
        ]
      };
    }

    case 'cua_browser_annotate': {
      const elements = await harness.browserAnnotate();
      return {
        content: [{
          type: 'text',
          text: `Found ${elements.length} interactive elements:\n` + JSON.stringify(elements, null, 2)
        }]
      };
    }

    case 'cua_browser_click_ref': {
      const res = await harness.browserClickRef(args.ref_id);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'cua_browser_fill_ref': {
      const res = await harness.browserFillRef(args.ref_id, args.text);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'cua_browser_upload': {
      const res = await harness.browserUploadFile(args.ref_id, args.file_paths);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'cua_browser_eval': {
      const res = await harness.browserEval(args.expression);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'cua_exec_sandboxed': {
      const res = await harness.execInDesktopSandbox(args.command_line);
      return { content: [{ type: 'text', text: res }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
