import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

// A small pool of worker threads for the optimiser, so long searches run in
// parallel and never block other requests (deal search, saving, downloads).
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'calc-worker.js');
const SIZE = Math.max(2, Math.min(4, os.cpus().length));

const workers = [];
let nextId = 1;
const pending = new Map();

function spawn() {
  const w = new Worker(FILE);
  w.busy = 0;
  w.rateId = null;
  w.on('message', ({ id, result, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    w.busy--;
    error ? p.reject(new Error(error)) : p.resolve(result);
  });
  w.on('error', (e) => {
    for (const [id, p] of pending) if (p.worker === w) { pending.delete(id); p.reject(e); }
    workers.splice(workers.indexOf(w), 1, spawn());
  });
  return w;
}

export function calculateInWorker(inputs, ctx, buildId) {
  if (!workers.length) for (let i = 0; i < SIZE; i++) workers.push(spawn());
  const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = nextId++;
  const msg = { id, inputs, settings: ctx.settings, fx: ctx.fx };
  if (w.rateId !== buildId) {
    msg.rateBuild = { id: buildId, archetypes: ctx.archetypes, factors: ctx.factors };
    w.rateId = buildId;
  }
  w.busy++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker: w });
    w.postMessage(msg);
  });
}
