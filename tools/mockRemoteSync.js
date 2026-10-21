#!/usr/bin/env node
/**
 * Simple mock endpoint to inspect remote synchronisation payloads.
 *
 * Usage:
 *   node tools/mockRemoteSync.js
 *
 * The server listens on http://localhost:4780/sync by default and stores every
 * payload in assets/logs/remote-sync.log (one JSONL entry per request).
 * If you need to change the port/path, export SYNC_MOCK_PORT / SYNC_MOCK_PATH.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.SYNC_MOCK_PORT) || 4780;
const PATHNAME = process.env.SYNC_MOCK_PATH || '/sync';
const LOG_DIR = path.join(__dirname, '..', 'assets', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'remote-sync.log');

const ensureLogDir = async () => {
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
};

const appendLog = async entry => {
  await ensureLogDir();
  await fs.promises.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS' && req.url === PATHNAME) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,PUT,PATCH,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
      });
      res.end();
      return;
    }

    if (!req.url.startsWith(PATHNAME)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Not Found' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      const receivedAt = new Date().toISOString();
      const record = {
        receivedAt,
        method: req.method,
        headers: req.headers,
        body: null
      };
      try {
        record.body = JSON.parse(body || '{}');
      } catch (error) {
        record.body = { raw: body, parseError: error.message };
      }
      await appendLog(record);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', receivedAt }));
    });
  } catch (error) {
    console.error('[mock-sync] error', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: error.message }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`[mock-sync] Listening on http://localhost:${PORT}${PATHNAME}`);
  console.log(`[mock-sync] Logging to ${LOG_FILE}`);
});
