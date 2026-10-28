// Local-only visual verification; no Twitch credentials or production server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import WebSocket from 'ws';
import { scanPlugins } from '../core/plugins.js';

const stage = process.argv[2] || 'after';
const output = path.resolve('artifacts/overlay-check');
fs.mkdirSync(output, { recursive: true });
const app = express();
app.use(express.static('public'));
app.get('/overlay', (_, res) => res.sendFile(path.resolve('public/overlay.html')));
app.get('/api/plugins', (_, res) => res.json(scanPlugins(path.resolve('plugins'))));
app.get('/events', (_, res) => { res.set('Content-Type', 'text/event-stream'); res.write('data: {"type":"snapshot","vote":null,"chat":[],"status":{"demo":true,"live":false}}\n\n'); });
app.get('/plugins/:name/plugin.html', (req, res) => {
  res.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'");
  res.sendFile(path.resolve('plugins', req.params.name, 'plugin.html'));
});
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'streamforge-browser-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser startup timeout')), 15000);
    browser.on('error', reject);
    browser.stderr.on('data', chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise(resolve => socket.once('open', resolve));
  let id = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const call = ++id; pending.set(call, { resolve, reject });
    socket.send(JSON.stringify({ id: call, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.EventSource=class { constructor(){window.__source=this;} };' });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const measurements = [];
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/overlay` });
      await new Promise(resolve => setTimeout(resolve, 700));
      await evaluate(`window.handleOverlayEvent=event=>window.__source.onmessage({data:JSON.stringify(event)});
        document.body.style.background='rgb(255,0,255)';
        handleOverlayEvent({type:'chat.message',user:'Viewer',text:'Hello from chat',ts:Date.now()});
        handleOverlayEvent({type:'vote.update', question:'Which challenge should we play next?', options:[
        'Explore the mysterious abandoned castle', 'Try the hardest community challenge now',
        'Build a new village beside the waterfall', 'Race through the forest without stopping'
        ].map((label,i)=>({label,count:i+1})),endsAt:Date.now()+300000});`);
      await evaluate('document.fonts.ready');
      await new Promise(resolve => setTimeout(resolve, 400));
      const idle = await evaluate(`({vote:document.querySelector('#vote-card').getBoundingClientRect().toJSON(),
        frames:[...document.querySelectorAll('iframe')].map(f=>({name:f.title,hidden:f.hidden,rect:f.getBoundingClientRect().toJSON(),scheme:getComputedStyle(f).colorScheme})),
        questionFont:getComputedStyle(document.querySelector('#vote-question')).fontSize,
        optionFont:getComputedStyle(document.querySelector('.vote-label')).fontSize,
        overflow:document.querySelector('#vote-card').scrollHeight>document.querySelector('#vote-card').clientHeight})`);
      fs.writeFileSync(path.join(output, `${stage}-${width}-${theme}-idle.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      await evaluate(`handleOverlayEvent({type:'recap.card', lines:['Recap: last 10 minutes','Chat: 24 messages from 6 unique chatters','Most active: Viewer (8 messages)','Latest raid: Raider (42 viewers)','Last vote: none','Chat peak: 12:08 UTC (12 messages/min)'],ts:Date.now()});`);
      await new Promise(resolve => setTimeout(resolve, 400));
      fs.writeFileSync(path.join(output, `${stage}-${width}-${theme}-active.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      measurements.push({ width, height, theme, ...idle });
      await evaluate("document.body.style.background=''");
    }
  }
  fs.writeFileSync(path.join(output, `${stage}-measurements.json`), JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify(measurements, null, 2));
  await send('Browser.close');
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections(); server.close();
  // Only remove the exact temporary profile created above.
  if (profile.startsWith(path.join(os.tmpdir(), 'streamforge-browser-'))) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
