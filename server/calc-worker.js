import { parentPort } from 'node:worker_threads';
import { calculate } from './engine/calculator.js';

// Runs one package calculation off the main thread.
// The rate table is sent once per build and kept here.
let rates = { id: null, archetypes: null, factors: null };

parentPort.on('message', ({ id, inputs, settings, fx, rateBuild }) => {
  try {
    if (rateBuild) rates = rateBuild;
    const result = calculate(inputs, { archetypes: rates.archetypes, factors: rates.factors, settings, fx });
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
