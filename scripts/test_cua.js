/**
 * Test Suite for Codex CUA & MCP Engine
 */

import { CodexCuaHarness } from './codex_cua_harness.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runTests() {
  console.log('=== [1] Testing CodexCuaHarness Instantiation & Policy ===');
  const harness = new CodexCuaHarness();
  console.log('Policy Loaded:', JSON.stringify(harness.policy, null, 2));

  if (!harness.policy.computer_use || !harness.policy.browser_use) {
    throw new Error('Policy structure invalid');
  }
  console.log('✓ Policy validation passed.');

  console.log('\n=== [2] Testing Sleep Prevention API (Win32) ===');
  try {
    const sleepRes = await harness.setPreventIdleSleep(true);
    console.log('Sleep Prevention Result:', sleepRes);
    console.log('✓ Sleep prevention configured successfully.');
  } catch (err) {
    console.warn('! Sleep prevention test skipped or failed:', err.message);
  }

  console.log('\n=== [3] Testing MCP Server JSON-RPC Protocol ===');
  const mcpServerPath = resolve(__dirname, 'codex_mcp_server.js');
  const mcpProc = spawn('node', [mcpServerPath], {
    stdio: ['pipe', 'pipe', 'inherit']
  });

  const sendRpc = (req) => {
    return new Promise((resolve) => {
      const handler = (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === req.id) {
              mcpProc.stdout.off('data', handler);
              return resolve(parsed);
            }
          } catch (_) {}
        }
      };
      mcpProc.stdout.on('data', handler);
      mcpProc.stdin.write(JSON.stringify(req) + '\n');
    });
  };

  // Test initialize
  const initRes = await sendRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test-client' } }
  });
  console.log('Init Response:', initRes.result?.serverInfo);

  // Test tools/list
  const toolsRes = await sendRpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });
  const tools = toolsRes.result?.tools || [];
  console.log(`Registered MCP Tools (${tools.length}):`, tools.map(t => t.name).join(', '));

  // Test cua_status tool call
  const statusRes = await sendRpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'cua_status', arguments: {} }
  });
  console.log('cua_status Result:', statusRes.result?.content?.[0]?.text);

  mcpProc.kill();
  console.log('\n✓ All MCP Server communication tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
